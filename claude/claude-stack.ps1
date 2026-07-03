#Requires -Version 5.1
<#
  claude-stack.ps1 [install|update] [work] [github-cli] - install/update the CLAUDE CODE stack FOR A PROJECT (Windows/PowerShell).

  PowerShell port of claude-stack.sh: every skill / plugin / MCP from
  claude-stack.html (the complete toolset, not a curated subset), installed INTO a
  project. Built-in/system CLI skills are excluded (they ship with the CLI). Cursor lives in cursor-stack.ps1.

  Usage (Windows PowerShell 5.1 or PowerShell 7+), run inside the target project:
    pwsh claude-stack.ps1 install   # install for Claude Code
    pwsh claude-stack.ps1 update    # update Claude Code (skills + plugins + mcp + hooks)

  Provisions Claude Code: skills --agent claude-code; plugins; MCPs via `claude mcp add`; hooks +
  settings.json. Requires the `claude` CLI; claude-only steps fail soft if it is absent.

  Optional extras: MemoryProfile 'work' -> separate work memory DB (memory_work.db),
  omit for the default shared DB; -GitHubCli -> install gh via winget if missing. Both agents share
  ~/.memory-mcp so Claude Code and Cursor see the same DB. e.g.: .\claude-stack.ps1 install work -GitHubCli

  Scope (default PROJECT - installs the full set INTO this repo; $env:SCOPE = 'global' to
  install it into the active account instead):
    project -> skills project-scoped, plugins/mcps --scope project
    global  -> skills -g, plugins/mcps --scope user

  Windows differences vs claude-stack.sh:
    - hook .js files are invoked via `node` (Windows has no shebang / exec bit) - see Set-HookSettings.
    - settings.json is merged natively (ConvertFrom/To-Json), no python dependency.
    - claude-code keeps MCP arg strings LITERAL (${CLAUDE_PROJECT_DIR:-.} / ${CLAUDE_CONFIG_DIR}) so
      Claude Code interpolates them at launch.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'update')]
  [string]$Action = 'install',
  # Optional memory profile. 'work' -> separate work DB (memory_work.db).
  # Omit for the default shared DB.
  [Parameter(Position = 1)]
  [ValidateSet('', 'work')]
  [string]$MemoryProfile = '',
  # Optional: install the GitHub CLI (gh) via winget if missing; prompts for `gh auth login`
  # when unauthenticated. e.g.: .\claude-stack.ps1 install -GitHubCli
  [switch]$GitHubCli
)

$ErrorActionPreference = 'Stop'
# Keep NATIVE command failures non-fatal (mirror the .sh `|| true` tolerance); cmdlet errors still throw.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Log([string]$Message) { Write-Host "==> $Message" -ForegroundColor Blue }

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
  if (-not $ok) { Write-Host '  Install the missing tools above, then re-run.' -ForegroundColor Yellow }
}

$Scope = if ($env:SCOPE) { $env:SCOPE } else { 'project' }

# This script provisions the Claude Code agent. (Cursor lives in cursor-stack.ps1.)
$Agent = 'claude-code'

