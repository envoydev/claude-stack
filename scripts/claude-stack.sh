#!/usr/bin/env bash
#
# claude-stack.sh install|update [--space <name>] [--scope project|global] [--context7 local|remote]
# [--github-cli] [--keep-pins] - install/update the CLAUDE CODE stack FOR A PROJECT: every skill / plugin / MCP from
# claude-stack.html (the complete toolset, not a curated subset), installed INTO a project. Built-in/
# system CLI skills are excluded (they ship with the CLI). Bash twin of claude-stack.ps1; the Cursor
# stack lives in the cursor-stack repo.
#
# Usage - run this file directly inside the target project:
#   bash claude-stack.sh install   # install for Claude Code
#   bash claude-stack.sh update    # update Claude Code (skills + plugins + mcp + hooks)
#
# Provisions Claude Code: skills --agent claude-code; plugins; MCPs via `claude mcp add`; hooks +
# settings.json. Requires the `claude` CLI; claude-only steps fail soft if it is absent.
#
# The action (install|update) is the one positional argument; everything else is a named flag (any order):
#   --space <name>          any word; selects the Claude account ~/.claude-<name> (skills/plugins/MCPs
#                           install there - CLAUDE_CONFIG_DIR is exported for the claude CLI) AND a
#                           separate memory DB (memory_<name>.db). Omit for the default ~/.claude
#                           account + shared DB. The DB lives at ~/.memory-mcp, so a Cursor install
#                           on the same machine sees the same per-space DB.
#   --scope project|global  project (default) installs the full set INTO this repo (skills project-
#                           scoped, plugins/mcps --scope project); global installs it into the active
#                           account (skills -g, plugins/mcps --scope user). Overrides the SCOPE env var.
#   --context7 local|remote context7 transport; remote (default) is the hosted HTTP server, local the
#                           npx stdio server.
#   --github-cli            install the GitHub CLI (gh) via Homebrew (macOS) if missing; prompts for
#                           `gh auth login` when unauthenticated.
#   --keep-pins             keep this project's LOCAL model/effort frontmatter edits on installed
#                           agents (.claude/agents) and skills (SKILL.md) across the refresh - the
#                           local value is re-applied after the fetch/reinstall (which otherwise
#                           resets it to upstream). Only existing keys are re-applied; with the flag
#                           on, a local pin edit always wins over an upstream pin change.
#
# Full inventory - comment out manifest entries below to trim it to a curated subset.
set -euo pipefail

usage() {
  cat <<USAGE
claude-stack.sh - install or update the Claude Code stack into a project.

Usage: bash $0 <install|update> [--space <name>] [--scope project|global] [--context7 local|remote] [--github-cli] [--keep-pins]

Action (one is REQUIRED, positional):
  install   first-time provision; MCP/plugin versions freeze until the next update; wires .claude/settings.json
  update    re-resolve every runtime to latest + refresh hooks/agents/rules; leaves settings.json untouched

Named flags (any order, each optional with a default):
  --space <name>           install into the ~/.claude-<name> account + a separate memory_<name>.db
  --scope project|global   project (default) installs INTO this repo; global installs into the account
  --context7 local|remote  context7 transport; remote (default) is the hosted server, local the npx server
  --github-cli             install the GitHub CLI (gh) if missing
  --keep-pins              keep local model/effort frontmatter edits on installed agents/skills across
                           the refresh (an update resets them to upstream otherwise)
  --selection <file>       install ONLY the skills/plugins/mcps/agents/rules named in <file> (one 'category name' per line); hooks always install
  --print-plan             with --selection, print the resolved per-category install set and exit (dry run)
  --skills-only            run only the skill install/update step, then exit (testability; skips
                           prerequisites/plugins/mcps/hooks/agents/rules)
  --source <dir>           install FROM an existing claude-stack checkout instead of cloning one.
                           The caller owns <dir> - this script never deletes it. Used by the
                           /claude-stack setup+configure skills, which clone once and pass it here
                           so a guided run takes one clone, not two. Omit it and the script clones
                           its own source (and removes it on exit) - the standalone path.

Environment variables:
  SCOPE=project|global   fallback for --scope when the flag is absent (default project)
  CLAUDE_CONFIG_DIR      target a specific account when no --space is given (default ~/.claude)
  STACK_SKILLS_REPO      stack source repo (release-archive download, git-clone fallback; default https://github.com/envoydev/claude-stack); ignored with --source
  CONTEXT7_API_KEY       context7 API key, read from the environment at launch (higher rate limits)
  CONTEXT7_BAKE_KEY      with --context7 local, bake CONTEXT7_API_KEY into the registration (keep .mcp.json uncommitted)

Examples:
  bash $0 install
  bash $0 install --space work --github-cli
  bash $0 update --scope global
USAGE
}

# -h/--help anywhere -> print full usage and exit 0, before the required-action check below.
for _a in "$@"; do case "$_a" in -h|--help) usage; exit 0 ;; esac; done

# 'install' or 'update' is REQUIRED - the one positional argument (the action). Everything after it is
# a named flag with a default (parsed below); shift the action off so $@ is just the flags.
ACTION="${1:-}"
case "$ACTION" in
  install|update) shift ;;
  help) usage; exit 0 ;;
  *) usage >&2; echo "error: first argument must be 'install' or 'update' (got '${ACTION:-<none>}')" >&2; exit 1 ;;
esac

# This script provisions the Claude Code agent. (The Cursor stack lives in the cursor-stack repo.)
AGENT="claude-code"

# Named flags (any order, each with a default): --space <name> (account ~/.claude-<name> +
# memory_<name>.db), --scope project|global, --context7 local|remote, --github-cli (install gh),
# --keep-pins (preserve local model/effort pin edits across the refresh).
# Named-only: there is no positional space - a value must be attached to its flag, so a space can be
# literally any word (no reserved-word collisions with the flag names).
SPACE=""
SCOPE_FLAG=""
INSTALL_GITHUB_CLI=false
KEEP_PINS=false
CONTEXT7_MODE="remote"
SELECTION=""
PRINT_PLAN=false
SKILLS_ONLY=false
SOURCE_DIR=""
_flag_val() {  # $1 = flag name, $2 = the arg meant to be its value ('' when the flag was last)
  [ -n "$2" ] || { usage >&2; echo "error: $1 needs a value" >&2; exit 1; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --space)      _flag_val "$1" "${2:-}"; SPACE="$2";         shift 2 ;;
    --space=*)    SPACE="${1#*=}";                             shift ;;
    --scope)      _flag_val "$1" "${2:-}"; SCOPE_FLAG="$2";    shift 2 ;;
    --scope=*)    SCOPE_FLAG="${1#*=}";                        shift ;;
    --context7)   _flag_val "$1" "${2:-}"; CONTEXT7_MODE="$2"; shift 2 ;;
    --context7=*) CONTEXT7_MODE="${1#*=}";                     shift ;;
    --github-cli) INSTALL_GITHUB_CLI=true;                     shift ;;
    --keep-pins)  KEEP_PINS=true;                              shift ;;
    --selection)   _flag_val "$1" "${2:-}"; SELECTION="$2";     shift 2 ;;
    --selection=*) SELECTION="${1#*=}";                          shift ;;
    --print-plan)  PRINT_PLAN=true;                              shift ;;
    --skills-only) SKILLS_ONLY=true;                              shift ;;
    --source)      _flag_val "$1" "${2:-}"; SOURCE_DIR="$2";      shift 2 ;;
    --source=*)    SOURCE_DIR="${1#*=}";                          shift ;;
    *) usage >&2; echo "error: unknown argument '$1' (named flags only: --space, --scope, --context7, --github-cli, --keep-pins, --selection, --print-plan, --skills-only, --source)" >&2; exit 1 ;;
  esac
done

# Validate: --space is baked into a path (~/.claude-<space>, memory_<space>.db); --scope + --context7 are enums.
if [ -n "$SPACE" ]; then
  case "$SPACE" in
    [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
      usage >&2; echo "error: --space '$SPACE' must start alphanumeric; chars [A-Za-z0-9._-]" >&2; exit 1 ;;
  esac
fi
# --scope flag wins, else the SCOPE env var, else project. Lower-case the two enums (NOT the space,
# whose casing is significant) so a non-canonical casing like 'Global'/'Remote' is accepted the same as
# on the case-insensitive PowerShell twin - printf|tr always exits 0, so this is set -e safe.
SCOPE="${SCOPE_FLAG:-${SCOPE:-project}}"
SCOPE="$(printf '%s' "$SCOPE" | tr '[:upper:]' '[:lower:]')"
CONTEXT7_MODE="$(printf '%s' "$CONTEXT7_MODE" | tr '[:upper:]' '[:lower:]')"
case "$SCOPE" in project|global) ;;
  *) usage >&2; echo "error: --scope must be 'project' or 'global' (got '$SCOPE')" >&2; exit 1 ;;
