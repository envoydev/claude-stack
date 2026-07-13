#!/usr/bin/env bash
#
# cursor-stack.sh [install|update] [space] [github-cli] - install/update the CURSOR stack
# FOR A PROJECT: every skill / MCP from cursor-stack.html (the complete toolset, not a curated
# subset), installed INTO a project. Built-in/system CLI skills are excluded (they ship with the
# CLI). Bash twin of cursor-stack.ps1; Claude Code lives in claude-stack.sh.
#
# Usage - run this file directly inside the target project (install == update for Cursor):
#   bash cursor-stack.sh install   # provision Cursor
#   bash cursor-stack.sh update    # refresh skills + the .cursor tree
#
# SELF-CONTAINED .cursor/: skills copied into .cursor/skills (strict - no dependency on .claude or
# .agents); MCPs into .cursor/mcp.json; hooks into .cursor/hooks.json (+ .cursor/hooks/). NEVER calls
# the claude CLI. Marketplace plugins are UI-only (install them from the Cursor UI); their skill /
# MCP / hook components are provisioned here.
#
# Optional extras (args 2+, any order):
#   space       -> any word; a separate memory DB (memory_<space>.db). Omit for the default shared
#                  DB. Both agents share ~/.memory-mcp so Claude Code and Cursor see the same per-space
#                  DB. (Cursor is self-contained under ~/.cursor; the space does not change that.)
#   github-cli  -> install the GitHub CLI (gh) via Homebrew (macOS) if missing; prompts for
#                  `gh auth login` when unauthenticated. e.g.:
#                    bash cursor-stack.sh install github-cli
#                    bash cursor-stack.sh install work github-cli
#
# Scope (default PROJECT - installs the full set INTO this repo; SCOPE=global installs it into the
# active account instead):
#   SCOPE=project  -> skills project-scoped; cursor tree -> <repo>/.cursor/  (default)
#   SCOPE=global   -> skills -g;             cursor tree -> ~/.cursor/
# Full inventory - comment out manifest entries below to trim it to a curated subset.
set -euo pipefail

# 'install' or 'update' is REQUIRED (the main action); every arg after it is optional (has a default).
ACTION="${1:-}"
case "$ACTION" in
  install|update) ;;
  *) echo "usage: bash $0 <install|update> [space] [github-cli] [context7-local|context7-remote]" >&2; exit 1 ;;
esac

# This script provisions the Cursor agent. (Claude Code lives in claude-stack.sh.)
AGENT="cursor"

# Optional extras (args 2+, any order, each with a default): a space name (any word -> a separate
# memory_<space>.db), 'github-cli' (install gh), 'context7-local' | 'context7-remote' (context7
# transport; default remote).
SPACE=""
INSTALL_GITHUB_CLI=false
CONTEXT7_MODE="remote"
for extra in "${@:2}"; do
  case "$extra" in
    github-cli) INSTALL_GITHUB_CLI=true ;;
    context7-local) CONTEXT7_MODE="local" ;;
    context7-remote) CONTEXT7_MODE="remote" ;;
    *)
      # Any other single word is the SPACE (memory-DB namespace). Reserved flags are matched above;
      # a second bare word, or a disallowed charset, is an error.
      if [ -n "$SPACE" ]; then
        echo "usage: bash $0 <install|update> [space] [github-cli] [context7-local|context7-remote]   (only one space name; got '$SPACE' and '$extra')" >&2; exit 1
      fi
      case "$extra" in
        [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
          echo "usage: bash $0 <install|update> [space] [github-cli] [context7-local|context7-remote]   (space '$extra' must start alphanumeric; chars [A-Za-z0-9._-])" >&2; exit 1 ;;
      esac
      SPACE="$extra" ;;
  esac
done

SCOPE="${SCOPE:-project}"
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

prerequisites_check() {
  # Warn (not fail) on missing prerequisites, matching the script's fail-soft philosophy.
  log "prerequisites check"
  local ok=true
  if command -v uvx >/dev/null 2>&1; then
    printf '  uvx: %s\n' "$(uvx --version 2>&1 | head -1)"
  else
    echo "  !! uvx not found - serena and memory MCPs will not work." >&2
    echo "     Install: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    ok=false
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '  python3: %s\n' "$(command -v python3)"
  else
    echo "  !! python3 not found - the security-guidance hook and the Cursor/settings JSON merges will fail." >&2
    ok=false
  fi
  # node: required by Claude Code, the convention hooks, and npx-based MCPs. Below 22.12 LTS some
  # MCPs (chrome-devtools) refuse to start and die at launch with a generic JSON-RPC -32000.
  if command -v node >/dev/null 2>&1; then
    node_ver="$(node -v 2>/dev/null | sed 's/^v//')"
    node_major="${node_ver%%.*}"; node_rest="${node_ver#*.}"; node_minor="${node_rest%%.*}"
    case "$node_major" in (*[!0-9]*|'') node_major=0 ;; esac
    case "$node_minor" in (*[!0-9]*|'') node_minor=0 ;; esac
    if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 12 ]; }; then
      echo "  !! node $node_ver - recommend Node >= 22.12 LTS. chrome-devtools (and some npx MCPs)" >&2
      echo "     require it; an older Node makes them die at launch with a generic JSON-RPC -32000." >&2
    else
      printf '  node: %s\n' "$node_ver"
    fi
  else
    echo "  !! node not found - Claude Code, the convention hooks, and npx-based MCPs need it." >&2
    ok=false
  fi
  # csharp-ls: the csharp-lsp plugin shells out to it for Roslyn diagnostics. Off $PATH and the
  # plugin dies at launch with "Executable not found in $PATH". Needed only for C# work, so warn.
  if command -v csharp-ls >/dev/null 2>&1; then
    printf '  csharp-ls: %s\n' "$(command -v csharp-ls)"
  else
    echo "  !! csharp-ls not found - the csharp-lsp plugin needs it (C# work only)." >&2
    echo "     Install: dotnet tool install --global csharp-ls (needs the .NET SDK + ~/.dotnet/tools on PATH)." >&2
  fi
  $ok || echo "  Install the missing tools above, then re-run." >&2
}

