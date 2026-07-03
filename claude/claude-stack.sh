#!/usr/bin/env bash
#
# claude-stack.sh [install|update] [work] [github-cli] - install/update the CLAUDE CODE
# stack FOR A PROJECT: every skill / plugin / MCP from claude-stack.html (the complete
# toolset, not a curated subset), installed INTO a project. Built-in/system CLI skills are
# excluded (they ship with the CLI). Bash twin of claude-stack.ps1; Cursor lives in cursor-stack.sh.
#
# Usage - run this file directly inside the target project:
#   bash claude-stack.sh install   # install for Claude Code
#   bash claude-stack.sh update    # update Claude Code (skills + plugins + mcp + hooks)
#
# Provisions Claude Code: skills --agent claude-code; plugins; MCPs via `claude mcp add`; hooks +
# settings.json. Requires the `claude` CLI; claude-only steps fail soft if it is absent.
#
# Optional extras (args 2+, any order):
#   work        -> separate work memory DB (memory_work.db). Omit for the default
#                  shared DB. Both agents share ~/.memory-mcp so Claude Code and Cursor see the same DB.
#   github-cli  -> install the GitHub CLI (gh) via Homebrew (macOS) if missing; prompts for
#                  `gh auth login` when unauthenticated. e.g.:
#                    bash claude-stack.sh install github-cli
#                    bash claude-stack.sh install work github-cli
#
# Scope (default PROJECT - installs the full set INTO this repo; SCOPE=global installs it into the
# active account instead):
#   SCOPE=project  -> skills project-scoped, plugins/mcps --scope project  (default)
#   SCOPE=global   -> skills -g, plugins/mcps --scope user
# Full inventory - comment out manifest entries below to trim it to a curated subset.
set -euo pipefail

ACTION="${1:-install}"
case "$ACTION" in
  install|update) ;;
  *) echo "usage: bash $0 [install|update] [work] [github-cli]" >&2; exit 1 ;;
esac

# This script provisions the Claude Code agent. (Cursor lives in cursor-stack.sh.)
AGENT="claude-code"

# Optional extras (args 2+, any order): 'work' (separate work memory DB), 'github-cli' (install gh).
MEMORY_PROFILE=""
INSTALL_GITHUB_CLI=false
for extra in "${@:2}"; do
  case "$extra" in
    work) MEMORY_PROFILE="work" ;;
    github-cli) INSTALL_GITHUB_CLI=true ;;
    *) echo "usage: bash $0 [install|update] [work] [github-cli]   (unknown extra: $extra)" >&2; exit 1 ;;
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
  # typescript-language-server: the typescript-lsp plugin shells out to it via a bare-name $PATH
  # lookup (a SEPARATE npm package from typescript/tsserver). Off $PATH -> the plugin dies at launch
  # with "Executable not found in $PATH". Needed for TS/JS work, so warn (the plugin self-scopes).
  if command -v typescript-language-server >/dev/null 2>&1; then
    printf '  typescript-language-server: %s\n' "$(command -v typescript-language-server)"
  else
    echo "  !! typescript-language-server not found - the typescript-lsp plugin needs it (TS/JS work)." >&2
    echo "     Install: npm i -g typescript-language-server typescript (nvm scopes globals per node version; add both to ~/.nvm/default-packages to cover future versions)." >&2
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
# CLAUDE_CONFIG_DIR (a specific account, e.g. ~/.claude-work) or the ~/.claude default.
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -z "${CLAUDE_CONFIG_DIR:-}" ]; then
  log "CLAUDE_CONFIG_DIR not set - using the claude CLI default account; resolving config paths to $CONFIG_DIR."
fi

SERENA_CTX="claude-code"   # serena's --context for Claude Code

# Shared memory root - always resolved at install time so both Claude Code and Cursor point to the
# same DB path regardless of agent.
HOME_MEMORY_DIR="$HOME/.memory-mcp"