esac
case "$CONTEXT7_MODE" in local|remote) ;;
  *) usage >&2; echo "error: --context7 must be 'local' or 'remote' (got '$CONTEXT7_MODE')" >&2; exit 1 ;;
esac
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# Run-outcome tracking for the honest end-of-run summary.
FAIL_COUNT=0            # item install/add failures (skills / plugins / mcps)
CLAUDE_MISSING=false    # claude CLI absent -> plugins / MCPs / settings.json wiring skipped
PREREQ_MISSING=false    # a hard prerequisite (uvx / python3 / node) was missing
note_failure() { FAIL_COUNT=$((FAIL_COUNT + 1)); log "  !! $*"; }

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
    echo "  !! python3 not found - the security-guidance hook and the settings.json wiring will fail." >&2
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
  # claude CLI: the core dependency for plugins, MCPs, and settings.json wiring. Absent -> those steps
  # are skipped (fail-soft); flag it upfront so the user can fix PATH before the long skill install runs.
  if command -v claude >/dev/null 2>&1; then
    printf '  claude: %s\n' "$(command -v claude)"
  else
    echo "  !! claude CLI not found - plugins, MCPs, and settings.json wiring will be SKIPPED." >&2
    echo "     Install: https://docs.claude.com/claude-code (then re-run to add plugins/MCPs)." >&2
    CLAUDE_MISSING=true
  fi
  if ! $ok; then PREREQ_MISSING=true; echo "  Install the missing tools above, then re-run." >&2; fi
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

# CONFIG_DIR is for path resolution only and is normally NOT exported - EXCEPT when a space is given:
# a space (any word) selects the Claude account ~/.claude-<space> and IS exported so the claude CLI
# (skills/plugins/mcp) installs into it. Without a space, CLAUDE_CONFIG_DIR (a specific account you
# set yourself, e.g. ~/.claude-work) or the ~/.claude default is used and never exported.
if [ -n "$SPACE" ]; then
  CONFIG_DIR="$HOME/.claude-$SPACE"
  # Distinguish an existing account from a brand-new one so a typo'd space ('wrok') is visible, not silent.
  if [ -d "$CONFIG_DIR" ]; then
    log "space '$SPACE' -> existing account $CONFIG_DIR (CLAUDE_CONFIG_DIR exported for the claude CLI); memory DB memory_$SPACE.db."
  else
    log "space '$SPACE' -> creating NEW account $CONFIG_DIR (typo? did you mean an existing one?); memory DB memory_$SPACE.db."
  fi
  [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ "${CLAUDE_CONFIG_DIR}" != "$CONFIG_DIR" ] && \
    log "space '$SPACE' overrides CLAUDE_CONFIG_DIR ($CLAUDE_CONFIG_DIR)."
  export CLAUDE_CONFIG_DIR="$CONFIG_DIR"
else
  CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -z "${CLAUDE_CONFIG_DIR:-}" ]; then
    log "CLAUDE_CONFIG_DIR not set - using the claude CLI default account; resolving config paths to $CONFIG_DIR."
  fi
fi

SERENA_CTX="claude-code"   # serena's --context for Claude Code

# Shared memory root - always resolved at install time to a fixed home path, so a Cursor install on
# the same machine points to the same DB.
HOME_MEMORY_DIR="$HOME/.memory-mcp"

if [ "$SCOPE" = "project" ]; then
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  CLAUDE_SCOPE="project"
else
  CLAUDE_SCOPE="user"
fi

# ===========================================================================
# MANIFEST - edit these, then run.
# ===========================================================================

# (1) Skills, one per line as "repo|skill" (comment a line to skip it).
SKILLS=(
  # House (envoydev/claude-stack)
  "envoydev/claude-stack|create-ticket"             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  "envoydev/claude-stack|dev-log-convert"           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  "envoydev/claude-stack|explain-code-tutor"        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  "envoydev/claude-stack|project-quality-loop"             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  "envoydev/claude-stack|project-architecture-quality-loop"        # deliberate analyze-assess-improve loop - the project-architecture-analyzer capture writes ARCHITECTURE.md + ASSESSMENT.md, fix cons by tier, reconcile docs; manual /-only
  "envoydev/claude-stack|project-code-style-analyzer"    # deliberate code-style capture - fans out code-style-analyzer per language, merges docs/PROJECT-CODE-STYLE.md, generates + wires the inject-code-style hook; manual /-only
  "envoydev/claude-stack|project-architecture-analyzer"  # deliberate architecture capture - dispatches code-analyzer per module, reasons in the main session, writes docs/architecture/ARCHITECTURE.md + ASSESSMENT.md + the generated awareness rule baseline-project-architecture.md; manual /-only
  "envoydev/claude-stack|project-version-upgrade"        # deliberate BREAKING version-event flow (framework/runtime/package major) - plan in-session via context7 + code-analyzer digests, approval gate (auto mode only on explicit user ask), staged execution via implementers + resolvers; manual /-only
  "envoydev/claude-stack|project-capabilities"           # deliberate capabilities capture - inventories installed skills/agents/MCPs/plugins, generates the awareness rule baseline-project-capabilities.md; manual /-only
  "envoydev/claude-stack|project-related-context"        # deliberate related-projects capture - args paths/URLs, fans out related-project-analyzer per sibling, writes the awareness rule baseline-project-related-context.md + docs/PROJECT-RELATED-CONTEXT.md; manual /-only
  "envoydev/claude-stack|project-build-from-scratch" # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  "envoydev/claude-stack|project-task-flow"    # entry-point router: classify -> smallest execution mode -> cross-domain contract freeze + integration gate; home of the shared subagent policies
  "envoydev/claude-stack|project-verify-plan"      # audit an implementation plan BEFORE building - risk-coverage review (traps named per the stack skill, scope, edges, minimal); precedes /code-review
  "envoydev/claude-stack|project-implementer"              # single-chat build step: execute a verified plan task-by-task (contracts + per-task green gate + inline red-resolution, no dispatch), finish via /code-review + the done-gate
  "envoydev/claude-stack|project-solution-design"  # single-chat designer twin: read the architecture, judge where a change fits (extend/refactor/isolate), load the stack skill for traps, decompose into an ordered plan; feeds project-verify-plan
  "envoydev/claude-stack|project-task-cycle"       # gated single-chat vertical: design -> plan audit -> user approval + build mode -> build -> conformance verify (skippable) -> /code-review; hard user stop between steps, plan-file + serena-note state survives compaction
  "envoydev/claude-stack|project-failure-signatures" # single-chat diagnoser twin: local-runtime crash signatures (null-ref/DI/deadlock/disposed/config-drift/boundary/HTTP-status) -> where to isolate each; pairs with systematic-debugging
  "envoydev/claude-stack|project-ci-failure-signatures"        # single-chat CI-diagnoser twin: red-pipeline signatures (compile/restore, green-locally-red-on-runner, quality-gate, signing/release, workflow-config, infra-flake) -> code-vs-environment call + route; pairs with project-failure-signatures
  "envoydev/claude-stack|devops"           # DevOps for the .NET/Angular house: Docker multi-stage/digest-pinned/non-root, GitHub Actions CI/CD, safe expand-contract deploys, secrets/OIDC, Aspire AppHost
  "envoydev/claude-stack|database-conventions" # cross-engine DB conventions + per-engine skill routing
  "envoydev/claude-stack|data-security"    # SQL/data-layer security: parameterized-only injection, least-privilege DB accounts, row-level security, connection-string secrets, encryption, audit
  "envoydev/claude-stack|typescript"       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  "envoydev/claude-stack|angular-conventions" # Angular 17+/TS house conventions (signals, OnPush, a11y)
  "envoydev/claude-stack|angular-material"   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  "envoydev/claude-stack|angular-styling"    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  "envoydev/claude-stack|angular-security"   # Angular/web frontend security: XSS/DomSanitizer bypass, CSP, CSRF, no-secrets-in-bundle, token storage, SSR/TransferState
  "envoydev/claude-stack|frontend"         # web frontend router: Angular/TS + in-skill design-quality guidance -> mobile
  "envoydev/claude-stack|mobile"           # Ionic/Capacitor router/index over the Angular (angular-conventions) + TypeScript baselines
  "envoydev/claude-stack|ionic"            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  "envoydev/claude-stack|capacitor-release" # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  "envoydev/claude-stack|mobile-security"  # Ionic/Capacitor mobile security: Keychain/Keystore storage, deep-link validation, permissions, cleartext/WebView hardening
  "envoydev/claude-stack|csharp"           # C# house conventions - style, naming, async, logging, DI
  "envoydev/claude-stack|csharp-design-patterns" # all 23 GoF patterns with modern .NET 8+ forms
  "envoydev/claude-stack|dotnet"           # router mapping .NET work areas to specialist skills
  "envoydev/claude-stack|dotnet-architecture-tests" # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  "envoydev/claude-stack|dotnet-aspire"    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  "envoydev/claude-stack|dotnet-authentication" # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  "envoydev/claude-stack|dotnet-code-quality" # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
  "envoydev/claude-stack|dotnet-console-apps" # console-app interface surface: CLI arg parsing (System.CommandLine 2.0/Spectre.Console.Cli/Cocona) + bot-SDK integration (Telegram/Discord/Slack/exchange) in a BackgroundService
  "envoydev/claude-stack|dotnet-cryptography" # System.Security.Cryptography: SHA-2, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare
  "envoydev/claude-stack|dotnet-error-handling" # Result + ProblemDetails (RFC 9457) + IExceptionHandler + FluentValidation
  "envoydev/claude-stack|dotnet-grpc"      # gRPC: .proto/codegen, ASP.NET Core host, 4 streaming modes, JWT/mTLS, interceptors, health
  "envoydev/claude-stack|dotnet-hosted-services" # worker/background-service host: BackgroundService, ExecuteAsync trap, scoped scope, PeriodicTimer, shutdown, Channels
  "envoydev/claude-stack|dotnet-messaging" # event-driven messaging: Wolverine (MIT)/MassTransit, outbox, sagas, RabbitMQ/Azure SB
  "envoydev/claude-stack|dotnet-migrate"   # safe migration workflow: EF schema, .NET upgrades, NuGet - rollback + verify per step
  "envoydev/claude-stack|dotnet-minimal-api" # minimal API endpoint mechanics: MapGroup, TypedResults, endpoint filters, binding
  "envoydev/claude-stack|dotnet-mvc-controllers" # controller-based Web API: [ApiController], attribute routing, ActionResult<T>, auto-400 filter, action filters, binding
  "envoydev/claude-stack|dotnet-openapi"   # OpenAPI doc (Swashbuckle / built-in .NET 9+) + Scalar docs UI
  "envoydev/claude-stack|dotnet-realtime"  # SignalR real-time: strongly-typed Hub<T>, IHubContext push, groups/presence, reconnection, JWT-over-querystring, Redis/Azure backplane
  "envoydev/claude-stack|dotnet-security"  # OWASP Top 10 (2021) -> .NET 8 mitigations; deprecated-pattern warnings
  "envoydev/claude-stack|dotnet-source-generators" # Roslyn IIncrementalGenerator authoring + built-in generators (GeneratedRegex/LoggerMessage/STJ)
  "envoydev/claude-stack|dotnet-testing"   # .NET test strategy: AAA, per-layer coverage, library routing
  "envoydev/claude-stack|dotnet-web-backend" # ASP.NET Core cross-cutting: HttpClientFactory, OpenAPI, observability
  "envoydev/claude-stack|dotnet-winforms"  # WinForms conventions: MVP/binding, disposal, GDI leaks, high-DPI, migration
  "envoydev/claude-stack|dotnet-wpf"       # WPF strict-MVVM conventions, bindings, virtualization
  "envoydev/claude-stack|postgres"         # PostgreSQL engine delta: index types, JSONB, SARGability, EXPLAIN, pooling
  "envoydev/claude-stack|sqlite"           # SQLite engine delta: WAL/single-writer, PRAGMAs, type affinity, limited ALTER
  "envoydev/claude-stack|dotnet-data-access" # EF Core + NHibernate ORM hub (references/): DbContext, tracking, N+1, projection
  "envoydev/claude-stack|dotnet-architecture" # architecture decision hub (references/): clean/ddd/vsa/modular/microservices
  "envoydev/claude-stack|markdown-style" # Markdown authoring / review: syntax canon (valid) + house style overlay, two-pass procedure
  "envoydev/claude-stack|docs-as-code" # docs-as-code authoring: Mermaid sequence/ER diagrams, ADRs (Nygard/MADR 4), C4 views - per-type references/
  "envoydev/claude-stack|ilspy-decompile" # decompile a .NET assembly (ilspycmd via dnx) to read real API/behavior - framework internals, NuGet source, pre-upgrade checks
  "envoydev/claude-stack|dotnet-project-setup" # .NET solution build spine (hub, references/): src/tests layout, .slnx, Directory.Build.props, global.json, central package management, dotnet-tool pinning
  "envoydev/claude-stack|dotnet-performance" # perf-aware .NET design (hub, references/): allocation/type design (struct vs class, Span, ValueTask) + serialization-format choice (STJ source-gen / Protobuf / MessagePack)
  "envoydev/claude-stack|dotnet-diagnostics" # measure/diagnose a live .NET process (hub, references/): BenchmarkDotNet microbenchmarks + crash/hang/OOM dump capture & first-look SOS analysis
  "envoydev/claude-stack|nx"               # Nx monorepo: project-graph nav + 'nx affected' scoping, generators, module-boundary tags; CLI over MCP; serena-vs-nx routing
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
  "claude-hud@claude-hud"                       # statusline HUD (global/user scope)
  "ponytail@ponytail"                           # 'lazy senior dev' decision ladder: minimal-code default, cuts generated code/latency/cost
)

