#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update the Claude Code stack (skills, plugins, MCPs, hooks, agents, rules) into a project.

.DESCRIPTION
  PowerShell port of claude-stack.sh: every skill / plugin / MCP from claude-stack.html (the complete
  toolset, not a curated subset), installed INTO a project. Built-in/system CLI skills are excluded
  (they ship with the CLI). Requires the `claude` CLI; claude-only steps fail soft if it is absent.
  Cursor lives in cursor-stack.ps1.

  Windows differences vs claude-stack.sh: hook .js files are invoked via `node` (no shebang/exec bit);
  settings.json is merged natively (ConvertFrom/To-Json), no python dependency; MCP arg strings stay
  LITERAL (${CLAUDE_PROJECT_DIR:-.} / ${CLAUDE_CONFIG_DIR}) so Claude Code interpolates them at launch.

.PARAMETER Action
  REQUIRED. 'install' = first-time provision; MCP/plugin versions freeze until the next update; wires
  .claude/settings.json. 'update' = re-resolve every runtime to latest + refresh hooks/agents/rules;
  leaves settings.json untouched.

.PARAMETER Space
  Any word -> install into the ~/.claude-<Space> account (CLAUDE_CONFIG_DIR is exported for the claude
  CLI) and use a separate memory_<Space>.db. Omit for the default ~/.claude account + shared memory.db.

.PARAMETER Scope
  'project' (default) installs INTO this repo; 'global' installs into the active account. Overrides the
  SCOPE env var; when neither is set, defaults to 'project'.

.PARAMETER Context7
  context7 transport: 'remote' (default) = the hosted HTTP server, no local process; 'local' = the
  local npx stdio server.

.PARAMETER GitHubCli
  Install the GitHub CLI (gh) via winget if missing. Reminds you to run `gh auth login` when unauthenticated.

.NOTES
  Environment variables:
    SCOPE=project|global  fallback for -Scope when the flag is absent (default project).
    CLAUDE_CONFIG_DIR     target a specific account when no -Space is given (default ~/.claude).
    CONTEXT7_API_KEY      context7 API key; add it to settings.json 'env' for higher rate limits.
    CONTEXT7_BAKE_KEY     with -Context7 local, bake CONTEXT7_API_KEY into the registration (keep .mcp.json uncommitted).

  On Windows PowerShell 5.1 use `powershell` instead of `pwsh`. If scripts are blocked, run once:
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass.

.EXAMPLE
  .\claude-stack.ps1 install
  Install the full stack into the current project (default account, project scope).

.EXAMPLE
  .\claude-stack.ps1 install -Space work -GitHubCli
  Install into the ~/.claude-work account (+ memory_work.db) and install the GitHub CLI.

.EXAMPLE
  .\claude-stack.ps1 update -Scope global
  Update everything to latest in the global (~/.claude) account.
#>
[CmdletBinding()]
param(
  # REQUIRED main action.
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('install', 'update')]
  [string]$Action,
  # Optional space (any word): selects the Claude account ~/.claude-<Space> (skills/plugins/MCPs
  # install there) AND a separate memory DB (memory_<Space>.db). Named-only. Omit for the default
  # account + shared DB. e.g.: .\claude-stack.ps1 install -Space work
  [string]$Space = '',
  # Optional install scope. 'project' (default) installs INTO this repo; 'global' installs into the
  # active account. Overrides the SCOPE env var; empty here -> resolved from SCOPE, then 'project'.
  [string]$Scope = '',
  # Optional: context7 transport. 'remote' (default) = hosted HTTP server, no local process;
  # 'local' = the local npx stdio server. e.g.: .\claude-stack.ps1 install -Context7 local
  [ValidateSet('remote', 'local')]
  [string]$Context7 = 'remote',
  # Optional: install the GitHub CLI (gh) via winget if missing; prompts for `gh auth login`
  # when unauthenticated. e.g.: .\claude-stack.ps1 install -GitHubCli
  [switch]$GitHubCli
)

$ErrorActionPreference = 'Stop'
# Keep NATIVE command failures non-fatal (mirror the .sh `|| true` tolerance); cmdlet errors still throw.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# A space is any word but becomes part of a path (~/.claude-<Space>, memory_<Space>.db) - validate it.
if ($Space -and $Space -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
  Write-Host "space name '$Space' must start alphanumeric and contain only [A-Za-z0-9._-]" -ForegroundColor Red
  exit 1
}

function Log([string]$Message) { Write-Host "==> $Message" -ForegroundColor Blue }

# Run-outcome tracking for the honest end-of-run summary.
$script:FailCount     = 0        # item install/add failures (skills / plugins / mcps)
$script:ClaudeMissing = $false   # claude CLI absent -> plugins / MCPs / settings.json wiring skipped
$script:PrereqMissing = $false   # a hard prerequisite (uvx / python3 / node) was missing
function Add-Failure([string]$Message) { $script:FailCount++; Write-Host "  !! $Message" -ForegroundColor Red }

function Write-JsonFile([object]$Data, [string]$Path, [int]$Depth = 20) {
  # PowerShell's ConvertTo-Json indents inconsistently and version-dependently (5.1 = 4-space
  # ladders + double-space colons; 7 = deep nested alignment). node's JSON.stringify(_, null, 2)
  # is clean 2-space everywhere, and node is always present (Claude Code requires it). So: write
  # compact via PS, then reformat the file in place with node. Fallback to PS pretty if node is gone.
  $enc = New-Object System.Text.UTF8Encoding($false)
  # Windows gotcha: an existing target carrying the ReadOnly or Hidden attribute makes
  # [IO.File]::WriteAllText (and node's fs.writeFileSync below) throw "Access to the path ... is
  # denied" (UnauthorizedAccessException) even when the ACL would allow the write - FileMode.Create
  # cannot truncate such a file. Clear those bits first so the write lands on the real content.
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    try {
      $f = Get-Item -LiteralPath $Path -Force
      $blocked = [System.IO.FileAttributes]::ReadOnly -bor [System.IO.FileAttributes]::Hidden
      if ($f.Attributes -band $blocked) { $f.Attributes = $f.Attributes -band (-bnot $blocked) }
    } catch {}
  }
  [System.IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth $Depth -Compress), $enc)
  if (Get-Command node -ErrorAction SilentlyContinue) {
    try {
      & node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' $Path 2>$null
      if ($LASTEXITCODE -eq 0) { return }
    } catch {}
  }
  [System.IO.File]::WriteAllText($Path, (($Data | ConvertTo-Json -Depth $Depth) + "`n"), $enc)
}

function Install-GitHubCli {  # opt-in via -GitHubCli; fail-soft like everything else
  if (-not $GitHubCli) { return }
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $ghVersion = try { (& gh --version 2>$null | Select-Object -First 1) } catch { 'version unknown' }
    Log "github-cli: gh already installed ($ghVersion) - skipping install"
  }
  elseif (Get-Command winget -ErrorAction SilentlyContinue) {
    Log 'github-cli: installing gh via winget'
    winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Warning 'winget install gh failed - install manually: https://cli.github.com'; return }
    # No auth during install (deliberate): run `gh auth login` once before the first GitHub
    # platform use (PRs/issues). Plain git push/pull never needs it.
    Log '  installed - run `gh auth login` before first GitHub platform use'
  }
  else {
    Write-Warning 'winget not found - install gh manually: https://cli.github.com (or scoop/choco install gh)'
  }
}

