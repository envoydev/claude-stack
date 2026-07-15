# Design - `claude-stack` setup plugin

Date: 2026-07-15
Status: approved design, pre-implementation

## Goal

Ship a Claude Code plugin that bundles a single skill (`setup-claude-stack`) which bootstraps the
full Claude stack into a target project: detect the environment, analyse the project, interactively
curate a dependency-correct selection of skills / agents / rules / MCPs / plugins, check
prerequisites, and run the existing `claude-stack.{sh,ps1}` installer against that computed subset.

The plugin is the delivery vehicle only. The `.sh` / `.ps1` installers stay the single source of
truth for how anything is wired; the skill is a friendly, project-aware, dependency-aware front end
over them.

## Non-goals

- Not re-homing skills / agents / rules / hooks into the plugin. They keep their existing homes
  (`npx skills add` for skills; per-project fetch for the rest). The plugin ships only the setup
  skill and, optionally, a `/claude-stack` command.
- Not replacing or forking the installers. They gain one backward-compatible flag; everything else
  is unchanged.
- Not a global install of the stack. The per-project model (per-repo `.mcp.json`, per-project
  rules / agents / hooks, per-project trimming) is preserved - the skill just automates the
  trimming.
- Cursor is out of scope for v1 (Cursor has no Claude-plugin format). Noted as a follow-up.

## Flow (what the user experiences)

1. `claude plugin marketplace add envoydev/agents-stack` then `claude plugin install claude-stack@envoydev-agents-stack` (one-time).
2. Inside a target project, invoke the skill (`/setup-claude-stack`).
3. The skill:
   1. **Detects** OS + analyses the project (languages, frameworks, project files) and recommends stacks.
   2. **Asks the scalar choices** via AskUserQuestion: scope, space, context7 transport, github-cli, keep-pins (requirement 3.1).
   3. **Downloads** the right installer for the OS (`claude-stack.sh` on Unix, `claude-stack.ps1` on Windows) from `main`.
   4. **Computes the selection + dependency closure** from `stack-graph.json`.
   5. **Presents an editable selection manifest** for review / deselect, then re-applies closure.
   6. **Runs the two-phase prerequisites check** and reports blockers / warnings.
   7. **Runs the installer** with `--selection <file>` plus the scalar flags. On Windows/TypeScript the `.ps1` already delegates to `scripts/fix-serena-ts-windows.ps1`.
   8. **Post-check** - reports pending follow-ons (LSP tools, `/claude-hud:setup`, trust prompts).

## Components

Build order: A -> B -> D -> C (each independently testable; C ties them together).

### A. `stack-graph.json` - the dependency graph

- **Location:** committed at `scripts/stack-graph.json`, regenerated and validated by
  `scripts/lint-skills.js` - the same script that already resolves the cross-reference tokens.
- **Sync discipline:** `npm run lint` validates the committed graph against a fresh extraction and
  fails on drift (the same pattern as the HTML-in-sync check today); a `--write` mode updates it.
  So the graph is a generated artifact CI keeps honest, never hand-maintained.
- **Edge derivation** (matches the approved closure rules - skills do not pull other skills):
  - **agent -> skill**: prefer the agent's `skills:` frontmatter (declared, accurate - present on
    18/33 today); fall back to backtick-resolved skill tokens in the body for agents without it,
    and record which source was used.
  - **rule -> skill / agent**: backtick-resolved tokens in the rule body, plus the `paths:` glob
    from frontmatter.
  - **skill / agent / rule -> mcp**: backtick-resolved MCP tokens.
  - **skill / agent / rule -> plugin**: backtick-resolved plugin tokens; a plugin-provided skill
    name maps to its owning plugin.
- **Schema (sketch):**
  ```json
  {
    "generatedBy": "lint-skills",
    "skills": { "dotnet-data-access": { "mcps": ["serena"], "plugins": [] } },
    "agents": { "aspnet-solution-designer": {
      "skills": ["dotnet", "dotnet-web-backend", "dotnet-testing", "project-solution-design"],
      "skillsSource": "frontmatter", "agents": [], "mcps": [], "plugins": [] } },
    "rules":  { "csharp-conventions": { "skills": ["csharp"], "agents": [], "paths": ["**/*.cs"] } },
    "catalog": { "mcps": ["serena", "context7", "..."], "plugins": ["superpowers", "..."] }
  }
  ```

### B. Installer subset mode

- **New flag:** `--selection <file>` on both `claude-stack.sh` and `claude-stack.ps1`
  (kept in twin parity - the lint already enforces `.sh`/`.ps1` parity).
- **Selection file format:** line-oriented for trivial shell + PowerShell parsing - one
  `category name` per line, e.g. `skill csharp`, `agent aspnet-implementer`, `mcp serena`,
  `plugin superpowers`, `rule csharp-conventions`. Comments (`#`) and blank lines ignored.
- **Behavior:** when `--selection` is present, each hardcoded array (`SKILLS`, `AGENTS`,
  `CLAUDE_RULES`, `MCPS`, `PLUGINS`) is filtered to the names listed. Absent flag = today's
  install-everything behavior (fully backward compatible). A listed name absent from an array is a
  skip-with-warning, never a hard error.
- **The installer stays dumb.** Closure is computed by the skill (C); the installer only honors the
  final list. This keeps all graph logic in one place.

### C. The setup skill (plugin-bundled)

- **Plugin scaffolding:** a `.claude-plugin/marketplace.json` (this repo becomes its own marketplace)
  plus the plugin manifest and the skill under it. Optionally a `/claude-stack` command aliasing the
  skill.