# (3) MCP servers as "name|args"; scope follows SCOPE.
#     @SERENA_CONTEXT@   -> resolved at install time to claude-code.
#     @HOME_MEMORY_DIR@  -> resolved at install time to ~/.memory-mcp (shared with any Cursor install on the box).
#     \${CLAUDE_PROJECT_DIR:-.} stays LITERAL so Claude Code interpolates it at server launch.
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
# Bounded fetches (npm_config_fetch_timeout / curl --max-time) so a dead network fails fast to the
# unpinned fallback instead of hanging on a single silent line.
_npm_latest()  { command -v npm >/dev/null 2>&1 && npm_config_fetch_timeout=15000 npm view "$1" version 2>/dev/null | tr -d '[:space:]'; }
_pypi_latest() { curl -fsSL --max-time 15 "https://pypi.org/pypi/$1/json" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['info']['version'])" 2>/dev/null; }
log "resolving latest MCP runtime versions (install/update network step)"
# '|| true' is REQUIRED: under `set -e` a failing command substitution (offline, or npm/curl/python3
# absent) aborts the whole run - these must fall through to empty -> unpinned, per the design above.
MCP_CONTEXT7_VER="$(_npm_latest @upstash/context7-mcp)" || true
MCP_PLAYWRIGHT_VER="$(_npm_latest @playwright/mcp)" || true
MCP_SERENA_VER="$(_pypi_latest serena-agent)" || true
MCP_MEMORY_VER="$(_pypi_latest mcp-memory-service)" || true
# Version-pin suffix: "@1.2.3" when resolved, "" (unpinned fallback) when offline.
CTX7_PIN="${MCP_CONTEXT7_VER:+@$MCP_CONTEXT7_VER}"
PW_PIN="${MCP_PLAYWRIGHT_VER:+@$MCP_PLAYWRIGHT_VER}"
SERENA_PIN="${MCP_SERENA_VER:+@$MCP_SERENA_VER}"
MEMORY_PIN="${MCP_MEMORY_VER:+@$MCP_MEMORY_VER}"
# Report what pinned vs. fell back to unpinned - the whole point of this step is 'frozen until update'.
for _pv in "context7:$MCP_CONTEXT7_VER" "playwright:$MCP_PLAYWRIGHT_VER" "serena:$MCP_SERENA_VER" "memory:$MCP_MEMORY_VER"; do
  _pn="${_pv%%:*}"; _pver="${_pv#*:}"
  if [ -n "$_pver" ]; then log "  pinned $_pn@$_pver"
  else log "  !! could not resolve $_pn latest - installing unpinned (re-run when online to pin it)"; fi
done

MEMORY_BACKEND="sqlite_vec"; MEMORY_DB_FILE="memory.db"
if [ -n "$SPACE" ]; then MEMORY_DB_FILE="memory_$SPACE.db"; fi  # space -> per-space DB; backend stays sqlite_vec (the only valid local backend)
MEMORY_ENTRY="memory|-e MCP_MEMORY_STORAGE_BACKEND=$MEMORY_BACKEND -e MCP_MEMORY_SQLITE_PATH=@HOME_MEMORY_DIR@/$MEMORY_DB_FILE -- uvx --with numpy --from mcp-memory-service${MEMORY_PIN} memory server"

# context7 runs REMOTE (the hosted server) by DEFAULT - no local process, and the key stays out of
# the registration: put CONTEXT7_API_KEY in ~/.claude/settings.json (or .claude/settings.local.json)
# under "env" and Claude Code expands ${CONTEXT7_API_KEY} in the header at launch, so .mcp.json holds
# no secret. Pass --context7 local for the local stdio server instead - keyless by default too,
# and CONTEXT7_BAKE_KEY=1 (with CONTEXT7_API_KEY) bakes --api-key into <repo>/.mcp.json (keep it uncommitted).
CONTEXT7_REMOTE_URL='https://mcp.context7.com/mcp'
CONTEXT7_REMOTE_HDR='CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}'