install_github_cli() {  # opt-in via the 'github-cli' extra; fail-soft like everything else
  $INSTALL_GITHUB_CLI || return 0
  if command -v gh >/dev/null 2>&1; then
    log "github-cli: gh already installed ($(gh --version 2>/dev/null | head -1)) - skipping install"
  elif command -v brew >/dev/null 2>&1; then
    log "github-cli: installing gh via Homebrew"
    brew install gh || { echo "  !! brew install gh failed - install manually: https://cli.github.com" >&2; return 0; }
    # No auth during install (deliberate): run `gh auth login` once before the first GitHub
    # platform use (PRs/issues). Plain git push/pull never needs it.
    log "  installed - run 'gh auth login' before first GitHub platform use"
  else
    echo "  !! brew not found - install Homebrew or gh manually: https://cli.github.com" >&2
  fi
}

# CONFIG_DIR is for path resolution only - never exported to any CLI:
# ~/.cursor - so a cursor install has ZERO dependency on .claude or the claude CLI.
CONFIG_DIR="$HOME/.cursor"

SERENA_CTX="ide-assistant"   # serena's --context for Cursor (generic ide-assistant)

# Shared memory root - always resolved at install time so both Claude Code and Cursor point to the
# same DB path regardless of agent.
HOME_MEMORY_DIR="$HOME/.memory-mcp"

if [ "$SCOPE" = "project" ]; then
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  SKILLS_ADD_FLAG=""           # npx skills add: project is the default (no -g)
else
  SKILLS_ADD_FLAG="-g"
fi

# ===========================================================================
# MANIFEST - edit these, then run.
# ===========================================================================