function Test-Prerequisites {
  # Warn (not fail) on missing prerequisites, matching the script's fail-soft philosophy.
  Log 'prerequisites check'
  $ok = $true
  # uvx: required by serena and memory MCP servers.
  if (-not (Get-Command uvx -ErrorAction SilentlyContinue)) {
    Write-Host '  !! uvx not found - serena and memory MCPs will not work.' -ForegroundColor Red
    Write-Host '     Install: powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 | iex"' -ForegroundColor Yellow
    $ok = $false
  }
  else { Write-Host "  uvx: $((uvx --version 2>&1) -join '')" -ForegroundColor Green }
  # Python 3: required by the security-guidance plugin hook.
  # The Windows Store stub (WindowsApps) does not count - it pops the Store and exits.
  $pyCmd  = Get-Command python  -ErrorAction SilentlyContinue
  $py3Cmd = Get-Command python3 -ErrorAction SilentlyContinue
  $hasRealPy = ($pyCmd  -and $pyCmd.Source  -notlike '*WindowsApps*') -or
               ($py3Cmd -and $py3Cmd.Source -notlike '*WindowsApps*')
  if (-not $hasRealPy) {
    Write-Host '  !! Python 3 not found (Windows Store stub does not count) - security-guidance hook will fail.' -ForegroundColor Red
    Write-Host '     Install: winget install Python.Python.3.12' -ForegroundColor Yellow
    $ok = $false
  }
  else {
    $src = if ($py3Cmd -and $py3Cmd.Source -notlike '*WindowsApps*') { $py3Cmd.Source } else { $pyCmd.Source }
    Write-Host "  python3: $src" -ForegroundColor Green
  }
  # node: required by Claude Code, the convention hooks, and npx-based MCPs. Below 22.12 LTS some
  # MCPs (chrome-devtools) refuse to start and die at launch with a generic JSON-RPC -32000.
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = (node --version 2>$null) -replace '^v', ''
    $tooOld = $false
    try { $tooOld = [version]($nodeVer -replace '-.*$', '') -lt [version]'22.12.0' } catch { $tooOld = $false }
    if ($tooOld) {
      Write-Host "  !! node $nodeVer - recommend Node >= 22.12 LTS. chrome-devtools (and some npx MCPs)" -ForegroundColor Yellow
      Write-Host '     require it; an older Node makes them die at launch with a generic JSON-RPC -32000.' -ForegroundColor Yellow
    }
    else { Write-Host "  node: $nodeVer" -ForegroundColor Green }
  }
  else {
    Write-Host '  !! node not found - Claude Code, the convention hooks, and npx-based MCPs need it.' -ForegroundColor Red
    $ok = $false
  }
  # csharp-ls: the csharp-lsp plugin shells out to it for Roslyn diagnostics. Off PATH and the
  # plugin dies at launch with "Executable not found in $PATH". Needed only for C# work, so warn.
  $csharpLs = Get-Command csharp-ls -ErrorAction SilentlyContinue
  if ($csharpLs) { Write-Host "  csharp-ls: $($csharpLs.Source)" -ForegroundColor Green }
  else {
    Write-Host '  !! csharp-ls not found - the csharp-lsp plugin needs it (C# work only).' -ForegroundColor Yellow
    Write-Host '     Install: dotnet tool install --global csharp-ls (needs the .NET SDK + ~\.dotnet\tools on PATH).' -ForegroundColor Yellow
  }
  # typescript-language-server: the typescript-lsp plugin shells out to it via a bare-name PATH lookup
  # (a SEPARATE npm package from typescript/tsserver). Off PATH -> the plugin dies at launch with
  # "Executable not found in $PATH". Needed for TS/JS work, so warn.
  $tsLs = Get-Command typescript-language-server -ErrorAction SilentlyContinue
  if ($tsLs) { Write-Host "  typescript-language-server: $($tsLs.Source)" -ForegroundColor Green }
  else {
    Write-Host '  !! typescript-language-server not found - the typescript-lsp plugin needs it (TS/JS work).' -ForegroundColor Yellow
    Write-Host '     Install: npm i -g typescript-language-server typescript.' -ForegroundColor Yellow
  }
  # claude CLI: the core dependency for plugins, MCPs, and settings.json wiring. Absent -> those steps
  # are skipped (fail-soft); flag it upfront so the user can fix PATH before the long skill install runs.
  if (Get-Command claude -ErrorAction SilentlyContinue) { Write-Host "  claude: $((Get-Command claude).Source)" -ForegroundColor Green }
  else {
    Write-Host '  !! claude CLI not found - plugins, MCPs, and settings.json wiring will be SKIPPED.' -ForegroundColor Red
    Write-Host '     Install: https://docs.claude.com/claude-code (then re-run to add plugins/MCPs).' -ForegroundColor Yellow
    $script:ClaudeMissing = $true
  }
  if (-not $ok) { $script:PrereqMissing = $true; Write-Host '  Install the missing tools above, then re-run.' -ForegroundColor Yellow }
}

# -Scope flag wins, else the SCOPE env var, else 'project'. Lower-case both enums so the resolved value
# is canonical and a non-canonical casing ('Global'/'Remote') behaves identically to the bash twin.
if (-not $Scope) { $Scope = if ($env:SCOPE) { $env:SCOPE } else { 'project' } }
$Scope = $Scope.ToLowerInvariant()
$Context7 = $Context7.ToLowerInvariant()
if ($Scope -notin @('project', 'global')) {
  Write-Host "-Scope must be 'project' or 'global' (got '$Scope')" -ForegroundColor Red
  exit 1
}

# This script provisions the Claude Code agent. (Cursor lives in cursor-stack.ps1.)
$Agent = 'claude-code'

# $ConfigDir is for path resolution only and is normally NOT exported - EXCEPT when a space is given:
# a space (any word) selects the Claude account ~/.claude-<Space> and IS exported so the claude CLI
# (skills/plugins/mcp) installs into it. Without a space, CLAUDE_CONFIG_DIR (a specific account you
# set yourself, e.g. ...\.claude-work) or the ~/.claude default is used and never exported.
if ($Space) {
  $spaceAccount = Join-Path $HOME (".claude-" + $Space)
  # Distinguish an existing account from a brand-new one so a typo'd space ('wrok') is visible, not silent.
  if (Test-Path -LiteralPath $spaceAccount -PathType Container) {
    Log "space '$Space' -> existing account $spaceAccount (CLAUDE_CONFIG_DIR exported for the claude CLI); memory DB memory_$Space.db."
  } else {
    Log "space '$Space' -> creating NEW account $spaceAccount (typo? did you mean an existing one?); memory DB memory_$Space.db."
  }
  if ($env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR -ne $spaceAccount) {
    Log "space '$Space' overrides CLAUDE_CONFIG_DIR ($env:CLAUDE_CONFIG_DIR)."
  }
  $ConfigDir = $spaceAccount
  $env:CLAUDE_CONFIG_DIR = $ConfigDir
} else {
  $ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  if (-not $env:CLAUDE_CONFIG_DIR) {
    Log "CLAUDE_CONFIG_DIR not set - using the claude CLI default account; resolving config paths to $ConfigDir."
  }
}

# serena's --context is per-agent: Cursor uses the generic ide-assistant context.
$SerenaContext = @{ 'claude-code' = 'claude-code'; 'cursor' = 'ide-assistant' }

