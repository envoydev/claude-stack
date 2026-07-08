# Claude Code stack (`claude-stack`)

Two twin scripts that install (or update) the **complete Claude Code stack into a project** -
every skill, plugin, MCP server, and hook from the curated inventory in `claude-stack.html`.
Built-in/system CLI skills are excluded (they ship with the CLI). The agent is the script you
run, so there is **no agent argument**. (Cursor is the peer in [`../cursor/`](../cursor/README.md).)

> The subagent roster - the per-domain specialist team and the cross-cutting agents - is laid out
> visually at the top of [`claude-stack.html`](claude-stack.html), above the full stack inventory it now folds in.

| Script             | System        | Shell                                   |
| ------------------ | ------------- | --------------------------------------- |
| `claude-stack.sh`  | macOS / Linux | `bash`                                  |
| `claude-stack.ps1` | Windows       | PowerShell 5.1 (Desktop) or 7+ (`pwsh`) |

The `.sh`/`.ps1` twins take the **same arguments** and produce the **same result**;
everything below applies to both unless a row is marked otherwise.

> The scripts are the **single source of truth** for the stack. `SKILLS` and `MCPS` are shared
> with the Cursor scripts (identical across all four); `PLUGINS` are Claude-only. To trim or
> extend, comment/uncomment entries in the manifest blocks near the top, then re-run. After
> editing, run the repo lint (`npm run lint` from the repo root) - it verifies all four manifests
> agree (and match the HTML).

---

## What gets installed