# (1) Skills, one per line as "repo|skill" (comment a line to skip it).
SKILLS=(
  # Personal (envoydev/agents-stack)
  "envoydev/agents-stack|create-ticket"             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  "envoydev/agents-stack|dev-log-convert"           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  "envoydev/agents-stack|explain-code-tutor"        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  "envoydev/agents-stack|project-quality-loop"             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  "envoydev/agents-stack|project-architecture-quality-loop"        # deliberate analyze-assess-improve loop - the project-architecture-analyzer capture writes ARCHITECTURE.md + ASSESSMENT.md, fix cons by tier, reconcile docs; manual /-only
  "envoydev/agents-stack|project-code-style-analyzer"    # deliberate code-style capture - fans out code-style-analyzer per language, merges docs/PROJECT-CODE-STYLE.md, generates + wires the inject-code-style hook; manual /-only
  "envoydev/agents-stack|project-architecture-analyzer"  # deliberate architecture capture - dispatches code-analyzer per module, reasons in the main session, writes docs/architecture/ARCHITECTURE.md + ASSESSMENT.md + the generated awareness rule baseline-project-architecture.md; manual /-only
  "envoydev/agents-stack|project-version-upgrade"        # deliberate BREAKING version-event flow (framework/runtime/package major) - plan in-session via context7 + code-analyzer digests, approval gate (auto mode only on explicit user ask), staged execution via implementers + resolvers; manual /-only
  "envoydev/agents-stack|project-capabilities"           # deliberate capabilities capture - inventories installed skills/agents/MCPs/plugins, generates the awareness rule baseline-project-capabilities.md; manual /-only
  "envoydev/agents-stack|project-related-context"        # deliberate related-projects capture - args paths/URLs, fans out related-project-analyzer per sibling, writes the awareness rule baseline-project-related-context.md + docs/PROJECT-RELATED-CONTEXT.md; manual /-only
  "envoydev/agents-stack|project-build-from-scratch" # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  "envoydev/agents-stack|project-task-flow"    # entry-point router: classify -> smallest execution mode -> cross-domain contract freeze + integration gate; home of the shared subagent policies
  "envoydev/agents-stack|project-verify-plan"      # audit an implementation plan BEFORE building - risk-coverage review (traps named per the stack skill, scope, edges, minimal); precedes /code-review
  "envoydev/agents-stack|project-implement"              # single-chat build step: execute a verified plan task-by-task (contracts + per-task green gate + resolver routing), finish via /code-review + the done-gate
  "envoydev/agents-stack|project-solution-design"  # single-chat designer twin: read the architecture, judge where a change fits (extend/refactor/isolate), load the stack skill for traps, decompose into an ordered plan; feeds project-verify-plan
  "envoydev/agents-stack|project-failure-signatures" # single-chat diagnoser twin: local-runtime crash signatures (null-ref/DI/deadlock/disposed/config-drift/boundary/HTTP-status) -> where to isolate each; pairs with systematic-debugging
  "envoydev/agents-stack|project-ci-failure-signatures"        # single-chat CI-diagnoser twin: red-pipeline signatures (compile/restore, green-locally-red-on-runner, quality-gate, signing/release, workflow-config, infra-flake) -> code-vs-environment call + route; pairs with project-failure-signatures
  "envoydev/agents-stack|devops"           # DevOps for the .NET/Angular house: Docker multi-stage/digest-pinned/non-root, GitHub Actions CI/CD, safe expand-contract deploys, secrets/OIDC, Aspire AppHost
  "envoydev/agents-stack|database-conventions" # cross-engine DB conventions + per-engine skill routing
  "envoydev/agents-stack|data-security"    # SQL/data-layer security: parameterized-only injection, least-privilege DB accounts, row-level security, connection-string secrets, encryption, audit
  "envoydev/agents-stack|typescript"       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  "envoydev/agents-stack|angular-conventions" # Angular 17+/TS house conventions (signals, OnPush, a11y)
  "envoydev/agents-stack|angular-material"   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  "envoydev/agents-stack|angular-styling"    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  "envoydev/agents-stack|angular-security"   # Angular/web frontend security: XSS/DomSanitizer bypass, CSP, CSRF, no-secrets-in-bundle, token storage, SSR/TransferState
  "envoydev/agents-stack|frontend"         # web frontend router: Angular/TS + in-skill design-quality guidance -> mobile
  "envoydev/agents-stack|mobile"           # Ionic/Capacitor router/index over the Angular (angular-conventions) + TypeScript baselines
  "envoydev/agents-stack|ionic"            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  "envoydev/agents-stack|capacitor-release" # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  "envoydev/agents-stack|mobile-security"  # Ionic/Capacitor mobile security: Keychain/Keystore storage, deep-link validation, permissions, cleartext/WebView hardening
  "envoydev/agents-stack|csharp"           # C# house conventions - style, naming, async, logging, DI
  "envoydev/agents-stack|csharp-design-patterns" # all 23 GoF patterns with modern .NET 8+ forms
  "envoydev/agents-stack|dotnet"           # router mapping .NET work areas to specialist skills
  "envoydev/agents-stack|dotnet-architecture-tests" # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  "envoydev/agents-stack|dotnet-aspire"    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  "envoydev/agents-stack|dotnet-authentication" # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  "envoydev/agents-stack|dotnet-code-quality" # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
  "envoydev/agents-stack|dotnet-console-apps" # console-app interface surface: CLI arg parsing (System.CommandLine 2.0/Spectre.Console.Cli/Cocona) + bot-SDK integration (Telegram/Discord/Slack/exchange) in a BackgroundService
  "envoydev/agents-stack|dotnet-cryptography" # System.Security.Cryptography: SHA-2, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare
  "envoydev/agents-stack|dotnet-error-handling" # Result + ProblemDetails (RFC 9457) + IExceptionHandler + FluentValidation
  "envoydev/agents-stack|dotnet-grpc"      # gRPC: .proto/codegen, ASP.NET Core host, 4 streaming modes, JWT/mTLS, interceptors, health
  "envoydev/agents-stack|dotnet-hosted-services" # worker/background-service host: BackgroundService, ExecuteAsync trap, scoped scope, PeriodicTimer, shutdown, Channels
  "envoydev/agents-stack|dotnet-messaging" # event-driven messaging: Wolverine (MIT)/MassTransit, outbox, sagas, RabbitMQ/Azure SB
  "envoydev/agents-stack|dotnet-migrate"   # safe migration workflow: EF schema, .NET upgrades, NuGet - rollback + verify per step
  "envoydev/agents-stack|dotnet-minimal-api" # minimal API endpoint mechanics: MapGroup, TypedResults, endpoint filters, binding
  "envoydev/agents-stack|dotnet-mvc-controllers" # controller-based Web API: [ApiController], attribute routing, ActionResult<T>, auto-400 filter, action filters, binding
  "envoydev/agents-stack|dotnet-openapi"   # OpenAPI doc (Swashbuckle / built-in .NET 9+) + Scalar docs UI
  "envoydev/agents-stack|dotnet-realtime"  # SignalR real-time: strongly-typed Hub<T>, IHubContext push, groups/presence, reconnection, JWT-over-querystring, Redis/Azure backplane
  "envoydev/agents-stack|dotnet-security"  # OWASP Top 10 (2021) -> .NET 8 mitigations; deprecated-pattern warnings
  "envoydev/agents-stack|dotnet-source-generators" # Roslyn IIncrementalGenerator authoring + built-in generators (GeneratedRegex/LoggerMessage/STJ)
  "envoydev/agents-stack|dotnet-testing"   # .NET test strategy: AAA, per-layer coverage, library routing
  "envoydev/agents-stack|dotnet-web-backend" # ASP.NET Core cross-cutting: HttpClientFactory, OpenAPI, observability
  "envoydev/agents-stack|dotnet-winforms"  # WinForms conventions: MVP/binding, disposal, GDI leaks, high-DPI, migration
  "envoydev/agents-stack|dotnet-wpf"       # WPF strict-MVVM conventions, bindings, virtualization
  "envoydev/agents-stack|postgres"         # PostgreSQL engine delta: index types, JSONB, SARGability, EXPLAIN, pooling
  "envoydev/agents-stack|sqlite"           # SQLite engine delta: WAL/single-writer, PRAGMAs, type affinity, limited ALTER
  "envoydev/agents-stack|dotnet-data-access" # EF Core + NHibernate ORM hub (references/): DbContext, tracking, N+1, projection
  "envoydev/agents-stack|dotnet-architecture" # architecture decision hub (references/): clean/ddd/vsa/modular/microservices
  "envoydev/agents-stack|markdown-style" # Markdown authoring / review: syntax canon (valid) + house style overlay, two-pass procedure
  "envoydev/agents-stack|ilspy-decompile" # decompile a .NET assembly (ilspycmd via dnx) to read real API/behavior - framework internals, NuGet source, pre-upgrade checks
  "envoydev/agents-stack|dotnet-project-setup" # .NET solution build spine (hub, references/): src/tests layout, .slnx, Directory.Build.props, global.json, central package management, dotnet-tool pinning
  "envoydev/agents-stack|dotnet-performance" # perf-aware .NET design (hub, references/): allocation/type design (struct vs class, Span, ValueTask) + serialization-format choice (STJ source-gen / Protobuf / MessagePack)
  "envoydev/agents-stack|dotnet-diagnostics" # measure/diagnose a live .NET process (hub, references/): BenchmarkDotNet microbenchmarks + crash/hang/OOM dump capture & first-look SOS analysis
  "envoydev/agents-stack|nx"               # Nx monorepo: project-graph nav + 'nx affected' scoping, generators, module-boundary tags; CLI over MCP; serena-vs-nx routing
)