if [ "$SCOPE" = "project" ]; then
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  SKILLS_ADD_FLAG=""           # npx skills add: project is the default (no -g)
  CLAUDE_SCOPE="project"
else
  SKILLS_ADD_FLAG="-g"
  CLAUDE_SCOPE="user"
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
  "envoydev/agents-stack|project-scaffold" # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  "envoydev/agents-stack|domain-build"     # domain-build orchestration - designer decomposes, implementers fan out, verifier gates
  "envoydev/agents-stack|database-conventions" # cross-engine DB conventions + per-engine skill routing
  "envoydev/agents-stack|typescript"       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  "envoydev/agents-stack|angular-conventions" # Angular 17+/TS house conventions (signals, OnPush, a11y)
  "envoydev/agents-stack|angular-material"   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  "envoydev/agents-stack|angular-styling"    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  "envoydev/agents-stack|frontend"         # web frontend router: Angular/TS/frontend-design + -> mobile
  "envoydev/agents-stack|mobile"           # Ionic/Capacitor router: ionic-angular/capacitor-angular/capacitor-plugins + Angular/TS baseline
  "envoydev/agents-stack|ionic"            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  "envoydev/agents-stack|capacitor-release" # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  "envoydev/agents-stack|csharp"           # C# house conventions - style, naming, async, logging, DI
  "envoydev/agents-stack|csharp-design-patterns" # all 23 GoF patterns with modern .NET 8+ forms
  "envoydev/agents-stack|dotnet"           # router mapping .NET work areas to specialist skills
  "envoydev/agents-stack|dotnet-architecture-tests" # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  "envoydev/agents-stack|dotnet-aspire"    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  "envoydev/agents-stack|dotnet-authentication" # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  "envoydev/agents-stack|dotnet-code-quality" # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
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
  "envoydev/agents-stack|dotnet-wpf"       # WPF strict-MVVM conventions, bindings, virtualization
  # .NET (aaronontheweb/dotnet-skills)
  "aaronontheweb/dotnet-skills|api-design"    # stable extend-only public APIs, NuGet/wire versioning
  "aaronontheweb/dotnet-skills|aspire-integration-testing" # .NET Aspire integration tests: DistributedApplicationTestingBuilder, AppHost, endpoint discovery
  "aaronontheweb/dotnet-skills|crap-analysis" # CRAP-score risk hotspots (complexity x coverage)
  "aaronontheweb/dotnet-skills|csharp-concurrency-patterns" # async/await, Channels, Akka.NET concurrency guidance
  "aaronontheweb/dotnet-skills|database-performance" # read-path perf: N+1, projections, AsNoTracking, row limits
  "aaronontheweb/dotnet-skills|dependency-injection-patterns" # IServiceCollection Add* extension composition
  "aaronontheweb/dotnet-skills|dotnet-local-tools" # pin CLI tools (dotnet-ef/csharpier/reportgenerator) in .config/dotnet-tools.json for local+CI parity
  "aaronontheweb/dotnet-skills|dotnet-project-structure" # .slnx, Directory.Build.props, global.json layout
  "aaronontheweb/dotnet-skills|dotnet-slopwatch" # detect LLM reward-hacking in diffs (disabled tests, empty catches)
  "aaronontheweb/dotnet-skills|efcore-patterns" # EF Core query/tracking/migration mechanics
  "aaronontheweb/dotnet-skills|ilspy-decompile" # decompile assemblies to inspect the real API/behavior
  "aaronontheweb/dotnet-skills|microsoft-extensions-configuration" # typed options binding + startup validation
  "aaronontheweb/dotnet-skills|OpenTelemetry-NET-Instrumentation" # deep manual OTel: custom Activity/spans, metric cardinality, zero-alloc TagList (beyond web-backend wiring)
  "aaronontheweb/dotnet-skills|package-management" # NuGet central package management via dotnet CLI
  "aaronontheweb/dotnet-skills|r3-reactive-extensions" # R3 (Cysharp modern Rx): Observable, operators, schedulers for event-driven C#
  "aaronontheweb/dotnet-skills|serialization" # System.Text.Json / Protobuf / MessagePack guidance
  "aaronontheweb/dotnet-skills|snapshot-testing" # Verify snapshot/approval tests: HTTP responses, public API surface, serialized output
  "aaronontheweb/dotnet-skills|testcontainers-integration-tests" # integration tests against real DBs in Docker
  "aaronontheweb/dotnet-skills|type-design-performance" # structs vs classes, sealing, allocation-aware type design
  # .NET diagnostics (dotnet/skills - official Microsoft)
  "dotnet/skills|microbenchmarking"           # BenchmarkDotNet: design/run/compare microbenchmarks (net-new runtime perf)
  "dotnet/skills|dump-collect"                # crash / on-demand dump capture (Linux/macOS/Win + containers)
  # Architecture (codewithmukesh/dotnet-claude-kit) - version-neutral concepts referenced live; the
  # version-coupled ASP.NET Core areas are covered by the original house dotnet-* skills above (.NET 8 floor).
  "codewithmukesh/dotnet-claude-kit|clean-architecture" # Clean Architecture 4-project layout + dependency rules
  "codewithmukesh/dotnet-claude-kit|ddd"      # tactical DDD: aggregates, value objects, domain events
  # Docs / DB / Docker / Git (josiahsiegel/claude-plugin-marketplace)
  "josiahsiegel/claude-plugin-marketplace|docker-platform-guide" # per-OS Docker Desktop setup specifics
  "josiahsiegel/claude-plugin-marketplace|docker-security-guide" # container hardening, capability dropping, CIS
  "josiahsiegel/claude-plugin-marketplace|git-master" # non-trivial git: recovery, history rewrite, submodules
  "josiahsiegel/claude-plugin-marketplace|index-strategies" # SQL Server index design: clustered/filtered/columnstore/INCLUDE
  "josiahsiegel/claude-plugin-marketplace|markdown-style" # two-pass Markdown syntax/style review
  "josiahsiegel/claude-plugin-marketplace|query-optimization" # T-SQL rewrites, SARGability, execution-plan reading
  "josiahsiegel/claude-plugin-marketplace|tsql-functions" # T-SQL function catalog (string/date/window/JSON/XML)
  # Single-skill repos
  "supabase/agent-skills|supabase-postgres-best-practices" # Postgres performance + schema best practices
  "mryll/skills|vertical-slice-architecture"  # VSA: feature folders, minimal cross-slice coupling
  # Ionic / Capacitor mobile (capawesome-team/skills - MIT)
  "capawesome-team/skills|ionic-angular"      # Angular-specific Ionic patterns (components, theming, navigation)
  "capawesome-team/skills|capacitor-angular"  # Angular-specific Capacitor app patterns
  "capawesome-team/skills|capacitor-plugins"  # install/configure/use 160+ Capacitor plugins (official/Capawesome/community/CapGo)
)