# sentry runs REMOTE only (the hosted MCP at mcp.sentry.dev) - no local process, no pin to resolve;
# the token stays out of the registration: put SENTRY_ACCESS_TOKEN in settings.json "env" and Claude
# Code expands the Authorization header at launch.
SENTRY_REMOTE_URL='https://mcp.sentry.dev/mcp'
SENTRY_REMOTE_HDR='Authorization: Bearer ${SENTRY_ACCESS_TOKEN}'
if [ "$CONTEXT7_MODE" = "local" ]; then
  CONTEXT7_SPEC="-- npx -y @upstash/context7-mcp${CTX7_PIN}"
  if [ -n "${CONTEXT7_BAKE_KEY:-}" ] && [ -n "${CONTEXT7_API_KEY:-}" ]; then
    CONTEXT7_SPEC="$CONTEXT7_SPEC --api-key $CONTEXT7_API_KEY"
    log "  !! baking CONTEXT7_API_KEY into the context7 registration; at project scope it lands in <repo>/.mcp.json - keep .mcp.json uncommitted (or use --context7 remote to keep the key out of the file)."
  fi
else
  CONTEXT7_SPEC="@HTTP@"
  if [ -n "${CONTEXT7_BAKE_KEY:-}" ]; then
    log "  !! CONTEXT7_BAKE_KEY is set but context7 is remote - it is ignored; pass --context7 local to bake, or add CONTEXT7_API_KEY to settings.json 'env'."
  fi
fi
CONTEXT7_ENTRY="context7|$CONTEXT7_SPEC"

