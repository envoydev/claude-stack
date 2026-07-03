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
  - `hooks/` - `require-convention-skill.js` (PreToolUse `Edit|Write` convention gate) +
    `guard-protected-force-push.js` + `guard-catastrophic-rm.js` (PreToolUse `Bash`) +
    `guard-read-whole-file.js` (PreToolUse `Read`). Fetched into a project's `.claude/hooks/`.
  - `agents/` - the Claude-contract subagents, 28 total: the four build/test resolvers - .NET
    (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`,
    `angular-test-resolver`) - plus eight cross-cutting analysis agents (`architecture-analyzer`,
    `task-analyzer`, `ci-failure-diagnoser`, `issue-diagnoser`, `greenfield-solution-designer`,
    `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor` - the last a read-only
    cross-stack security posture audit that routes an OWASP/CWE punch-list to the implementers, complementing
    `/security-review`) - plus
    15 per-domain seats, the same 3-agent vertical repeated across 5 stacks (ASP.NET, Angular, WPF,
    mobile, data): `<stack>-solution-designer` (decomposes into parallel tasks) → `<stack>-implementer`
    (builds one task, code + tests) → `<stack>-verifier` (gates the assembled build vs plan + quality,
    punch-list loop) - plus a read-only `evidence-gatherer` (sonnet/medium) the two diagnosers dispatch to
    reproduce and pull logs, keeping the log volume off the opus seat. The `domain-build` skill orchestrates
    one stack's vertical per run. All 28 carry
    frontmatter model/effort pins (see the divergence table). Fetched into a project's
    `.claude/agents/`. Cursor ships twins of the four resolvers only (its own `cursor/agents/`, weaker
    contract - see the divergence table); the cross-cutting and per-domain agents are Claude-only.
  - `rules/` - `markdown-docs.md` / `dotnet-repair-agents.md` / `angular-repair-agents.md`: three
    path-scoped routing files, lazy-loaded on matching file reads. Fetched into a project's
    `.claude/rules/`.
  - `README.md`.
- `cursor/` - the **Cursor** stack (peer of `claude/`):
  - `cursor-stack.{sh,ps1}` installer + `cursor-stack.html` inventory.
  - `AGENTS.template.md` - the Cursor analog: the stack-neutral base each project's `AGENTS.md`
    is filled in from (Cursor reads `AGENTS.md`).
  - `hooks/` - `guard-protected-force-push.js` + `guard-catastrophic-rm.js` in Cursor's
    `beforeShellExecution` contract.
  - `rules/` - `csharp` / `typescript` / `sql` / `angular`-conventions.mdc: the convention gate
    re-expressed as soft, glob-auto-attaching `.cursor/rules` (Cursor has no skill-load gate).
  - `agents/` - the Cursor-contract twins of the four Claude resolver subagents (.NET build/test +
    Angular build/test; the nine pipeline agents have no Cursor twins), fetched into a project's
    `.cursor/agents/`. No `tools:` allowlist (only a `readonly` bool) and no hard convention gate, so
    the bodies lean on `.cursor/rules`.
  - `README.md`.
- `scripts/lint-skills.js` - the 4-way parity lint (below). `README.md` - repo overview.

## The two agent stacks - shared skills/MCPs, different delivery

`SKILLS` and `MCPS` are **shared** (identical across all four installers); the rest differs
because the platforms differ:

| | Claude Code (`claude/`) | Cursor (`cursor/`) |
|---|---|---|
| Skills | `npx skills add … --agent claude-code` → `.claude/skills` | `… --agent cursor` → `.cursor/skills` (Cursor Skills) |
| MCP | `claude mcp add` → `<repo>/.mcp.json` | written into `.cursor/mcp.json` (tokens pre-resolved) |
| Plugins | 8 via `claude plugin install` (superpowers, claude-md-management, the `*-lsp` pair, security-guidance, frontend-design, claude-hud, ponytail) | **none** - Cursor has no Claude-style `/plugin install` (its own format installs via `/add-plugin`); equivalents are MCP / native (Skills, Subagents, Bugbot `/review`, Rules) / Open-VSX extensions. ponytail additionally ships a Cursor rule that `cursor-stack` fetches (see `cursor-stack.html`'s mapping) |
| Hooks | `.claude/hooks/` wired into `.claude/settings.json` (4 hooks) | `.cursor/hooks.json` (force-push + catastrophic-rm - Cursor's contract differs) |
| Agents | `.claude/agents/` - 28 Claude subagents, all model/effort-pinned: the 4 build/test resolvers (`model: sonnet` + `effort: high`) + 8 cross-cutting analysis agents (`architecture-analyzer`, `task-analyzer`, `ci-failure-diagnoser`, `issue-diagnoser`, `greenfield-solution-designer`, `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor` - read-only cross-stack security posture audit routing an OWASP/CWE punch-list to the implementers, all `model: opus` + `effort: xhigh`) + 15 per-domain seats - a 3-agent vertical repeated across 5 stacks (ASP.NET, Angular, WPF, mobile, data): `<stack>-solution-designer` pinned `opus`/`xhigh`, `<stack>-verifier` pinned `sonnet`/`xhigh`, `<stack>-implementer` pinned `sonnet`/`medium`; the `domain-build` skill dispatches one stack's vertical per run; plus a read-only `evidence-gatherer` (`sonnet`/`medium`) the two diagnosers dispatch to reproduce and pull logs, keeping the log volume off the opus seat. Fetched like hooks; per-tool `tools:` allowlist + `Skill`-tool gate | `.cursor/agents/` - twins of the 4 RESOLVERS only, fetched like hooks; the cross-cutting and per-domain agents are Claude-only and no pin carries over (Cursor agents take a `model` field but have no `effort` pin - the twins inherit Cursor's session model). Cursor's contract is weaker: no per-tool allowlist (only a `readonly` bool), and no hard convention gate - so the bodies lean on the auto-attaching `.cursor/rules` instead of a Skill-load gate |
| Convention gate | `require-convention-skill` hook (hard block until the skill is loaded; base cs/ng/sql/ts tables plus scss/xaml opt-in tables wired per repo shape) | `.cursor/rules/*.mdc` (soft, auto-attach by glob - no session skill-load state) |
| Security review | `/security-review` (diff/PR) + `security-guidance` hooks (commit-time) + the `security-auditor` agent (opus/xhigh, read-only posture audit routing an OWASP/CWE punch-list to the implementers) | Cursor **Bugbot** (`/review`); the `security-auditor` agent is Claude-only |
| Project instructions | `CLAUDE.md` | `AGENTS.md` |
| LSP | `csharp-lsp` / `typescript-lsp` plugins | built-in TypeScript + Open-VSX extensions (a Roslyn C# extension - MS's C# Dev Kit is blocked in Cursor) |

## The model these templates encode

- **MCP servers are per-project, never global.** Active baseline (7): `context7` (docs),
  `serena` (symbol nav + edits + memory), `playwright` (browser), `memory` (cross-project
  recall), plus `angular-cli` (framework-specific - comment out where not applicable),
  `chrome-devtools` (browser/extension debug) and `appium-mcp` (native mobile E2E -
  Capacitor/Ionic, needs Xcode/Android SDK + Java). The last two are heavy and fail at launch
  without their native deps - comment them out where not applicable.
- **serena self-activates via `--project-from-cwd`**, not a hook: it finds `.serena/project.yml`
  in its cwd (the project root) and binds on process start, zero model involvement. Two approaches
  that look right but FAIL - do not retry: (1) an `mcp_tool` `SessionStart` hook calling
  `activate_project` never fires before serena connects; (2) `--project ${CLAUDE_PROJECT_DIR}` is
  passed *literally* - Claude Code does not expand `${...}` inside `.mcp.json` args. Cursor runs
  serena with `--context ide-assistant`; Claude with `claude-code`.
- **serena state is isolated per project** via `-e SERENA_HOME=.serena/home` (relative, resolved
  from cwd): registry, memories, logs, and language servers all live in-project, so nothing pools
  across projects or accounts (default `~/.serena` keys off `$HOME`, merging every repo across
  both Claude config dirs). Cost: the LSP is re-downloaded per same-language project (~327MB for C#
  Roslyn); `.serena/home/` must be gitignored.
- **serena isolates, the `memory` MCP shares** - granularity follows each tool's scope. Three
  stores, don't conflate: the file-based auto-memory (`MEMORY.md` + `memory/*.md`, harness-injected);
  serena's per-project memories (under `.serena/home`); the `memory` MCP (one SQLite DB under
  `$HOME`, shared across projects *and* accounts - that's the point; `MemoryProfile=work` →
  `memory_work.db` for a work/personal split; narrow to a single product only by overriding
  `MCP_MEMORY_SQLITE_PATH`).
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
  (`claude/hooks/` or `cursor/hooks/`). A per-file-type convention → the Claude convention gate /
  a Cursor rule. A keyword capability → the skill's own description. Cross-cutting guidance →
  the base template (`claude/CLAUDE.template.md` / `cursor/AGENTS.template.md`), filled into the
  project's `CLAUDE.md` / `AGENTS.md`. Never state one trigger twice.
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