# (2) Plugins "<plugin>@<marketplace>" (non-default marketplaces added first).
EXTRA_MARKETPLACES=(
  "jarrodwatts/claude-hud"
  "DietrichGebert/ponytail"
)
PLUGINS=(
  "superpowers@claude-plugins-official"       # workflow skills: plan, TDD, debug, verify-before-done
  "claude-md-management@claude-plugins-official" # audit + revise CLAUDE.md files
  "csharp-lsp@claude-plugins-official"      # inline Roslyn diagnostics on edit (complements serena nav); needs csharp-ls (dotnet tool install -g csharp-ls)
  "typescript-lsp@claude-plugins-official"  # same for Angular/TS work
  "security-guidance@claude-plugins-official" # security hooks: pattern warnings + LLM diff review on Stop/commit
  "frontend-design@claude-plugins-official"   # distinctive, production-grade frontend UI; polished code that avoids generic AI aesthetics
  "claude-hud@claude-hud"                       # statusline HUD (global/user scope)
  "ponytail@ponytail"                           # 'lazy senior dev' decision ladder: minimal-code default, cuts generated code/latency/cost
)

# (3) MCP servers as "name|args"; scope follows SCOPE.
#     @SERENA_CONTEXT@   -> resolved at install time per-agent (claude-code | ide-assistant).
#     @HOME_MEMORY_DIR@  -> resolved at install time to ~/.memory-mcp for BOTH agents (shared DB).
#     \${CLAUDE_PROJECT_DIR:-.} stays LITERAL so Claude Code interpolates it at server launch; for
#       Cursor (no shell interpolation) it is resolved to a concrete path when .cursor/mcp.json is written.
#     memory (mcp-memory-service): MemoryProfile='work' switches to memory_work.db.
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
if [ "$MEMORY_PROFILE" = "work" ]; then MEMORY_DB_FILE="memory_work.db"; fi  # separation is by DB path; backend stays sqlite_vec (the only valid local backend)
MEMORY_ENTRY="memory|-e MCP_MEMORY_STORAGE_BACKEND=$MEMORY_BACKEND -e MCP_MEMORY_SQLITE_PATH=@HOME_MEMORY_DIR@/$MEMORY_DB_FILE -- uvx --with numpy --from mcp-memory-service${MEMORY_PIN} memory server"