# (3) MCP servers as "name|args"; scope follows SCOPE.
#     @SERENA_CONTEXT@   -> resolved at install time per-agent (claude-code | ide-assistant).
#     @HOME_MEMORY_DIR@  -> resolved at install time to ~/.memory-mcp for BOTH agents (shared DB).
#     \${CLAUDE_PROJECT_DIR:-.} stays LITERAL so Claude Code interpolates it at server launch; for
#       Cursor (no shell interpolation) it is resolved to a concrete path when .cursor/mcp.json is written.
#     memory (mcp-memory-service): a space (e.g. 'work') switches to memory_<space>.db.
#
# PERFORMANCE - network resolution is the cost of a slow new-session start, so it happens HERE
# (install/update), never at launch:
#   - install/update resolves each runtime's LATEST published version (below) and bakes it into the
#     registration. `install` SKIPS MCPs already registered, so the resolved version stays FROZEN
#     until you run `update` (which removes + re-adds -> re-resolves -> bumps). No versions are
#     hardcoded in this script - "latest at provision, frozen until next update".
#   - launch is fast because versions are PINNED (npx skips dist-tag resolution; uvx reuses its
#     cached env). Do NOT add --prefer-offline: with a freshly-resolved latest version, a stale npm
#     cache index reports "no matching version" and the server dies (-32000). The pin alone is the
#     speed-up; npx fetches the exact version once if the cache lacks it, then reuses it.
#   - serena runs from the pinned PyPI package (NOT git+https, which re-fetched the ref on every
#     launch - the biggest startup cost), web dashboard off (no HTTP server spun up).
#   - memory: --with numpy is injected because mcp-memory-service's sqlite_vec backend needs numpy
#     but doesn't declare it, so uvx's isolated env omits it -> "No module named 'numpy'" (-32000).
#   - offline at provision -> resolution yields empty -> the entry falls back to unpinned.
_npm_latest()  { command -v npm >/dev/null 2>&1 && npm view "$1" version 2>/dev/null | tr -d '[:space:]'; }
_pypi_latest() { curl -fsSL "https://pypi.org/pypi/$1/json" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['info']['version'])" 2>/dev/null; }
log "resolving latest MCP runtime versions (install/update network step)"
MCP_CONTEXT7_VER="$(_npm_latest @upstash/context7-mcp)"
MCP_PLAYWRIGHT_VER="$(_npm_latest @playwright/mcp)"
MCP_SERENA_VER="$(_pypi_latest serena-agent)"
MCP_MEMORY_VER="$(_pypi_latest mcp-memory-service)"
# Version-pin suffix: "@1.2.3" when resolved, "" (unpinned fallback) when offline.
CTX7_PIN="${MCP_CONTEXT7_VER:+@$MCP_CONTEXT7_VER}"
PW_PIN="${MCP_PLAYWRIGHT_VER:+@$MCP_PLAYWRIGHT_VER}"
SERENA_PIN="${MCP_SERENA_VER:+@$MCP_SERENA_VER}"
MEMORY_PIN="${MCP_MEMORY_VER:+@$MCP_MEMORY_VER}"