if ($Scope -eq 'project') {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $top) { Set-Location -LiteralPath $top }
  $SkillsAddFlag = ''        # npx skills add: project is the default (no -g)
  $ClaudeScope = 'project'
}
else {
  $SkillsAddFlag = '-g'
  $ClaudeScope = 'user'
}

# ===========================================================================
# MANIFEST - edit these, then run.
# ===========================================================================

# (1) Skills "repo|skill" (comment a line to skip). Full inventory - every skill (58).
$Skills = @(
  # Personal (envoydev/agents-stack)
  'envoydev/agents-stack|create-ticket'             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  'envoydev/agents-stack|dev-log-convert'           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  'envoydev/agents-stack|explain-code-tutor'        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  'envoydev/agents-stack|project-quality-loop'             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  'envoydev/agents-stack|architecture-quality-loop'        # deliberate analyze-assess-improve loop - architecture-analyzer writes ARCHITECTURE.md + ASSESSMENT.md, fix cons by tier, reconcile docs; manual /-only
  'envoydev/agents-stack|project-scaffold' # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  'envoydev/agents-stack|main-stack-agents-flow'     # main-stack-agents-flow orchestration - designer decomposes, implementers fan out, verifier gates
  'envoydev/agents-stack|cross-stack-agents-flow'    # entry-point router: classify -> smallest execution mode -> cross-domain contract freeze + integration gate; home of the shared subagent policies
  'envoydev/agents-stack|verify-plan'      # audit an implementation plan BEFORE building - risk-coverage review (traps named per the stack skill, scope, edges, minimal); precedes /code-review
  'envoydev/agents-stack|solution-design'  # single-chat designer twin: read the architecture, judge where a change fits (extend/refactor/isolate), load the stack skill for traps, decompose into an ordered plan; feeds verify-plan
  'envoydev/agents-stack|failure-signatures' # single-chat diagnoser twin: local-runtime crash signatures (null-ref/DI/deadlock/disposed/config-drift/boundary/HTTP-status) -> where to isolate each; pairs with systematic-debugging
  'envoydev/agents-stack|ci-triage'        # single-chat CI-diagnoser twin: red-pipeline signatures (compile/restore, green-locally-red-on-runner, quality-gate, signing/release, workflow-config, infra-flake) -> code-vs-environment call + route; pairs with failure-signatures
  'envoydev/agents-stack|devops'           # DevOps for the .NET/Angular house: Docker multi-stage/digest-pinned/non-root, GitHub Actions CI/CD, safe expand-contract deploys, secrets/OIDC, Aspire AppHost
  'envoydev/agents-stack|database-conventions' # cross-engine DB conventions + per-engine skill routing
  'envoydev/agents-stack|data-security'    # SQL/data-layer security: parameterized-only injection, least-privilege DB accounts, row-level security, connection-string secrets, encryption, audit
  'envoydev/agents-stack|typescript'       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  'envoydev/agents-stack|angular-conventions' # Angular 17+/TS house conventions (signals, OnPush, a11y)
  'envoydev/agents-stack|angular-material'   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  'envoydev/agents-stack|angular-styling'    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  'envoydev/agents-stack|angular-security'   # Angular/web frontend security: XSS/DomSanitizer bypass, CSP, CSRF, no-secrets-in-bundle, token storage, SSR/TransferState
  'envoydev/agents-stack|frontend'         # web frontend router: Angular/TS + in-skill design-quality guidance -> mobile
  'envoydev/agents-stack|mobile'           # Ionic/Capacitor router/index over the Angular (angular-conventions) + TypeScript baselines
  'envoydev/agents-stack|ionic'            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  'envoydev/agents-stack|capacitor-release' # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  'envoydev/agents-stack|mobile-security'  # Ionic/Capacitor mobile security: Keychain/Keystore storage, deep-link validation, permissions, cleartext/WebView hardening
  'envoydev/agents-stack|csharp'           # C# house conventions - style, naming, async, logging, DI
  'envoydev/agents-stack|csharp-design-patterns' # all 23 GoF patterns with modern .NET 8+ forms
  'envoydev/agents-stack|dotnet'           # router mapping .NET work areas to specialist skills
  'envoydev/agents-stack|dotnet-architecture-tests' # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  'envoydev/agents-stack|dotnet-aspire'    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  'envoydev/agents-stack|dotnet-authentication' # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  'envoydev/agents-stack|dotnet-code-quality' # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
  'envoydev/agents-stack|dotnet-cryptography' # System.Security.Cryptography: SHA-2, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare
  'envoydev/agents-stack|dotnet-error-handling' # Result + ProblemDetails (RFC 9457) + IExceptionHandler + FluentValidation
  'envoydev/agents-stack|dotnet-grpc'      # gRPC: .proto/codegen, ASP.NET Core host, 4 streaming modes, JWT/mTLS, interceptors, health
  'envoydev/agents-stack|dotnet-hosted-services' # worker/background-service host: BackgroundService, ExecuteAsync trap, scoped scope, PeriodicTimer, shutdown, Channels
  'envoydev/agents-stack|dotnet-messaging' # event-driven messaging: Wolverine (MIT)/MassTransit, outbox, sagas, RabbitMQ/Azure SB
  'envoydev/agents-stack|dotnet-migrate'   # safe migration workflow: EF schema, .NET upgrades, NuGet - rollback + verify per step
  'envoydev/agents-stack|dotnet-minimal-api' # minimal API endpoint mechanics: MapGroup, TypedResults, endpoint filters, binding
  'envoydev/agents-stack|dotnet-mvc-controllers' # controller-based Web API: [ApiController], attribute routing, ActionResult<T>, auto-400 filter, action filters, binding
  'envoydev/agents-stack|dotnet-openapi'   # OpenAPI doc (Swashbuckle / built-in .NET 9+) + Scalar docs UI
  'envoydev/agents-stack|dotnet-realtime'  # SignalR real-time: strongly-typed Hub<T>, IHubContext push, groups/presence, reconnection, JWT-over-querystring, Redis/Azure backplane
  'envoydev/agents-stack|dotnet-security'  # OWASP Top 10 (2021) -> .NET 8 mitigations; deprecated-pattern warnings
  'envoydev/agents-stack|dotnet-source-generators' # Roslyn IIncrementalGenerator authoring + built-in generators (GeneratedRegex/LoggerMessage/STJ)
  'envoydev/agents-stack|dotnet-testing'   # .NET test strategy: AAA, per-layer coverage, library routing
  'envoydev/agents-stack|dotnet-web-backend' # ASP.NET Core cross-cutting: HttpClientFactory, OpenAPI, observability
  'envoydev/agents-stack|dotnet-winforms'  # WinForms conventions: MVP/binding, disposal, GDI leaks, high-DPI, migration
  'envoydev/agents-stack|dotnet-wpf'       # WPF strict-MVVM conventions, bindings, virtualization
  'envoydev/agents-stack|postgres'         # PostgreSQL engine delta: index types, JSONB, SARGability, EXPLAIN, pooling
  'envoydev/agents-stack|sqlite'           # SQLite engine delta: WAL/single-writer, PRAGMAs, type affinity, limited ALTER
  'envoydev/agents-stack|dotnet-data-access' # EF Core + NHibernate ORM hub (references/): DbContext, tracking, N+1, projection
  'envoydev/agents-stack|dotnet-architecture' # architecture decision hub (references/): clean/ddd/vsa/modular/microservices
  'envoydev/agents-stack|markdown-style' # Markdown authoring / review: syntax canon (valid) + house style overlay, two-pass procedure
  'envoydev/agents-stack|ilspy-decompile' # decompile a .NET assembly (ilspycmd via dnx) to read real API/behavior - framework internals, NuGet source, pre-upgrade checks
  'envoydev/agents-stack|dotnet-project-setup' # .NET solution build spine (hub, references/): src/tests layout, .slnx, Directory.Build.props, global.json, central package management, dotnet-tool pinning
  'envoydev/agents-stack|dotnet-performance' # perf-aware .NET design (hub, references/): allocation/type design (struct vs class, Span, ValueTask) + serialization-format choice (STJ source-gen / Protobuf / MessagePack)
  'envoydev/agents-stack|dotnet-diagnostics' # measure/diagnose a live .NET process (hub, references/): BenchmarkDotNet microbenchmarks + crash/hang/OOM dump capture & first-look SOS analysis
  'envoydev/agents-stack|nx'               # Nx monorepo: project-graph nav + 'nx affected' scoping, generators, module-boundary tags; CLI over MCP; serena-vs-nx routing
)