MCPS=(
  "angular-cli|-- npx -y @angular/cli mcp" # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  "serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent${SERENA_PIN} serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd" # LSP symbol navigation; per-project SERENA_HOME (.serena/home - gitignore it, holds ~327MB LSP) isolates serena's registry/memories/logs/LSP, no pooling across projects/accounts; --project-from-cwd self-activates the repo (.serena/project.yml in cwd) on launch; PyPI (not git), dashboard off
  "playwright|-- npx -y @playwright/mcp${PW_PIN} --user-data-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright/screenshots" # drive a real browser for visual checks / web app verification
  "chrome-devtools|-- npx chrome-devtools-mcp@latest" # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  "appium-mcp|-- npx -y appium-mcp@latest" # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  "sentry|@HTTP@" # OPT-IN Sentry error monitoring - hosted remote MCP (mcp.sentry.dev); the Authorization header keeps ${SENTRY_ACCESS_TOKEN} LITERAL, expanded at launch from settings.json "env"; comment out where the project has no Sentry
  "$MEMORY_ENTRY"  # memory: cross-project recall - the subagent handoff runs on serena; comment out in a standalone project
  "$CONTEXT7_ENTRY"                           # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (4) PreToolUse hooks (claude-code): copied into the repo from the run's source clone (hooks/) on BOTH
# actions (per-hook fail-soft - a hook not yet upstream keeps its committed repo copy); on INSTALL each is
# also wired into .claude/settings.json. UPDATE refreshes files only (never settings).
# Each entry: "filename::matcher::args" - args (if any) are appended to the hook command.
HOOKS=(
  "guard-protected-force-push.js::Bash::"         # block force-push to main/master/develop
  "guard-catastrophic-rm.js::Bash::"              # block recursive rm of /, ~, $HOME, or a bare *
  "guard-read-whole-file.js::Read::"              # block whole-file Read of a >100-line source file - locate via serena first
  "instrument-tool-usage.js::"                    # fetched, NOT wired (empty matcher): opt-in tool-usage stats - wire PreToolUse '.*' + STACK_INSTRUMENT=1 for a measured run (see README)
)

# settings.json permissions.deny (claude-code): hard-block Read of secret-bearing files. Wired into
# .claude/settings.json alongside the hooks on INSTALL (idempotent, union-merged - a consuming project's
# own deny entries are preserved). Bare globs match at any depth (gitignore semantics), and Claude Code
# applies a Read() deny to recognized Bash reads too (cat/head/tail/sed) - not to arbitrary subprocesses.
# Stack-specific secret/config globs stay a per-project addition (baseline-security.md tells the agent to extend the deny list in settings.json).
# The settings.json deny-list is a Claude Code feature (no equivalent elsewhere).
SECRET_DENY=(
  "Read(.env)"
  "Read(.env.*)"
  "Read(*.pem)"
  "Read(*.pfx)"
  "Read(*.p12)"
  "Read(*.key)"
)

# (5) Subagents (claude-code): specialist agents copied into .claude/agents/ from the run's source clone
# (agents/) on BOTH actions (per-agent fail-soft - an agent not yet upstream keeps its committed repo copy).
# Claude Code auto-discovers .claude/agents/*.md; no settings.json wiring needed. (Cursor's twins of these
# live in the cursor-stack repo.)
AGENTS=(
  "dotnet-build-error-resolver.md"   # implement phase (sonnet/high): dotnet build -> categorize errors -> minimal fix loop (serena/csharp-lsp), capped
  "dotnet-test-failure-resolver.md"  # implement phase (sonnet/high): dotnet test -> red->green repair loop, anti-reward-hacking guard, capped
  "ng-build-error-resolver.md"       # implement phase (sonnet/high): ng build -> minimal fix loop (serena/LSP), capped
  "angular-test-resolver.md"         # implement phase (sonnet/high): ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
  "code-analyzer.md"                 # analysis support (sonnet/low): read-only per-module characterizer (purpose/surface/deps/patterns/smells) - the project-architecture-analyzer skill fans it out, also independently callable
  "code-style-analyzer.md"                # analysis phase (sonnet/medium): read-only per-language style characterizer - the project-code-style-analyzer skill fans it out per language and merges docs/PROJECT-CODE-STYLE.md + the inject-code-style hook from its structured reports
  "related-project-analyzer.md"           # analysis support (sonnet/medium): read-only sibling-repo characterizer (name/relation/first_read/seam, URL siblings shallow-cloned to scratch) - the project-related-context skill fans it out per sibling and merges docs/PROJECT-RELATED-CONTEXT.md
  "ci-failure-diagnoser.md"          # analysis phase (opus/high): read-only CI red-run diagnosis via gh - categorize, local repro, route
  "issue-diagnoser.md"               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  "evidence-gatherer.md"             # diagnosis support (sonnet/low): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  "security-auditor.md"              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  "integration-reviewer.md"          # final gate (opus/xhigh): read-only cross-domain integration review - contract consistency, assembled build/test/migration, the commit gate no single-stack verifier is
  # Per-domain specialist team (7 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
  "aspnet-solution-designer.md"      # design phase (opus/xhigh): ASP.NET Core architecture + plan + test strategy, decomposes into parallel tasks
  "aspnet-implementer.md"            # build phase (sonnet/medium): builds one ASP.NET task - code + tests
  "aspnet-verifier.md"               # verify phase (sonnet/xhigh): gates the ASP.NET build vs plan + quality, punch-list back
  "angular-solution-designer.md"     # design phase (opus/xhigh): Angular architecture + plan + test strategy, decomposes
  "angular-implementer.md"           # build phase (sonnet/medium): builds one Angular task - code + tests
  "angular-verifier.md"              # verify phase (sonnet/xhigh): gates the Angular build vs plan + quality
  "wpf-solution-designer.md"         # design phase (opus/xhigh): WPF strict-MVVM architecture + plan + test strategy, decomposes
  "wpf-implementer.md"               # build phase (sonnet/medium): builds one WPF task - code + tests
  "wpf-verifier.md"                  # verify phase (sonnet/xhigh): gates the WPF build vs plan + quality
  "console-solution-designer.md"     # design phase (opus/xhigh): headless .NET (Generic Host worker/bot/daemon/CLI) architecture + plan + test strategy, decomposes
  "console-implementer.md"           # build phase (sonnet/medium): builds one console/worker task - code + tests
  "console-verifier.md"              # verify phase (sonnet/xhigh): gates the console/worker build vs plan + quality
  "mobile-solution-designer.md"      # design phase (opus/xhigh): Ionic/Capacitor architecture + plan + test strategy, decomposes
  "mobile-implementer.md"            # build phase (sonnet/medium): builds one mobile task - code + tests
  "mobile-verifier.md"               # verify phase (sonnet/xhigh): gates the mobile build vs plan + quality
  "data-solution-designer.md"        # design phase (opus/xhigh): schema/data-model architecture + plan + test strategy, decomposes
  "data-implementer.md"              # build phase (sonnet/medium): builds one data task - SQL + migration tests
  "data-verifier.md"                 # verify phase (sonnet/xhigh): gates the data build vs plan + quality
  "devops-solution-designer.md"      # design phase (opus/xhigh): Docker/CI/CD/deploy architecture + plan + validation strategy, decomposes
  "devops-implementer.md"            # build phase (sonnet/medium): builds one devops task - Dockerfile/workflow/deploy + local validation
  "devops-verifier.md"               # verify phase (sonnet/xhigh): gates the devops build vs plan + quality
)

# (6) Path-scoped rules (claude-code): copied into .claude/rules/ from the run's source clone (rules/)
# on BOTH actions - lazy-load on matching file reads; conventions stay with the convention-gate hook,
# rules carry only glob-scoped routing.
# NOTE: baseline-project-related-context.md, baseline-project-architecture.md and
# baseline-project-capabilities.md are GENERATED per-project (by /project-related-context,
# /project-architecture-analyzer and /project-capabilities) - NEVER add those names to this
# manifest (the copy would overwrite the generated copies); nothing prunes the rules dir, so
# they survive update.
CLAUDE_RULES=(
  # Always-on baseline (no paths) - loads every session like CLAUDE.md; one job per file, comment out what a project doesn't want.
  "baseline-interaction.md"    # communication + evaluating-proposals + planning (merged by exclusion affinity)
  "baseline-quality-gates.md"  # code-quality + definition-of-done (merged by exclusion affinity)
  "baseline-security.md"
  "baseline-git.md"
  "baseline-navigation.md"
  # Path-scoped routing
  "markdown-docs.md"          # markdown-style routing, path-scoped **/*.md
  "dotnet-repair-agents.md"   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  "angular-repair-agents.md"  # Angular repair-loop routing, path-scoped
  # Convention rules (soft, glob auto-attach) - each points ONE file family at its house-style skill; replaced the require-convention-skill hard gate.
  "typescript-conventions.md" # ts/js family -> typescript (framework-agnostic baseline)
  "angular-conventions.md"    # Angular file shapes -> angular-conventions (Angular/Ionic projects only)
  "angular-styling-conventions.md" # scss/css -> angular-styling (Angular/Ionic projects only)
  "csharp-conventions.md"     # c#: .cs -> csharp (backend, desktop, console)
  "wpf-conventions.md"        # wpf: .xaml -> dotnet-wpf
  "sql-conventions.md"        # sql: .sql -> database-conventions
  "devops-conventions.md"     # rest (devops): Dockerfile/compose/workflow -> devops
)

# --- Selection subset filter (Component B) --------------------------------
# With --selection <file>, keep only the SKILLS / PLUGINS / MCPS / AGENTS /
# CLAUDE_RULES entries whose name appears in the file (one 'category name' per
# line; '#' comments and blank lines ignored). HOOKS are never filtered - they
# are foundational. --print-plan prints the resolved per-category set and exits
# (a dry run) before any prerequisite or install step runs.
if [ -n "$SELECTION" ]; then
  [ -f "$SELECTION" ] || { printf 'selection file not found: %s\n' "$SELECTION" >&2; exit 1; }

  _sel_has() { grep -qxF "$1 $2" "$SELECTION"; }   # 0 if 'category name' is a line

  _f=(); for e in ${SKILLS[@]+"${SKILLS[@]}"};             do _sel_has skill  "${e#*|}"                                    && _f+=("$e"); done; SKILLS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${PLUGINS[@]+"${PLUGINS[@]}"};           do _sel_has plugin "${e%%@*}"                                   && _f+=("$e"); done; PLUGINS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${MCPS[@]+"${MCPS[@]}"};                 do _sel_has mcp    "${e%%|*}"                                   && _f+=("$e"); done; MCPS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${AGENTS[@]+"${AGENTS[@]}"};             do n="${e%%::*}"; _sel_has agent "${n%.md}"                     && _f+=("$e"); done; AGENTS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do n="${e%%::*}"; _sel_has rule  "${n%.md}"                     && _f+=("$e"); done; CLAUDE_RULES=(${_f[@]+"${_f[@]}"})
fi

if [ "$PRINT_PLAN" = true ]; then
  printf 'plan skills:';  for e in ${SKILLS[@]+"${SKILLS[@]}"};             do printf ' %s' "${e#*|}";                 done; printf '\n'
  printf 'plan plugins:'; for e in ${PLUGINS[@]+"${PLUGINS[@]}"};           do printf ' %s' "${e%%@*}";                done; printf '\n'
  printf 'plan mcps:';    for e in ${MCPS[@]+"${MCPS[@]}"};                 do printf ' %s' "${e%%|*}";                done; printf '\n'
  printf 'plan agents:';  for e in ${AGENTS[@]+"${AGENTS[@]}"};             do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  printf 'plan rules:';   for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  exit 0
fi

# ===========================================================================
# SOURCE SNAPSHOT - the ONE revision every artifact in a run comes from
# ===========================================================================
# Every file the stack installs (skills, hooks, agents, rules, the CLAUDE.md template) lives in
# this one repo, so a run takes ONE source snapshot and copies out of it: the rolling 'latest'
# release archive (.github/workflows/release.yml republishes it on every push to main, with a
# RELEASE-SOURCE file inside naming the exact commit), falling back to a shallow git clone when
# no release is reachable (a fork without releases, a blocked CDN, the brief window while the
# workflow recreates the release). Why one snapshot and not the per-file
# raw.githubusercontent.com fetches this replaced:
#   - ATOMIC. An archive or clone is a single revision. The raw URLs are per-file and CDN-cached
#     (a push takes ~5 min to propagate), so a raw run could mix revisions - and then
#     claude-stack.stamp, which records the revision this install came from, would be a lie. The
#     snapshot makes the stamp true by construction.
#   - CHEAP. One download replaces ~50 round trips (the HOOKS + AGENTS + CLAUDE_RULES arrays).
# Fail-soft, like the fetches were: no source (archive AND clone failed) means callers keep the
# copies already on disk and the run carries on. STACK_SHA stays empty, which is what suppresses
# the stamp write.
#
# --source <dir> hands in a source the CALLER already fetched (an extracted release archive or a
# git checkout). That is the plugin path: the setup / configure skills must download anyway (they
# need stack-select.js, stack-graph.json, the CLAUDE.md template and the stamp diff before the
# install runs), so they pass that same source here and the guided run costs ONE download instead
# of two. A caller-provided dir is borrowed, never deleted. Standalone (no --source) is
# unchanged: the script fetches its own source and cleans it up.
STACK_REPO_URL="${STACK_SKILLS_REPO:-https://github.com/envoydev/claude-stack}"
STACK_SRC=""            # the source worktree; empty until stack_src runs
STACK_SHA=""            # the exact commit every artifact this run installs was copied from
STACK_REF=""            # the branch that commit is the tip of (whatever the source's HEAD is)
STACK_SRC_TRIED=false   # memoises the OUTCOME, so a dead source costs one fetch attempt, not one per caller
STACK_SRC_OWNED=false   # true only when WE fetched it - the EXIT trap removes ours, never the caller's
STACK_SRC_ROOT=""       # the temp dir an owned fetch lives in (the EXIT trap's removal target)

_cleanup_stack_src() {
  if $STACK_SRC_OWNED && [ -n "$STACK_SRC_ROOT" ]; then rm -rf "$STACK_SRC_ROOT"; fi
  return 0
}
trap _cleanup_stack_src EXIT

stack_src() {
  # Resolves on the first call; every later caller reuses the worktree. Returns non-zero (never
  # aborts) when the source is unavailable, so each caller applies its own fail-soft.
  # Memoise BOTH outcomes: five steps call this, and without the failure latch an offline run
  # would pay five download timeouts and report five failures for one root cause.
  [ -n "$STACK_SRC" ] && return 0
  $STACK_SRC_TRIED && return 1
  STACK_SRC_TRIED=true

  if [ -n "$SOURCE_DIR" ]; then
    # Borrowed source. Sanity-check it IS the stack (a wrong --source would otherwise 'install'
    # nothing and report 117 per-file failures), then read its revision: a git checkout carries
    # it in HEAD, an extracted release archive in its RELEASE-SOURCE file.
    if [ ! -d "$SOURCE_DIR/skills" ] || [ ! -d "$SOURCE_DIR/agents" ]; then
      note_failure "--source '$SOURCE_DIR' is not a claude-stack checkout (no skills/ + agents/) - stack source unavailable"
      return 1
    fi
    STACK_SRC="$SOURCE_DIR"; STACK_SRC_OWNED=false
    STACK_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
    STACK_REF="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$STACK_SHA" ]; then
      # Stamp the URL the caller actually cloned from, not our default - they may have used a fork.
      STACK_REPO_URL="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || echo "$STACK_REPO_URL")"
    elif [ -f "$SOURCE_DIR/RELEASE-SOURCE" ]; then
      STACK_SHA="$(sed -n 's/^sha: //p' "$SOURCE_DIR/RELEASE-SOURCE" | head -1)"
      STACK_REF="$(sed -n 's/^ref: //p' "$SOURCE_DIR/RELEASE-SOURCE" | head -1)"
    fi
    if [ -z "$STACK_SHA" ]; then
      log "source: $SOURCE_DIR (provided; no git checkout or RELEASE-SOURCE - no revision, so no stamp)"
    else
      log "source: $SOURCE_DIR (provided) @ ${STACK_REF:-?} $(printf '%.12s' "$STACK_SHA")"
    fi
    return 0
  fi

  # Release archive first: one asset is one revision, and no git is needed to take it.
  local tmp; tmp="$(mktemp -d)"
  local url="$STACK_REPO_URL/releases/latest/download/claude-stack.tar.gz"
  if command -v curl >/dev/null 2>&1 &&
     curl -fsSL "$url" -o "$tmp/claude-stack.tar.gz" 2>/dev/null &&
     mkdir -p "$tmp/repo" &&
     tar -xzf "$tmp/claude-stack.tar.gz" -C "$tmp/repo" 2>/dev/null &&
     [ -d "$tmp/repo/skills" ] && [ -d "$tmp/repo/agents" ]; then
    STACK_SRC="$tmp/repo"; STACK_SRC_ROOT="$tmp"; STACK_SRC_OWNED=true
    STACK_SHA="$(sed -n 's/^sha: //p' "$tmp/repo/RELEASE-SOURCE" 2>/dev/null | head -1)"
    STACK_REF="$(sed -n 's/^ref: //p' "$tmp/repo/RELEASE-SOURCE" 2>/dev/null | head -1)"
    log "source: $url @ ${STACK_REF:-?} $(printf '%.12s' "${STACK_SHA:-unknown}")"
    return 0
  fi
  rm -rf "$tmp"

  # Fallback: a shallow clone - a fork without releases, a blocked release CDN, a local test path.
  # Pinned to main: the release branch is what installs deliver, never the default branch
  # (development lands on develop).
  command -v git >/dev/null 2>&1 || { note_failure "release archive unreachable and git not found - stack source unavailable"; return 1; }
  tmp="$(mktemp -d)"
  if ! git clone --depth 1 -b main "$STACK_REPO_URL" "$tmp" >/dev/null 2>&1; then
    note_failure "release archive and clone of $STACK_REPO_URL both failed - stack source unavailable (nothing refreshed; existing copies kept)"
    rm -rf "$tmp"; return 1
  fi
  STACK_SRC="$tmp"; STACK_SRC_ROOT="$tmp"; STACK_SRC_OWNED=true
  STACK_SHA="$(git -C "$tmp" rev-parse HEAD 2>/dev/null)"
  STACK_REF="$(git -C "$tmp" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  log "source: $STACK_REPO_URL (clone fallback) @ ${STACK_REF:-?} $(printf '%.12s' "${STACK_SHA:-unknown}")"
  return 0
}

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); MCPs and plugins SKIP if already present
# ===========================================================================
install_skills() {
  # Copy each selected skills/<name>/ out of the run's clone into the scope dest - all 65 house
  # skills live in ONE repo, so a plain copy fully reproduces what the skills CLI used to stage;
  # no npx/network-registry dependency.
  stack_src || { note_failure "skills not installed"; return 0; }   # fail-soft: skip, never abort
  local name dest entry
  case "$CLAUDE_SCOPE" in user) dest="$CONFIG_DIR/skills" ;; *) dest="$PWD/.claude/skills" ;; esac
  mkdir -p "$dest"
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    name="${entry#*|}"
    if [ -d "$STACK_SRC/skills/$name" ]; then
      rm -rf "$dest/$name"; cp -R "$STACK_SRC/skills/$name" "$dest/$name"
      log "skill [$CLAUDE_SCOPE]: $name -> $dest/$name"
    else
      note_failure "skill '$name' not found in $STACK_REPO_URL"
    fi
  done
}

