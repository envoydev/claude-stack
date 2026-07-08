# Cursor stack (`cursor-stack`)

Two twin scripts that install (or update) the **complete Cursor stack into a project** - skills,
MCP servers, hooks, convention rules, and subagents from the curated inventory in `cursor-stack.html`. The
result is a **self-contained `.cursor/` tree** with zero dependency on `.claude` or the `claude`
CLI. The agent is the script you run, so there is **no agent argument**. (Claude Code is the peer
in [`../claude/`](../claude/README.md).)

| Script             | System        | Shell                                   |
| ------------------ | ------------- | --------------------------------------- |
| `cursor-stack.sh`  | macOS / Linux | `bash`                                  |
| `cursor-stack.ps1` | Windows       | PowerShell 5.1 (Desktop) or 7+ (`pwsh`) |

The `.sh`/`.ps1` twins take the **same arguments** and produce the **same result**.

> `SKILLS` and `MCPS` are shared with the Claude scripts (the repo lint enforces parity across all
> four). Cursor has **no `/plugin install`** system, so there is no plugins block here - Claude's
> plugins map to Cursor natives / Open-VSX extensions / MCPs instead (see below). To trim or extend,
> comment/uncomment manifest entries near the top of the script, then re-run; `npm run lint` (repo
> root) verifies the manifests agree.

---

## What gets installed