# (2) Plugins "<plugin>@<marketplace>" (non-default marketplaces added first).
$ExtraMarketplaces = @(
  'jarrodwatts/claude-hud'
  'DietrichGebert/ponytail'
)
$Plugins = @(
  'superpowers@claude-plugins-official'       # workflow skills: plan, TDD, debug, verify-before-done
  'claude-md-management@claude-plugins-official' # audit + revise CLAUDE.md files
  'csharp-lsp@claude-plugins-official'      # inline Roslyn diagnostics on edit (complements serena nav); needs csharp-ls (dotnet tool install -g csharp-ls)
  'typescript-lsp@claude-plugins-official'  # same for Angular/TS work
  'security-guidance@claude-plugins-official' # security hooks: pattern warnings + LLM diff review on Stop/commit
  'claude-hud@claude-hud'                       # statusline HUD (global/user scope)
  'ponytail@ponytail'                           # 'lazy senior dev' decision ladder: minimal-code default, cuts generated code/latency/cost
)

# (3) MCP servers "name|args"; scope follows $Scope. SINGLE-QUOTED so ${...} stays LITERAL ->
#     Claude Code interpolates ${CLAUDE_PROJECT_DIR:-.} at server launch.
#     memory: uses ${HOME_MEMORY_DIR} - a script-local token resolved to $HOME\.memory-mcp at install
#     time for BOTH agents, so Claude Code and Cursor share the same DB. A space (e.g. 'work')
#     switches to a separate per-space DB (memory_<space>.db).
# PERFORMANCE (see claude-stack.sh for the full rationale): resolve each runtime's LATEST version
# HERE (install/update network step) and bake it into the registration. `install` skips already-
# registered MCPs, so the resolved version stays FROZEN until `update` re-resolves and bumps it -
# "latest at provision, frozen until next update", no hardcoded versions. Launch is fast because
# versions are PINNED (npx skips dist-tag resolution). Do NOT add --prefer-offline: against a
# freshly-resolved latest version a stale npm cache index reports "no matching version" and the
# server dies (-32000). serena runs from the pinned PyPI package (not git+https). memory injects
# --with numpy (its sqlite_vec backend needs numpy but the package doesn't declare it, so uvx's
# isolated env omits it -> "No module named 'numpy'"). Offline at provision -> empty -> unpinned.
# Bounded fetches (npm --fetch-timeout / Invoke-RestMethod -TimeoutSec) so a dead network fails fast to
# the unpinned fallback instead of hanging on a single silent line.
function Get-NpmLatest([string]$Pkg)  { try { ((npm view $Pkg version --fetch-timeout=15000 2>$null) | Select-Object -First 1).Trim() } catch { '' } }
function Get-PypiLatest([string]$Pkg) { try { (Invoke-RestMethod "https://pypi.org/pypi/$Pkg/json" -TimeoutSec 15).info.version } catch { '' } }
Log 'resolving latest MCP runtime versions (install/update network step)'
$McpContext7Ver   = Get-NpmLatest  '@upstash/context7-mcp'
$McpPlaywrightVer = Get-NpmLatest  '@playwright/mcp'
$McpSerenaVer     = Get-PypiLatest 'serena-agent'
$McpMemoryVer     = Get-PypiLatest 'mcp-memory-service'
# Version-pin suffix: '@1.2.3' when resolved, '' (unpinned fallback) when offline.
$Ctx7Pin   = if ($McpContext7Ver)   { '@' + $McpContext7Ver }   else { '' }
$PwPin     = if ($McpPlaywrightVer) { '@' + $McpPlaywrightVer } else { '' }
$SerenaPin = if ($McpSerenaVer)     { '@' + $McpSerenaVer }     else { '' }
$MemoryPin = if ($McpMemoryVer)     { '@' + $McpMemoryVer }     else { '' }
# Report what pinned vs. fell back to unpinned - the whole point of this step is 'frozen until update'.
$resolvedVers = [ordered]@{ 'context7' = $McpContext7Ver; 'playwright' = $McpPlaywrightVer; 'serena' = $McpSerenaVer; 'memory' = $McpMemoryVer }
foreach ($k in $resolvedVers.Keys) {
  if ($resolvedVers[$k]) { Log "  pinned $k@$($resolvedVers[$k])" }
  else { Log "  !! could not resolve $k latest - installing unpinned (re-run when online to pin it)" }
}

$MemoryBackend = 'sqlite_vec'  # separation is by DB path (below); backend stays sqlite_vec (the only valid local backend)
$MemoryDbFile  = if ($Space) { "memory_$Space.db" } else { 'memory.db' }
# Windows path separator on purpose: ${HOME_MEMORY_DIR} resolves via Join-Path to a backslashed
# root (C:\Users\...\.memory-mcp), so the file joins with '\' too - '...\.memory-mcp\memory.db' -
# instead of the mixed '...\.memory-mcp/memory.db'. JSON serialization escapes it automatically.
$MemoryEntry   = 'memory|-e MCP_MEMORY_STORAGE_BACKEND=' + $MemoryBackend +
                 ' -e MCP_MEMORY_SQLITE_PATH=${HOME_MEMORY_DIR}\' + $MemoryDbFile +
                 ' -- uvx --with numpy --from mcp-memory-service' + $MemoryPin + ' memory server'

# npx-launched MCPs (context7, angular-cli, playwright): on Windows the spawned stdio server can't
# resolve the bare `npx` shim (it's npx.cmd), so it dies with JSON-RPC -32000 - wrap in `cmd /c`.
# Non-Windows (Cursor on mac/Linux) keeps bare npx. $IsWindows is $null on PS 5.1 Desktop -> Windows.
# Entries are built by single-quote concatenation so ${CLAUDE_PROJECT_DIR:-.} stays LITERAL for
# launch-time interpolation (a double-quoted PS string would mangle it).
$OnWindows = if ($null -ne $IsWindows) { $IsWindows } else { $true }
$Npx       = if ($OnWindows) { 'cmd /c npx' } else { 'npx' }