# context7 API key is a SECRET. RECOMMENDED: put it in ~/.claude/settings.json under "env" as
# CONTEXT7_API_KEY - context7 reads it from the environment at launch, so the key NEVER touches the
# MCP registration (.mcp.json) and is set once, user-global. In that case leave CONTEXT7_API_KEY
# UNSET in your install shell so the registration stays keyless (below).
# ALTERNATIVE (legacy): export CONTEXT7_API_KEY before running and it is baked as --api-key into the
# registration - but project scope writes <repo>/.mcp.json, so the key would land in that file; keep
# it uncommitted if you go this route.
CONTEXT7_SPEC="-- npx -y @upstash/context7-mcp${CTX7_PIN}"
[ -n "${CONTEXT7_API_KEY:-}" ] && CONTEXT7_SPEC="$CONTEXT7_SPEC --api-key $CONTEXT7_API_KEY"
CONTEXT7_ENTRY="context7|$CONTEXT7_SPEC"

MCPS=(
  "angular-cli|-- npx -y @angular/cli mcp" # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  "serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent${SERENA_PIN} serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd" # LSP symbol navigation; per-project SERENA_HOME (.serena/home - gitignore it, holds ~327MB LSP) isolates serena's registry/memories/logs/LSP, no pooling across projects/accounts; --project-from-cwd self-activates the repo (.serena/project.yml in cwd) on launch; PyPI (not git), dashboard off
  "playwright|-- npx -y @playwright/mcp${PW_PIN} --user-data-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright/screenshots" # drive a real browser for visual checks / web app verification
  "chrome-devtools|-- npx chrome-devtools-mcp@latest" # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  "appium-mcp|-- npx -y appium-mcp@latest" # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  "$MEMORY_ENTRY"                             # memory: cross-project semantic recall (mcp-memory-service)
  "$CONTEXT7_ENTRY"                           # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (4) PreToolUse hooks (claude-code): fetched into the repo from envoydev/agents-stack/claude/hooks on BOTH actions
# (per-hook fail-soft - a hook not yet upstream keeps its committed repo copy); on INSTALL each is also
# wired into .claude/settings.json. UPDATE refreshes files only (never settings).
# Each entry: "filename::matcher::args" - args (if any) are appended to the hook command.
HOOK_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/hooks"
# Every serena file-mutating tool the convention gate covers (symbol + line edits, create/replace/rename) - matched alongside Edit|Write.
SERENA_EDITORS="mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol|mcp__serena__create_text_file|mcp__serena__replace_content|mcp__serena__replace_regex|mcp__serena__rename_symbol|mcp__serena__replace_lines|mcp__serena__delete_lines|mcp__serena__insert_at_line"
HOOKS=(
  # Variant keys are PER PROJECT TYPE (union semantics - a file gets every matching skill):
  #   web/Angular        -> "cs ng sql ts"  (.ts/.js -> typescript; Angular suffixes also -> angular-conventions)
  #   browser extension  -> "ts"            (plain TS/JS, no framework/cs/sql)
  #   Node / TS tooling  -> "ts"            (+ "sql" if hand-written SQL)
  # ts gates bare .ts/.tsx/.js/.jsx/.mjs/.cjs on typescript (must be installed where ts is on).
  #   scss -> angular-styling  (.scss/.css - suffix-triggered, inert where the suffix never occurs)
  #   xaml -> dotnet-wpf       (.xaml - suffix-triggered, inert where the suffix never occurs)
  "require-convention-skill.js::Edit|Write|${SERENA_EDITORS}::cs ng sql ts scss xaml"
  "guard-protected-force-push.js::Bash::"         # block force-push to main/master/develop
  "guard-catastrophic-rm.js::Bash::"              # block recursive rm of /, ~, $HOME, or a bare *
  "guard-read-whole-file.js::Read::"              # block whole-file Read of a >100-line source file - locate via serena first
)

# (5) Subagents (claude-code): specialist agents fetched into .claude/agents/ on BOTH actions
# (per-agent fail-soft - an agent not yet upstream keeps its committed repo copy). Claude Code auto-discovers
# .claude/agents/*.md; no settings.json wiring needed. Cursor twins exist for the four resolvers only; the
# model-routed pipeline agents are Claude-only (Cursor agents pin a model but have no effort pin).
AGENT_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/agents"
AGENTS=(
  "dotnet-build-error-resolver.md"   # implement phase (sonnet/high): dotnet build -> categorize errors -> minimal fix loop (serena/csharp-lsp), capped
  "dotnet-test-failure-resolver.md"  # implement phase (sonnet/high): dotnet test -> red->green repair loop, anti-reward-hacking guard, capped
  "ng-build-error-resolver.md"       # implement phase (sonnet/high): ng build -> minimal fix loop (serena/LSP), capped
  "angular-test-resolver.md"         # implement phase (sonnet/high): ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
  "architecture-analyzer.md"         # analysis phase (opus/xhigh): read-only system-level structure map + change-fit verdict
  "task-analyzer.md"                 # analysis phase (opus/xhigh): read-only deep task analysis - impact, coupling, open questions
  "ci-failure-diagnoser.md"          # analysis phase (opus/xhigh): read-only CI red-run diagnosis via gh - categorize, local repro, route
  "issue-diagnoser.md"               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  "evidence-gatherer.md"             # diagnosis support (sonnet/medium): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  "greenfield-solution-designer.md"  # analysis phase (opus/xhigh): read-only greenfield design - architecture/stack/structure options from a spec
  "cross-stack-contract-designer.md" # analysis phase (opus/xhigh): read-only - freezes the shared backend/frontend contract before the per-stack designers
  "framework-upgrade-planner.md"     # analysis phase (opus/xhigh): read-only - turns a version/deprecation event into an ordered, contracted upgrade plan
  "security-auditor.md"              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  # Per-domain specialist team (5 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
  "aspnet-solution-designer.md"      # design phase (opus/xhigh): ASP.NET Core architecture + plan + test strategy, decomposes into parallel tasks
  "aspnet-implementer.md"            # build phase (sonnet/medium): builds one ASP.NET task - code + tests
  "aspnet-verifier.md"               # verify phase (sonnet/xhigh): gates the ASP.NET build vs plan + quality, punch-list back
  "angular-solution-designer.md"     # design phase (opus/xhigh): Angular architecture + plan + test strategy, decomposes
  "angular-implementer.md"           # build phase (sonnet/medium): builds one Angular task - code + tests
  "angular-verifier.md"              # verify phase (sonnet/xhigh): gates the Angular build vs plan + quality
  "wpf-solution-designer.md"         # design phase (opus/xhigh): WPF strict-MVVM architecture + plan + test strategy, decomposes
  "wpf-implementer.md"               # build phase (sonnet/medium): builds one WPF task - code + tests
  "wpf-verifier.md"                  # verify phase (sonnet/xhigh): gates the WPF build vs plan + quality
  "mobile-solution-designer.md"      # design phase (opus/xhigh): Ionic/Capacitor architecture + plan + test strategy, decomposes
  "mobile-implementer.md"            # build phase (sonnet/medium): builds one mobile task - code + tests
  "mobile-verifier.md"               # verify phase (sonnet/xhigh): gates the mobile build vs plan + quality
  "data-solution-designer.md"        # design phase (opus/xhigh): schema/data-model architecture + plan + test strategy, decomposes
  "data-implementer.md"              # build phase (sonnet/medium): builds one data task - SQL + migration tests
  "data-verifier.md"                 # verify phase (sonnet/xhigh): gates the data build vs plan + quality
)

# (6) Path-scoped rules (claude-code): fetched into .claude/rules/ on BOTH actions - lazy-load on
# matching file reads; conventions stay with the convention-gate hook, rules carry only glob-scoped routing.
RULES_BASE_URL="https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/rules"
CLAUDE_RULES=(
  "markdown-docs.md"          # markdown-style routing, path-scoped **/*.md
  "dotnet-repair-agents.md"   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  "angular-repair-agents.md"  # Angular repair-loop routing, path-scoped
)

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); MCPs and plugins SKIP if already present
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