MEMORY_BACKEND="sqlite_vec"; MEMORY_DB_FILE="memory.db"
if [ -n "$SPACE" ]; then MEMORY_DB_FILE="memory_$SPACE.db"; fi  # space -> per-space DB; backend stays sqlite_vec (the only valid local backend)
MEMORY_ENTRY="memory|-e MCP_MEMORY_STORAGE_BACKEND=$MEMORY_BACKEND -e MCP_MEMORY_SQLITE_PATH=@HOME_MEMORY_DIR@/$MEMORY_DB_FILE -- uvx --with numpy --from mcp-memory-service${MEMORY_PIN} memory server"

# context7 runs REMOTE (the hosted server) by DEFAULT - no local process, and the key stays out of
# .cursor/mcp.json: set CONTEXT7_API_KEY as an OS/user environment variable and Cursor expands
# ${env:CONTEXT7_API_KEY} in the header at launch. Pass the 'context7-local' arg for the local stdio
# server - keyless by default too, and CONTEXT7_BAKE_KEY=1 (with CONTEXT7_API_KEY) bakes --api-key in (keep
# the resulting .cursor/mcp.json uncommitted).
if [ "$CONTEXT7_MODE" = "local" ]; then
  CONTEXT7_SPEC="-- npx -y @upstash/context7-mcp${CTX7_PIN}"
  if [ -n "${CONTEXT7_BAKE_KEY:-}" ] && [ -n "${CONTEXT7_API_KEY:-}" ]; then
    CONTEXT7_SPEC="$CONTEXT7_SPEC --api-key $CONTEXT7_API_KEY"
  fi
else
  CONTEXT7_SPEC="@HTTP@"
fi
CONTEXT7_ENTRY="context7|$CONTEXT7_SPEC"

MCPS=(
  "angular-cli|-- npx -y @angular/cli mcp" # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  "serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent${SERENA_PIN} serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd" # LSP symbol navigation; per-project SERENA_HOME (.serena/home - gitignore it, holds ~327MB LSP) isolates serena's registry/memories/logs/LSP, no pooling across projects/accounts; --project-from-cwd self-activates the repo (.serena/project.yml in cwd) on launch; PyPI (not git), dashboard off
  "playwright|-- npx -y @playwright/mcp${PW_PIN} --user-data-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright/screenshots" # drive a real browser for visual checks / web app verification
  "chrome-devtools|-- npx chrome-devtools-mcp@latest" # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  "appium-mcp|-- npx -y appium-mcp@latest" # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  "$MEMORY_ENTRY"  # memory: cross-project recall - the subagent handoff runs on serena; comment out in a standalone project
  "$CONTEXT7_ENTRY"                           # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (5) Cursor hooks "filename::event" + rules. Cursor's hook contract (.cursor/hooks.json v1) differs from
# Claude's settings.json PreToolUse, so these are CURSOR-contract scripts FETCHED from cursor/hooks (NOT
# the Claude-contract files). The portable Bash guards map over as hooks:
#   - guard-protected-force-push -> beforeShellExecution (reads {command}, returns {permission}).
#   - guard-catastrophic-rm      -> beforeShellExecution (blocks recursive rm of /, ~, $HOME, bare *).
# Convention enforcement is NOT a hook on either stack - its home is a soft, glob-auto-attaching rule
# (.cursor/rules/*.mdc here, see CURSOR_RULES; .claude/rules on Claude), never a pre-edit block.
CURSOR_HOOK_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/hooks"
CURSOR_RULES_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/rules"
CURSOR_HOOKS=(
  "guard-protected-force-push.js::beforeShellExecution"
  "guard-catastrophic-rm.js::beforeShellExecution"
)
# A rule entry is "name" (fetched from CURSOR_RULES_BASE_URL) or "name|url" (fetched from that url -
# e.g. a third-party rule like ponytail, which we reference rather than vendor here).
CURSOR_RULES=(
  # Per-file-type convention rules, soft and auto-attaching by glob (cs ng sql ts).
  "csharp-conventions.mdc"                    # cs  -> csharp (globs **/*.cs)
  "typescript-conventions.mdc"                # ts  -> typescript (.ts/.tsx/.js/.jsx/.mjs/.cjs)
  "sql-conventions.mdc"                       # sql -> database-conventions (**/*.sql)
  "angular-conventions.mdc"                   # ng  -> angular-conventions (*.component.ts &c.)
  "wpf-conventions.mdc"                       # xaml -> dotnet-wpf
  "scss-conventions.mdc"                      # scss/css -> angular-styling
  "ponytail.mdc|https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.cursor/rules/ponytail.mdc" # ponytail 'lazy senior dev' minimal-code rule (alwaysApply) - fetched from its repo, not vendored
)

# (6) Subagents (cursor): Cursor-native specialist agents fetched into .cursor/agents/ on BOTH actions
# (per-agent fail-soft - an agent not yet upstream keeps any existing local copy). Cursor auto-discovers
# .cursor/agents/*.md; no settings wiring needed. These mirror the four Claude resolver subagents (the
# pipeline agents and all model/effort pins are Claude-only) in Cursor's weaker contract: prompt-only guardrails, no
# per-tool allowlist (only a `readonly` bool) - so the agent bodies lean on the auto-attaching .cursor/rules
# for conventions, the same soft model Claude's .claude/rules now use.
CURSOR_AGENT_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/agents"
CURSOR_AGENTS=(
  "dotnet-build-error-resolver.md"   # implement phase: dotnet build -> categorize errors -> minimal fix loop (serena/LSP), capped
  "dotnet-test-failure-resolver.md"  # implement phase: dotnet test -> red->green repair loop, anti-reward-hacking guard, capped
  "ng-build-error-resolver.md"       # implement phase: ng build -> minimal fix loop (serena/LSP), capped
  "angular-test-resolver.md"         # implement phase: ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
)

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); the .cursor tree is refreshed
# (mcp.json: install skips an already-present server / update re-writes it; hooks.json / rules skip if already wired)
# ===========================================================================
install_skills() {
  command -v npx >/dev/null || { echo "npx not found"; return 1; }
  local seen="" entry repo skill sargs names
  for entry in "${SKILLS[@]}"; do
    repo="${entry%%|*}"
    case " $seen " in *" $repo "*) continue ;; esac   # repo already done
    seen="$seen $repo"
    sargs=(); names=""                                 # one --skill flag per skill (CLI rejects comma lists)
    for skill in "${SKILLS[@]}"; do
      [ "${skill%%|*}" = "$repo" ] || continue
      sargs+=(--skill "${skill#*|}")
      names="${names:+$names,}${skill#*|}"
    done
    log "skills [$SCOPE -> $AGENT]: $repo -> $names"
    npx -y skills add "$repo" "${sargs[@]}" --agent "$AGENT" $SKILLS_ADD_FLAG --yes || log "  !! $repo ($AGENT) failed - check selectors (npx skills add $repo --list)"
  done
}