# context7 runs REMOTE (the hosted server) by DEFAULT - no local process, and the key stays out of
# the registration: put CONTEXT7_API_KEY in ~/.claude/settings.json (or .claude/settings.local.json)
# under "env" and Claude Code expands ${CONTEXT7_API_KEY} in the header at launch, so .mcp.json holds
# no secret. On Windows this is the reliable path (no setx/restart dance). Pass -Context7 local for
# the local stdio server - keyless by default too, and $env:CONTEXT7_BAKE_KEY bakes --api-key.
$Context7RemoteUrl = 'https://mcp.context7.com/mcp'
$Context7RemoteHdr = 'CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}'
if ($Context7 -eq 'local') {
  $Ctx7Cmd = "$Npx -y @upstash/context7-mcp$Ctx7Pin"
  if ($env:CONTEXT7_BAKE_KEY -and $env:CONTEXT7_API_KEY) {
    $Ctx7Cmd += ' --api-key ' + $env:CONTEXT7_API_KEY
    Log "  !! baking CONTEXT7_API_KEY into the context7 registration; at project scope it lands in <repo>/.mcp.json - keep .mcp.json uncommitted (or use -Context7 remote to keep the key out of the file)."
  }
  $Ctx7Spec = '-- ' + $Ctx7Cmd
} else {
  $Ctx7Spec = '@HTTP@'
  if ($env:CONTEXT7_BAKE_KEY) {
    Log "  !! CONTEXT7_BAKE_KEY is set but context7 is remote - it is ignored; pass -Context7 local to bake, or add CONTEXT7_API_KEY to settings.json 'env'."
  }
}
$Context7Entry = 'context7|' + $Ctx7Spec
$AngularCliEntry = 'angular-cli|-- ' + $Npx + ' -y @angular/cli mcp'
$PlaywrightEntry = 'playwright|-- ' + $Npx + " -y @playwright/mcp$PwPin " + '--user-data-dir ${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir ${CLAUDE_PROJECT_DIR:-.}/.playwright/screenshots'
$SerenaEntry     = 'serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent' + $SerenaPin + ' serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd'

$Mcps = @(
  $AngularCliEntry                            # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  $SerenaEntry                                # LSP symbol navigation; PyPI-pinned (not git), dashboard off
  $PlaywrightEntry                            # drive a real browser for visual checks / web app verification
  'chrome-devtools|-- cmd /c npx chrome-devtools-mcp@latest' # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  'appium-mcp|-- cmd /c npx -y appium-mcp@latest' # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  $MemoryEntry  # memory: cross-project recall - the subagent handoff runs on serena; comment out in a standalone project
  $Context7Entry                              # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (4) PreToolUse hooks: fetched into the repo from envoydev/agents-stack/claude/hooks on BOTH actions
#     (per-hook fail-soft - a hook not yet upstream keeps its committed repo copy); INSTALL
#     also wires each into settings.json. UPDATE refreshes files only (never settings).
#     Each entry: "filename::matcher::args" - args (if any) are appended to the hook command.
#     Windows note: the .js has no shebang/exec bit here, so it is invoked via `node`.
#     $CLAUDE_PROJECT_DIR is substituted by Claude Code; if your Windows build needs
#     %CLAUDE_PROJECT_DIR% instead, change that one token in Set-HookSettings below.
$HookBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/hooks'
$Hooks = @(
  'guard-protected-force-push.js::Bash::'         # block force-push to main/master/develop
  'guard-catastrophic-rm.js::Bash::'              # block recursive rm of /, ~, $HOME, or a bare *
  'guard-read-whole-file.js::Read::'              # block whole-file Read of a >100-line source file - locate via serena first
)

# settings.json permissions.deny (claude-code): hard-block Read of secret-bearing files. Wired into
# .claude/settings.json alongside the hooks on INSTALL (idempotent, union-merged - a consuming project's
# own deny entries are preserved). Bare globs match at any depth (gitignore semantics), and Claude Code
# applies a Read() deny to recognized Bash reads too (cat/head/tail/sed) - not to arbitrary subprocesses.
# Stack-specific secret/config globs stay a per-project addition (see CLAUDE.template.md's Security note).
# Claude-only - Cursor has no settings.json deny-list.
$SecretDeny = @(
  'Read(.env)'
  'Read(.env.*)'
  'Read(*.pem)'
  'Read(*.pfx)'
  'Read(*.p12)'
  'Read(*.key)'
)

# (5) Subagents (claude-code): specialist agents fetched into .claude/agents/ on BOTH actions
# (per-agent fail-soft). Claude Code auto-discovers .claude/agents/*.md; no settings.json wiring. Cursor twins
# exist for the four resolvers only; the model-routed pipeline agents are Claude-only (Cursor agents pin a model but have no effort pin).
$AgentBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/agents'
$Agents = @(
  'dotnet-build-error-resolver.md'   # implement phase (sonnet/high): dotnet build -> minimal fix loop (serena/csharp-lsp), capped
  'dotnet-test-failure-resolver.md'  # implement phase (sonnet/high): dotnet test -> red->green repair loop, anti-reward-hacking, capped
  'ng-build-error-resolver.md'       # implement phase (sonnet/high): ng build -> minimal fix loop (serena/LSP), capped
  'angular-test-resolver.md'         # implement phase (sonnet/high): ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
  'architecture-analyzer.md'         # analysis phase (opus/xhigh): deliberate iterative reasoner - loops code-analyzer, writes docs/architecture/ARCHITECTURE.md + docs/architecture/ASSESSMENT.md; read-only over code, @agent-/loop-only
  'code-analyzer.md'                 # analysis support (sonnet/low): read-only per-module characterizer (purpose/surface/deps/patterns/smells) - architecture-analyzer loops it, also independently callable
  'style-analyzer.md'                # analysis phase (sonnet/medium): reads per-language style config + code -> writes docs/CODE-STYLE.md (project's actual style, config + idioms); read-only over source
  'task-analyzer.md'                 # analysis phase (opus/high): read-only deep task analysis - impact, coupling, open questions
  'ci-failure-diagnoser.md'          # analysis phase (opus/high): read-only CI red-run diagnosis via gh - categorize, local repro, route
  'issue-diagnoser.md'               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  'evidence-gatherer.md'             # diagnosis support (sonnet/low): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  'greenfield-solution-designer.md'  # analysis phase (opus/xhigh): read-only greenfield design - architecture/stack/structure options from a spec
  'cross-stack-contract-designer.md' # analysis phase (opus/xhigh): read-only - freezes the shared backend/frontend contract before the per-stack designers
  'framework-upgrade-planner.md'     # analysis phase (opus/xhigh): read-only - turns a version/deprecation event into an ordered, contracted upgrade plan
  'security-auditor.md'              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  'integration-reviewer.md'          # final gate (opus/xhigh): read-only cross-domain integration review - contract consistency, assembled build/test/migration, the commit gate no single-stack verifier is
  # Per-domain specialist team (6 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
  'aspnet-solution-designer.md'      # design phase (opus/xhigh): ASP.NET Core architecture + plan + test strategy, decomposes into parallel tasks
  'aspnet-implementer.md'            # build phase (sonnet/medium): builds one ASP.NET task - code + tests
  'aspnet-verifier.md'               # verify phase (sonnet/xhigh): gates the ASP.NET build vs plan + quality, punch-list back
  'angular-solution-designer.md'     # design phase (opus/xhigh): Angular architecture + plan + test strategy, decomposes
  'angular-implementer.md'           # build phase (sonnet/medium): builds one Angular task - code + tests
  'angular-verifier.md'              # verify phase (sonnet/xhigh): gates the Angular build vs plan + quality
  'wpf-solution-designer.md'         # design phase (opus/xhigh): WPF strict-MVVM architecture + plan + test strategy, decomposes
  'wpf-implementer.md'               # build phase (sonnet/medium): builds one WPF task - code + tests
  'wpf-verifier.md'                  # verify phase (sonnet/xhigh): gates the WPF build vs plan + quality
  'mobile-solution-designer.md'      # design phase (opus/xhigh): Ionic/Capacitor architecture + plan + test strategy, decomposes
  'mobile-implementer.md'            # build phase (sonnet/medium): builds one mobile task - code + tests
  'mobile-verifier.md'               # verify phase (sonnet/xhigh): gates the mobile build vs plan + quality
  'data-solution-designer.md'        # design phase (opus/xhigh): schema/data-model architecture + plan + test strategy, decomposes
  'data-implementer.md'              # build phase (sonnet/medium): builds one data task - SQL + migration tests
  'data-verifier.md'                 # verify phase (sonnet/xhigh): gates the data build vs plan + quality
  'devops-solution-designer.md'      # design phase (opus/xhigh): Docker/CI/CD/deploy architecture + plan + validation strategy, decomposes
  'devops-implementer.md'            # build phase (sonnet/medium): builds one devops task - Dockerfile/workflow/deploy + local validation
  'devops-verifier.md'               # verify phase (sonnet/xhigh): gates the devops build vs plan + quality
)

# (6) Path-scoped rules (claude-code): fetched into .claude/rules/ on BOTH actions - lazy-load on
# matching file reads; conventions stay with the convention-gate hook, rules carry only glob-scoped routing.
$RulesBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/rules'
$ClaudeRules = @(
  'markdown-docs.md'          # markdown-style routing, path-scoped **/*.md
  'dotnet-repair-agents.md'   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  'angular-repair-agents.md'  # Angular repair-loop routing, path-scoped
  # Convention rules (soft, glob auto-attach) - each points a file type at its house-style skill; replaced the require-convention-skill hard gate.
  'web-conventions.md'        # angular/web/ionic: ts/js/scss -> typescript + angular-conventions + angular-styling
  'aspnet-conventions.md'     # asp.net: .cs -> csharp
  'wpf-conventions.md'        # wpf: .xaml -> dotnet-wpf
  'sql-conventions.md'        # sql: .sql -> database-conventions
  'devops-conventions.md'     # rest (devops): Dockerfile/compose/workflow -> devops
)

function Get-RepoRoot {
  $r = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $r) { return $r }
  return $null
}

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); MCPs and plugins SKIP if already present
# ===========================================================================
function Install-Skills {
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Add-Failure 'npx not found - skills not installed'; return }
  $seen = @{}
  foreach ($entry in $Skills) {
    $repo = $entry.Split('|')[0]
    if ($seen.ContainsKey($repo)) { continue }   # repo already done
    $seen[$repo] = $true
    $names = @($Skills | Where-Object { $_.Split('|')[0] -eq $repo } | ForEach-Object { $_.Split('|', 2)[1] })
    $sargs = @('-y', 'skills', 'add', $repo)      # one --skill flag per skill (CLI rejects comma lists)
    foreach ($n in $names) { $sargs += '--skill'; $sargs += $n }
    $sargs += @('--agent', $Agent)
    if ($SkillsAddFlag) { $sargs += $SkillsAddFlag }
    $sargs += '--yes'
    Log "skills [$Scope -> $Agent]: $repo -> $($names -join ',')"
    & npx @sargs
    if ($LASTEXITCODE -ne 0) { Add-Failure "$repo ($Agent) failed - check selectors (npx skills add $repo --list)" }
  }
}