install_plugins() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  for mp in ${EXTRA_MARKETPLACES[@]+"${EXTRA_MARKETPLACES[@]}"}; do claude plugin marketplace add "$mp" 2>/dev/null || true; done
  for p in ${PLUGINS[@]+"${PLUGINS[@]}"}; do
    # claude-hud is a statusline HUD - force USER scope regardless of $CLAUDE_SCOPE. A project-scoped
    # install + the global statusline enable mismatch, so every OTHER project warns "plugin not cached".
    pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac
    log "plugin [$pscope]: $p"
    claude plugin install "$p" --scope "$pscope" || note_failure "plugin $p failed"   # may prompt to trust on first run
  done
}

install_mcps() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  local entry name args spec tok_cfg url hdr
  local -a spec_words
  tok_cfg='${CLAUDE_CONFIG_DIR}'
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    spec="${args//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec="${spec//@HOME_MEMORY_DIR@/$HOME_MEMORY_DIR}"
    # CLAUDE_CONFIG_DIR unset -> the CLI can't interpolate ${CLAUDE_CONFIG_DIR} at launch, so resolve it now.
    [ -z "${CLAUDE_CONFIG_DIR:-}" ] && spec="${spec//"$tok_cfg"/$CONFIG_DIR}"
    if claude mcp get "$name" >/dev/null 2>&1; then echo "  mcp $name already configured - skipping"; continue; fi
    log "mcp [$CLAUDE_SCOPE]: $name"
    if [ "$spec" = "@HTTP@" ]; then
      # remote (hosted) server - url/header keyed by name: sentry, else context7
      if [ "$name" = "sentry" ]; then url="$SENTRY_REMOTE_URL"; hdr="$SENTRY_REMOTE_HDR"
      else url="$CONTEXT7_REMOTE_URL"; hdr="$CONTEXT7_REMOTE_HDR"; fi
      claude mcp add --transport http --scope "$CLAUDE_SCOPE" "$name" "$url" --header "$hdr" || note_failure "mcp $name failed"
      continue
    fi
    # ASSUMPTION: no resolved path token ($CONFIG_DIR / $HOME_MEMORY_DIR) contains a space - the MCP
    # spec is space-separated by design (-e KEY=VAL -- cmd args), so a space inside one token cannot
    # survive word-splitting. read -ra splits on whitespace into an array (the intended token split)
    # AND disables glob expansion, so a bare '*' in spec is passed literally, never expanded.
    read -ra spec_words <<<"$spec"
    claude mcp add --scope "$CLAUDE_SCOPE" "$name" "${spec_words[@]}" || note_failure "mcp $name failed"
  done
}

# _install_from_src <subdir> <label> <dest-dir> <executable?> <file...>
# Shared body of the hook/agent/rule steps: copy each named file out of the run's clone. Per-file
# fail-soft (a file not yet upstream keeps its committed copy), and an unchanged file is reported
# 'current' rather than rewritten, so a no-op run leaves mtimes alone.
_install_from_src() {
  local subdir="$1" label="$2" dest_dir="$3" exec_bit="$4"; shift 4
  stack_src || { log "  !! stack source unavailable - kept existing $label copies"; return 0; }
  local file src dest
  for file in "$@"; do
    src="$STACK_SRC/$subdir/$file"
    [ -f "$src" ] || { note_failure "$label '$file' not found in $STACK_REPO_URL"; continue; }
    dest="$dest_dir/$file"; mkdir -p "$(dirname "$dest")"
    if [ -f "$dest" ] && cmp -s "$src" "$dest"; then log "  $label current: $file"; continue; fi
    cp "$src" "$dest"
    [ "$exec_bit" = "exec" ] && chmod +x "$dest"
    log "  $label installed -> $file"
  done
}

download_hooks() {  # copy each hook file into the repo; per-hook fail-soft (keeps repo copy)
  local root entry file; local -a files=()
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping hooks"; return 0; }
  for entry in "${HOOKS[@]}"; do file="${entry%%::*}"; files+=("$file"); done
  _install_from_src hooks hook "$root/.claude/hooks" exec ${files[@]+"${files[@]}"}
}

download_agents() {  # copy each subagent .md into .claude/agents/; per-agent fail-soft (keeps repo copy)
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping agents"; return 0; }
  _install_from_src agents agent "$root/.claude/agents" no ${AGENTS[@]+"${AGENTS[@]}"}
}

download_rules() {  # copy each rule .md into .claude/rules/; per-rule fail-soft (keeps repo copy)
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping rules"; return 0; }
  _install_from_src rules rule "$root/.claude/rules" no ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}
}