# $ConfigDir is for path resolution only (e.g. the memory MCP db) - never exported to any CLI:
# CLAUDE_CONFIG_DIR (a specific account, e.g. ...\.claude-work) or the ~/.claude default.
$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
if (-not $env:CLAUDE_CONFIG_DIR) {
  Log "CLAUDE_CONFIG_DIR not set - using the claude CLI default account; resolving config paths to $ConfigDir."
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

# (1) Skills "repo|skill" (comment a line to skip). Full inventory - every skill (72).
$Skills = @(
  # Personal (envoydev/agents-stack)
  'envoydev/agents-stack|create-ticket'             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  'envoydev/agents-stack|dev-log-convert'           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  'envoydev/agents-stack|explain-code-tutor'        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  'envoydev/agents-stack|project-quality-loop'             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  'envoydev/agents-stack|project-scaffold' # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  'envoydev/agents-stack|domain-build'     # domain-build orchestration - designer decomposes, implementers fan out, verifier gates
  'envoydev/agents-stack|database-conventions' # cross-engine DB conventions + per-engine skill routing
  'envoydev/agents-stack|typescript'       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  'envoydev/agents-stack|angular-conventions' # Angular 17+/TS house conventions (signals, OnPush, a11y)
  'envoydev/agents-stack|angular-material'   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  'envoydev/agents-stack|angular-styling'    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  'envoydev/agents-stack|frontend'         # web frontend router: Angular/TS/frontend-design + -> mobile
  'envoydev/agents-stack|mobile'           # Ionic/Capacitor router: ionic-angular/capacitor-angular/capacitor-plugins + Angular/TS baseline
  'envoydev/agents-stack|ionic'            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  'envoydev/agents-stack|capacitor-release' # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
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
  'envoydev/agents-stack|dotnet-wpf'       # WPF strict-MVVM conventions, bindings, virtualization
  # .NET (aaronontheweb/dotnet-skills)
  'aaronontheweb/dotnet-skills|api-design'    # stable extend-only public APIs, NuGet/wire versioning
  'aaronontheweb/dotnet-skills|aspire-integration-testing' # .NET Aspire integration tests: DistributedApplicationTestingBuilder, AppHost, endpoint discovery
  'aaronontheweb/dotnet-skills|crap-analysis' # CRAP-score risk hotspots (complexity x coverage)
  'aaronontheweb/dotnet-skills|csharp-concurrency-patterns' # async/await, Channels, Akka.NET concurrency guidance
  'aaronontheweb/dotnet-skills|database-performance' # read-path perf: N+1, projections, AsNoTracking, row limits
  'aaronontheweb/dotnet-skills|dependency-injection-patterns' # IServiceCollection Add* extension composition
  'aaronontheweb/dotnet-skills|dotnet-local-tools' # pin CLI tools (dotnet-ef/csharpier/reportgenerator) in .config/dotnet-tools.json for local+CI parity
  'aaronontheweb/dotnet-skills|dotnet-project-structure' # .slnx, Directory.Build.props, global.json layout
  'aaronontheweb/dotnet-skills|dotnet-slopwatch' # detect LLM reward-hacking in diffs (disabled tests, empty catches)
  'aaronontheweb/dotnet-skills|efcore-patterns' # EF Core query/tracking/migration mechanics
  'aaronontheweb/dotnet-skills|ilspy-decompile' # decompile assemblies to inspect the real API/behavior
  'aaronontheweb/dotnet-skills|microsoft-extensions-configuration' # typed options binding + startup validation
  'aaronontheweb/dotnet-skills|OpenTelemetry-NET-Instrumentation' # deep manual OTel: custom Activity/spans, metric cardinality, zero-alloc TagList (beyond web-backend wiring)
  'aaronontheweb/dotnet-skills|package-management' # NuGet central package management via dotnet CLI
  'aaronontheweb/dotnet-skills|r3-reactive-extensions' # R3 (Cysharp modern Rx): Observable, operators, schedulers for event-driven C#
  'aaronontheweb/dotnet-skills|serialization' # System.Text.Json / Protobuf / MessagePack guidance
  'aaronontheweb/dotnet-skills|snapshot-testing' # Verify snapshot/approval tests: HTTP responses, public API surface, serialized output
  'aaronontheweb/dotnet-skills|testcontainers-integration-tests' # integration tests against real DBs in Docker
  'aaronontheweb/dotnet-skills|type-design-performance' # structs vs classes, sealing, allocation-aware type design
  # .NET diagnostics (dotnet/skills - official Microsoft)
  'dotnet/skills|microbenchmarking'           # BenchmarkDotNet: design/run/compare microbenchmarks (net-new runtime perf)
  'dotnet/skills|dump-collect'                # crash / on-demand dump capture (Linux/macOS/Win + containers)
  # Architecture (codewithmukesh/dotnet-claude-kit) - version-neutral concepts referenced live; the
  # version-coupled ASP.NET Core areas are covered by the original house dotnet-* skills above (.NET 8 floor).
  'codewithmukesh/dotnet-claude-kit|clean-architecture' # Clean Architecture 4-project layout + dependency rules
  'codewithmukesh/dotnet-claude-kit|ddd'      # tactical DDD: aggregates, value objects, domain events
  # Docs / DB / Docker / Git (josiahsiegel/claude-plugin-marketplace)
  'josiahsiegel/claude-plugin-marketplace|docker-platform-guide' # per-OS Docker Desktop setup specifics
  'josiahsiegel/claude-plugin-marketplace|docker-security-guide' # container hardening, capability dropping, CIS
  'josiahsiegel/claude-plugin-marketplace|git-master' # non-trivial git: recovery, history rewrite, submodules
  'josiahsiegel/claude-plugin-marketplace|index-strategies' # SQL Server index design: clustered/filtered/columnstore/INCLUDE
  'josiahsiegel/claude-plugin-marketplace|markdown-style' # two-pass Markdown syntax/style review
  'josiahsiegel/claude-plugin-marketplace|query-optimization' # T-SQL rewrites, SARGability, execution-plan reading
  'josiahsiegel/claude-plugin-marketplace|tsql-functions' # T-SQL function catalog (string/date/window/JSON/XML)
  # Single-skill repos
  'supabase/agent-skills|supabase-postgres-best-practices' # Postgres performance + schema best practices
  'mryll/skills|vertical-slice-architecture'  # VSA: feature folders, minimal cross-slice coupling
  # Ionic / Capacitor mobile (capawesome-team/skills - MIT)
  'capawesome-team/skills|ionic-angular'      # Angular-specific Ionic patterns (components, theming, navigation)
  'capawesome-team/skills|capacitor-angular'  # Angular-specific Capacitor app patterns
  'capawesome-team/skills|capacitor-plugins'  # install/configure/use 160+ Capacitor plugins (official/Capawesome/community/CapGo)
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
  'frontend-design@claude-plugins-official'   # distinctive, production-grade frontend UI; polished code that avoids generic AI aesthetics
  'claude-hud@claude-hud'                       # statusline HUD (global/user scope)
  'ponytail@ponytail'                           # 'lazy senior dev' decision ladder: minimal-code default, cuts generated code/latency/cost
)

# (3) MCP servers "name|args"; scope follows $Scope. SINGLE-QUOTED so ${...} stays LITERAL ->
#     Claude Code interpolates ${CLAUDE_PROJECT_DIR:-.} at server launch.
#     memory: uses ${HOME_MEMORY_DIR} - a script-local token resolved to $HOME\.memory-mcp at install
#     time for BOTH agents, so Claude Code and Cursor share the same DB. MemoryProfile='work'
#     switches to a separate work DB (memory_work.db).
# PERFORMANCE (see claude-stack.sh for the full rationale): resolve each runtime's LATEST version
# HERE (install/update network step) and bake it into the registration. `install` skips already-
# registered MCPs, so the resolved version stays FROZEN until `update` re-resolves and bumps it -
# "latest at provision, frozen until next update", no hardcoded versions. Launch is fast because
# versions are PINNED (npx skips dist-tag resolution). Do NOT add --prefer-offline: against a
# freshly-resolved latest version a stale npm cache index reports "no matching version" and the
# server dies (-32000). serena runs from the pinned PyPI package (not git+https). memory injects
# --with numpy (its sqlite_vec backend needs numpy but the package doesn't declare it, so uvx's
# isolated env omits it -> "No module named 'numpy'"). Offline at provision -> empty -> unpinned.
function Get-NpmLatest([string]$Pkg)  { try { ((npm view $Pkg version 2>$null) | Select-Object -First 1).Trim() } catch { '' } }
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

$MemoryBackend = 'sqlite_vec'  # separation is by DB path (below); backend stays sqlite_vec (the only valid local backend)
$MemoryDbFile  = if ($MemoryProfile -eq 'work') { 'memory_work.db'  } else { 'memory.db'   }
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

# context7 API key is a SECRET. RECOMMENDED: put it in ~/.claude/settings.json under "env" as
# CONTEXT7_API_KEY - context7 reads it from the environment at launch, so the key NEVER touches the
# MCP registration (.mcp.json) and is set once, user-global. Leave $env:CONTEXT7_API_KEY UNSET in
# your install shell so the registration stays keyless. ALTERNATIVE (legacy): set $env:CONTEXT7_API_KEY
# before running and it is baked as --api-key into the registration (project scope = <repo>/.mcp.json,
# so keep that file uncommitted).
$Ctx7Cmd = "$Npx -y @upstash/context7-mcp$Ctx7Pin"
if ($env:CONTEXT7_API_KEY) { $Ctx7Cmd += ' --api-key ' + $env:CONTEXT7_API_KEY }
$Context7Entry   = 'context7|-- ' + $Ctx7Cmd
$AngularCliEntry = 'angular-cli|-- ' + $Npx + ' -y @angular/cli mcp'
$PlaywrightEntry = 'playwright|-- ' + $Npx + " -y @playwright/mcp$PwPin " + '--user-data-dir ${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir ${CLAUDE_PROJECT_DIR:-.}/.playwright/screenshots'
$SerenaEntry     = 'serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent' + $SerenaPin + ' serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd'

$Mcps = @(
  $AngularCliEntry                            # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  $SerenaEntry                                # LSP symbol navigation; PyPI-pinned (not git), dashboard off
  $PlaywrightEntry                            # drive a real browser for visual checks / web app verification
  'chrome-devtools|-- cmd /c npx chrome-devtools-mcp@latest' # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  'appium-mcp|-- cmd /c npx -y appium-mcp@latest' # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  $MemoryEntry                                # memory: cross-project semantic recall (mcp-memory-service)
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
# Every serena file-mutating tool the convention gate covers (symbol + line edits, create/replace/rename) - matched alongside Edit|Write.
$SerenaEditors = 'mcp__serena__replace_symbol_body|mcp__serena__insert_after_symbol|mcp__serena__insert_before_symbol|mcp__serena__create_text_file|mcp__serena__replace_content|mcp__serena__replace_regex|mcp__serena__rename_symbol|mcp__serena__replace_lines|mcp__serena__delete_lines|mcp__serena__insert_at_line'
$Hooks = @(
  # Variant keys are PER PROJECT TYPE (union semantics - a file gets every matching skill):
  #   web/Angular        -> "cs ng sql ts"  (.ts/.js -> typescript; Angular suffixes also -> angular-conventions)
  #   browser extension  -> "ts"            (plain TS/JS, no framework/cs/sql)
  #   Node / TS tooling  -> "ts"            (+ "sql" if hand-written SQL)
  # ts gates bare .ts/.tsx/.js/.jsx/.mjs/.cjs on typescript (must be installed where ts is on).
  #   scss -> angular-styling  (.scss/.css - suffix-triggered, inert where the suffix never occurs)
  #   xaml -> dotnet-wpf       (.xaml - suffix-triggered, inert where the suffix never occurs)
  "require-convention-skill.js::Edit|Write|$SerenaEditors::cs ng sql ts scss xaml"
  'guard-protected-force-push.js::Bash::'         # block force-push to main/master/develop
  'guard-catastrophic-rm.js::Bash::'              # block recursive rm of /, ~, $HOME, or a bare *
  'guard-read-whole-file.js::Read::'              # block whole-file Read of a >100-line source file - locate via serena first
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
  'architecture-analyzer.md'         # analysis phase (opus/xhigh): read-only system-level structure map + change-fit verdict
  'task-analyzer.md'                 # analysis phase (opus/xhigh): read-only deep task analysis - impact, coupling, open questions
  'ci-failure-diagnoser.md'          # analysis phase (opus/xhigh): read-only CI red-run diagnosis via gh - categorize, local repro, route
  'issue-diagnoser.md'               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  'evidence-gatherer.md'             # diagnosis support (sonnet/medium): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  'greenfield-solution-designer.md'  # analysis phase (opus/xhigh): read-only greenfield design - architecture/stack/structure options from a spec
  'cross-stack-contract-designer.md' # analysis phase (opus/xhigh): read-only - freezes the shared backend/frontend contract before the per-stack designers
  'framework-upgrade-planner.md'     # analysis phase (opus/xhigh): read-only - turns a version/deprecation event into an ordered, contracted upgrade plan
  'security-auditor.md'              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  # Per-domain specialist team (5 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
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
)

# (6) Path-scoped rules (claude-code): fetched into .claude/rules/ on BOTH actions - lazy-load on
# matching file reads; conventions stay with the convention-gate hook, rules carry only glob-scoped routing.
$RulesBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/rules'
$ClaudeRules = @(
  'markdown-docs.md'          # markdown-style routing, path-scoped **/*.md
  'dotnet-repair-agents.md'   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  'angular-repair-agents.md'  # Angular repair-loop routing, path-scoped
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
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Write-Host 'npx not found'; return }
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
    if ($LASTEXITCODE -ne 0) { Log "  !! $repo ($Agent) failed - check selectors (npx skills add $repo --list)" }
  }
}