function Install-Plugins {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { $script:ClaudeMissing = $true; return }   # fail-soft: skip, never abort
  foreach ($mp in $ExtraMarketplaces) { try { & claude plugin marketplace add $mp 2>$null } catch {} }
  foreach ($p in $Plugins) {
    # claude-hud is a statusline HUD - force USER scope regardless of $ClaudeScope. A project-scoped
    # install + the global statusline enable mismatch, so every OTHER project warns "plugin not cached".
    $pScope = if ($p -like 'claude-hud@*') { 'user' } else { $ClaudeScope }
    Log "plugin [$pScope]: $p"
    try { & claude plugin install $p --scope $pScope } catch {}   # may prompt to trust on first run
    if ($LASTEXITCODE -ne 0) { Add-Failure "plugin $p failed" }
  }
}

function Install-Mcps {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { $script:ClaudeMissing = $true; return }   # fail-soft: skip, never abort
  foreach ($entry in $Mcps) {
    $parts = $entry.Split('|', 2)
    $name = $parts[0]
    $spec = $parts[1].Replace('@SERENA_CONTEXT@', $SerenaContext['claude-code'])
    # CLAUDE_CONFIG_DIR unset -> the CLI can't interpolate ${CLAUDE_CONFIG_DIR} at launch, so resolve it now.
    if (-not $env:CLAUDE_CONFIG_DIR) { $spec = $spec.Replace('${CLAUDE_CONFIG_DIR}', $ConfigDir) }
    # HOME_MEMORY_DIR: shared memory root ($HOME\.memory-mcp) - always resolved at install time so both
    # Claude Code and Cursor point to the same DB path regardless of agent.
    $spec = $spec.Replace('${HOME_MEMORY_DIR}', (Join-Path $HOME '.memory-mcp'))
    # ASSUMPTION: no resolved path token ($ConfigDir / $HOME\.memory-mcp) contains a space - the MCP
    # spec is space-separated by design (-e KEY=VAL -- cmd args), so a space inside one token cannot
    # survive this split. .Split(' ') yields an array (no glob expansion, unlike bash word-splitting).
    $argArr = @($spec.Split(' ') | Where-Object { $_ -ne '' })
    # PS 5.1 + ErrorActionPreference='Stop': a native command's redirected stderr throws, so probe in try/catch.
    $configured = $false
    try { & claude mcp get $name *> $null; $configured = ($LASTEXITCODE -eq 0) } catch { $configured = $false }
    if ($configured) { Write-Host "  mcp $name already configured - skipping"; continue }
    Log "mcp [$ClaudeScope]: $name"
    if ($spec -eq '@HTTP@') {
      try { & claude mcp add --transport http --scope $ClaudeScope $name $Context7RemoteUrl --header $Context7RemoteHdr } catch {}
      if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
      continue
    }
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
    if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
  }
}

function Get-Hooks {
  # Fetch each hook file into the repo; per-hook fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping hooks'; return }
  foreach ($entry in $Hooks) {
    $file = ($entry -split '::', 2)[0]
    $dest = Join-Path $root ".claude/hooks/$file"
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri "$HookBaseUrl/$file" -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch { Log "  !! fetch failed (kept repo copy if any): $file"; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; continue }
    if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
      Remove-Item -LiteralPath $tmp -Force; Log "  hook current: $file"
    }
    else {
      Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  hook fetched -> $file"
    }
  }
}

function Get-Agents {
  # Fetch each subagent .md into the repo; per-agent fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping agents'; return }
  foreach ($file in $Agents) {
    $dest = Join-Path $root ".claude/agents/$file"
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri "$AgentBaseUrl/$file" -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch { Log "  !! fetch failed (kept repo copy if any): $file"; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; continue }
    if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
      Remove-Item -LiteralPath $tmp -Force; Log "  agent current: $file"
    }
    else {
      Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  agent fetched -> $file"
    }
  }
}