seed_claude_md() {  # INSTALL: lay down a starter .claude/CLAUDE.md from the template when the project has none (never clobber a filled one)
  local root dest src
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping CLAUDE.md"; return 0; }
  # Auto-loaded from either ./CLAUDE.md or ./.claude/CLAUDE.md - skip if EITHER exists so we never leave two copies.
  if [ -f "$root/CLAUDE.md" ] || [ -f "$root/.claude/CLAUDE.md" ]; then log "  CLAUDE.md: already present - left as-is (finish its authoring outline if not done)"; return 0; fi
  stack_src || { log "  !! stack source unavailable - create .claude/CLAUDE.md by hand from CLAUDE.template.md"; return 0; }
  src="$STACK_SRC/templates/CLAUDE.template.md"
  [ -f "$src" ] || { note_failure "CLAUDE.template.md not found in $STACK_REPO_URL"; return 0; }
  dest="$root/.claude/CLAUDE.md"; mkdir -p "$root/.claude"
  cp "$src" "$dest"; log "  CLAUDE.md: seeded to .claude/CLAUDE.md - write the project top from its authoring-outline comment, and keep the '.claude/*' + '!.claude/CLAUDE.md' gitignore lines so it stays committed"
}

# ===========================================================================
# INSTALL STAMP - which revision this install came from
# ===========================================================================
# Claude Code has no per-artifact version: `version:` is in the plugin.json schema and NOWHERE else
# (not skills, not agents, not rules, not hooks - an added key there parses but is ignored). So the
# stack versions the INSTALL, not the file: one stamp naming the commit every artifact was copied
# from. That is what /claude-stack:configure diffs against to answer 'what changed since I
# installed?' - exactly, for all ~117 artifacts, with nothing to hand-bump:
#     <repo>/compare/<sha>...main  (the GitHub compare view / API)
# Machine-local by design (it describes THIS checkout's install) and already covered by the
# '.claude/*' gitignore line the run prints.
stack_version_from() {
  # The stack's ONE version: an extracted release archive carries it in RELEASE-SOURCE; a git
  # checkout reads it from the plugin manifest - the same file the marketplace serves from main,
  # so the stamp, the release, and the marketplace always name the same version.
  { sed -n 's/^version: //p' "$1/RELEASE-SOURCE" 2>/dev/null | head -1 | grep .; } ||
    sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/setup-plugin/.claude-plugin/plugin.json" 2>/dev/null | head -1
}

write_stamp() {
  # No SHA means no source resolved this run (the archive download and the clone fallback both
  # failed, and every step fail-softly kept its existing copy). Stamping then would claim an
  # install that did not occur, and a wrong stamp is worse than none - so leave any previous
  # stamp untouched.
  [ -n "$STACK_SHA" ] || { log "  stamp: skipped - no source revision resolved this run"; return 0; }
  local dir dest root version
  version="$(stack_version_from "$STACK_SRC")"
  case "$CLAUDE_SCOPE" in
    user) dir="$CONFIG_DIR" ;;
    # Prefer the repo root - that is where hooks/agents/rules land. Outside a repo fall back to
    # $PWD, which is where install_skills puts .claude/skills: the stamp belongs next to whatever
    # this run actually installed, and a skills-only install into a plain directory still gets one.
    *)    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
          [ -n "$root" ] || root="$PWD"
          dir="$root/.claude" ;;
  esac
  mkdir -p "$dir"; dest="$dir/claude-stack.stamp"
  cat > "$dest" <<STAMP
# claude-stack install stamp - machine-local, written by claude-stack.sh / claude-stack.ps1.
# The revision every artifact of this install was copied from. To see what changed since:
#   open $STACK_REPO_URL/compare/$STACK_SHA...main
# /claude-stack:configure reports exactly this diff. Then re-run the installer's
# '$ACTION' action (or that skill) to take the changes.
source: $STACK_REPO_URL
ref: $STACK_REF
sha: $STACK_SHA
version: $version
installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
action: $ACTION
scope: $CLAUDE_SCOPE
STAMP
  log "  stamp: $dest @ $(printf '%.12s' "$STACK_SHA")"
}

wire_hooks_settings() {  # INSTALL: ensure the hook PreToolUse blocks + secret-read deny-list + mcp allow-list are in settings.json (idempotent)
  local root settings; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  settings="$root/.claude/settings.json"; mkdir -p "$(dirname "$settings")"
  command -v python3 >/dev/null || { log "  !! python3 not found - wire hooks into settings.json by hand"; return 0; }
  # NB: program via -c (not `python3 - <<heredoc`): a pipe + heredoc both target stdin and the pipe
  # wins, so a heredoc program would never run. -c frees stdin for the piped hook specs.
  local prog; prog=$(cat <<'PY'
import json, sys
path = sys.argv[1]
deny_specs, mcp_names, bucket = [], [], None
for a in sys.argv[2:]:
    if a == "--DENY": bucket = deny_specs; continue
    if a == "--MCP": bucket = mcp_names; continue
    if bucket is not None: bucket.append(a)
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
# permissions.deny: union-merge the secret-file Read blocks, preserving any the project already set.
deny = data.setdefault("permissions", {}).setdefault("deny", [])
for rule in deny_specs:
    if rule not in deny:
        deny.append(rule); changed = True
# enabledMcpjsonServers: pre-approve exactly the project .mcp.json servers we register, so no per-launch
# trust prompt - never blanket enableAllProjectMcpServers. Union-merged; an unlisted name is a harmless no-op.
enabled = data.setdefault("enabledMcpjsonServers", [])
for name in mcp_names:
    if name not in enabled:
        enabled.append(name); changed = True
# env: project-default auto-compact trigger (compact at ~40% of the context window). Set only when
# absent, so a project that pins its own value - or holds CONTEXT7_API_KEY here - is never clobbered.
env = data.setdefault("env", {})
if "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" not in env:
    env["CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"] = "40"; changed = True
if changed:
    json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
    print("  settings.json: hooks + secret deny-list + mcp allow-list + compact default ensured")
else:
    print("  settings.json: hooks + secret deny-list + mcp allow-list + compact default already present - unchanged")
PY
)
  local -a mcp_names; mcp_names=()
  for _m in ${MCPS[@]+"${MCPS[@]}"}; do mcp_names+=("${_m%%|*}"); done   # server name = the token before the first '|'
  printf '%s\n' "${HOOKS[@]}" | python3 -c "$prog" "$settings" --DENY "${SECRET_DENY[@]}" --MCP ${mcp_names[@]+"${mcp_names[@]}"} || log "  !! settings.json wiring failed"
}

# ===========================================================================
# UPDATE - bring everything to latest
# ===========================================================================
remove_skills() {  # rm -rf each manifest skill under the scope dest, so update starts from a clean slate
  local dest entry name
  case "$CLAUDE_SCOPE" in user) dest="$CONFIG_DIR/skills" ;; *) dest="$PWD/.claude/skills" ;; esac
  log "skills [$CLAUDE_SCOPE]: removing ${#SKILLS[@]} for clean reinstall"
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    name="${entry#*|}"
    rm -rf "$dest/$name"
  done
}

update_skills() {
  # Fresh clone + copy - the same as install (the copy overwrites), just cleared first.
  remove_skills
  install_skills
}

update_plugins() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  claude plugin marketplace update 2>/dev/null || true            # refresh marketplaces first
  for p in ${PLUGINS[@]+"${PLUGINS[@]}"}; do
    pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac   # claude-hud is user-scope (statusline)
    log "plugin update [$pscope]: $p"
    claude plugin update "$p" --scope "$pscope" 2>&1 | tail -1 || true
  done
}

update_mcps() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  # MCP binaries auto-update at launch (@latest / uvx git+); this re-asserts the config.
  local entry name args spec tok_cfg url hdr
  local -a spec_words
  tok_cfg='${CLAUDE_CONFIG_DIR}'
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    spec="${args//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec="${spec//@HOME_MEMORY_DIR@/$HOME_MEMORY_DIR}"
    [ -z "${CLAUDE_CONFIG_DIR:-}" ] && spec="${spec//"$tok_cfg"/$CONFIG_DIR}"
    log "mcp refresh [$CLAUDE_SCOPE]: $name"
    claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 || true
    if [ "$spec" = "@HTTP@" ]; then
      # remote (hosted) server - url/header keyed by name: sentry, else context7
      if [ "$name" = "sentry" ]; then url="$SENTRY_REMOTE_URL"; hdr="$SENTRY_REMOTE_HDR"
      else url="$CONTEXT7_REMOTE_URL"; hdr="$CONTEXT7_REMOTE_HDR"; fi
      claude mcp add --transport http --scope "$CLAUDE_SCOPE" "$name" "$url" --header "$hdr" || note_failure "mcp $name failed"
      continue
    fi
    # Same no-spaces-in-resolved-path assumption + glob-safe array split as install_mcps (see there).
    read -ra spec_words <<<"$spec"
    claude mcp add --scope "$CLAUDE_SCOPE" "$name" "${spec_words[@]}" || note_failure "mcp $name failed"
  done
}

update_hooks() { download_hooks; }   # UPDATE: refresh hook files only; settings.json untouched
update_agents() { download_agents; } # UPDATE: refresh subagent files
update_rules() { download_rules; }   # UPDATE: refresh rule files