function Install-Plugins {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host 'claude CLI not found'; return }
  foreach ($mp in $ExtraMarketplaces) { try { & claude plugin marketplace add $mp 2>$null } catch {} }
  foreach ($p in $Plugins) {
    # claude-hud is a statusline HUD - force USER scope regardless of $ClaudeScope. A project-scoped
    # install + the global statusline enable mismatch, so every OTHER project warns "plugin not cached".
    $pScope = if ($p -like 'claude-hud@*') { 'user' } else { $ClaudeScope }
    Log "plugin [$pScope]: $p"
    try { & claude plugin install $p --scope $pScope } catch {}   # may prompt to trust on first run
  }
}

function Install-Mcps {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host 'claude CLI not found'; return }
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
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
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

function Set-HookSettings {
  # INSTALL: ensure every hook's PreToolUse block is in settings.json (idempotent).
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
  if ($changed) {
    $data.hooks.PreToolUse = $pre
    try {
      Write-JsonFile $data $settings
      Log '  settings.json: hook block(s) injected'
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
    Log '  settings.json: hooks already wired - unchanged'
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
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host 'claude CLI not found'; return }
  try { & claude plugin marketplace update 2>$null } catch {}   # refresh marketplaces first
  foreach ($p in $Plugins) {
    $pScope = if ($p -like 'claude-hud@*') { 'user' } else { $ClaudeScope }   # claude-hud is user-scope (statusline)
    Log "plugin update [$pScope]: $p"
    try { & claude plugin update $p --scope $pScope } catch {}
  }
}

function Update-Mcps {
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host 'claude CLI not found'; return }
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
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
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
if ($Action -eq 'install') { Install-Skills; Install-Plugins; Install-Mcps; Get-Hooks; Set-HookSettings; Get-Agents; Get-Rules; Repair-SerenaTsLspWindows }
else { Update-Skills; Update-Plugins; Update-Mcps; Update-Hooks; Update-Agents; Update-Rules; Repair-SerenaTsLspWindows }

Remove-AgentsCache
Log "done: $Action ($Scope, agent=$Agent). $($Skills.Count) skills, $($Plugins.Count) plugins, MCPs, hooks=$($Hooks.Count), agents=$($Agents.Count), rules=$($ClaudeRules.Count)."

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
Write-Host ''
Write-Host "Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git\info\exclude):"
Write-Host '  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)'
Write-Host '  .claude          Claude Code project config + local state (settings.local.json, hooks)'
Write-Host '  .slopwatch       dotnet-slopwatch output'
Write-Host '  .playwright      playwright MCP user-data-dir + screenshots'
Write-Host '  .mcp.json        generated MCP server config (machine-local)'
Write-Host '  skill-lock.json  skills CLI lock file'