function Get-Rules {
  # Fetch each rule .md into the repo; per-rule fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping rules'; return }
  foreach ($file in $ClaudeRules) {
    $dest = Join-Path $root ".claude/rules/$file"
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri "$RulesBaseUrl/$file" -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch { Log "  !! fetch failed (kept repo copy if any): $file"; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; continue }
    if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
      Remove-Item -LiteralPath $tmp -Force; Log "  rule current: $file"
    }
    else {
      Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  rule fetched -> $file"
    }
  }
}

$ClaudeMdUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/CLAUDE.template.md'
function New-ClaudeMd {
  # INSTALL: lay down a starter CLAUDE.md from the template when the project has none (never clobber a filled one).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping CLAUDE.md'; return }
  $dest = Join-Path $root 'CLAUDE.md'
  if (Test-Path -LiteralPath $dest) { Log '  CLAUDE.md: already present - left as-is (fill any remaining <placeholders>)'; return }
  $tmp = [System.IO.Path]::GetTempFileName()
  try { Invoke-WebRequest -Uri $ClaudeMdUrl -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
  catch { Log '  !! CLAUDE.md template fetch failed - create it by hand from claude/CLAUDE.template.md'; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; return }
  Move-Item -LiteralPath $tmp -Destination $dest -Force; Log '  CLAUDE.md: seeded from the template - FILL its <placeholders> for this project before you start'
}

function Set-HookSettings {
  # INSTALL: ensure the hook PreToolUse blocks + secret-read deny-list + mcp allow-list are in settings.json (idempotent).
  $root = Get-RepoRoot
  if (-not $root) { return }
  $settings = Join-Path $root '.claude/settings.json'
  $dir = Split-Path -Parent $settings
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $data = if (Test-Path -LiteralPath $settings) { Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }

  if (-not $data.PSObject.Properties['hooks']) { $data | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
  if (-not $data.hooks.PSObject.Properties['PreToolUse']) { $data.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue @() }
  $pre = @($data.hooks.PreToolUse)
  $have = @(foreach ($e in $pre) { foreach ($h in $e.hooks) { $h.command } })
  $changed = $false
  foreach ($entry in $Hooks) {
    $parts = $entry -split '::', 3
    $file = $parts[0]
    $matcher = $parts[1]
    $argStr = if ($parts.Count -ge 3) { $parts[2] } else { '' }
    if (-not $matcher) { continue }
    # Single-quoted segments keep $CLAUDE_PROJECT_DIR literal (Claude Code substitutes it at runtime).
    $cmd = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/' + $file + '"'
    if ($argStr) { $cmd = $cmd + ' ' + $argStr }
    if ($have -contains $cmd) { continue }
    $block = [pscustomobject]@{ matcher = $matcher; hooks = @([pscustomobject]@{ type = 'command'; command = $cmd }) }
    $pre += $block
    $have += $cmd
    $changed = $true
  }
  $data.hooks.PreToolUse = $pre
  # permissions.deny: union-merge the secret-file Read blocks, preserving any the project already set.
  if (-not $data.PSObject.Properties['permissions']) { $data | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{}) }
  if (-not $data.permissions.PSObject.Properties['deny']) { $data.permissions | Add-Member -NotePropertyName deny -NotePropertyValue @() }
  $deny = @($data.permissions.deny)
  foreach ($rule in $SecretDeny) {
    if ($deny -notcontains $rule) { $deny += $rule; $changed = $true }
  }
  $data.permissions.deny = $deny
  # enabledMcpjsonServers: pre-approve exactly the project .mcp.json servers we register (never enableAllProjectMcpServers).
  if (-not $data.PSObject.Properties['enabledMcpjsonServers']) { $data | Add-Member -NotePropertyName enabledMcpjsonServers -NotePropertyValue @() }
  $enabled = @($data.enabledMcpjsonServers)
  foreach ($mcpEntry in $Mcps) {
    $mcpName = ($mcpEntry -split '\|', 2)[0]   # server name = the token before the first '|'
    if ($enabled -notcontains $mcpName) { $enabled += $mcpName; $changed = $true }
  }
  $data.enabledMcpjsonServers = $enabled
  # env: project-default auto-compact trigger (compact at ~40% of the context window). Set only when
  # absent, so a project that pins its own value - or holds CONTEXT7_API_KEY here - is never clobbered.
  if (-not $data.PSObject.Properties['env']) { $data | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
  if (-not $data.env.PSObject.Properties['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) {
    $data.env | Add-Member -NotePropertyName CLAUDE_AUTOCOMPACT_PCT_OVERRIDE -NotePropertyValue '40'
    $changed = $true
  }
  if ($changed) {
    try {
      Write-JsonFile $data $settings
      Log '  settings.json: hooks + secret deny-list + mcp allow-list + compact default ensured'
    }
    catch {
      # Mirror the .sh twin's `|| log "settings.json wiring failed"`: a single unwritable file must
      # not abort the install (Get-Agents and the serena fix still need to run). ReadOnly/Hidden are
      # cleared in Write-JsonFile, so reaching here means a real lock or ACL denial.
      Write-Warning "  settings.json wiring failed: $($_.Exception.Message)"
      Write-Host '     Likely locked or ACL-restricted. Close Claude Code / editors holding it, or check' -ForegroundColor Yellow
      Write-Host "     write permission on $settings, then re-run (hooks are wired idempotently)." -ForegroundColor Yellow
    }
  }
  else {
    Log '  settings.json: hooks + secret deny-list + mcp allow-list + compact default already present - unchanged'
  }
}

# ===========================================================================
# UPDATE - bring everything to latest
# ===========================================================================
function Remove-Skills {
  # Uninstall the manifest skills so the following re-add lands as fresh COPIES.
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { return }
  $sargs = @('-y', 'skills', 'remove')
  foreach ($e in $Skills) { $sargs += '--skill'; $sargs += $e.Split('|', 2)[1] }
  $sargs += @('--agent', $Agent)
  if ($SkillsAddFlag) { $sargs += $SkillsAddFlag }
  $sargs += '--yes'
  Log "skills [$Scope -> $Agent]: removing $($Skills.Count) for clean reinstall"
  & npx @sargs 2>$null
}

function Update-Skills {
  # Clean reinstall (remove + add), NOT `npx skills update`: keeps .claude/skills as real COPIES
  # instead of symlinks into .agents/, and `npx skills add` re-clones each repo = latest.
  Remove-Skills
  Install-Skills
}

function Update-Plugins {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { $script:ClaudeMissing = $true; return }   # fail-soft: skip, never abort
  try { & claude plugin marketplace update 2>$null } catch {}   # refresh marketplaces first
  foreach ($p in $Plugins) {
    $pScope = if ($p -like 'claude-hud@*') { 'user' } else { $ClaudeScope }   # claude-hud is user-scope (statusline)
    Log "plugin update [$pScope]: $p"
    try { & claude plugin update $p --scope $pScope } catch {}
  }
}

function Update-Mcps {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { $script:ClaudeMissing = $true; return }   # fail-soft: skip, never abort
  # MCP binaries auto-update at launch (@latest / uvx git+); this re-asserts the config.
  foreach ($entry in $Mcps) {
    $parts = $entry.Split('|', 2)
    $name = $parts[0]
    $spec = $parts[1].Replace('@SERENA_CONTEXT@', $SerenaContext['claude-code'])
    if (-not $env:CLAUDE_CONFIG_DIR) { $spec = $spec.Replace('${CLAUDE_CONFIG_DIR}', $ConfigDir) }
    $spec = $spec.Replace('${HOME_MEMORY_DIR}', (Join-Path $HOME '.memory-mcp'))
    # Same no-spaces-in-resolved-path assumption as Install-Mcps (see there); .Split(' ') is array, no glob.
    $argArr = @($spec.Split(' ') | Where-Object { $_ -ne '' })
    Log "mcp refresh [$ClaudeScope]: $name"
    try { & claude mcp remove $name -s $ClaudeScope 2>$null } catch {}
    if ($spec -eq '@HTTP@') {
      try { & claude mcp add --transport http --scope $ClaudeScope $name $Context7RemoteUrl --header $Context7RemoteHdr } catch {}
      if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
      continue
    }
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
    if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
  }
}

function Update-Hooks { Get-Hooks }   # UPDATE: refresh hook files only; settings.json untouched
function Update-Agents { Get-Agents } # UPDATE: refresh subagent files
function Update-Rules { Get-Rules }   # UPDATE: refresh rule files

function Remove-AgentsCache {
  # npx skills stages an agent-neutral .agents/ store. With a STRICT per-agent copy (.claude/skills is
  # a real copy), nothing reads .agents/ anymore - prune it. Guard: keep it if any skill entry under
  # .claude/skills is a symlink (a symlinked tree still depends on .agents/; removing it would dangle).
  $root = Get-RepoRoot
  if (-not $root) { return }
  $agents = Join-Path $root '.agents'
  if (-not (Test-Path -LiteralPath $agents)) { return }
  $hasSymlink = $false
  foreach ($d in @((Join-Path $root '.claude/skills'))) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $sym = [bool](Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
    if ($sym) { $hasSymlink = $true; break }
  }
  if ($hasSymlink) { Log '  kept .agents/ - a skills tree has symlinks that still depend on it' }
  else { Remove-Item -LiteralPath $agents -Recurse -Force -ErrorAction SilentlyContinue; Log '  pruned .agents/ (skills are real per-agent copies)' }
}

# ===========================================================================
# WINDOWS SERENA FIX (interim) - remove once oraios/serena#311 ships upstream
# ===========================================================================
function Repair-SerenaTsLspWindows {
  # Windows-only. serena/solidlsp spawns npm's extensionless POSIX shim
  # (.bin/typescript-language-server), which cmd.exe can't run, so serena's TS symbol/reference
  # tools die at language-server init (oraios/serena#311). serena exposes NO command/path override,
  # so the only lever is patching _create_launch_command in the cached package. Two steps:
  #   1) pre-warm: `claude mcp add` only registers serena - the package isn't materialized in the uv
  #      cache until serena first launches, so force a uvx run now or there is nothing to patch yet.
  #   2) delegate the idempotent patch to scripts/fix-serena-ts-windows.ps1 (single source of truth),
  #      fetched from the repo like the hooks. Fail-soft throughout. No-op on the .sh twin (Unix runs
  #      the shim directly via its shebang). REMOVE this whole block once #311 ships upstream.
  if (-not $OnWindows) { return }
  if (-not (Get-Command uvx -ErrorAction SilentlyContinue)) { return }
  $serenaOn = $false
  try { & claude mcp get serena *> $null; $serenaOn = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $serenaOn) { return }   # only patch when serena is actually part of this stack

  Log 'serena: applying interim Windows TS-LSP launch fix (oraios/serena#311)'
  # Pre-warm: any subcommand makes uvx resolve+cache serena-agent (download happens before the
  # command runs, so the exit code is irrelevant); $SerenaPin keeps it the same version the MCP uses.
  try { & uvx --from ('serena-agent' + $SerenaPin) serena --help *> $null } catch {}

  $fixUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/scripts/fix-serena-ts-windows.ps1'
  $fixTmp = Join-Path ([System.IO.Path]::GetTempPath()) 'fix-serena-ts-windows.ps1'
  try {
    Invoke-WebRequest -Uri $fixUrl -OutFile $fixTmp -UseBasicParsing -ErrorAction Stop
    & powershell -NoProfile -ExecutionPolicy Bypass -File $fixTmp   # child process: its `exit` won't kill this installer
  }
  catch { Write-Warning "  serena TS-LSP fix skipped (fetch/run failed): $($_.Exception.Message)" }
  finally { Remove-Item -LiteralPath $fixTmp -Force -ErrorAction SilentlyContinue }
}

# ===========================================================================
# DISPATCH
# ===========================================================================
Test-Prerequisites
Install-GitHubCli

# claude-only steps fail soft (Get-Command claude) if the CLI is not installed.
if ($Action -eq 'install') { Install-Skills; Install-Plugins; Install-Mcps; Get-Hooks; Set-HookSettings; Get-Agents; Get-Rules; New-ClaudeMd; Repair-SerenaTsLspWindows }
else { Update-Skills; Update-Plugins; Update-Mcps; Update-Hooks; Update-Agents; Update-Rules; Repair-SerenaTsLspWindows }

Remove-AgentsCache
Write-Host ''
Log "done: $Action [scope=$Scope, account=$ConfigDir, agent=$Agent]"
$summary = "  skills=$($Skills.Count), plugins=$($Plugins.Count), mcps=$($Mcps.Count), hooks=$($Hooks.Count), agents=$($Agents.Count), rules=$($ClaudeRules.Count)"
if ($Space) { $summary += "; space=$Space, memory DB=$MemoryDbFile" }
Log "$summary; context7=$Context7"
if ($script:ClaudeMissing) { Log "  !! claude CLI absent - plugins, MCPs, and settings.json wiring were SKIPPED (install it, then re-run)" }
if ($script:FailCount -gt 0) { Log "  !! $($script:FailCount) item(s) failed above - re-run '$Action' to retry" }

Log 'next steps:'
Log "  - fill your project's CLAUDE.md <placeholders> (framework, stack, conventions, secret/config globs) - install seeds a starter from the template when the project has none; the claude-md-management plugin can help audit it"
Log "  - if this repo has sibling projects (a backend/frontend pair, a consumed package), add docs/RELATED-PROJECTS.md naming the edges (consumes / provides-to / peer) + keep a one-line pointer in CLAUDE.md's '## Related projects' section"
Log '  - restart Claude Code (or reopen the project) to load the new MCPs, hooks, and settings'
if ($script:PrereqMissing) { Log '  - install the missing prerequisites flagged above, then re-run' }
if ($Context7 -eq 'remote') { Log "  - context7 is remote; add CONTEXT7_API_KEY to $ConfigDir\settings.json 'env' for higher rate limits (or re-run with -Context7 local)" }
if ($GitHubCli) { Log "  - run 'gh auth login' if gh is not yet authenticated (needed before PRs/issues)" }

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
Write-Host ''
Write-Host "Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git\info\exclude):"
Write-Host '  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)'
Write-Host '  .claude          Claude Code project config + local state (settings.local.json, hooks)'
Write-Host '  .slopwatch       dotnet-slopwatch output'
Write-Host '  .playwright      playwright MCP user-data-dir + screenshots'
Write-Host '  .mcp.json        generated MCP server config (machine-local)'
Write-Host '  skill-lock.json  skills CLI lock file'
Write-Host '  docs/superpowers superpowers / brainstorming scratch specs (docs/ itself - the committed architecture map - stays tracked)'