| Component | Lands in | Notes |
| --------- | -------- | ----- |
| **Skills** (51) | `.cursor/skills/` | real copies; run as Cursor Skills (`agentskills.io`); includes `domain-build` per-domain orchestration + `subagent-flow` cross-domain routing. `npx skills add … --agent cursor` |
| **MCP servers** (6) | `.cursor/mcp.json` | `angular-cli`, `serena` (`--context ide-assistant`), `playwright`, `context7`, plus `chrome-devtools` + `appium-mcp` (heavy - active; comment out where not needed); `memory` is now opt-in (commented - cross-project recall only). Cursor supports MCP natively; shell `${…}` tokens are resolved to concrete paths (Cursor does no shell interpolation) |
| **Hooks** (2) | `.cursor/hooks/` + `.cursor/hooks.json` | `guard-protected-force-push` + `guard-catastrophic-rm` (`beforeShellExecution`): block force-push to main/master/develop and a recursive rm of /, ~, $HOME, or a bare *. Fetched from the repo's `cursor/hooks/` |
| **Rules** (7) | `.cursor/rules/` | `csharp` / `typescript` / `sql` / `angular`-conventions.mdc (house conventions, auto-attach by glob) + `wpf-conventions.mdc` (`.xaml`, opt-in for WPF repos) + `scss-conventions.mdc` (`.scss`/`.css`, opt-in for Angular workspaces owning their stylesheets) + `ponytail.mdc` (minimal-code, `alwaysApply`; fetched from the ponytail repo, not vendored here) |
| **Agents** (4) | `.cursor/agents/` | .NET (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`, `angular-test-resolver`) - the same four resolvers the Claude stack ships, in Cursor's weaker contract: a `readonly` bool rather than a per-tool allowlist. Conventions are soft auto-attaching rules in both stacks now, so the bodies lean on the rules above. Fetched from the repo's `cursor/agents/` |

### Install cadence - keep always vs install on occasion

Cost differs by artifact, so the keep-or-skip call does too:

- **Skills** - permanent by default: keyword-gated and ~free when idle, so install all and let them self-gate. Whole-domain sets (the Ionic/Capacitor `mobile` group, `dotnet-wpf`) are optional only if you never touch that domain.
- **MCPs** - real launch cost, so split: baseline `context7` / `serena` / `playwright`; domain-gated `angular-cli` (Angular projects only); opt-in `chrome-devtools` and `appium-mcp` (heavy native deps) and `memory` (cross-project recall only - the per-project handoff runs on serena) - all left commented out unless needed.
- **Rules and agents** - permanent: the convention rules auto-attach by glob (free when no file matches) and `ponytail.mdc` is `alwaysApply`; the four resolver agents run on demand. Cursor has no plugins - the Claude `*-lsp` pair maps to per-language Open-VSX extensions (install those matching the project's languages); design-taste guidance for distinctive UI now lives in the `frontend` skill (installed like any Cursor skill), not a plugin.

To provision Claude Code too, run [`../claude/claude-stack.*`](../claude/README.md).

---

## Plugins - there is no `/plugin install` in Cursor

Cursor adds capabilities three ways, none a Claude-style plugin marketplace:

- **MCP servers** (native) - the five above, plus anything else in `.cursor/mcp.json`.
- **Native features** - Skills, Commands, Rules, Subagents (`.cursor/agents/` - the four resolvers
  this script installs), and **Bugbot** (`/review`) for security review.
- **Open-VSX VS Code extensions** - e.g. a Roslyn-based C# extension
  (DotRush / `muhammad-sammy.csharp` / ReSharper) since Microsoft's C# Dev Kit is blocked in Cursor.
  TypeScript diagnostics are built in. *(These are not installed by this script.)*

**Recommended manual add - `superpowers`.** The Claude stack installs the `superpowers` workflow
plugin; it ships a Cursor plugin too (a `.cursor-plugin` manifest with 14 workflow skills +
Cursor hooks). Get it with a one-time **`/add-plugin superpowers`** in Cursor chat - `cursor-stack`
can't script that UI step, so it's not auto-installed here.

`cursor-stack.html` has the full **"Claude plugins → Cursor equivalent"** map. The Claude
marketplace plugins themselves can't run in Cursor - only the MCP servers bundled inside them port
(e.g. `context7`). There is **no Cursor GUI equivalent of a statusline HUD** (`claude-hud`); the
closest is the Cursor **CLI** `/statusline` (terminal-only, scriptable) - not installed here.

---

## Convention rules

The `.cursor/rules/*.mdc` carry the house conventions per file type. They are **soft guidance**
(auto-attached by glob when a matching file is in context), **not** a hard pre-edit block - Cursor
has no session "skill loaded" state and no stable pre-edit deny. The conventions themselves live in
the matching skill under `.cursor/skills/`.

| File types | House skill | Rule |
| ---------- | ----------- | ---- |
| `.cs` | `csharp` | `csharp-conventions.mdc` |
| `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs` | `typescript` | `typescript-conventions.mdc` |
| `.sql` | `database-conventions` | `sql-conventions.mdc` |
| `.component.ts` / `.service.ts` / … / `.component.html` | `angular-conventions` | `angular-conventions.mdc` |

An Angular `*.component.ts` matches both the TypeScript and Angular rules, so both attach together.

---

## Prerequisites

The script runs a **prerequisites check first and warns (never fails)** - install what you need, then re-run.

| Tool | Needed for | Required? | Install (macOS/Linux) | Install (Windows) |
| ---- | ---------- | --------- | --------------------- | ----------------- |
| **node** ≥ 22.12 LTS | the Cursor hook (runs via `node`), `npx` MCPs, skills CLI | **Yes** | `brew install node` / nvm | `winget install OpenJS.NodeJS.LTS` |
| **npx** | skills CLI (ships with node) | **Yes** | (with node) | (with node) |
| **git** | project-scope path resolution (repo root) | **Yes** for project scope | `brew install git` | `winget install Git.Git` |
| **uvx** (uv) | `serena` (+ `memory` if enabled) MCPs | for those MCPs | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `irm https://astral.sh/uv/install.ps1 \| iex` |
| **python3** | the `.cursor/mcp.json` + `.cursor/hooks.json` merges (**bash only** - PowerShell merges natively) | **Yes** (bash) | `brew install python` | `winget install Python.Python.3.12` (Store stub does **not** count) |
| **curl** / `Invoke-WebRequest` | fetching the hook + rule files | for hooks/rules | preinstalled | preinstalled |
| **brew** / **winget** | `github-cli` extra only | optional | Homebrew | winget |

The **`claude` CLI is never used**. C# LSP (`csharp-ls`) is only relevant if you add
the corresponding Open-VSX extension yourself - this script does not install extensions.

---

## Before you run - environment variables & keys

### `SCOPE` - where the `.cursor/` tree lands (default `project`)

| Value | Cursor tree | Skills |
| ----- | ----------- | ------ |
| `project` (default) | `<repo>/.cursor/` | project-scoped |
| `global` | `~/.cursor/` | `-g` |

```bash
SCOPE=global bash cursor-stack.sh install            # macOS/Linux
$env:SCOPE = 'global'; pwsh cursor-stack.ps1 install # Windows
```

### `CONTEXT7_API_KEY` - the one secret (optional)

The `context7` MCP reads it from the environment at launch. Leave it unset in your install shell so
the registration stays keyless, and set it as a persistent OS/user env var (or in your shell
profile). `CLAUDE_CONFIG_DIR` is **not** used - Cursor resolves everything under `~/.cursor`.

---

## How to run

The **action** (`install` | `update`) is **required**; every other argument is optional with a default.

```bash
cd /path/to/your/project        # run inside the target project
bash cursor-stack.sh install
bash cursor-stack.sh update

# Optional extras (args 2+, any order): a space (separate memory DB), install gh, context7 transport
bash cursor-stack.sh install work            # space 'work' -> memory_work.db
bash cursor-stack.sh install github-cli
bash cursor-stack.sh install context7-local  # local npx context7 (default: remote hosted server)
```

```powershell
Set-Location C:\path\to\your\project
pwsh cursor-stack.ps1 install
pwsh cursor-stack.ps1 install work          # space 'work' -> memory_work.db (positional)
pwsh cursor-stack.ps1 install -GitHubCli    # install gh (switch)
pwsh cursor-stack.ps1 install -Context7 local  # local npx context7 (default: remote)
```

> On Windows PowerShell 5.1 use `powershell` instead of `pwsh`. If scripts are blocked, run once:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

For Cursor, **`install` and `update` are effectively the same**: a clean skill re-add, then the
`.cursor/` tree (mcp.json, hooks, rules) is rewritten either way.

---

## Memory database

Cursor and Claude Code share **`~/.memory-mcp`** so both see the same DB: default `memory.db`, or
`memory_<space>.db` with a **space** (e.g. `work`). The path is resolved at install time and baked into
`.cursor/mcp.json`.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| MCP dies at launch with `-32000` | Node too old (use ≥ 22.12 LTS); or a stale npm cache against a freshly pinned version. |
| `serena` / `memory` MCP missing | `uvx` not installed - install uv (see prereqs). `memory` also needs numpy, injected via `--with numpy`. |
| `.cursor/mcp.json` or `hooks.json` not written | Python 3 missing (bash path) - on Windows the Store stub doesn't count. |
| Hook / rule not installed | Fetched from GitHub (`…/main/cursor/hooks` and `…/cursor/rules`); needs `curl`/`Invoke-WebRequest` and the files pushed upstream. Fail-soft keeps any existing copy. |
| "not in a git repo - skipping…" | Project scope needs a git repo. Run `git init`, or use `SCOPE=global`. |
| C# diagnostics absent | Cursor doesn't get the Claude LSP plugins - install a Roslyn C# extension from Open VSX (see the plugins section). |