install_plugins() {
  command -v claude >/dev/null || { echo "claude CLI not found"; return 1; }
  for mp in ${EXTRA_MARKETPLACES[@]+"${EXTRA_MARKETPLACES[@]}"}; do claude plugin marketplace add "$mp" 2>/dev/null || true; done
  for p in "${PLUGINS[@]}"; do
    # claude-hud is a statusline HUD - force USER scope regardless of $CLAUDE_SCOPE. A project-scoped
    # install + the global statusline enable mismatch, so every OTHER project warns "plugin not cached".
    pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac
    log "plugin [$pscope]: $p"
    claude plugin install "$p" --scope "$pscope" || true   # may prompt to trust on first run
  done
}

install_mcps() {
  command -v claude >/dev/null || { echo "claude CLI not found"; return 1; }
  local entry name args spec tok_cfg
  local -a spec_words
  tok_cfg='${CLAUDE_CONFIG_DIR}'
  for entry in "${MCPS[@]}"; do
    name="${entry%%|*}"; args="${entry#*|}"
    spec="${args//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec="${spec//@HOME_MEMORY_DIR@/$HOME_MEMORY_DIR}"
    # CLAUDE_CONFIG_DIR unset -> the CLI can't interpolate ${CLAUDE_CONFIG_DIR} at launch, so resolve it now.
    [ -z "${CLAUDE_CONFIG_DIR:-}" ] && spec="${spec//"$tok_cfg"/$CONFIG_DIR}"
    if claude mcp get "$name" >/dev/null 2>&1; then echo "  mcp $name already configured - skipping"; continue; fi
    log "mcp [$CLAUDE_SCOPE]: $name"
    # ASSUMPTION: no resolved path token ($CONFIG_DIR / $HOME_MEMORY_DIR) contains a space - the MCP
    # spec is space-separated by design (-e KEY=VAL -- cmd args), so a space inside one token cannot
    # survive word-splitting. read -ra splits on whitespace into an array (the intended token split)
    # AND disables glob expansion, so a bare '*' in spec is passed literally, never expanded.
    read -ra spec_words <<<"$spec"
    claude mcp add --scope "$CLAUDE_SCOPE" "$name" "${spec_words[@]}" || true
  done
}

download_hooks() {  # fetch each hook file into the repo; per-hook fail-soft (keeps repo copy)
  command -v curl >/dev/null || { log "  !! curl not found - skipping hook fetch"; return 0; }
  local root entry file dest tmp
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping hooks"; return 0; }
  for entry in "${HOOKS[@]}"; do
    file="${entry%%::*}"
    dest="$root/.claude/hooks/$file"; mkdir -p "$(dirname "$dest")"
    tmp="$(mktemp)"
    if ! curl -fsSL "$HOOK_BASE_URL/$file" -o "$tmp"; then log "  !! fetch failed (kept repo copy if any): $file"; rm -f "$tmp"; continue; fi
    if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then rm -f "$tmp"; log "  hook current: $file"
    else mv "$tmp" "$dest"; chmod +x "$dest"; log "  hook fetched -> $file"; fi
  done
}

download_agents() {  # fetch each subagent .md into .claude/agents/; per-agent fail-soft (keeps repo copy)
  command -v curl >/dev/null || { log "  !! curl not found - skipping agent fetch"; return 0; }
  local root file dest tmp
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping agents"; return 0; }
  for file in "${AGENTS[@]}"; do
    dest="$root/.claude/agents/$file"; mkdir -p "$(dirname "$dest")"
    tmp="$(mktemp)"
    if ! curl -fsSL "$AGENT_BASE_URL/$file" -o "$tmp"; then log "  !! fetch failed (kept repo copy if any): $file"; rm -f "$tmp"; continue; fi
    if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then rm -f "$tmp"; log "  agent current: $file"
    else mv "$tmp" "$dest"; log "  agent fetched -> $file"; fi
  done
}

download_rules() {  # fetch each rule .md into .claude/rules/; per-rule fail-soft (keeps repo copy)
  command -v curl >/dev/null || { log "  !! curl not found - skipping rule fetch"; return 0; }
  local root file dest tmp
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping rules"; return 0; }
  for file in "${CLAUDE_RULES[@]}"; do
    dest="$root/.claude/rules/$file"; mkdir -p "$(dirname "$dest")"
    tmp="$(mktemp)"
    if ! curl -fsSL "$RULES_BASE_URL/$file" -o "$tmp"; then log "  !! fetch failed (kept repo copy if any): $file"; rm -f "$tmp"; continue; fi
    if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then rm -f "$tmp"; log "  rule current: $file"
    else mv "$tmp" "$dest"; log "  rule fetched -> $file"; fi
  done
}

wire_hooks_settings() {  # INSTALL: ensure every hook's PreToolUse block is in settings.json (idempotent)
  local root settings; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  settings="$root/.claude/settings.json"; mkdir -p "$(dirname "$settings")"
  command -v python3 >/dev/null || { log "  !! python3 not found - wire hooks into settings.json by hand"; return 0; }
  # NB: program via -c (not `python3 - <<heredoc`): a pipe + heredoc both target stdin and the pipe
  # wins, so a heredoc program would never run. -c frees stdin for the piped hook specs.
  local prog; prog=$(cat <<'PY'
import json, sys
path = sys.argv[1]
specs = []
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    file, matcher, args = (line.split("::", 2) + ["", ""])[:3]
    if not matcher:
        continue
    cmd = "$CLAUDE_PROJECT_DIR/.claude/hooks/" + file + ((" " + args) if args else "")
    specs.append((matcher, cmd))
try:
    data = json.load(open(path))
except Exception:
    data = {}
cur = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
have = {h.get("command", "") for e in cur for h in e.get("hooks", [])}
changed = False
for matcher, command in specs:
    if command in have:
        continue
    cur.append({"matcher": matcher, "hooks": [{"type": "command", "command": command}]})
    have.add(command); changed = True
if changed:
    json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
    print("  settings.json: hook block(s) injected")
else:
    print("  settings.json: hooks already wired - unchanged")
PY
)
  printf '%s\n' "${HOOKS[@]}" | python3 -c "$prog" "$settings" || log "  !! settings.json wiring failed"
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

update_plugins() {
  command -v claude >/dev/null || { echo "claude CLI not found"; return 1; }
  claude plugin marketplace update 2>/dev/null || true            # refresh marketplaces first
  for p in "${PLUGINS[@]}"; do
    pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac   # claude-hud is user-scope (statusline)
    log "plugin update [$pscope]: $p"
    claude plugin update "$p" --scope "$pscope" 2>&1 | tail -1 || true
  done
}

update_mcps() {
  command -v claude >/dev/null || { echo "claude CLI not found"; return 1; }
  # MCP binaries auto-update at launch (@latest / uvx git+); this re-asserts the config.
  local entry name args spec tok_cfg
  local -a spec_words
  tok_cfg='${CLAUDE_CONFIG_DIR}'
  for entry in "${MCPS[@]}"; do
    name="${entry%%|*}"; args="${entry#*|}"
    spec="${args//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec="${spec//@HOME_MEMORY_DIR@/$HOME_MEMORY_DIR}"
    [ -z "${CLAUDE_CONFIG_DIR:-}" ] && spec="${spec//"$tok_cfg"/$CONFIG_DIR}"
    log "mcp refresh [$CLAUDE_SCOPE]: $name"
    claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 || true
    # Same no-spaces-in-resolved-path assumption + glob-safe array split as install_mcps (see there).
    read -ra spec_words <<<"$spec"
    claude mcp add --scope "$CLAUDE_SCOPE" "$name" "${spec_words[@]}" || true
  done
}

update_hooks() { download_hooks; }   # UPDATE: refresh hook files only; settings.json untouched
update_agents() { download_agents; } # UPDATE: refresh subagent files
update_rules() { download_rules; }   # UPDATE: refresh rule files

prune_agents_cache() {
  # npx skills stages an agent-neutral .agents/ store. With a STRICT per-agent copy (.claude/skills is
  # a real copy), nothing reads .agents/ anymore - prune it. Guard: keep it if any skill entry under
  # .claude/skills is a symlink (a symlinked tree still depends on .agents/; removing it would dangle).
  local root d; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -d "$root/.agents" ] || return 0
  local has_symlink=false
  for d in "$root/.claude/skills"; do
    [ -d "$d" ] || continue
    if find "$d" -maxdepth 1 -type l 2>/dev/null | grep -q .; then has_symlink=true; break; fi
  done
  if $has_symlink; then
    log "  kept .agents/ - a skills tree has symlinks that still depend on it"
  else
    rm -rf "$root/.agents" && log "  pruned .agents/ (skills are real per-agent copies)"
  fi
}

# ===========================================================================
# DISPATCH
# ===========================================================================
prerequisites_check
install_github_cli

# claude-only steps fail soft (command -v claude) if the CLI is not installed.
if [ "$ACTION" = "install" ]; then
  install_skills; install_plugins; install_mcps; download_hooks; wire_hooks_settings; download_agents; download_rules
else
  update_skills; update_plugins; update_mcps; update_hooks; update_agents; update_rules
fi

prune_agents_cache
log "done: $ACTION ($SCOPE, agent=$AGENT). ${#SKILLS[@]} skills, ${#PLUGINS[@]} plugins, MCPs, hooks=${#HOOKS[@]}, agents=${#AGENTS[@]}, rules=${#CLAUDE_RULES[@]}."

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
cat <<'GITIGNORE'

Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git/info/exclude):
  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)
  .claude          Claude Code project config + local state (settings.local.json, hooks)
  .slopwatch       dotnet-slopwatch output
  .playwright      playwright MCP user-data-dir + screenshots
  .mcp.json        generated MCP server config (machine-local)
  skill-lock.json  skills CLI lock file
GITIGNORE
