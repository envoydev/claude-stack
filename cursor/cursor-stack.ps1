#Requires -Version 5.1
<#
  cursor-stack.ps1 [install|update] [space] [github-cli] - install/update the CURSOR stack FOR A PROJECT (Windows/PowerShell).

  PowerShell port of cursor-stack.sh: every skill / MCP from cursor-stack.html (the complete
  toolset, not a curated subset), installed INTO a project. Built-in/system CLI skills are
  excluded (they ship with the CLI). Claude Code lives in claude-stack.ps1.

  Usage (Windows PowerShell 5.1 or PowerShell 7+), run inside the target project (install == update for Cursor):
    pwsh cursor-stack.ps1 install   # provision Cursor
    pwsh cursor-stack.ps1 update    # refresh skills + the .cursor tree

  SELF-CONTAINED .cursor/: skills copied into .cursor/skills (strict - no dependency on .claude or
  .agents); MCPs into .cursor/mcp.json (memory db under ~/.cursor); hooks into .cursor/hooks.json
  (+ .cursor/hooks/). NEVER calls the claude CLI. Marketplace plugins are UI-only (install them from
  the Cursor UI); their skill / MCP / hook components are provisioned here. The .cs conventions ship as
  a Cursor rule (.cursor/rules/csharp.mdc), not a hook.

  Optional extras: a Space (any word) -> separate memory DB (memory_<Space>.db), omit for the default
  shared DB; -GitHubCli -> install gh via winget if missing. Both agents share ~/.memory-mcp so Claude
  Code and Cursor see the same per-space DB. Cursor is self-contained under ~/.cursor; the space does
  not change that. e.g.: .\cursor-stack.ps1 install work -GitHubCli

  Scope (default PROJECT - installs the full set INTO this repo; $env:SCOPE = 'global' to
  install it into the active account instead):
    project -> skills project-scoped, cursor tree -> <repo>/.cursor/
    global  -> skills -g, cursor tree -> ~/.cursor/

  Windows differences vs cursor-stack.sh:
    - .cursor/mcp.json / .cursor/hooks.json are merged natively (ConvertFrom/To-Json), no python dependency.
    - Cursor does NOT do shell interpolation, so ${CLAUDE_PROJECT_DIR:-.} / ${CLAUDE_CONFIG_DIR} tokens
      are resolved to concrete paths when .cursor/mcp.json is written (see Set-CursorMcps).
    - Cursor hooks (Set-CursorHooks) bake the ABSOLUTE node path into the hooks.json command, because the
      spawned hook process can inherit a stripped PATH where bare `node` is not found (same root cause as
      the statusline fix). Scripts are authored locally - the envoydev hooks speak Claude's contract.
#>
[CmdletBinding()]
param(
  # REQUIRED main action.
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('install', 'update')]
  [string]$Action,
  # Optional space (any word): a separate memory DB (memory_<Space>.db). Omit for the default shared
  # DB. Cursor is self-contained under ~/.cursor; the space does not change that.
  [Parameter(Position = 1)]
  [string]$Space = '',
  # Optional: context7 transport. 'remote' (default) = hosted HTTP server, no local process;
  # 'local' = the local npx stdio server. e.g.: .\cursor-stack.ps1 install -Context7 local
  [ValidateSet('remote', 'local')]
  [string]$Context7 = 'remote',
  # Optional: install the GitHub CLI (gh) via winget if missing; prompts for `gh auth login`
  # when unauthenticated. e.g.: .\cursor-stack.ps1 install -GitHubCli
  [switch]$GitHubCli
)

$ErrorActionPreference = 'Stop'
# Keep NATIVE command failures non-fatal (mirror the .sh `|| true` tolerance); cmdlet errors still throw.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

# A space is any word but becomes part of a path (memory_<Space>.db) - validate it.
if ($Space -and $Space -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
  Write-Host "space name '$Space' must start alphanumeric and contain only [A-Za-z0-9._-]" -ForegroundColor Red
  exit 1
}

function Log([string]$Message) { Write-Host "==> $Message" -ForegroundColor Blue }