# ===========================================================================
# KEEP-PINS (--keep-pins) - preserve local model/effort frontmatter edits across the refresh.
# The agent fetch and the skills clean-reinstall reset every file to upstream, wiping a per-project
# model/effort re-pin. With --keep-pins the values are snapshotted BEFORE the refresh and re-applied
# AFTER it - only keys present in both the old local file and the refreshed one (no add/remove), and
# the local value always wins over an upstream pin change (the flag cannot tell the two apart).
# ===========================================================================
_fm_pin() {  # $1=file $2=key -> print the key's value from the leading frontmatter block ('' if absent)
  awk -v k="$2" '
    NR==1 { if ($0 !~ /^---[[:space:]]*$/) exit; next }
    /^---[[:space:]]*$/ { exit }
    index($0, k":") == 1 { sub("^"k":[[:space:]]*", ""); sub(/[[:space:]]+$/, ""); print; exit }
  ' "$1" 2>/dev/null
}

_fm_set_pin() {  # $1=file $2=key $3=value - rewrite the key's line INSIDE the frontmatter block only
  local tmp; tmp="$(mktemp)"
  awk -v k="$2" -v v="$3" '
    NR==1 && /^---[[:space:]]*$/ { fm=1; print; next }
    fm==1 && /^---[[:space:]]*$/ { fm=2; print; next }
    fm==1 && index($0, k":") == 1 { print k": "v; next }
    { print }
  ' "$1" > "$tmp" && mv "$tmp" "$1"
}

_pin_files() {  # print every locally-installed pin-bearing target: manifest agents + skill SKILL.md files
  local root file entry skills_dir
  root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  for file in ${AGENTS[@]+"${AGENTS[@]}"}; do
    [ -f "$root/.claude/agents/$file" ] && printf '%s\n' "$root/.claude/agents/$file"
  done
  if [ "$SCOPE" = "project" ]; then skills_dir="$root/.claude/skills"; else skills_dir="$CONFIG_DIR/skills"; fi
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    [ -f "$skills_dir/${entry#*|}/SKILL.md" ] && printf '%s\n' "$skills_dir/${entry#*|}/SKILL.md"
  done
}

PIN_DIR=""
snapshot_pins() {  # --keep-pins: record each installed agent/skill file's model/effort before the refresh
  $KEEP_PINS || return 0
  PIN_DIR="$(mktemp -d)"
  local f key m e count=0
  while IFS= read -r f; do
    m="$(_fm_pin "$f" model)"; e="$(_fm_pin "$f" effort)"
    [ -z "$m" ] && [ -z "$e" ] && continue
    key="$(printf '%s' "$f" | tr '/' '_')"   # flatten the path -> one snapshot file per target
    printf 'model=%s\neffort=%s\n' "$m" "$e" > "$PIN_DIR/$key"
    count=$((count + 1))
  done < <(_pin_files)
  log "keep-pins: snapshotted model/effort from $count file(s)"
}

restore_pins() {  # --keep-pins: re-apply every snapshotted value the refresh changed
  $KEEP_PINS || return 0
  [ -n "$PIN_DIR" ] || return 0
  local f key k saved cur disp kept=0
  while IFS= read -r f; do
    key="$(printf '%s' "$f" | tr '/' '_')"
    [ -f "$PIN_DIR/$key" ] || continue
    case "$f" in
      */.claude/agents/*) disp="agents/${f##*/.claude/agents/}" ;;
      */skills/*)         disp="skills/${f##*/skills/}" ;;
      *)                  disp="$f" ;;
    esac
    for k in model effort; do
      saved="$(sed -n "s/^$k=//p" "$PIN_DIR/$key")"
      [ -n "$saved" ] || continue
      cur="$(_fm_pin "$f" "$k")"
      if [ -n "$cur" ] && [ "$cur" != "$saved" ]; then
        _fm_set_pin "$f" "$k" "$saved"; kept=$((kept + 1))
        log "  pin kept: $disp $k=$saved (upstream: $cur)"
      fi
    done
  done < <(_pin_files)
  rm -rf "$PIN_DIR"; PIN_DIR=""
  log "keep-pins: re-applied $kept local pin value(s)"
}

prune_agents_cache() {
  # Legacy cleanup: an npx-skills-era install staged an agent-neutral .agents/ store. The git-copy
  # install_skills never creates one, so this is a no-op on a fresh install and only matters for a
  # project upgrading from the old flow. Guard: keep it if any skill entry under .claude/skills is a
  # symlink (a symlinked tree still depends on .agents/; removing it would dangle).
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
# --skills-only: run ONLY the skill step and exit, before any prerequisite check or claude-CLI-
# dependent step (testability - drives just the git-copy with no claude/gh/network dependency).
if [ "$SKILLS_ONLY" = true ]; then
  if [ "$ACTION" = "install" ]; then install_skills; else update_skills; fi
  write_stamp   # a skills-only run still installs FROM a revision - record it
  exit 0
fi

prerequisites_check
install_github_cli

# claude-only steps fail soft (command -v claude) if the CLI is not installed.
snapshot_pins   # --keep-pins only: no-op without the flag (install re-adds skills unconditionally too, so both actions refresh)
if [ "$ACTION" = "install" ]; then
  install_skills; install_plugins; install_mcps; download_hooks; wire_hooks_settings; download_agents; download_rules; seed_claude_md
else
  update_skills; update_plugins; update_mcps; update_hooks; update_agents; update_rules
fi
restore_pins
write_stamp   # after every copy step, so the stamp only ever names a revision that fully landed

prune_agents_cache
echo
log "done: $ACTION [scope=$SCOPE, account=$CONFIG_DIR, agent=$AGENT]"
_summary="  skills=${#SKILLS[@]}, plugins=${#PLUGINS[@]}, mcps=${#MCPS[@]}, hooks=${#HOOKS[@]}, agents=${#AGENTS[@]}, rules=${#CLAUDE_RULES[@]}"
[ -n "$SPACE" ] && _summary="$_summary; space=$SPACE, memory DB=$MEMORY_DB_FILE"
[ "$KEEP_PINS" = true ] && _summary="$_summary; keep-pins=on"
log "$_summary; context7=$CONTEXT7_MODE"
if [ "$CLAUDE_MISSING" = true ]; then
  log "  !! claude CLI absent - plugins, MCPs, and settings.json wiring were SKIPPED (install it, then re-run)"
fi
if [ "$FAIL_COUNT" -gt 0 ]; then
  log "  !! $FAIL_COUNT item(s) failed above - re-run '$ACTION' to retry"
fi

log "next steps:"
log "  - write your project's CLAUDE.md top from the template's authoring-outline comment (framework, stack, conventions, secret/config globs) - install seeds a starter from the template when the project has none; the claude-md-management plugin can help audit it"
log "  - if this repo has sibling projects (a backend/frontend pair, a consumed package), run /project-related-context with their paths/URLs - it generates the awareness rule (baseline-project-related-context.md) + docs/PROJECT-RELATED-CONTEXT.md"
log "  - run /project-capabilities once - it inventories the installed skills/agents/MCPs and generates baseline-project-capabilities.md (re-run after update or a manifest trim)"
log "  - once oriented, run the other two captures the CLAUDE.md rules table names: /project-architecture-analyzer (architecture map + assessment + awareness rule) and /project-code-style-analyzer (docs/PROJECT-CODE-STYLE.md + the inject-code-style hook)"
log "  - restart Claude Code (or reopen the project) to load the new MCPs, hooks, and settings"
[ "$PREREQ_MISSING" = true ] && log "  - install the missing prerequisites flagged above, then re-run"
if [ "$CONTEXT7_MODE" = "remote" ]; then
  log "  - context7 is remote; add CONTEXT7_API_KEY to $CONFIG_DIR/settings.json 'env' for higher rate limits (or re-run with --context7 local)"
fi
[ "$INSTALL_GITHUB_CLI" = true ] && log "  - run 'gh auth login' if gh is not yet authenticated (needed before PRs/issues)"

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
cat <<'GITIGNORE'

Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git/info/exclude):
  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)
  .claude/*        Claude Code project config + local state (settings.local.json, hooks) - ignore the contents...
  !.claude/CLAUDE.md   ...but TRACK the project instructions: they live at .claude/CLAUDE.md and must be committed (git can only re-include a file if the parent dir is not wholesale-ignored, hence '.claude/*' not '.claude/')
  .slopwatch       dotnet-slopwatch output
  .playwright      playwright MCP user-data-dir + screenshots
  .mcp.json        generated MCP server config (machine-local)

If the project's CLAUDE.md 'Generated docs root' is relocated under .claude/, the generated docs
inherit the .claude ignore above and become local-only - not committed, not shared. Keep the docs
root at its committed docs/ default unless that machine-local tradeoff is wanted.
GITIGNORE