# ===========================================================================
# CURSOR - self-contained .cursor/ tree (never touches .claude / never calls claude CLI)
# ===========================================================================
copy_cursor_skills() {
  # STRICT independence: copy each manifest skill into .cursor/skills as REAL copies so Cursor never
  # depends on .claude/skills or the shared .agents/ store. Source is the npx staging (.agents/skills)
  # with a .claude/skills fallback. Idempotent: an existing destination skill is replaced.
  local root base dest n r src target copied=0
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || { log "  !! not in a git repo - skipping cursor skills"; return 0; }
    base="$root"
  else
    base="$HOME"
  fi
  dest="$base/.cursor/skills"; mkdir -p "$dest"

  local names=() seen="" e nm
  for e in "${SKILLS[@]}"; do
    nm="${e#*|}"
    case " $seen " in *" $nm "*) continue ;; esac
    seen="$seen $nm"; names+=("$nm")
  done

  for n in "${names[@]}"; do
    src=""
    for r in "$base/.agents/skills" "$base/.claude/skills"; do
      [ -d "$r/$n" ] && { src="$r/$n"; break; }
    done
    [ -n "$src" ] || { log "  !! cursor skill source missing: $n (install skills first)"; continue; }
    target="$dest/$n"
    rm -rf "$target"
    cp -R "$src" "$target"
    copied=$((copied + 1))
  done
  log "  cursor skills -> $dest ($copied/${#names[@]} copied)"
}

set_cursor_mcps() {
  # Write/merge Cursor's MCP config: <repo>/.cursor/mcp.json (project) or ~/.cursor/mcp.json (global).
  # Cursor does NOT do shell-style ${VAR} interpolation, so resolve those tokens to concrete paths here.
  # Idempotency mirrors the claude path: a plain `install` SKIPS an MCP already in mcp.json (its baked
  # pin stays FROZEN); only `update` re-resolves latest and re-writes the entry (bumps the pin).
  local root proj_dir mcp_path entry name args spec tok_proj tok_cfg
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || { log "  !! not in a git repo - skipping cursor mcp.json"; return 0; }
    mcp_path="$root/.cursor/mcp.json"
  else
    mcp_path="$HOME/.cursor/mcp.json"
  fi
  mkdir -p "$(dirname "$mcp_path")"
  command -v python3 >/dev/null || { log "  !! python3 not found - skipping cursor mcp.json"; return 0; }
  proj_dir="${root:-$(pwd)}"
  tok_proj='${CLAUDE_PROJECT_DIR:-.}'
  tok_cfg='${CLAUDE_CONFIG_DIR}'

  local resolved=()
  for entry in "${MCPS[@]}"; do
    name="${entry%%|*}"; args="${entry#*|}"
    spec="${args//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec="${spec//@HOME_MEMORY_DIR@/$HOME_MEMORY_DIR}"
    spec="${spec//"$tok_proj"/$proj_dir}"
    spec="${spec//"$tok_cfg"/$CONFIG_DIR}"
    resolved+=("$name|$spec")
  done

  local prog; prog=$(cat <<'PY'
import json, sys
path, action = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path))
except Exception:
    data = {}
servers = data.setdefault("mcpServers", {})
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    name, spec = line.split("|", 1)
    # Skip-if-present on plain install, matching the claude path's `claude mcp get` guard: an MCP
    # already in mcp.json keeps its baked pin (FROZEN until `update` re-resolves and re-writes it).
    # Without this a plain install would re-write the freshly-resolved latest pin and silently bump it.
    if action == "install" and name in servers:
        print("  cursor mcp " + name + " already configured - skipping")
        continue
    if spec.strip() == "@HTTP@":
        servers[name] = {"url": "https://mcp.context7.com/mcp",
                         "headers": {"CONTEXT7_API_KEY": "${env:CONTEXT7_API_KEY}"}}
        print("  cursor mcp: " + name)
        continue
    # ASSUMPTION: no resolved path token (proj_dir / CONFIG_DIR / HOME_MEMORY_DIR) contains a space.
    # The spec is space-separated by design (-e KEY=VAL -- cmd args); a space inside one token would
    # be mis-parsed here, so project paths with spaces are unsupported.
    tokens = spec.split()
    env, cmd, cmd_args, after_sep, i = {}, None, [], False, 0
    while i < len(tokens):
        t = tokens[i]
        if not after_sep:
            if t == "--":
                after_sep = True; i += 1
            elif t == "-e":
                k, _, v = tokens[i + 1].partition("="); env[k] = v; i += 2
            else:
                i += 1            # ignore any other pre-`--` claude-mcp flags (not used by Cursor)
        else:
            if cmd is None: cmd = t
            else: cmd_args.append(t)
            i += 1
    if cmd is None:
        continue
    server = {"command": cmd, "args": cmd_args}
    if env:
        server["env"] = env
    servers[name] = server
    print("  cursor mcp: " + name)
json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
print("  cursor mcp.json -> " + path)
PY
)
  printf '%s\n' "${resolved[@]}" | python3 -c "$prog" "$mcp_path" "$ACTION"
}