function Write-JsonFile([object]$Data, [string]$Path, [int]$Depth = 20) {
  # PowerShell's ConvertTo-Json indents inconsistently and version-dependently (5.1 = 4-space
  # ladders + double-space colons; 7 = deep nested alignment). node's JSON.stringify(_, null, 2)
  # is clean 2-space everywhere, and node is always present (Claude Code requires it). So: write
  # compact via PS, then reformat the file in place with node. Fallback to PS pretty if node is gone.
  $enc = New-Object System.Text.UTF8Encoding($false)
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
  if (-not $ok) { Write-Host '  Install the missing tools above, then re-run.' -ForegroundColor Yellow }
}

$Scope = if ($env:SCOPE) { $env:SCOPE } else { 'project' }

# This script provisions the Cursor agent. (Claude Code lives in claude-stack.ps1.)
$Agent = 'cursor'

# $ConfigDir is for path resolution only (e.g. the memory MCP db) - never exported to any CLI:
# ~/.cursor - so a cursor install has ZERO dependency on .claude or the claude CLI.
$ConfigDir = Join-Path $HOME '.cursor'

# serena's --context is per-agent: Cursor uses the generic ide-assistant context.
$SerenaContext = @{ 'claude-code' = 'claude-code'; 'cursor' = 'ide-assistant' }

if ($Scope -eq 'project') {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $top) { Set-Location -LiteralPath $top }
  $SkillsAddFlag = ''        # npx skills add: project is the default (no -g)
}
else {
  $SkillsAddFlag = '-g'
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

# (3) MCP servers "name|args"; scope follows $Scope. SINGLE-QUOTED so ${...} stays LITERAL ->
#     Claude Code interpolates ${CLAUDE_PROJECT_DIR:-.} at server launch.
#     memory: uses ${HOME_MEMORY_DIR} - a script-local token resolved to $HOME\.memory-mcp at install
#     time for BOTH agents, so Claude Code and Cursor share the same DB. A space (e.g. 'work')
#     switches to a separate per-space DB (memory_<space>.db).
# PERFORMANCE (see cursor-stack.sh for the full rationale): resolve each runtime's LATEST version
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
# .cursor/mcp.json: set CONTEXT7_API_KEY as a user environment variable
# ([Environment]::SetEnvironmentVariable('CONTEXT7_API_KEY',$key,'User') then restart) and Cursor
# expands ${env:CONTEXT7_API_KEY} in the header at launch. Pass -Context7 local for the local stdio
# server - keyless by default too, and $env:CONTEXT7_BAKE_KEY bakes --api-key.
if ($Context7 -eq 'local') {
  $Ctx7Cmd = "$Npx -y @upstash/context7-mcp$Ctx7Pin"
  if ($env:CONTEXT7_BAKE_KEY -and $env:CONTEXT7_API_KEY) { $Ctx7Cmd += ' --api-key ' + $env:CONTEXT7_API_KEY }
  $Ctx7Spec = '-- ' + $Ctx7Cmd
} else {
  $Ctx7Spec = '@HTTP@'
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

# (5) Cursor hooks "filename::event" + rules. Cursor's hook contract (.cursor/hooks.json v1) differs
#     from Claude's settings.json PreToolUse, so these are CURSOR-contract scripts FETCHED from
#     cursor/hooks (NOT the Claude-contract files). The portable Bash guards map over as hooks:
#       - guard-protected-force-push -> beforeShellExecution (reads {command}, returns {permission}).
#       - guard-catastrophic-rm      -> beforeShellExecution (blocks recursive rm of /, ~, $HOME, bare *).
#     Conventions are NOT a hook in either stack: they ship as soft, path-scoped rules (Cursor:
#     .cursor/rules/*.mdc, auto-attaches by glob - guidance, never a block) - see $CursorRules.
$CursorHookBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/hooks'
$CursorRulesBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/rules'
$CursorHooks = @(
  'guard-protected-force-push.js::beforeShellExecution'
  'guard-catastrophic-rm.js::beforeShellExecution'
)
# A rule entry is 'name' (fetched from $CursorRulesBaseUrl) or 'name|url' (fetched from that url -
# e.g. a third-party rule like ponytail, which we reference rather than vendor here).
$CursorRules = @(
  # The per-file-type convention rules - soft, auto-attaching by glob (cs ng sql ts).
  'csharp-conventions.mdc'                    # cs  -> csharp (**/*.cs)
  'typescript-conventions.mdc'                # ts  -> typescript (.ts/.tsx/.js/.jsx/.mjs/.cjs)
  'sql-conventions.mdc'                       # sql -> database-conventions (**/*.sql)
  'angular-conventions.mdc'                   # ng  -> angular-conventions (*.component.ts &c.)
  'wpf-conventions.mdc'                       # xaml -> dotnet-wpf
  'scss-conventions.mdc'                      # scss/css -> angular-styling
  'ponytail.mdc|https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.cursor/rules/ponytail.mdc' # ponytail minimal-code rule (alwaysApply) - fetched from its repo, not vendored
)

# (6) Subagents (cursor): Cursor-native specialist agents fetched into .cursor/agents/ on BOTH actions
# (per-agent fail-soft - an agent not yet upstream keeps any existing local copy). Cursor auto-discovers
# .cursor/agents/*.md; no settings wiring needed. These mirror the four Claude resolver subagents (the
# pipeline agents and all model/effort pins are Claude-only) in Cursor's weaker contract: prompt-only guardrails, no
# per-tool allowlist (only a `readonly` bool) - so the agent bodies lean on the
# auto-attaching .cursor/rules (the same soft convention model both stacks now use).
$CursorAgentBaseUrl = 'https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/agents'
$CursorAgents = @(
  'dotnet-build-error-resolver.md'   # implement phase: dotnet build -> categorize errors -> minimal fix loop (serena/LSP), capped
  'dotnet-test-failure-resolver.md'  # implement phase: dotnet test -> red->green repair loop, anti-reward-hacking guard, capped
  'ng-build-error-resolver.md'       # implement phase: ng build -> minimal fix loop (serena/LSP), capped
  'angular-test-resolver.md'         # implement phase: ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
)

function Get-RepoRoot {
  $r = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $r) { return $r }
  return $null
}

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); the .cursor tree is refreshed
# (mcp.json: install skips an already-present server / update re-writes it; hooks.json / rules skip if already wired)
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