| Component | Count | Notes |
| --------- | ----- | ----- |
| **Skills**  | 51 | conventions + utilities (ticket writers, C#/.NET, Angular/TS, SQL, `domain-build` per-domain orchestration + `subagent-flow` cross-domain routing) - `npx skills add … --agent claude-code` |
| **Plugins** | 8  | `superpowers`, `claude-md-management`, `csharp-lsp`, `typescript-lsp`, `security-guidance`, `claude-hud`, `ponytail`, `caveman` - `claude plugin install` (needs the `claude` CLI) |
| **MCP servers** | 7 | `angular-cli`, `serena`, `playwright`, `memory`, `context7`, plus `chrome-devtools` + `appium-mcp` (heavy - active; comment out where not needed). `memory` is cross-project recall (the subagent handoff runs on serena) - comment it out in a standalone project → `<repo>/.mcp.json` |
| **Hooks** | 3 | `guard-protected-force-push` (blocks force-push to main/master/develop) + `guard-catastrophic-rm` (blocks recursive rm of /, ~, $HOME, or a bare *) + `guard-read-whole-file` (PreToolUse Read - blocks a whole-file Read of a >100-line source file, locate via serena first) → `.claude/hooks/` + wired into `.claude/settings.json` |
| **Agents** | 32 | 4 resolvers - .NET (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`, `angular-test-resolver`): implement-phase build/test fix loops, serena-driven, iteration-capped, no reward-hacking, pinned sonnet/high - plus 9 cross-cutting agents (`architecture-analyzer`, `task-analyzer`, `greenfield-solution-designer`, `ci-failure-diagnoser`, `issue-diagnoser`, `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor`, `integration-reviewer` - the last the mandatory cross-domain final gate before commit, all read-only, pinned opus/xhigh - bar task-analyzer + ci-failure-diagnoser at opus/high) - plus 18 per-domain seats, a 3-agent vertical repeated across 6 stacks (ASP.NET, Angular, WPF, mobile, data, DevOps): `<stack>-solution-designer` (opus/xhigh - decomposes into parallel tasks) → `<stack>-implementer` (sonnet/medium - builds one task, code + tests) → `<stack>-verifier` (sonnet/xhigh - gates the build vs plan + quality, loops back) - plus a read-only `evidence-gatherer` (sonnet/low) the two diagnosers dispatch to reproduce and pull logs, keeping the log volume off the opus seat; every seat bar `evidence-gatherer` also uses serena's per-project memory as the hand-off bus (read a note named `<feature>__<contract_version>__<seat>` at start, write one at hand-off) → `.claude/agents/` |
| **Rules** | 8 | markdown authoring + per-language repair-loop routing + the 5 convention rules (angular/web/ionic, asp.net, wpf, sql, devops - each glob-attaches a file type to its house-style skill, the soft replacement for the retired convention-gate hook), all path-scoped → `.claude/rules/` |

### Install cadence - keep always vs install on occasion

Cost differs by artifact, so the keep-or-skip call does too:

- **Skills** - permanent by default: keyword-gated and ~free when idle, so install all and let them self-gate. Whole-domain sets (the Ionic/Capacitor `mobile` group, `dotnet-wpf`) are optional only if you never touch that domain.
- **MCPs** - real launch cost, so split: baseline `context7` / `serena` / `memory` / `playwright`; domain-gated `angular-cli` (Angular projects only); opt-in `chrome-devtools` and `appium-mcp` (heavy native deps - left commented unless needed). `memory` is cross-project recall (the subagent handoff runs on serena) - comment it out in a standalone project.
- **Plugins** - permanent (language-agnostic): `superpowers`, `claude-md-management`, `security-guidance`, `claude-hud`, `ponytail`, `caveman`. Language-gated: the `*-lsp` pair - install the ones matching the project's languages (`typescript-lsp` + `csharp-lsp` for an Angular + .NET shop). (Design-taste guidance for distinctive UI now lives in-house in the `frontend` skill, not a separate plugin.)

---

## Prerequisites

The script runs a **prerequisites check first and warns (never fails)** on anything missing -
install what you need for the work you actually do, then re-run.

| Tool | Needed for | Required? | Install (macOS/Linux) | Install (Windows) |
| ---- | ---------- | --------- | --------------------- | ----------------- |
| **node** ≥ 22.12 LTS | Claude Code, hooks, all `npx` MCPs | **Yes** | `brew install node` / nvm | `winget install OpenJS.NodeJS.LTS` |
| **npx** | skills CLI (ships with node) | **Yes** | (with node) | (with node) |
| **claude** CLI | plugins, MCP registration, hook wiring | **Yes** | `npm i -g @anthropic-ai/claude-code` | `winget install Anthropic.ClaudeCode` |
| **git** | project-scope path resolution (repo root) | **Yes** for project scope | `brew install git` | `winget install Git.Git` |
| **uvx** (uv) | `serena` + `memory` MCPs | for those MCPs | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| **python3** | `security-guidance` plugin hook; settings.json merge (**bash only** - PowerShell merges natively) | for that plugin | `brew install python` | `winget install Python.Python.3.12` (the Windows Store stub does **not** count) |
| **typescript-language-server** | `typescript-lsp` plugin (TS/JS work) | optional | `npm i -g typescript-language-server typescript` | same |
| **csharp-ls** | `csharp-lsp` plugin (C# work only) | optional | `dotnet tool install --global csharp-ls` | same (needs `~/.dotnet/tools` on PATH) |
| **curl** / `Invoke-WebRequest` | fetching hook files | for hooks | preinstalled | preinstalled |
| **brew** / **winget** | `github-cli` extra only | optional | Homebrew | winget |

> **Why node ≥ 22.12:** below that, some MCPs (notably `chrome-devtools`) refuse to start and
> die at launch with a generic JSON-RPC `-32000`.

> **Claude Code on Windows (winget):** `winget install Anthropic.ClaudeCode` is the native install -
> no Node needed for the CLI itself, but keep Node ≥ 22.12 anyway for the hooks and npx MCPs. Mind the
> package ID: `Anthropic.ClaudeCode` is the CLI; `Anthropic.Claude` is the separate desktop app. winget
> installs don't auto-update - refresh the CLI with `winget upgrade Anthropic.ClaudeCode` (this is the
> CLI binary, independent of the stack's own `update` action). npm still works on Windows too.

---

## Before you run - environment variables & keys

Set these in your shell **before** invoking the script (all optional except where a default is noted).

### `--scope` / `-Scope` - where the stack lands (default `project`)

| Value | Skills | Plugins / MCPs |
| ----- | ------ | -------------- |
| `project` (default) | project-scoped | `--scope project` (writes `<repo>/.mcp.json`) |
| `global` | `-g` (`~/.claude/skills`) | `--scope user` |

```bash
bash claude-stack.sh install --scope global          # macOS/Linux
pwsh claude-stack.ps1 install -Scope global          # Windows
```

The `SCOPE` env var is still honored as a **fallback** when the flag is absent
(`SCOPE=global bash claude-stack.sh install`); the flag wins when both are set.

### The `--space` flag / `CLAUDE_CONFIG_DIR` - which Claude account

Pass `--space <name>` (`-Space <name>` on Windows; any word) and the installer targets the
`~/.claude-<name>` account - it exports `CLAUDE_CONFIG_DIR` so the `claude` CLI installs
skills/plugins/MCPs there - and uses a separate `memory_<name>.db`:

```bash
bash claude-stack.sh install --space work        # -> ~/.claude-work account + memory_work.db
bash claude-stack.sh install --space clientx     # -> ~/.claude-clientx + memory_clientx.db
```

Without a space, the default `~/.claude` account is used. To target a specific account **manually**
(no space), set `CLAUDE_CONFIG_DIR` yourself - used only for path resolution, never exported:

```bash
export CLAUDE_CONFIG_DIR="$HOME/.claude-work"          # macOS/Linux
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-work"          # Windows
```

### `CONTEXT7_API_KEY` - the one secret (optional)

The `context7` MCP reads `CONTEXT7_API_KEY` **from the environment at launch**, so expose it to
the MCP process *without* writing it into the registration (`.mcp.json`). **Leave it unset in your
install shell** so the registration stays keyless, and provide the key one of these ways:

- **macOS / Linux (recommended).** Put it in `~/.claude/settings.json` under `"env"` (set once,
  user-global): `{ "env": { "CONTEXT7_API_KEY": "ctx7-..." } }`.
- **Windows (recommended).** Set a **persistent OS environment variable** - **Machine scope** so
  even an elevated PowerShell inherits it: `[Environment]::SetEnvironmentVariable('CONTEXT7_API_KEY','ctx7-...','Machine')`
  (or `setx … /M`). Open a **new** terminal afterward. (`settings.json` `env` works on Windows too.)
- **Legacy - bake it in (any OS).** Export `CONTEXT7_API_KEY` **before** running and it is added as
  `--api-key` to the registration; at project scope that writes it into `<repo>/.mcp.json` - **keep
  that file uncommitted** if you go this route.

No other API keys are required by any component.

---

## How to run

The **action** (`install` | `update`) is the one **required** positional argument; everything else is
a **named flag**, optional with a default.

```bash
cd /path/to/your/project        # run inside the target project
bash claude-stack.sh install
bash claude-stack.sh update

# Named flags (any order): --space (account + memory DB), --scope, --context7, --github-cli
bash claude-stack.sh install --space work                    # space 'work' -> ~/.claude-work account + memory_work.db
bash claude-stack.sh install --github-cli
bash claude-stack.sh install --space work --scope global --github-cli
bash claude-stack.sh install --context7 local               # local npx context7 (default: remote hosted server)
```

```powershell
Set-Location C:\path\to\your\project
pwsh claude-stack.ps1 install
pwsh claude-stack.ps1 update
pwsh claude-stack.ps1 install -Space work                   # space 'work' -> ~/.claude-work + memory_work.db
pwsh claude-stack.ps1 install -GitHubCli                    # install gh (switch)
pwsh claude-stack.ps1 install -Scope global -Context7 local # global scope + local npx context7 (default: remote)
```

> On Windows PowerShell 5.1 use `powershell` instead of `pwsh`. If scripts are blocked, run once:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

### Arguments

The **action** is the one positional argument; everything else is a **named flag** (any order). The
old positional forms (`install work`, `install github-cli`) are gone - pass a value with its flag.

| Argument | Values | Meaning |
| -------- | ------ | ------- |
| **action** (positional) | `install` \| `update` (required) | `install` adds everything (idempotent - existing items skipped, MCP versions frozen). `update` brings everything to latest (clean re-add of skills, plugin/MCP refresh, re-fetch hook files). |
| **`--space`** \| **`-Space`** | any word | Selects the Claude account `~/.claude-<space>` (skills/plugins/MCPs install there) and a separate `memory_<space>.db`. Omit for `~/.claude` + shared `memory.db`. |
| **`--scope`** \| **`-Scope`** | `project` (default) \| `global` | `project` installs INTO this repo; `global` installs into the active account. Falls back to the `SCOPE` env var when the flag is absent. |
| **`--context7`** \| **`-Context7`** | `remote` (default) \| `local` | context7 transport: `remote` is the hosted HTTP server, `local` the npx stdio server. |
| **`--github-cli`** \| **`-GitHubCli`** | flag / switch | Install the GitHub CLI (`gh`) if missing. No auth during install; run `gh auth login` once before first GitHub platform use. |

---

## `install` vs `update`

- **`install`** - additive, **idempotent**. Already-registered skills/plugins/MCPs are skipped;
  MCP runtime versions resolve to *latest at provision* then **freeze** until the next `update`.
  Hooks are fetched into `.claude/hooks/` and wired into `.claude/settings.json`.
- **`update`** - removes and re-adds skills (real copies, not symlinks), re-resolves/re-pins MCP
  versions, refreshes plugins, and re-fetches hook files. It does **not** rewrite the
  `settings.json` hook wiring (that happens only on `install`).

**Claude-only steps fail soft** if the `claude` CLI is absent - skills still install.

---

## Memory database

Claude Code and Cursor share **`~/.memory-mcp`** so both see the same DB:

- default: `memory.db` (`sqlite_vec` backend),
- with a **space** (e.g. `work`): `memory_<space>.db` - a separate per-space DB (same `sqlite_vec` backend, different path).

The path is resolved at install time, so the choice is baked into the registration.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| MCP dies at launch with `-32000` | Node too old (use ≥ 22.12 LTS); or a stale npm cache against a freshly pinned version - the script intentionally avoids `--prefer-offline`. |
| `serena` / `memory` MCP missing | `uvx` not installed - install uv (see prereqs). `memory` also needs numpy, which the script injects via `--with numpy`. |
| `security-guidance` hook fails | Python 3 missing (on Windows the Store stub doesn't count - install a real Python). |
| `csharp-lsp` won't start | `csharp-ls` not on PATH - install per the prereqs (only needed for C# work). |
| `csharp-ls` install fails: `DotnetToolSettings.xml was not found` | Your .NET SDK is older than the tool's latest (`csharp-ls` 0.24.0 targets .NET 10); that error is dotnet's misleading wording for 'the tool targets a framework you don't have', not a broken package. `dotnet --list-sdks` to check. Cross-platform fix: pin a version matching your SDK - .NET 9 -> `--version 0.20.0`, .NET 8 -> `--version 0.15.0`. Or install the .NET 10 SDK and retry (Windows: `winget install Microsoft.DotNet.SDK.10`; macOS/Linux: package manager or the `dotnet-install` script `--channel 10.0`) - side-by-side, `global.json` keeps projects on their own SDK. |
| "not in a git repo - skipping…" | Project scope needs a git repo. Run `git init`, or use `--scope global`. |
| Plugins/MCPs skipped | `claude` CLI not installed - install it (or use the Cursor stack, which never needs it). |
| context7 key ended up in `.mcp.json` | You exported `CONTEXT7_API_KEY` (legacy path) at project scope. Prefer the `settings.json` `env` approach; keep `.mcp.json` uncommitted. |