set_cursor_hooks() {
  # Fetch the CURSOR-contract hook scripts into .cursor/hooks/ and wire .cursor/hooks.json (schema v1).
  # Mirrors the Claude path's download+wire, but from cursor/hooks (Cursor's beforeShellExecution etc.
  # contract). Per-hook fail-soft: a hook not yet upstream keeps any existing local copy.
  command -v curl >/dev/null || { log "  !! curl not found - skipping cursor hooks"; return 0; }
  local root hooks_json hooks_dir ref_prefix node_exe entry file event cmd tmp pairs=()
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || { log "  !! not in a git repo - skipping cursor hooks"; return 0; }
    hooks_json="$root/.cursor/hooks.json"; hooks_dir="$root/.cursor/hooks"; ref_prefix=".cursor/hooks/"
  else
    hooks_json="$HOME/.cursor/hooks.json"; hooks_dir="$HOME/.cursor/hooks"; ref_prefix="./hooks/"
  fi
  mkdir -p "$hooks_dir"
  command -v python3 >/dev/null || { log "  !! python3 not found - skipping cursor hooks.json"; return 0; }
  # Absolute node path dodges the stripped-PATH problem in spawned hook processes (cf. the statusline fix).
  node_exe="$(command -v node || echo node)"

  for entry in "${CURSOR_HOOKS[@]}"; do
    file="${entry%%::*}"; event="${entry##*::}"
    [ -n "$event" ] || continue
    tmp="$(mktemp)"
    if curl -fsSL "$CURSOR_HOOK_BASE_URL/$file" -o "$tmp"; then
      # Content-compare-then-skip, matching the Claude path's download_hooks: only overwrite when the
      # fetched bytes differ, so an unchanged hook is left untouched (stable mtime, no noisy log).
      if [ -f "$hooks_dir/$file" ] && cmp -s "$tmp" "$hooks_dir/$file"; then rm -f "$tmp"; log "  cursor hook current: $file"
      else mv "$tmp" "$hooks_dir/$file"; chmod +x "$hooks_dir/$file"; log "  cursor hook fetched -> $file"; fi
    else
      rm -f "$tmp"
      [ -f "$hooks_dir/$file" ] || { log "  !! fetch failed and no local copy: $file - skipping"; continue; }
      log "  !! fetch failed (kept existing copy): $file"
    fi
    cmd="\"$node_exe\" \"$ref_prefix$file\""
    pairs+=("$event|$cmd")
  done

  local prog; prog=$(cat <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path))
except Exception:
    data = {}
if "version" not in data:
    data["version"] = 1
hooks = data.setdefault("hooks", {})
changed = False
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    event, command = line.split("|", 1)
    arr = hooks.setdefault(event, [])
    if any(h.get("command") == command for h in arr):
        continue
    arr.append({"command": command}); changed = True
if changed:
    json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
    print("  cursor hooks.json -> " + path)
else:
    print("  cursor hooks.json: already wired - unchanged")
PY
)
  printf '%s\n' ${pairs[@]+"${pairs[@]}"} | python3 -c "$prog" "$hooks_json"
}

install_cursor_rules() {
  # Fetch .cursor/rules/*.mdc (soft convention guidance, auto-attached by glob) - e.g. the C# gate analog.
  # Per-rule fail-soft: a rule not yet upstream keeps any existing local copy.
  command -v curl >/dev/null || { log "  !! curl not found - skipping cursor rules"; return 0; }
  local root rules_dir entry file url tmp
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || { log "  !! not in a git repo - skipping cursor rules"; return 0; }
    rules_dir="$root/.cursor/rules"
  else
    rules_dir="$HOME/.cursor/rules"
  fi
  mkdir -p "$rules_dir"
  for entry in ${CURSOR_RULES[@]+"${CURSOR_RULES[@]}"}; do
    file="${entry%%|*}"                              # "name" -> repo base; "name|url" -> that url
    [ "$entry" = "$file" ] && url="$CURSOR_RULES_BASE_URL/$file" || url="${entry#*|}"
    tmp="$(mktemp)"
    if curl -fsSL "$url" -o "$tmp"; then
      mv "$tmp" "$rules_dir/$file"; log "  cursor rule fetched -> $file"
    else
      rm -f "$tmp"
      [ -f "$rules_dir/$file" ] || { log "  !! fetch failed and no local copy: $file - skipping"; continue; }
      log "  !! fetch failed (kept existing copy): $file"
    fi
  done
}