function Set-CursorMcps {
  # Write/merge Cursor's MCP config: <repo>/.cursor/mcp.json (project) or ~/.cursor/mcp.json (global).
  # Cursor does NOT do shell-style ${VAR} interpolation, so resolve those tokens to concrete paths here.
  # Idempotency mirrors the claude path: a plain `install` SKIPS an MCP already in mcp.json (its baked
  # pin stays FROZEN); only `update` re-resolves latest and re-writes the entry (bumps the pin).
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { Log '  !! not in a git repo - skipping cursor mcp.json'; return }
    $mcpPath = Join-Path $root '.cursor/mcp.json'
  }
  else {
    $mcpPath = Join-Path $HOME '.cursor/mcp.json'
  }
  $dir = Split-Path -Parent $mcpPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  $data = if (Test-Path -LiteralPath $mcpPath) { Get-Content -LiteralPath $mcpPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  if (-not $data.PSObject.Properties['mcpServers']) { $data | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }

  $projDir = if ($root) { $root } else { (Get-Location).Path }
  # Cursor is self-contained: resolve ${CLAUDE_CONFIG_DIR} to the cursor home (~/.cursor), NOT .claude,
  # so the memory MCP db lives under .cursor and a cursor install never depends on the .claude tree.
  $cfgDir = $ConfigDir

  foreach ($entry in $Mcps) {
    $parts = $entry.Split('|', 2)
    $name = $parts[0]
    # Skip-if-present on plain install, matching the claude path's `claude mcp get` guard: an MCP already
    # in mcp.json keeps its baked pin (FROZEN until `update` re-resolves and re-writes it). Without this a
    # plain install would re-write the freshly-resolved latest pin and silently bump it.
    if ($Action -eq 'install' -and $data.mcpServers.PSObject.Properties[$name]) {
      Write-Host "  cursor mcp $name already configured - skipping"
      continue
    }
    $spec = $parts[1].Replace('@SERENA_CONTEXT@', $SerenaContext['cursor'])
    $spec = $spec.Replace('${CLAUDE_PROJECT_DIR:-.}', $projDir).Replace('${CLAUDE_CONFIG_DIR}', $cfgDir)
    $spec = $spec.Replace('${HOME_MEMORY_DIR}', (Join-Path $HOME '.memory-mcp'))
    if ($spec -eq '@HTTP@') {
      $ctx7 = [ordered]@{ url = 'https://mcp.context7.com/mcp'; headers = [ordered]@{ CONTEXT7_API_KEY = '${env:CONTEXT7_API_KEY}' } }
      if ($data.mcpServers.PSObject.Properties[$name]) { $data.mcpServers.PSObject.Properties.Remove($name) }
      $data.mcpServers | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]$ctx7)
      Log "  cursor mcp: $name"
      continue
    }
    # ASSUMPTION: no resolved path token ($projDir / $cfgDir / $HOME\.memory-mcp) contains a space.
    # The spec is space-separated by design (-e KEY=VAL -- cmd args); a space inside one token would
    # be mis-parsed below, so project paths with spaces are unsupported.
    $tokens = @($spec.Split(' ') | Where-Object { $_ -ne '' })
    $envMap = [ordered]@{}
    $cmd = $null
    $cmdArgs = @()
    $i = 0
    $afterSep = $false
    while ($i -lt $tokens.Count) {
      $t = $tokens[$i]
      if (-not $afterSep) {
        if ($t -eq '--') { $afterSep = $true; $i++ }
        elseif ($t -eq '-e') { $kv = $tokens[$i + 1].Split('=', 2); $envMap[$kv[0]] = $kv[1]; $i += 2 }
        else { $i++ }   # ignore any other pre-`--` claude-mcp flags (not used by Cursor)
      }
      else {
        if (-not $cmd) { $cmd = $t } else { $cmdArgs += $t }
        $i++
      }
    }
    if (-not $cmd) { continue }
    $server = [ordered]@{ command = $cmd; args = @($cmdArgs) }
    if ($envMap.Count -gt 0) { $server['env'] = $envMap }
    if ($data.mcpServers.PSObject.Properties[$name]) { $data.mcpServers.PSObject.Properties.Remove($name) }
    $data.mcpServers | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]$server)
    Log "  cursor mcp: $name"
  }
  Write-JsonFile $data $mcpPath
  Log "  cursor mcp.json -> $mcpPath"
}

