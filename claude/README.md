# Claude Code stack (`claude-stack`)

Two twin scripts that install (or update) the **complete Claude Code stack into a project** -
every skill, plugin, MCP server, and hook from the curated inventory in `claude-stack.html`.
Built-in/system CLI skills are excluded (they ship with the CLI). The agent is the script you
run, so there is **no agent argument**. (Cursor is the peer in [`../cursor/`](../cursor/README.md).)

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
| **Skills**  | 74 | conventions + utilities (ticket writers, C#/.NET, Angular/TS, SQL, Docker, git, WP) - `npx skills add … --agent claude-code` |
| **Plugins** | 9  | `superpowers`, `claude-md-management`, `csharp-lsp`, `typescript-lsp`, `gopls-lsp`, `security-guidance`, `frontend-design`, `claude-hud`, `ponytail` - `claude plugin install` (needs the `claude` CLI) |
| **MCP servers** | 7 | `angular-cli`, `serena`, `playwright`, `memory`, `context7`, plus `chrome-devtools` + `appium-mcp` (heavy - now active; comment out where not needed) → `<repo>/.mcp.json` |
| **Hooks** | 3 | `require-convention-skill` (PreToolUse Edit/Write gate) + `guard-protected-force-push` (blocks force-push to main/master/develop) + `guard-catastrophic-rm` (blocks recursive rm of /, ~, $HOME, or a bare *) → `.claude/hooks/` + wired into `.claude/settings.json` |
| **Agents** | 4 | .NET (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`, `angular-test-resolver`) - Claude subagents: implement-phase build/test fix loops, serena-driven, iteration-capped, no reward-hacking → `.claude/agents/` |

### Install cadence - keep always vs install on occasion

Cost differs by artifact, so the keep-or-skip call does too:

- **Skills** - permanent by default: keyword-gated and ~free when idle, so install all and let them self-gate. Whole-domain sets (`wordpress-*`, the Ionic/Capacitor `mobile` group, `dotnet-wpf`) are optional only if you never touch that domain.
- **MCPs** - real launch cost, so split: baseline `context7` / `serena` / `memory` / `playwright`; domain-gated `angular-cli` (Angular projects only); opt-in `chrome-devtools` and `appium-mcp` (heavy native deps - leave commented out unless needed).
- **Plugins** - permanent (language-agnostic): `superpowers`, `claude-md-management`, `security-guidance`, `claude-hud`, `ponytail`. Language-gated: the `*-lsp` trio - install the ones matching the project's languages (`typescript-lsp` + `csharp-lsp` for an Angular + .NET shop; `gopls-lsp` only for Go). Task-gated: `frontend-design` - greenfield / visual UI work; skip if you only implement fixed designs or Figma handoffs.

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
| **gopls** | `gopls-lsp` plugin (Go work only; check gated on `go` being present) | optional | `go install golang.org/x/tools/gopls@latest` | same (needs `GOPATH/bin` on PATH) |
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

### `SCOPE` - where the stack lands (default `project`)

| Value | Skills | Plugins / MCPs |
| ----- | ------ | -------------- |
| `project` (default) | project-scoped | `--scope project` (writes `<repo>/.mcp.json`) |
| `global` | `-g` (`~/.claude/skills`) | `--scope user` |

```bash
SCOPE=global bash claude-stack.sh install            # macOS/Linux
$env:SCOPE = 'global'; pwsh claude-stack.ps1 install # Windows
```

### `CLAUDE_CONFIG_DIR` - which Claude account

Used **only for path resolution** (e.g. the memory DB), never exported to any CLI. Unset → the
default account, resolving config paths to `~/.claude`. Set it to target a specific account:

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

The only positional argument is the **action** (`install` | `update`, default `install`).

```bash
cd /path/to/your/project        # run inside the target project
bash claude-stack.sh install
bash claude-stack.sh update

# Optional extras (args 2+, any order): separate work memory DB, install gh
bash claude-stack.sh install work
bash claude-stack.sh install github-cli
bash claude-stack.sh install work github-cli
```

```powershell
Set-Location C:\path\to\your\project
pwsh claude-stack.ps1 install
pwsh claude-stack.ps1 update
pwsh claude-stack.ps1 install work          # work memory profile (positional)
pwsh claude-stack.ps1 install -GitHubCli    # install gh (switch)
```

> On Windows PowerShell 5.1 use `powershell` instead of `pwsh`. If scripts are blocked, run once:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

### Arguments

| Position / flag | Values | Meaning |
| --------------- | ------ | ------- |
| 1 - **action** | `install` \| `update` (default `install`) | `install` adds everything (idempotent - existing items skipped, MCP versions frozen). `update` brings everything to latest (clean re-add of skills, plugin/MCP refresh, re-fetch hook files). |
| extra - **work** | bash: `work` positional · PS: `work` as `MemoryProfile` | Use a **separate** work memory DB (`memory_work.db`) instead of the shared one. |
| extra - **github-cli** | bash: `github-cli` positional · PS: `-GitHubCli` switch | Install the GitHub CLI (`gh`) if missing. No auth during install; run `gh auth login` once before first GitHub platform use. |
| env - **SCOPE** | `project` (default) \| `global` | See table above. |

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
- with the **`work`** extra: `memory_work.db` - a separate work DB (same `sqlite_vec` backend, different path).

The path is resolved at install time, so the choice is baked into the registration.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| MCP dies at launch with `-32000` | Node too old (use ≥ 22.12 LTS); or a stale npm cache against a freshly pinned version - the script intentionally avoids `--prefer-offline`. |
| `serena` / `memory` MCP missing | `uvx` not installed - install uv (see prereqs). `memory` also needs numpy, which the script injects via `--with numpy`. |
| `security-guidance` hook fails | Python 3 missing (on Windows the Store stub doesn't count - install a real Python). |
| `csharp-lsp` / `gopls-lsp` won't start | `csharp-ls` / `gopls` not on PATH - install per the prereqs (only needed for C#/Go work). |
| `csharp-ls` install fails: `DotnetToolSettings.xml was not found` | Your .NET SDK is older than the tool's latest (`csharp-ls` 0.24.0 targets .NET 10); that error is dotnet's misleading wording for 'the tool targets a framework you don't have', not a broken package. `dotnet --list-sdks` to check. Cross-platform fix: pin a version matching your SDK - .NET 9 -> `--version 0.20.0`, .NET 8 -> `--version 0.15.0`. Or install the .NET 10 SDK and retry (Windows: `winget install Microsoft.DotNet.SDK.10`; macOS/Linux: package manager or the `dotnet-install` script `--channel 10.0`) - side-by-side, `global.json` keeps projects on their own SDK. |
| "not in a git repo - skipping…" | Project scope needs a git repo. Run `git init`, or use `SCOPE=global`. |
| Plugins/MCPs skipped | `claude` CLI not installed - install it (or use the Cursor stack, which never needs it). |
| context7 key ended up in `.mcp.json` | You exported `CONTEXT7_API_KEY` (legacy path) at project scope. Prefer the `settings.json` `env` approach; keep `.mcp.json` uncommitted. |