- **Deterministic logic in a bundled helper.** The closure computation and prerequisite evaluation
  live in a small zero-dep helper (`stack-select.js`, in the spirit of `analyze-usage.js`), so they
  are testable and reliable rather than LLM-reasoned. The skill orchestrates: analyse project ->
  call helper -> present manifest -> run installer. The helper reads `stack-graph.json` + a raw
  selection + a detected-environment blob and emits (a) the closed selection and (b) the prereq
  report.
- **Project analysis heuristics:** file-glob signals -> recommended stacks, e.g. `*.csproj`/`*.sln`
  -> .NET (surface split by `Microsoft.NET.Sdk.Web` vs WPF/`UseWPF` vs worker/console);
  `angular.json` -> Angular; `ionic.config.json`/`capacitor.config.*` -> mobile;
  `Dockerfile`/`.github/workflows` -> devops; `*.sql`/migrations -> data.
- **Selection manifest (`stack-selection` file):** human-editable, recommended items pre-checked,
  required/locked items clearly marked and commented with why. The user deselects by editing, then
  confirms. After the edit the helper re-applies closure.
- **Required-but-deselected handling:** if the user removes a locked item, the helper re-adds it and
  prints one line naming which agent / rule / kept-skill pulled it - no silent override, no hard
  error.
- **Then:** serialize the final closed selection to the installer's `--selection` format and run the
  installer with the scalar flags from step 3.2.

### D. Preflight prerequisites check

- **A curated prerequisite map** in the helper (small, stable, honest - sourced from what the
  installer + `CLAUDE.md` already document, not auto-derived), keyed by item -> required binary /
  env var / native dep.
- **Phase 1 - upfront hard prereqs** (before anything, regardless of selection): `node`/`npx`,
  `git`, the `claude` CLI, `uvx` (serena). A miss here is a hard blocker - stop with the install
  command.
- **Phase 2 - selection-scoped prereqs** (after selection, before the installer) - only for kept
  items:

  | Kept item | Needs |
  |---|---|
  | `sentry` MCP | `SENTRY_ACCESS_TOKEN` env var (present + non-empty) |
  | `context7` local + bake | `CONTEXT7_API_KEY` |
  | `csharp-lsp` plugin | `csharp-ls` dotnet tool + `dotnet` SDK on PATH |
  | any .NET stack | `dotnet` SDK (`dotnet --version`) |
  | `chrome-devtools` MCP | Chrome / Chromium binary |
  | `appium-mcp` MCP | Xcode / Android SDK / Java (probed) |
  | `--github-cli` extra | Homebrew (macOS) |

- **Report format:** a grouped list - `present` / `missing -> how to get it` - split into
  **blockers** (a kept item won't work without it) and **warnings** (soft / optional). Keys are
  report-only (the skill tells the user the exact env var to export; it never sets or echoes a
  secret). Tools it can offer to install go through existing paths (`csharp-ls` via
  `dotnet tool install -g`, `gh` via the installer's `--github-cli`). Never silently proceeds past a
  blocker - it lists them and asks: fix-then-continue, or drop the affected items from the selection.

## Error handling

- Hard prereq missing (Phase 1) -> stop, print the install command, do not download or install.
- Soft prereq missing (Phase 2) -> warn, offer fix-or-drop.
- Installer non-zero / `note_failure` summary -> surface it verbatim; the installer is already
  fail-soft per item.
- Trust prompts on first `claude plugin install` -> the skill warns the user they may be prompted
  (cannot be fully silent).
- Selection listing an unknown name -> skip with a warning line.

## Testing

- **A (graph):** `npm run lint --write` then assert known edges on fixtures - e.g.
  `aspnet-solution-designer.skills == [dotnet, dotnet-web-backend, dotnet-testing,
  project-solution-design]`, `csharp-conventions.skills == [csharp]`. Drift check: a stale committed
  graph fails lint.
- **B (subset):** a `--dry-run` (or existing echo path) over a selection file asserts only the listed
  items resolve; `bash -n` / `shellcheck` + PowerShell parse check for both twins.
- **C/D (helper):** unit-test the pure functions in `stack-select.js` - closure computation
  (agent/rule pulls, required-but-deselected re-add) and prereq evaluation (map + detected-env blob
  -> blockers/warnings) with table-driven cases. The interactive skill prose is tested by dispatch
  scenarios, not asserted mechanically.

## Parity / lint impact

- `stack-graph.json` is a new committed artifact - added to the lint's generate-and-verify set.
- `--selection` must stay identical across `.sh` / `.ps1` (existing twin-parity lint covers it).
- The `setup-claude-stack` skill is plugin-only, not in the `SKILLS` array - the lint gets a small
  carve-out so it is not expected there.

## Open questions / risks

- **Marketplace bootstrap:** the user must add the marketplace before installing the plugin -
  documented in the README + the plugin's own description.
- **New parity surface:** the committed graph is one more thing to keep in sync; mitigated by making
  it lint-generated and CI-guarded.
- **Cursor follow-up:** an equivalent Cursor delivery (a Cursor skill, since no Claude-plugin format)
  is a separate future spec.

## Build order recap

1. **A** - teach `lint-skills.js` to emit + verify `stack-graph.json`.
2. **B** - `--selection` subset mode on both installers.
3. **D** - the prerequisite map + evaluator in `stack-select.js`.
4. **C** - the plugin scaffolding + `setup-claude-stack` skill wiring A/B/D into the flow.