function Copy-CursorSkills {
  # STRICT independence: copy each manifest skill into .cursor/skills as REAL copies so Cursor never
  # depends on .claude/skills or the shared .agents/ store. Source is the npx staging (.agents/skills)
  # with a .claude/skills fallback. Idempotent: an existing destination skill is replaced.
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { Log '  !! not in a git repo - skipping cursor skills'; return }
    $base = $root
  }
  else {
    $base = $HOME
  }
  $dest = Join-Path $base '.cursor/skills'
  $srcRoots = @((Join-Path $base '.agents/skills'), (Join-Path $base '.claude/skills'))
  if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

  $names = @($Skills | ForEach-Object { $_.Split('|', 2)[1] } | Select-Object -Unique)
  $copied = 0
  foreach ($n in $names) {
    $src = $null
    foreach ($r in $srcRoots) { $cand = Join-Path $r $n; if (Test-Path -LiteralPath $cand) { $src = $cand; break } }
    if (-not $src) { Log "  !! cursor skill source missing: $n (install skills first)"; continue }
    $target = Join-Path $dest $n
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
    $copied++
  }
  Log "  cursor skills -> $dest ($copied/$($names.Count) copied)"
}

function Set-CursorHooks {
  # Fetch the CURSOR-contract hook scripts into .cursor/hooks/ and wire .cursor/hooks.json (schema v1).
  # Mirrors the Claude path's Get-Hooks + Set-HookSettings, but from cursor/hooks (Cursor's
  # beforeShellExecution etc. contract). Per-hook fail-soft: a hook not yet upstream keeps any local copy.
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { Log '  !! not in a git repo - skipping cursor hooks'; return }
    $hooksJson = Join-Path $root '.cursor/hooks.json'
    $hooksDir = Join-Path $root '.cursor/hooks'
    $scriptRefPrefix = '.cursor/hooks/'      # project hooks run from the repo root
  }
  else {
    $hooksJson = Join-Path $HOME '.cursor/hooks.json'
    $hooksDir = Join-Path $HOME '.cursor/hooks'
    $scriptRefPrefix = './hooks/'            # user hooks run from ~/.cursor/
  }
  if (-not (Test-Path -LiteralPath $hooksDir)) { New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null }

  # Absolute node path dodges the stripped-PATH problem in spawned hook processes (cf. the statusline fix).
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { 'node' }

  $data = if (Test-Path -LiteralPath $hooksJson) { Get-Content -LiteralPath $hooksJson -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  if (-not $data.PSObject.Properties['version']) { $data | Add-Member -NotePropertyName version -NotePropertyValue 1 }
  if (-not $data.PSObject.Properties['hooks']) { $data | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }

  $changed = $false
  foreach ($entry in $CursorHooks) {
    $p = $entry -split '::', 2
    $file = $p[0]
    $event = $p[1]
    if (-not $event) { continue }
    $dest = Join-Path $hooksDir $file
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri "$CursorHookBaseUrl/$file" -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $dest)) { Log "  !! fetch failed and no local copy: $file - skipping"; continue }
      Log "  !! fetch failed (kept existing copy): $file"
    }
    # Hash-compare-then-skip, matching the Claude path's Get-Hooks: only overwrite when the fetched
    # bytes differ, so an unchanged hook is left untouched (stable mtime, no noisy log).
    if (Test-Path -LiteralPath $tmp) {
      if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
        Remove-Item -LiteralPath $tmp -Force; Log "  cursor hook current: $file"
      }
      else {
        Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  cursor hook fetched -> $file"
      }
    }

    if (-not $data.hooks.PSObject.Properties[$event]) { $data.hooks | Add-Member -NotePropertyName $event -NotePropertyValue @() }
    $arr = @($data.hooks.$event)
    $cmd = '"' + $nodeExe + '" "' + $scriptRefPrefix + $file + '"'
    $have = @(foreach ($h in $arr) { $h.command })
    if ($have -contains $cmd) { continue }
    $arr += [pscustomobject]@{ command = $cmd }
    $data.hooks.$event = $arr
    $changed = $true
  }
  if ($changed) {
    Write-JsonFile $data $hooksJson
    Log "  cursor hooks.json -> $hooksJson"
  }
  else {
    Log '  cursor hooks.json: already wired - unchanged'
  }
}