install_cursor_agents() {
  # Fetch each Cursor subagent .md into .cursor/agents/ (Cursor auto-discovers them - no settings wiring).
  # Mirrors the Claude path's download_agents: content-compare-then-skip + per-agent fail-soft (a fetch
  # failure keeps any existing local copy). Scope follows SCOPE like the rules/skills: repo root for
  # project, $HOME for global.
  command -v curl >/dev/null || { log "  !! curl not found - skipping cursor agents"; return 0; }
  local root agents_dir file tmp
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || { log "  !! not in a git repo - skipping cursor agents"; return 0; }
    agents_dir="$root/.cursor/agents"
  else
    agents_dir="$HOME/.cursor/agents"
  fi
  mkdir -p "$agents_dir"
  for file in ${CURSOR_AGENTS[@]+"${CURSOR_AGENTS[@]}"}; do
    tmp="$(mktemp)"
    if curl -fsSL "$CURSOR_AGENT_BASE_URL/$file" -o "$tmp"; then
      if [ -f "$agents_dir/$file" ] && cmp -s "$tmp" "$agents_dir/$file"; then rm -f "$tmp"; log "  cursor agent current: $file"
      else mv "$tmp" "$agents_dir/$file"; log "  cursor agent fetched -> $file"; fi
    else
      rm -f "$tmp"
      [ -f "$agents_dir/$file" ] || { log "  !! fetch failed and no local copy: $file - skipping"; continue; }
      log "  !! fetch failed (kept existing copy): $file"
    fi
  done
}

# ===========================================================================
# UPDATE - bring everything to latest
# ===========================================================================
remove_skills() {  # uninstall the manifest skills so the following re-add lands as fresh COPIES
  command -v npx >/dev/null || return 0
  local sargs=() entry
  for entry in "${SKILLS[@]}"; do sargs+=(--skill "${entry#*|}"); done
  log "skills [$SCOPE -> $AGENT]: removing ${#SKILLS[@]} for clean reinstall"
  npx -y skills remove "${sargs[@]}" --agent "$AGENT" $SKILLS_ADD_FLAG --yes 2>/dev/null || true
}

update_skills() {
  # Clean reinstall (remove + add), NOT `npx skills update`: keeps skills as real COPIES instead of
  # symlinks into .agents/, and `npx skills add` re-clones each repo = latest.
  remove_skills
  install_skills
}

prune_agents_cache() {
  # npx skills stages an agent-neutral .agents/ store. With a STRICT per-agent copy (.cursor/skills is
  # a real copy), nothing reads .agents/ anymore - prune it. Guard: keep it if any skill entry under
  # .cursor/skills is a symlink (a symlinked tree still depends on .agents/; removing it would dangle).
  # BASE must match the copy step (copy_cursor_skills): repo root for SCOPE=project, $HOME for global -
  # otherwise a global install leaves $HOME/.agents unpruned while we check the wrong (repo) base.
  local root d base
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ "$SCOPE" = "project" ]; then
    [ -n "$root" ] || return 0
    base="$root"
  else
    base="$HOME"
  fi
  [ -d "$base/.agents" ] || return 0
  local has_symlink=false
  for d in "$base/.cursor/skills"; do
    [ -d "$d" ] || continue
    if find "$d" -maxdepth 1 -type l 2>/dev/null | grep -q .; then has_symlink=true; break; fi
  done
  if $has_symlink; then
    log "  kept .agents/ - a skills tree has symlinks that still depend on it"
  else
    rm -rf "$base/.agents" && log "  pruned .agents/ (skills are real per-agent copies)"
  fi
}

# ===========================================================================
# DISPATCH
# ===========================================================================
prerequisites_check
install_github_cli

# Cursor path: 100% claude-free. install == update (clean re-add of skills, then refresh the .cursor tree).
if [ "$ACTION" = "install" ]; then install_skills; else update_skills; fi
copy_cursor_skills
set_cursor_mcps
set_cursor_hooks
install_cursor_rules
install_cursor_agents
log "plugins: Cursor marketplace plugins are UI-only - install them from the Cursor UI; their skill / mcp / hook components are provisioned here (+ .cursor/rules)."

prune_agents_cache
log "done: $ACTION ($SCOPE, agent=$AGENT). ${#SKILLS[@]} skills, MCPs, cursor-hooks=${#CURSOR_HOOKS[@]}, rules=${#CURSOR_RULES[@]}, agents=${#CURSOR_AGENTS[@]}."

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
cat <<'GITIGNORE'

Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git/info/exclude):
  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)
  .cursor          Cursor stack: skills + mcp.json + hooks.json + hook scripts + rules
  .slopwatch       dotnet-slopwatch output
  .playwright      playwright MCP user-data-dir + screenshots
  skill-lock.json  skills CLI lock file
GITIGNORE
