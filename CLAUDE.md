# CLAUDE.md - personal agent-stack repo

## What this repo is

The single source of truth for a personal coding-agent setup - **Claude Code and Cursor** -
not an application. It collects everything applied to *other* projects: the house-style
skills, the per-agent base instruction templates those projects extend, the hook scripts and
convention rules, and the installers that wire skills / MCP servers / plugins (Claude) or
rules (Cursor) into each project. Consuming projects pull from here - they do not own their
copy. Skills install via `npx skills add envoydev/agents-stack`; the rest is laid down by the
per-agent stack installers. The durable change always lives in *this* repo's source; a change
made only inside a consuming project is throwaway (see Invariants).

## Layout - one home per concern

- `skills/` - the personal house-style skills, each a `SKILL.md`. Auto-activate on their own
  keywords / file types in consuming projects. Distributed by `npx skills add envoydev/agents-stack`.
- `claude/` - the **Claude Code** stack:
  - `claude-stack.{sh,ps1}` installer (Unix / Windows) + `claude-stack.html` browser inventory.
  - `CLAUDE.template.md` - the stack-neutral base (with `<placeholders>`) that each consuming
    project's `CLAUDE.md` is filled in from. Content shipped to projects, not this repo's own file.
  - `hooks/` - `guard-protected-force-push.js` + `guard-catastrophic-rm.js` (PreToolUse `Bash`) +
    `guard-read-whole-file.js` (PreToolUse `Read`). Fetched into a project's `.claude/hooks/`.
  - `agents/` - the Claude-contract subagents, 32 total: the four build/test resolvers - .NET
    (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`,
    `angular-test-resolver`) - plus nine cross-cutting agents (`architecture-analyzer`,
    `task-analyzer`, `ci-failure-diagnoser`, `issue-diagnoser`, `greenfield-solution-designer`,
    `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor` - a read-only
    cross-stack security posture audit that routes an OWASP/CWE punch-list to the implementers, complementing
    `/security-review` - and `integration-reviewer`, the mandatory read-only cross-domain final gate that
    checks the assembled feature against the frozen contract before commit) - plus
    18 per-domain seats, the same 3-agent vertical repeated across 6 stacks (ASP.NET, Angular, WPF,
    mobile, data, DevOps): `<stack>-solution-designer` (decomposes into parallel tasks) → `<stack>-implementer`
    (builds one task, code + tests) → `<stack>-verifier` (gates the assembled build vs plan + quality,
    punch-list loop) - plus a read-only `evidence-gatherer` (sonnet/low) the two diagnosers dispatch to
    reproduce and pull logs, keeping the log volume off the opus seat. The `domain-build` skill orchestrates
    one stack's vertical per run, and the `subagent-flow` skill is the entry-point router above it - it picks
    the execution mode and, for cross-domain work, freezes the shared contract and drives the parallel
    per-stack runs through the `integration-reviewer` final gate. All 32 carry
    frontmatter model/effort pins (see the divergence table). Fetched into a project's
    `.claude/agents/`. Cursor ships twins of the four resolvers only (its own `cursor/agents/`, weaker
    contract - see the divergence table); the cross-cutting and per-domain agents are Claude-only.
  - `rules/` - eight path-scoped rules, lazy-loaded on a matching file touch: `markdown-docs.md`, the
    two repair-loop routers (`dotnet-repair-agents.md` / `angular-repair-agents.md`), and the five
    convention rules (`web-conventions.md` / `aspnet-conventions.md` / `wpf-conventions.md` /
    `sql-conventions.md` / `devops-conventions.md`) that glob-attach a file type to its house-style skill -
    the soft replacement for the retired require-convention-skill hard gate. Fetched into a project's
    `.claude/rules/`.
  - `README.md`.
- `cursor/` - the **Cursor** stack (peer of `claude/`):
  - `cursor-stack.{sh,ps1}` installer + `cursor-stack.html` inventory.
  - `AGENTS.template.md` - the Cursor analog: the stack-neutral base each project's `AGENTS.md`
    is filled in from (Cursor reads `AGENTS.md`).
  - `hooks/` - `guard-protected-force-push.js` + `guard-catastrophic-rm.js` in Cursor's
    `beforeShellExecution` contract.
  - `rules/` - `csharp` / `typescript` / `sql` / `angular`-conventions.mdc: soft, glob-auto-attaching
    convention rules - the same model Claude's `.claude/rules` convention rules now use.
  - `agents/` - the Cursor-contract twins of the four Claude resolver subagents (.NET build/test +
    Angular build/test; the nine pipeline agents have no Cursor twins), fetched into a project's
    `.cursor/agents/`. No `tools:` allowlist (only a `readonly` bool), so the bodies lean on
    `.cursor/rules` - as the Claude bodies now do too, both stacks having moved to soft convention rules.
  - `README.md`.
- `scripts/lint-skills.js` - the 4-way parity lint (below). `README.md` - repo overview.

## The two agent stacks - shared skills/MCPs, different delivery

`SKILLS` and `MCPS` are **shared** (identical across all four installers); the rest differs
because the platforms differ:

| | Claude Code (`claude/`) | Cursor (`cursor/`) |
|---|---|---|
| Skills | `npx skills add … --agent claude-code` → `.claude/skills` | `… --agent cursor` → `.cursor/skills` (Cursor Skills) |
| MCP | `claude mcp add` → `<repo>/.mcp.json` | written into `.cursor/mcp.json` (tokens pre-resolved) |
| Plugins | 7 via `claude plugin install` (superpowers, claude-md-management, the `*-lsp` pair, security-guidance, claude-hud, ponytail) | **none** - Cursor has no Claude-style `/plugin install` (its own format installs via `/add-plugin`); equivalents are MCP / native (Skills, Subagents, Bugbot `/review`, Rules) / Open-VSX extensions. ponytail additionally ships a Cursor rule that `cursor-stack` fetches (see `cursor-stack.html`'s mapping) |
| Hooks | `.claude/hooks/` wired into `.claude/settings.json` (3 hooks) | `.cursor/hooks.json` (force-push + catastrophic-rm - Cursor's contract differs) |
| Agents | `.claude/agents/` - 32 Claude subagents, all model/effort-pinned: the 4 build/test resolvers (`model: sonnet` + `effort: high`) + 9 cross-cutting agents (`architecture-analyzer`, `task-analyzer`, `ci-failure-diagnoser`, `issue-diagnoser`, `greenfield-solution-designer`, `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor` - read-only cross-stack security posture audit routing an OWASP/CWE punch-list to the implementers - and `integration-reviewer`, the mandatory cross-domain final gate before commit, all `model: opus` - `effort: xhigh` bar `task-analyzer` + `ci-failure-diagnoser` at `high`) + 18 per-domain seats - a 3-agent vertical repeated across 6 stacks (ASP.NET, Angular, WPF, mobile, data, DevOps): `<stack>-solution-designer` pinned `opus`/`xhigh`, `<stack>-verifier` pinned `sonnet`/`xhigh`, `<stack>-implementer` pinned `sonnet`/`medium`; the `domain-build` skill dispatches one stack's vertical per run; plus a read-only `evidence-gatherer` (`sonnet`/`low`) the two diagnosers dispatch to reproduce and pull logs, keeping the log volume off the opus seat. Fetched like hooks; per-tool `tools:` allowlist | `.cursor/agents/` - twins of the 4 RESOLVERS only, fetched like hooks; the cross-cutting and per-domain agents are Claude-only and no pin carries over (Cursor agents take a `model` field but have no `effort` pin - the twins inherit Cursor's session model). Cursor's contract is weaker: no per-tool allowlist (only a `readonly` bool) - its bodies lean on the auto-attaching `.cursor/rules`, as Claude's now do too |
| Convention gate | five path-scoped convention rules in `.claude/rules/` (soft, glob auto-attach - each points a file type at its house-style skill; replaced the `require-convention-skill` hard gate) | `.cursor/rules/*.mdc` (soft, auto-attach by glob - no session skill-load state) |
| Security review | `/security-review` (diff/PR) + `security-guidance` hooks (commit-time) + the `security-auditor` agent (opus/xhigh, read-only posture audit routing an OWASP/CWE punch-list to the implementers) | Cursor **Bugbot** (`/review`); the `security-auditor` agent is Claude-only |
| Project instructions | `CLAUDE.md` | `AGENTS.md` |
| LSP | `csharp-lsp` / `typescript-lsp` plugins | built-in TypeScript + Open-VSX extensions (a Roslyn C# extension - MS's C# Dev Kit is blocked in Cursor) |

## The model these templates encode

- **MCP servers are per-project, never global.** Active baseline (7): `context7` (docs),
  `serena` (symbol nav + edits + per-project memory), `playwright` (browser), `memory`
  (cross-project recall), plus `angular-cli` (framework-specific - comment out where not
  applicable), `chrome-devtools` (browser/extension debug) and `appium-mcp` (native mobile E2E -
  Capacitor/Ionic, needs Xcode/Android SDK + Java). The last two are heavy and fail at launch
  without their native deps - comment them out where not applicable. The `memory` MCP (one shared
  SQLite DB under `$HOME`) is the cross-project store - the per-project transient handoff runs
  on serena's local memory (durable orientation is the committed architecture docs), so comment
  `memory` out in a standalone project.
- **serena self-activates via `--project-from-cwd`**, not a hook: it finds `.serena/project.yml`
  in its cwd (the project root) and binds on process start, zero model involvement. Two approaches
  that look right but FAIL - do not retry: (1) an `mcp_tool` `SessionStart` hook calling
  `activate_project` never fires before serena connects; (2) `--project ${CLAUDE_PROJECT_DIR}` is the
  wrong lever - use `--project-from-cwd` (above). Current Claude Code *does* expand `${VAR}` /
  `${VAR:-default}` in `.mcp.json` (command/args/env/url/headers), so the blanket 'no `${...}`
  expansion' was too broad; the catch is only that `CLAUDE_PROJECT_DIR` isn't reliably in scope at
  `.mcp.json` parse time for a non-plugin config. Cursor runs
  serena with `--context ide-assistant`; Claude with `claude-code`.
- **serena state is isolated per project** via `-e SERENA_HOME=.serena/home` (relative, resolved
  from cwd): registry, logs, and language servers live in-project under `.serena/home`, and serena's
  project memories live alongside in `.serena/memories/` - so nothing pools across projects or
  accounts (default `~/.serena` keys off `$HOME`, merging every repo across both Claude config dirs).
  Cost: the LSP is re-downloaded per same-language project (~327MB for C# Roslyn); the whole `.serena/`
  must be gitignored (it holds the LSP cache and the memories).
- **serena holds local memory; the `memory` MCP is the cross-project store.** Three stores,
  don't conflate: the file-based auto-memory (`MEMORY.md` + `memory/*.md`, harness-injected);
  **serena's per-project memory** (`.serena/memories/`, name-addressed, local to the repo and
  gitignored - the store for the transient per-feature subagent handoff, not durable orientation); and the `memory`
  MCP (one SQLite DB under `$HOME`, shared across projects *and* accounts - active in the baseline
  for cross-project recall; a space arg names its DB `memory_<space>.db` and, on Claude, selects
  the `~/.claude-<space>` account). Comment `memory` out in a standalone project. Cross-project
  *structure* - which repos are related and where they live - lives in each repo's `## Related
  projects` CLAUDE.md section, not in memory.
- **Two stores, split by durability** - the second hard rule (peer of the read-whole-file rule
  below). The committed architecture docs - a lean `docs/architecture/ARCHITECTURE.md` core map plus the deep-dive
  files under `docs/architecture/references/` it links to - are the DURABLE truth: every seat READS them at start
  to orient (the structure, patterns, boundaries and packages already in place) instead of re-deriving
  the project, and `architecture-analyzer` owns them and updates them after each change lands. serena's
  per-project memory (`write_memory` / `read_memory` / `list_memories`, named
  `<feature>__<contract_version>__<seat>`, never the shared `memory` MCP) is the EPHEMERAL inter-agent
  comms bus - the transient per-feature handoff between seats: a diagnoser's task cards to the
  implementer, the implementer's build summary to the verifier, a short 'what to do' context note -
  info that is not durable architecture. serena memory is local and disposable; a reference that must
  survive a fresh clone belongs in the committed docs, not memory.
- **Never `Read` a whole file to find a symbol** - the hard rule shipped to both stacks: locate via
  serena (`find_symbol` / `find_referencing_symbols`) or the LSP; `Read` is for code already located.

## Working in THIS repo - invariants

- **Public repo.** No private project names or absolute personal paths in any tracked file - generic
  'consuming project' references only; real names / paths stay in untracked local files.
- **Parity / source-of-truth.** A change to skills / MCPs / hooks / rules / plugins lands in the
  SOURCE here, kept in parity: `SKILLS` + `MCPS` identical across all FOUR installers; `PLUGINS`
  claude-only (both `claude-stack` twins agree); each `.sh`/`.ps1` twin matches its sibling.
  **`npm run lint` enforces this 4-way** (and that the HTML agrees, and the skill count). Never patch
  only a generated `.mcp.json` / `.cursor/` tree or a consuming project's copy - the installer
  regenerates and silently wipes it.
- **One home per piece, no duplication.** A deterministic gate at a discrete event → a hook
  (`claude/hooks/` or `cursor/hooks/`). A per-file-type convention → a path-scoped rule that glob-attaches
  its house-style skill (`.claude/rules/` on Claude, `.cursor/rules/*.mdc` on Cursor). A keyword capability → the skill's own description. Cross-cutting guidance →
  the base template (`claude/CLAUDE.template.md` / `cursor/AGENTS.template.md`), filled into the
  project's `CLAUDE.md` / `AGENTS.md`. Never state one trigger twice.
- **Prove a behavioral change, don't assert it.** A change to a model / effort pin, a routing rule, or a
  plugin set - any claim the flow got cheaper or still catches the same bugs - ships only with evidence:
  run the affected build + tests yourself and read the code (never a run's self-report), measure the cost /
  token delta when the claim is about cost, and commit that evidence (a benchmark note or branch) BEFORE any
  reset. An earlier reset destroyed an unverified 'green' claim - so evidence lands first.
- **House voice:** direct, lean, single dashes not em-dashes, single quotes in prose, recommend one
  option with a reason.

## Maintenance gotchas

- The installer regenerates `.mcp.json` / the `.cursor/` tree on every run - fix the template, not
  the output.
- Editing a consuming project's installed copy is local-only; mirror the change into this repo's
  `claude/` + `cursor/` stack scripts (all four) or the next install wipes it.
- Hooks and Cursor rules are **fetched from GitHub** at install (`…/main/claude/hooks`,
  `…/main/cursor/hooks`, `…/main/cursor/rules`), so a change ships only once committed + pushed;
  until then the per-hook / per-rule fail-soft keeps any existing copy.
- Authoring or editing a house skill in skills/? The superpowers writing-skills method is a useful
  reference - subordinate it to the 4-way parity lint, the HTML + skill-count sync, and the house
  voice; take its skill-testing discipline, not its own formatting or its push-to-fork deploy step.