function Install-CursorRules {
  # Fetch .cursor/rules/*.mdc (soft convention guidance, auto-attached by glob) - e.g. the C# gate analog.
  # Per-rule fail-soft: a rule not yet upstream keeps any existing local copy.
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { Log '  !! not in a git repo - skipping cursor rules'; return }
    $rulesDir = Join-Path $root '.cursor/rules'
  }
  else {
    $rulesDir = Join-Path $HOME '.cursor/rules'
  }
  if (-not (Test-Path -LiteralPath $rulesDir)) { New-Item -ItemType Directory -Path $rulesDir -Force | Out-Null }
  foreach ($entry in $CursorRules) {
    $parts = $entry.Split('|', 2)                    # 'name' -> repo base; 'name|url' -> that url
    $file = $parts[0]
    $url = if ($parts.Count -gt 1) { $parts[1] } else { "$CursorRulesBaseUrl/$file" }
    $dest = Join-Path $rulesDir $file
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $dest)) { Log "  !! fetch failed and no local copy: $file - skipping"; continue }
      Log "  !! fetch failed (kept existing copy): $file"; continue
    }
    Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  cursor rule fetched -> $file"
  }
}

function Install-CursorAgents {
  # Fetch each Cursor subagent .md into .cursor/agents/ (Cursor auto-discovers them - no settings wiring).
  # Mirrors the Claude path's Get-Agents: hash-compare-then-skip + per-agent fail-soft (a fetch failure
  # keeps any existing local copy). Scope follows $Scope like the rules/skills: repo root for project,
  # $HOME for global.
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { Log '  !! not in a git repo - skipping cursor agents'; return }
    $agentsDir = Join-Path $root '.cursor/agents'
  }
  else {
    $agentsDir = Join-Path $HOME '.cursor/agents'
  }
  if (-not (Test-Path -LiteralPath $agentsDir)) { New-Item -ItemType Directory -Path $agentsDir -Force | Out-Null }
  foreach ($file in $CursorAgents) {
    $dest = Join-Path $agentsDir $file
    $tmp = [System.IO.Path]::GetTempFileName()
    try { Invoke-WebRequest -Uri "$CursorAgentBaseUrl/$file" -OutFile $tmp -UseBasicParsing -ErrorAction Stop }
    catch {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $dest)) { Log "  !! fetch failed and no local copy: $file - skipping"; continue }
      Log "  !! fetch failed (kept existing copy): $file"; continue
    }
    if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $tmp).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
      Remove-Item -LiteralPath $tmp -Force; Log "  cursor agent current: $file"
    }
    else {
      Move-Item -LiteralPath $tmp -Destination $dest -Force; Log "  cursor agent fetched -> $file"
    }
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

function Remove-AgentsCache {
  # npx skills stages an agent-neutral .agents/ store. With a STRICT per-agent copy (.cursor/skills is
  # a real copy), nothing reads .agents/ anymore - prune it. Guard: keep it if any skill entry under
  # .cursor/skills is a symlink (a symlinked tree still depends on .agents/; removing it would dangle).
  # BASE must match the copy step (Copy-CursorSkills): repo root for SCOPE=project, $HOME for global -
  # otherwise a global install leaves $HOME\.agents unpruned while we check the wrong (repo) base.
  $root = Get-RepoRoot
  if ($Scope -eq 'project') {
    if (-not $root) { return }
    $base = $root
  }
  else {
    $base = $HOME
  }
  $agents = Join-Path $base '.agents'
  if (-not (Test-Path -LiteralPath $agents)) { return }
  $hasSymlink = $false
  foreach ($d in @((Join-Path $base '.cursor/skills'))) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $sym = [bool](Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
    if ($sym) { $hasSymlink = $true; break }
  }
  if ($hasSymlink) { Log '  kept .agents/ - a skills tree has symlinks that still depend on it' }
  else { Remove-Item -LiteralPath $agents -Recurse -Force -ErrorAction SilentlyContinue; Log '  pruned .agents/ (skills are real per-agent copies)' }
}

# ===========================================================================
# DISPATCH
# ===========================================================================
Test-Prerequisites
Install-GitHubCli

# Cursor path: 100% claude-free. install == update (clean re-add of skills, then refresh the .cursor tree).
if ($Action -eq 'install') { Install-Skills } else { Update-Skills }
Copy-CursorSkills
Set-CursorMcps
Set-CursorHooks
Install-CursorRules
Install-CursorAgents
Log 'plugins: Cursor marketplace plugins are UI-only - install them from the Cursor UI; their skill / mcp / hook components are provisioned here (+ .cursor/rules).'

Remove-AgentsCache
Log "done: $Action ($Scope, agent=$Agent). $($Skills.Count) skills, MCPs, cursor-hooks=$($CursorHooks.Count), rules=$($CursorRules.Count), agents=$($CursorAgents.Count)."

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
Write-Host ''
Write-Host "Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git\info\exclude):"
Write-Host '  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)'
Write-Host '  .cursor          Cursor stack: skills + mcp.json + hooks.json + hook scripts + rules'
Write-Host '  .slopwatch       dotnet-slopwatch output'
Write-Host '  .playwright      playwright MCP user-data-dir + screenshots'
Write-Host '  skill-lock.json  skills CLI lock file'
