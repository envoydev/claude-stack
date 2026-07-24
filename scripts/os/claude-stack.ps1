#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update the Claude Code stack (skills, plugins, MCPs, hooks, agents, rules) into a project.

.DESCRIPTION
  PowerShell port of claude-stack.sh: every skill / plugin / MCP from claude-stack.html (the complete
  toolset, not a curated subset), installed INTO a project. Built-in/system CLI skills are excluded
  (they ship with the CLI). Requires the `claude` CLI; claude-only steps fail soft if it is absent.
  The Cursor stack lives in the cursor-stack repo.

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

.PARAMETER KeepPins
  Keep this project's LOCAL model/effort frontmatter edits on installed agents (.claude/agents) and
  skills (SKILL.md) across the refresh - the local value is re-applied after the fetch/reinstall
  (which otherwise resets it to upstream). Only existing keys are re-applied; with the switch on, a
  local pin edit always wins over an upstream pin change.

.PARAMETER Selection
  Install ONLY the skills/plugins/mcps/agents/rules/hooks named in <file> (one 'category name' per
  line); a selection with no 'hook' lines installs all hooks.

.PARAMETER PrintPlan
  With -Selection, print the resolved per-category install set and exit (dry run).

.PARAMETER SkillsOnly
  Run only the skill install/update step, then exit (testability; skips prerequisites/plugins/mcps/
  hooks/agents/rules).

.PARAMETER Source
  Install FROM an existing claude-stack checkout instead of cloning one. The caller owns the
  directory - this script never deletes it. Used by the /claude-stack setup+configure skills, which
  clone once and pass it here so a guided run takes one clone, not two. Omit it and the script
  clones its own source (and removes it on exit) - the standalone path.

.NOTES
  Environment variables:
    SCOPE=project|global  fallback for -Scope when the flag is absent (default project).
    CLAUDE_CONFIG_DIR     target a specific account when no -Space is given (default ~/.claude).
    STACK_SKILLS_REPO     stack source repo (release-archive download, git-clone fallback; default https://github.com/envoydev/claude-stack).
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
  [switch]$GitHubCli,
  # Optional: keep local model/effort frontmatter edits on installed agents/skills across the
  # refresh (an update resets them to upstream otherwise). e.g.: .\claude-stack.ps1 update -KeepPins
  [switch]$KeepPins,
  # Optional: install ONLY the skills/plugins/mcps/agents/rules named in <file> (one 'category name'
  # per line; hooks always install). e.g.: .\claude-stack.ps1 install -Selection selection.txt
  [string]$Selection = '',
  # Optional: with -Selection, print the resolved per-category install set and exit (dry run).
  [switch]$PrintPlan,
  # Optional: run only the skill install/update step, then exit (testability; skips prerequisites/
  # plugins/mcps/hooks/agents/rules). e.g.: .\claude-stack.ps1 install -SkillsOnly -Scope project
  [switch]$SkillsOnly,
  # Optional: install FROM an existing claude-stack checkout instead of cloning one. The caller owns
  # <dir> - this script never deletes it. e.g.: .\claude-stack.ps1 install -Source C:\tmp\repo
  [string]$Source = ''
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

# This script provisions the Claude Code agent. (The Cursor stack lives in the cursor-stack repo.)
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

$SerenaContext = 'claude-code'   # serena's --context for Claude Code

if ($Scope -eq 'project') {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $top) { Set-Location -LiteralPath $top }
  $ClaudeScope = 'project'
}
else {
  $ClaudeScope = 'user'
}

# ===========================================================================
# MANIFEST - edit these, then run.
# ===========================================================================

# (1) Skills "repo|skill" (comment a line to skip). Full inventory - every skill (75).
$Skills = @(
  # House (envoydev/claude-stack)
  'envoydev/claude-stack|create-ticket'             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  'envoydev/claude-stack|dev-log-convert'           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  'envoydev/claude-stack|explain-code-tutor'        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  'envoydev/claude-stack|project-quality-loop'             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  'envoydev/claude-stack|project-architecture-quality-loop'        # deliberate analyze-assess-improve loop - the project-architecture-analyzer capture writes ARCHITECTURE.md + ASSESSMENT.md, fix cons by tier, reconcile docs; manual /-only
  'envoydev/claude-stack|project-code-style-analyzer'    # deliberate code-style capture - fans out code-style-analyzer per language, merges docs/PROJECT-CODE-STYLE.md, generates + wires the inject-code-style hook; manual /-only
  'envoydev/claude-stack|project-architecture-analyzer'  # deliberate architecture capture - dispatches code-analyzer per module, reasons in the main session, writes docs/architecture/ARCHITECTURE.md + ASSESSMENT.md + the generated awareness rule baseline-project-architecture.md; manual /-only
  'envoydev/claude-stack|project-test-coverage-analyzer' # deliberate coverage capture - detect tooling per surface, instrumented run ONCE per surface in the main session, writes docs/test-coverage/COVERAGE.md (90% line after exclusions default, tiered weak points) + raw/ machine-readable results; manual /-only (the loop Read-loads it)
  'envoydev/claude-stack|project-test-coverage-loop'     # deliberate coverage analyze-triage-fix loop - runs the capture, works weak points by tier (tests inline/implementer briefs, testability refactors approval-gated, structural = user decision), reconciles docs; manual /-only
  'envoydev/claude-stack|project-version-upgrade'        # deliberate BREAKING version-event flow (framework/runtime/package major) - plan in-session via context7 + code-analyzer digests, approval gate (auto mode only on explicit user ask), staged execution via implementers + resolvers; manual /-only
  'envoydev/claude-stack|project-agent-capabilities'           # deliberate capabilities capture - inventories installed skills/agents/MCPs/plugins, generates the awareness rule baseline-project-agent-capabilities.md; manual /-only
  'envoydev/claude-stack|project-related-context'        # deliberate related-projects capture - args paths/URLs, fans out related-project-analyzer per sibling, writes the awareness rule baseline-project-related-context.md + docs/PROJECT-RELATED-CONTEXT.md; manual /-only
  'envoydev/claude-stack|project-build-from-scratch' # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  'envoydev/claude-stack|project-solve-cross-task'    # entry-point router: classify -> smallest execution mode -> cross-domain contract freeze + integration gate; home of the shared subagent policies
  'envoydev/claude-stack|project-verify-plan'      # audit an implementation plan BEFORE building - risk-coverage review (traps named per the stack skill, scope, edges, minimal); precedes /code-review
  'envoydev/claude-stack|project-verify-code'     # single-chat, no-dispatch review of an assembled build - the inline alternative to /code-review: rerun build/test, gate vs plan, RUN the app on failable inputs, trace wire-contract changes to consumers, ranked punch-list
  'envoydev/claude-stack|project-implementer'              # single-chat build step: execute a verified plan task-by-task (contracts + per-task green gate + inline red-resolution, no dispatch), finish via /code-review + the done-gate
  'envoydev/claude-stack|project-solution-design'  # single-chat designer twin: read the architecture, judge where a change fits (extend/refactor/isolate), load the stack skill for traps, decompose into an ordered plan; feeds project-verify-plan
  'envoydev/claude-stack|project-solve-task'       # gated single-chat vertical: design -> plan audit -> user approval + build mode -> build -> build review (skippable: project-verify-code inline or the verifier seat) -> done-gate; hard user stop between steps, plan-file + serena-note state survives compaction
  'envoydev/claude-stack|project-failure-signatures' # single-chat diagnoser twin: local-runtime crash signatures (null-ref/DI/deadlock/disposed/config-drift/boundary/HTTP-status) -> where to isolate each; pairs with systematic-debugging
  'envoydev/claude-stack|project-ci-failure-signatures'        # single-chat CI-diagnoser twin: red-pipeline signatures (compile/restore, green-locally-red-on-runner, quality-gate, signing/release, workflow-config, infra-flake) -> code-vs-environment call + route; pairs with project-failure-signatures
  'envoydev/claude-stack|project-stack-usage-analyzer' # token/tool usage audit of stack skill runs: transcript hunt -> analyze-usage.js per session -> per-session report + raw data under <docs-path>/claude-stack-usage-report/
  'envoydev/claude-stack|devops'           # DevOps for the .NET/Angular house: Docker multi-stage/digest-pinned/non-root, GitHub Actions CI/CD, safe expand-contract deploys, secrets/OIDC, Aspire AppHost
  'envoydev/claude-stack|database-conventions' # cross-engine DB conventions + per-engine skill routing
  'envoydev/claude-stack|database-security'    # SQL/data-layer security: parameterized-only injection, least-privilege DB accounts, row-level security, connection-string secrets, encryption, audit
  'envoydev/claude-stack|typescript'       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  'envoydev/claude-stack|javascript'       # base JS-family language layer: ESM modules, async discipline, two failure channels, modern-feature adoption, untrusted input, naming; typescript stacks on it
  'envoydev/claude-stack|npm'                 # professional npm: lockfile+ci discipline, supply-chain baseline (ignore-scripts/cooldown/allow-git), audit gating, overrides vs legacy-peer-deps, exports maps + ESM-first publishing, update-bot cooldowns
  'envoydev/claude-stack|browser-extension'    # MV3 browser extensions: ephemeral service worker + storage tiers, typed cross-context messaging, isolated vs MAIN world, least-privilege permissions, CSP-safe UI, WXT tooling, store review + monetization
  'envoydev/claude-stack|webpack'             # webpack 5 library builds: transpile/type-check split (swc + fork-ts-checker + tsc declarations), externals from package.json, tree-shaking preconditions, ESM output state, resolution traps, config factory + cache pitfalls
  'envoydev/claude-stack|angular-conventions' # Angular 17+/TS house conventions (signals, OnPush, a11y)
  'envoydev/claude-stack|angular-material'   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  'envoydev/claude-stack|angular-styling'    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  'envoydev/claude-stack|angular-security'   # Angular/web frontend security: XSS/DomSanitizer bypass, CSP, CSRF, no-secrets-in-bundle, token storage, SSR/TransferState
  'envoydev/claude-stack|frontend'         # web frontend router: Angular/TS + in-skill design-quality guidance -> mobile
  'envoydev/claude-stack|mobile'           # Ionic/Capacitor router/index over the Angular (angular-conventions) + TypeScript baselines
  'envoydev/claude-stack|ionic'            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  'envoydev/claude-stack|capacitor-release' # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  'envoydev/claude-stack|ionic-security'   # Ionic/Capacitor mobile security: Keychain/Keystore storage, deep-link validation, permissions, cleartext/WebView hardening
  'envoydev/claude-stack|csharp'           # C# house conventions - style, naming, async, logging, DI
  'envoydev/claude-stack|csharp-design-patterns' # all 23 GoF patterns with modern .NET 8+ forms
  'envoydev/claude-stack|dotnet'           # router mapping .NET work areas to specialist skills
  'envoydev/claude-stack|dotnet-architecture-tests' # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  'envoydev/claude-stack|dotnet-aspire'    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  'envoydev/claude-stack|dotnet-authentication' # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  'envoydev/claude-stack|dotnet-code-quality' # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
  'envoydev/claude-stack|dotnet-console-apps' # console-app interface surface: CLI arg parsing (System.CommandLine 2.0/Spectre.Console.Cli/Cocona) + bot-SDK integration (Telegram/Discord/Slack/exchange) in a BackgroundService
  'envoydev/claude-stack|dotnet-cryptography' # System.Security.Cryptography: SHA-2, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare
  'envoydev/claude-stack|dotnet-web-error-handling' # Result + ProblemDetails (RFC 9457) + IExceptionHandler + FluentValidation
  'envoydev/claude-stack|dotnet-grpc'      # gRPC: .proto/codegen, ASP.NET Core host, 4 streaming modes, JWT/mTLS, interceptors, health
  'envoydev/claude-stack|dotnet-hosted-services' # worker/background-service host: BackgroundService, ExecuteAsync trap, scoped scope, PeriodicTimer, shutdown, Channels
  'envoydev/claude-stack|dotnet-windows-service' # Windows Service SCM layer: AddWindowsService, budgets, non-zero-exit recovery, sc.exe install, gMSA/hardening, ServiceBase maintenance
  'envoydev/claude-stack|dotnet-messaging' # event-driven messaging: Wolverine (MIT)/MassTransit, outbox, sagas, RabbitMQ/Azure SB
  'envoydev/claude-stack|dotnet-migrate'   # safe migration workflow: EF schema, .NET upgrades, NuGet - rollback + verify per step
  'envoydev/claude-stack|dotnet-minimal-api' # minimal API endpoint mechanics: MapGroup, TypedResults, endpoint filters, binding
  'envoydev/claude-stack|dotnet-mvc-controllers' # controller-based Web API: [ApiController], attribute routing, ActionResult<T>, auto-400 filter, action filters, binding
  'envoydev/claude-stack|dotnet-openapi'   # OpenAPI doc (Swashbuckle / built-in .NET 9+) + Scalar docs UI
  'envoydev/claude-stack|dotnet-realtime'  # SignalR real-time: strongly-typed Hub<T>, IHubContext push, groups/presence, reconnection, JWT-over-querystring, Redis/Azure backplane
  'envoydev/claude-stack|dotnet-security'  # OWASP Top 10 (2021) -> .NET 8 mitigations; deprecated-pattern warnings
  'envoydev/claude-stack|dotnet-source-generators' # Roslyn IIncrementalGenerator authoring + built-in generators (GeneratedRegex/LoggerMessage/STJ)
  'envoydev/claude-stack|dotnet-testing'   # .NET test strategy: AAA, per-layer coverage, library routing
  'envoydev/claude-stack|dotnet-web-backend' # ASP.NET Core cross-cutting: HttpClientFactory, OpenAPI, observability
  'envoydev/claude-stack|dotnet-winforms'  # WinForms conventions: MVP/binding, disposal, GDI leaks, high-DPI, migration
  'envoydev/claude-stack|dotnet-wpf'       # WPF strict-MVVM conventions, bindings, virtualization
  'envoydev/claude-stack|postgres'         # PostgreSQL engine delta: index types, JSONB, SARGability, EXPLAIN, pooling
  'envoydev/claude-stack|sqlite'           # SQLite engine delta: WAL/single-writer, PRAGMAs, type affinity, limited ALTER
  'envoydev/claude-stack|dotnet-data-access' # EF Core + NHibernate ORM hub (references/): DbContext, tracking, N+1, projection
  'envoydev/claude-stack|dotnet-architecture' # architecture decision hub (references/): clean/ddd/vsa/modular/microservices
  'envoydev/claude-stack|markdown-style' # Markdown authoring / review: syntax canon (valid) + house style overlay, two-pass procedure
  'envoydev/claude-stack|docs-as-code' # docs-as-code authoring: Mermaid sequence/ER diagrams, ADRs (Nygard/MADR 4), C4 views - per-type references/
  'envoydev/claude-stack|ilspy-decompile' # decompile a .NET assembly (ilspycmd via dnx) to read real API/behavior - framework internals, NuGet source, pre-upgrade checks
  'envoydev/claude-stack|dotnet-project-setup' # .NET solution build spine (hub, references/): src/tests layout, .slnx, Directory.Build.props, global.json, central package management, dotnet-tool pinning
  'envoydev/claude-stack|dotnet-performance' # perf-aware .NET design (hub, references/): allocation/type design (struct vs class, Span, ValueTask) + serialization-format choice (STJ source-gen / Protobuf / MessagePack)
  'envoydev/claude-stack|dotnet-diagnostics' # measure/diagnose a live .NET process (hub, references/): BenchmarkDotNet microbenchmarks + crash/hang/OOM dump capture & first-look SOS analysis
  'envoydev/claude-stack|nx'               # Nx monorepo: project-graph nav + 'nx affected' scoping, generators, module-boundary tags; CLI over MCP; serena-vs-nx routing
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
#     time (a fixed home path, so a Cursor install on the same machine shares the same DB). A space
#     (e.g. 'work') switches to a separate per-space DB (memory_<space>.db).
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
# Non-Windows (pwsh on mac/Linux) keeps bare npx. $IsWindows is $null on PS 5.1 Desktop -> Windows.
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

# sentry runs REMOTE only (the hosted MCP at mcp.sentry.dev) - no local process, no pin to resolve;
# put SENTRY_ACCESS_TOKEN in settings.json "env" and Claude Code expands the Authorization header at launch.
$SentryRemoteUrl = 'https://mcp.sentry.dev/mcp'
$SentryRemoteHdr = 'Authorization: Bearer ${SENTRY_ACCESS_TOKEN}'
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
$SentryEntry     = 'sentry|@HTTP@'

$Mcps = @(
  $AngularCliEntry                            # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  $SerenaEntry                                # LSP symbol navigation; PyPI-pinned (not git), dashboard off
  $PlaywrightEntry                            # drive a real browser for visual checks / web app verification
  'chrome-devtools|-- cmd /c npx chrome-devtools-mcp@latest' # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads; pin a version
  'appium-mcp|-- cmd /c npx -y appium-mcp@latest' # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects; pin a version
  $SentryEntry  # OPT-IN Sentry error monitoring - hosted remote MCP (mcp.sentry.dev); the Authorization header keeps ${SENTRY_ACCESS_TOKEN} LITERAL, expanded at launch from settings.json "env"; comment out where the project has no Sentry
  $MemoryEntry  # memory: cross-project recall - the subagent handoff runs on serena; comment out in a standalone project
  $Context7Entry                              # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (4) PreToolUse hooks: fetched into the repo from envoydev/claude-stack/claude/hooks on BOTH actions
#     (per-hook fail-soft - a hook not yet upstream keeps its committed repo copy); INSTALL
#     also wires each into settings.json. UPDATE refreshes files only (never settings).
#     Each entry: "filename::matcher::args" - args (if any) are appended to the hook command.
#     Windows note: the .js has no shebang/exec bit here, so it is invoked via `node`.
#     $CLAUDE_PROJECT_DIR is substituted by Claude Code; if your Windows build needs
#     %CLAUDE_PROJECT_DIR% instead, change that one token in Set-HookSettings below.
$Hooks = @(
  'guard-protected-force-push.js::Bash::'         # block force-push to main/master/develop
  'guard-catastrophic-rm.js::Bash::'              # block recursive rm of /, ~, $HOME, or a bare *
  'guard-read-whole-file.js::Read::'              # block whole-file Read of a >100-line source file - locate via serena first
  'guard-unapproved-dispatch.js::Task|Agent::'    # block *-implementer dispatch without the docs-root flow/APPROVAL gate file (APPROVED/AUTO)
  'instrument-tool-usage.js::'                    # fetched, NOT wired (empty matcher): opt-in tool-usage stats - wire PreToolUse '.*' + STACK_INSTRUMENT=1 for a measured run (see README)
)

# settings.json permissions.deny (claude-code): hard-block Read of secret-bearing files. Wired into
# .claude/settings.json alongside the hooks on INSTALL (idempotent, union-merged - a consuming project's
# own deny entries are preserved). Bare globs match at any depth (gitignore semantics), and Claude Code
# applies a Read() deny to recognized Bash reads too (cat/head/tail/sed) - not to arbitrary subprocesses.
# Stack-specific secret/config globs stay a per-project addition (the CLAUDE.md template's authoring
# outline prompts the fill-in; baseline-security.md keeps the behavioral rule).
# The settings.json deny-list is a Claude Code feature (no equivalent elsewhere).
$SecretDeny = @(
  'Read(.env)'
  'Read(.env.*)'
  'Read(*.pem)'
  'Read(*.pfx)'
  'Read(*.p12)'
  'Read(*.key)'
)

# (5) Subagents (claude-code): specialist agents copied into .claude/agents/ from the run's source
# clone (agents/) on BOTH actions (per-agent fail-soft). Claude Code auto-discovers
# .claude/agents/*.md; no settings.json wiring. (Cursor's twins of these live in the cursor-stack repo.)
$Agents = @(
  'dotnet-build-error-resolver.md'   # implement phase (sonnet/high): dotnet build -> minimal fix loop (serena/csharp-lsp), capped
  'dotnet-test-failure-resolver.md'  # implement phase (sonnet/high): dotnet test -> red->green repair loop, anti-reward-hacking, capped
  'ng-build-error-resolver.md'       # implement phase (sonnet/high): ng build -> minimal fix loop (serena/LSP), capped
  'angular-test-resolver.md'         # implement phase (sonnet/high): ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
  'code-analyzer.md'                 # analysis support (sonnet/low): read-only per-module characterizer (purpose/surface/deps/patterns/smells) - the architecture + test-coverage captures fan it out, also independently callable
  'code-style-analyzer.md'                # analysis phase (sonnet/medium): read-only per-language style characterizer - the project-code-style-analyzer skill fans it out per language and merges docs/PROJECT-CODE-STYLE.md + the inject-code-style hook from its structured reports
  'related-project-analyzer.md'           # analysis support (sonnet/medium): read-only sibling-repo characterizer (name/relation/first_read/seam, URL siblings shallow-cloned to scratch) - the project-related-context skill fans it out per sibling and merges docs/PROJECT-RELATED-CONTEXT.md
  'ci-failure-diagnoser.md'          # analysis phase (opus/high): read-only CI red-run diagnosis via gh - categorize, local repro, route
  'issue-diagnoser.md'               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  'evidence-gatherer.md'             # diagnosis support (sonnet/low): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  'security-auditor.md'              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  'integration-reviewer.md'          # final gate (opus/xhigh): read-only cross-domain integration review - contract consistency, assembled build/test/migration, the commit gate no single-stack verifier is
  # Per-domain specialist team (10 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
  'aspnet-solution-designer.md'      # design phase (opus/xhigh): ASP.NET Core architecture + plan + test strategy, decomposes into parallel tasks
  'aspnet-implementer.md'            # build phase (sonnet/medium): builds one ASP.NET task - code + tests
  'aspnet-verifier.md'               # verify phase (sonnet/xhigh): gates the ASP.NET build vs plan + quality, punch-list back
  'web-angular-solution-designer.md'     # design phase (opus/xhigh): Angular architecture + plan + test strategy, decomposes
  'web-angular-implementer.md'           # build phase (sonnet/medium): builds one Angular task - code + tests
  'web-angular-verifier.md'              # verify phase (sonnet/xhigh): gates the Angular build vs plan + quality
  'wpf-solution-designer.md'         # design phase (opus/xhigh): WPF strict-MVVM architecture + plan + test strategy, decomposes
  'wpf-implementer.md'               # build phase (sonnet/medium): builds one WPF task - code + tests
  'wpf-verifier.md'                  # verify phase (sonnet/xhigh): gates the WPF build vs plan + quality
  'console-solution-designer.md'     # design phase (opus/xhigh): headless .NET (Generic Host worker/bot/daemon/CLI) architecture + plan + test strategy, decomposes
  'console-implementer.md'           # build phase (sonnet/medium): builds one console/worker task - code + tests
  'console-verifier.md'              # verify phase (sonnet/xhigh): gates the console/worker build vs plan + quality
  'ionic-angular-solution-designer.md'      # design phase (opus/xhigh): Ionic/Capacitor architecture + plan + test strategy, decomposes
  'ionic-angular-implementer.md'            # build phase (sonnet/medium): builds one mobile task - code + tests
  'ionic-angular-verifier.md'               # verify phase (sonnet/xhigh): gates the mobile build vs plan + quality
  'data-solution-designer.md'        # design phase (opus/xhigh): schema/data-model architecture + plan + test strategy, decomposes
  'data-implementer.md'              # build phase (sonnet/medium): builds one data task - SQL + migration tests
  'data-verifier.md'                 # verify phase (sonnet/xhigh): gates the data build vs plan + quality
  'devops-solution-designer.md'      # design phase (opus/xhigh): Docker/CI/CD/deploy architecture + plan + validation strategy, decomposes
  'devops-implementer.md'            # build phase (sonnet/medium): builds one devops task - Dockerfile/workflow/deploy + local validation
  'devops-verifier.md'               # verify phase (sonnet/xhigh): gates the devops build vs plan + quality
  'browser-extension-solution-designer.md' # design phase (opus/xhigh): MV3 extension architecture (SW/content/UI topology, message contract, permissions) + plan + test strategy, decomposes
  'browser-extension-implementer.md' # build phase (sonnet/medium): builds one extension task - code + tests
  'browser-extension-verifier.md'    # verify phase (sonnet/xhigh): gates the extension build vs plan + quality
  'windows-service-solution-designer.md' # design phase (opus/xhigh): SCM recovery/budget/identity topology + plan + test strategy, decomposes
  'windows-service-implementer.md' # build phase (sonnet/medium): builds one Windows Service task - code + tests
  'windows-service-verifier.md' # verify phase (sonnet/xhigh): gates the Windows Service build vs plan + quality
  'winforms-solution-designer.md'    # design phase (opus/xhigh): WinForms MVP seam / binding / disposal topology + plan + test strategy, decomposes
  'winforms-implementer.md'          # build phase (sonnet/medium): builds one WinForms task - code + tests
  'winforms-verifier.md'             # verify phase (sonnet/xhigh): gates the WinForms build vs plan + quality
)

# (6) Path-scoped rules (claude-code): fetched into .claude/rules/ on BOTH actions - lazy-load on
# matching file reads; conventions stay with the convention-gate hook, rules carry only glob-scoped routing.
# NOTE: baseline-project-related-context.md, baseline-project-architecture.md and
# baseline-project-agent-capabilities.md are GENERATED per-project (by /project-related-context,
# /project-architecture-analyzer and /project-agent-capabilities) - NEVER add those names to this
# manifest (the copy would overwrite the generated copies); nothing prunes the rules dir, so
# they survive update.
$ClaudeRules = @(
  # Always-on baseline (no paths) - loads every session like CLAUDE.md; one job per file, comment out what a project doesn't want.
  'baseline-interaction.md'    # communication + evaluating-proposals + planning (merged by exclusion affinity)
  'baseline-quality-gates.md'  # code-quality + definition-of-done (merged by exclusion affinity)
  'baseline-security.md'
  'baseline-git.md'
  'baseline-navigation.md'
  'baseline-docs-root.md'      # generated-docs root resolution (CLAUDE_DOCS_PATH)
  # Path-scoped routing
  'markdown-docs.md'          # markdown-style routing, path-scoped **/*.md
  'javascript-conventions.md'  # JS-family conventions, path-scoped js/jsx/mjs/cjs
  'dotnet-repair-agents.md'   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  'angular-repair-agents.md'  # Angular repair-loop routing, path-scoped
  # Convention rules (soft, glob auto-attach) - each points ONE file family at its house-style skill; replaced the require-convention-skill hard gate.
  'typescript-conventions.md' # ts/js family -> typescript (framework-agnostic baseline)
  'angular-conventions.md'    # Angular file shapes -> angular-conventions (Angular/Ionic projects only)
  'angular-styling-conventions.md' # scss/css -> angular-styling (Angular/Ionic projects only)
  'csharp-conventions.md'     # c#: .cs -> csharp (backend, desktop, console)
  'wpf-conventions.md'        # wpf: .xaml -> dotnet-wpf
  'winforms-conventions.md'   # winforms: .Designer.cs -> dotnet-winforms
  'sql-conventions.md'        # sql: .sql -> database-conventions
  'devops-conventions.md'     # rest (devops): Dockerfile/compose/workflow -> devops
)

# --- Selection subset filter (Component B twin of claude-stack.sh) --------
# With -Selection <file>, keep only the entries whose name appears in the file
# (one 'category name' per line; '#' comments and blank lines ignored). Hooks
# are never filtered. -PrintPlan prints the resolved set and exits (dry run).
if ($Selection) {
  if (-not (Test-Path $Selection)) { Write-Host "selection file not found: $Selection" -ForegroundColor Red; exit 1 }
  $sel = @{}
  foreach ($line in Get-Content $Selection) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $p = $t -split '\s+', 2
    if ($p.Count -eq 2) { $sel["$($p[0]) $($p[1])"] = $true }
  }
  $SelHas = { param($cat, $name) $sel.ContainsKey("$cat $name") }

  $Skills      = @($Skills      | Where-Object { & $SelHas 'skill'  (($_ -replace '^[^|]*\|', '')) })
  $Plugins     = @($Plugins     | Where-Object { & $SelHas 'plugin' (($_ -split '@', 2)[0]) })
  $Mcps        = @($Mcps        | Where-Object { & $SelHas 'mcp'    (($_ -split '\|', 2)[0]) })
  $Agents      = @($Agents      | Where-Object { & $SelHas 'agent'  ((($_ -split '::', 2)[0]) -replace '\.md$', '') })
  $ClaudeRules = @($ClaudeRules | Where-Object { & $SelHas 'rule'   ((($_ -split '::', 2)[0]) -replace '\.md$', '') })
  # Hooks joined the selection with the guided walk's hooks layer. A selection with no
  # 'hook' lines predates that layer - keep its install-every-hook behavior unchanged.
  if (@($sel.Keys | Where-Object { $_.StartsWith('hook ') }).Count -gt 0) {
    $Hooks     = @($Hooks       | Where-Object { & $SelHas 'hook'   ((($_ -split '::', 2)[0]) -replace '\.js$', '') })
  }
}

if ($PrintPlan) {
  'plan skills:'  + (($Skills      | ForEach-Object { ' ' + ($_ -replace '^[^|]*\|', '') }) -join '')
  'plan plugins:' + (($Plugins     | ForEach-Object { ' ' + ($_ -split '@', 2)[0] }) -join '')
  'plan mcps:'    + (($Mcps        | ForEach-Object { ' ' + ($_ -split '\|', 2)[0] }) -join '')
  'plan agents:'  + (($Agents      | ForEach-Object { ' ' + ((($_ -split '::', 2)[0]) -replace '\.md$', '') }) -join '')
  'plan rules:'   + (($ClaudeRules | ForEach-Object { ' ' + ((($_ -split '::', 2)[0]) -replace '\.md$', '') }) -join '')
  'plan hooks:'   + (($Hooks       | ForEach-Object { ' ' + ((($_ -split '::', 2)[0]) -replace '\.js$', '') }) -join '')
  exit 0
}

function Get-RepoRoot {
  $r = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $r) { return $r }
  return $null
}

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); MCPs and plugins SKIP if already present
# ===========================================================================
function Get-SkillsDest {
  # Scope-resolved skill destination, matching the .sh twin's `case "$CLAUDE_SCOPE"` inline check.
  if ($ClaudeScope -eq 'user') { return (Join-Path $ConfigDir 'skills') }
  return (Join-Path (Get-Location).Path '.claude\skills')
}

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
#   - CHEAP. One download replaces ~50 round trips (the Hooks + Agents + ClaudeRules arrays).
# Fail-soft, like the fetches were: no source (archive AND clone failed) means callers keep the
# copies already on disk and the run carries on. $StackSha stays empty, which is what suppresses
# the stamp write.
#
# -Source <dir> hands in a source the CALLER already fetched (an extracted release archive or a
# git checkout). That is the plugin path: the setup / configure skills must download anyway (they
# need stack-select.js, stack-graph.json, the CLAUDE.md template and the stamp diff before the
# install runs), so they pass that same source here and the guided run costs ONE download instead
# of two. A caller-provided dir is borrowed, never deleted. Standalone (no -Source) is
# unchanged: the script fetches its own source and cleans it up.
$StackRepoUrl = if ($env:STACK_SKILLS_REPO) { $env:STACK_SKILLS_REPO } else { 'https://github.com/envoydev/claude-stack' }
$script:StackSrc = ''          # the source worktree; empty until Get-StackSrc runs
$script:StackSha = ''          # the exact commit every artifact this run installs was copied from
$script:StackRef = ''          # the branch that commit is the tip of (whatever the source's HEAD is)
$script:StackSrcTried = $false # memoises the OUTCOME, so a dead source costs one fetch attempt, not one per caller
$script:StackSrcOwned = $false # true only when WE fetched it - Remove-StackSrc removes ours, never the caller's
$script:StackSrcRoot = ''      # the temp dir an owned fetch lives in (Remove-StackSrc's removal target)

function Read-ReleaseSource {
  # An extracted release archive carries its revision in RELEASE-SOURCE (the workflow writes it).
  param([string]$Dir)
  $file = Join-Path $Dir 'RELEASE-SOURCE'
  if (-not (Test-Path -LiteralPath $file)) { return }
  $lines = Get-Content -LiteralPath $file
  $script:StackSha = (($lines | Where-Object { $_ -match '^sha: ' } | Select-Object -First 1) -replace '^sha: ', '')
  $script:StackRef = (($lines | Where-Object { $_ -match '^ref: ' } | Select-Object -First 1) -replace '^ref: ', '')
}

function Get-StackSrc {
  # Resolves on the first call; every later caller reuses the worktree. Returns $false (never throws)
  # when the source is unavailable, so each caller applies its own fail-soft.
  # Memoise BOTH outcomes: five steps call this, and without the failure latch an offline run
  # would pay five download timeouts and report five failures for one root cause.
  if ($script:StackSrc) { return $true }
  if ($script:StackSrcTried) { return $false }
  $script:StackSrcTried = $true
  $hasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)

  if ($Source) {
    # Borrowed source. Sanity-check it IS the stack (a wrong -Source would otherwise 'install'
    # nothing and report 117 per-file failures), then read its revision: a git checkout carries
    # it in HEAD, an extracted release archive in its RELEASE-SOURCE file.
    if (-not ((Test-Path -LiteralPath (Join-Path $Source 'stack/skills') -PathType Container) -and
              (Test-Path -LiteralPath (Join-Path $Source 'stack/agents') -PathType Container))) {
      Add-Failure "-Source '$Source' is not a claude-stack checkout (no skills/ + agents/) - stack source unavailable"
      return $false
    }
    $script:StackSrc = $Source
    $script:StackSrcOwned = $false
    if ($hasGit) {
      $script:StackSha = (& git -C $Source rev-parse HEAD 2>$null)
      $script:StackRef = (& git -C $Source rev-parse --abbrev-ref HEAD 2>$null)
    }
    if ($script:StackSha) {
      # Stamp the URL the caller actually cloned from, not our default - they may have used a fork.
      $originUrl = (& git -C $Source remote get-url origin 2>$null)
      if ($originUrl) { $script:StackRepoUrl = $originUrl }
    } else { Read-ReleaseSource -Dir $Source }
    if (-not $script:StackSha) { Log "source: $Source (provided; no git checkout or RELEASE-SOURCE - no revision, so no stamp)" }
    else {
      $shortSha = $script:StackSha.Substring(0, [Math]::Min(12, $script:StackSha.Length))
      $refName = if ($script:StackRef) { $script:StackRef } else { '?' }
      Log "source: $Source (provided) @ $refName $shortSha"
    }
    return $true
  }

  # Release archive first: one asset is one revision, and no git is needed to take it.
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $url = "$StackRepoUrl/releases/latest/download/claude-stack.zip"
  $repo = Join-Path $tmp 'repo'
  try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp 'claude-stack.zip') -UseBasicParsing -ErrorAction Stop
    Expand-Archive -LiteralPath (Join-Path $tmp 'claude-stack.zip') -DestinationPath $repo -Force
  } catch { <# fall through to the clone below #> }
  if ((Test-Path -LiteralPath (Join-Path $repo 'stack/skills') -PathType Container) -and
      (Test-Path -LiteralPath (Join-Path $repo 'stack/agents') -PathType Container)) {
    $script:StackSrc = $repo
    $script:StackSrcRoot = $tmp
    $script:StackSrcOwned = $true
    Read-ReleaseSource -Dir $repo
    $shortSha = if ($script:StackSha) { $script:StackSha.Substring(0, [Math]::Min(12, $script:StackSha.Length)) } else { 'unknown' }
    $refName = if ($script:StackRef) { $script:StackRef } else { '?' }
    Log "source: $url @ $refName $shortSha"
    return $true
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

  # Fallback: a shallow clone - a fork without releases, a blocked release CDN, a local test path.
  # Pinned to main: the release branch is what installs deliver, never the default branch
  # (development lands on develop).
  if (-not $hasGit) { Add-Failure 'release archive unreachable and git not found - stack source unavailable'; return $false }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  & git clone --depth 1 -b main $StackRepoUrl $tmp *> $null
  if ($LASTEXITCODE -ne 0) {
    Add-Failure "release archive and clone of $StackRepoUrl both failed - stack source unavailable (nothing refreshed; existing copies kept)"
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return $false
  }
  $script:StackSrc = $tmp
  $script:StackSrcRoot = $tmp
  $script:StackSrcOwned = $true
  $script:StackSha = (& git -C $tmp rev-parse HEAD 2>$null)
  $script:StackRef = (& git -C $tmp rev-parse --abbrev-ref HEAD 2>$null)
  $shortSha = if ($script:StackSha) { $script:StackSha.Substring(0, [Math]::Min(12, $script:StackSha.Length)) } else { 'unknown' }
  $refName = if ($script:StackRef) { $script:StackRef } else { '?' }
  Log "source: $StackRepoUrl (clone fallback) @ $refName $shortSha"
  return $true
}

function Remove-StackSrc {
  # Only ever removes a fetch WE took - a -Source dir belongs to the caller.
  if ($script:StackSrcOwned -and $script:StackSrcRoot) {
    Remove-Item -LiteralPath $script:StackSrcRoot -Recurse -Force -ErrorAction SilentlyContinue
    $script:StackSrc = ''
    $script:StackSrcRoot = ''
  }
}

function Copy-FromStackSrc {
  # Shared body of the hook/agent/rule steps: copy each named file out of the run's clone. Per-file
  # fail-soft (a file not yet upstream keeps its committed copy), and an unchanged file is reported
  # 'current' rather than rewritten, so a no-op run leaves timestamps alone.
  param([string]$SubDir, [string]$Label, [string]$DestDir, [string[]]$Files)
  if (-not (Get-StackSrc)) { Log "  !! stack source unavailable - kept existing $Label copies"; return }
  foreach ($file in $Files) {
    $src = Join-Path $script:StackSrc (Join-Path $SubDir $file)
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Add-Failure "$Label '$file' not found in $StackRepoUrl"; continue }
    $dest = Join-Path $DestDir $file
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ((Test-Path -LiteralPath $dest) -and ((Get-FileHash -LiteralPath $src).Hash -eq (Get-FileHash -LiteralPath $dest).Hash)) {
      Log "  $Label current: $file"; continue
    }
    Copy-Item -LiteralPath $src -Destination $dest -Force
    Log "  $Label installed -> $file"
  }
}

function Install-Skills {
  # Copy each selected skills/<name>/ out of the run's clone into the scope dest - all house skills
  # live in ONE repo, so a plain copy fully reproduces what the skills CLI used to stage; no
  # npx/network-registry dependency.
  if (-not (Get-StackSrc)) { Add-Failure 'skills not installed'; return }   # fail-soft: skip, never abort
  $dest = Get-SkillsDest
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  foreach ($entry in $Skills) {
    $name = $entry.Split('|', 2)[1]
    $src = Join-Path $script:StackSrc (Join-Path 'stack/skills' $name)
    if (Test-Path -LiteralPath $src -PathType Container) {
      $target = Join-Path $dest $name
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
      Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
      Log "skill [$ClaudeScope]: $name -> $target"
    }
    else {
      Add-Failure "skill '$name' not found in $StackRepoUrl"
    }
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
    $spec = $parts[1].Replace('@SERENA_CONTEXT@', $SerenaContext)
    # CLAUDE_CONFIG_DIR unset -> the CLI can't interpolate ${CLAUDE_CONFIG_DIR} at launch, so resolve it now.
    if (-not $env:CLAUDE_CONFIG_DIR) { $spec = $spec.Replace('${CLAUDE_CONFIG_DIR}', $ConfigDir) }
    # HOME_MEMORY_DIR: shared memory root ($HOME\.memory-mcp) - always resolved at install time to a
    # fixed home path, so a Cursor install on the same machine points to the same DB.
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
      # remote (hosted) server - url/header keyed by name: sentry, else context7
      $url = if ($name -eq 'sentry') { $SentryRemoteUrl } else { $Context7RemoteUrl }
      $hdr = if ($name -eq 'sentry') { $SentryRemoteHdr } else { $Context7RemoteHdr }
      try { & claude mcp add --transport http --scope $ClaudeScope $name $url --header $hdr } catch {}
      if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
      continue
    }
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
    if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
  }
}

function Get-Hooks {
  # Copy each hook file into the repo from the run's clone; per-hook fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping hooks'; return }
  $files = @(foreach ($entry in $Hooks) { ($entry -split '::', 2)[0] })
  Copy-FromStackSrc -SubDir 'stack/hooks' -Label 'hook' -DestDir (Join-Path $root '.claude/hooks') -Files $files
}

function Get-Agents {
  # Copy each subagent .md into the repo from the run's clone; per-agent fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping agents'; return }
  Copy-FromStackSrc -SubDir 'stack/agents' -Label 'agent' -DestDir (Join-Path $root '.claude/agents') -Files $Agents
}

function Get-Rules {
  # Copy each rule .md into the repo from the run's clone; per-rule fail-soft (keeps repo copy).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping rules'; return }
  Copy-FromStackSrc -SubDir 'stack/rules' -Label 'rule' -DestDir (Join-Path $root '.claude/rules') -Files $ClaudeRules
  Set-DocsRootStamp $root
}

function Set-DocsRootStamp {
  # Replace __DOCS_ROOT__ in the copied baseline-docs-root.md with the CURRENT env value
  # (settings.json, else the default) - runs on install AND update, so the stamp always tracks the env.
  param([string]$root)
  $rule = Join-Path $root '.claude/rules/baseline-docs-root.md'
  if (-not (Test-Path $rule)) { return }
  $val = '.claude/docs'
  $settings = Join-Path $root '.claude/settings.json'
  if (Test-Path $settings) {
    try {
      $data = Get-Content $settings -Raw | ConvertFrom-Json
      if ($data.env -and $data.env.PSObject.Properties['CLAUDE_DOCS_PATH'] -and $data.env.CLAUDE_DOCS_PATH) {
        $val = $data.env.CLAUDE_DOCS_PATH
      }
    } catch { Log '  !! docs-root stamp: settings.json unreadable - stamping the default' }
  }
  try {
    (Get-Content $rule -Raw).Replace('__DOCS_ROOT__', $val) | Set-Content $rule -NoNewline -Encoding utf8
  } catch { Log '  !! docs-root stamp failed - the rule keeps the env-wins fallback' }
}

function New-ClaudeMd {
  # INSTALL: lay down a starter .claude/CLAUDE.md from the template when the project has none (never clobber a filled one).
  $root = Get-RepoRoot
  if (-not $root) { Log '  !! not in a git repo - skipping CLAUDE.md'; return }
  # Auto-loaded from either ./CLAUDE.md or ./.claude/CLAUDE.md - skip if EITHER exists so we never leave two copies.
  if ((Test-Path -LiteralPath (Join-Path $root 'CLAUDE.md')) -or (Test-Path -LiteralPath (Join-Path $root '.claude/CLAUDE.md'))) { Log '  CLAUDE.md: already present - left as-is (finish its authoring outline if not done)'; return }
  if (-not (Get-StackSrc)) { Log '  !! stack source unavailable - create .claude/CLAUDE.md by hand from CLAUDE.template.md'; return }
  $src = Join-Path $script:StackSrc (Join-Path 'stack' 'CLAUDE.template.md')
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Add-Failure "CLAUDE.template.md not found in $StackRepoUrl"; return }
  $dest = Join-Path $root '.claude/CLAUDE.md'
  New-Item -ItemType Directory -Force -Path (Join-Path $root '.claude') | Out-Null
  Copy-Item -LiteralPath $src -Destination $dest -Force
  Log '  CLAUDE.md: seeded to .claude/CLAUDE.md - write the project top from its authoring-outline comment, and keep the .claude/* + !.claude/CLAUDE.md gitignore lines so it stays committed'
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
function Get-StackVersionFrom {
  # The stack's ONE version: an extracted release archive carries it in RELEASE-SOURCE; a git
  # checkout reads it from the plugin manifest - the same file the marketplace serves from main,
  # so the stamp, the release, and the marketplace always name the same version.
  param([string]$Dir)
  $rel = Join-Path $Dir 'RELEASE-SOURCE'
  if (Test-Path -LiteralPath $rel) {
    $v = ((Get-Content -LiteralPath $rel | Where-Object { $_ -match '^version: ' } | Select-Object -First 1) -replace '^version: ', '')
    if ($v) { return $v }
  }
  $manifest = Join-Path $Dir 'setup-plugin/.claude-plugin/plugin.json'
  if (Test-Path -LiteralPath $manifest) {
    try { return [string](Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version } catch { }
  }
  return ''
}

function Write-Stamp {
  # No SHA means no source resolved this run (the archive download and the clone fallback both
  # failed, and every step fail-softly kept its existing copy). Stamping then would claim an
  # install that did not occur, and a wrong stamp is worse than none - so leave any previous
  # stamp untouched.
  if (-not $script:StackSha) { Log '  stamp: skipped - no source revision resolved this run'; return }
  $version = if ($script:StackSrc) { Get-StackVersionFrom -Dir $script:StackSrc } else { '' }
  if ($ClaudeScope -eq 'user') { $dir = $ConfigDir }
  else {
    # Prefer the repo root - that is where hooks/agents/rules land. Outside a repo fall back to the
    # cwd, which is where Install-Skills puts .claude/skills: the stamp belongs next to whatever
    # this run actually installed, and a skills-only install into a plain directory still gets one.
    $root = Get-RepoRoot
    if (-not $root) { $root = (Get-Location).Path }
    $dir = Join-Path $root '.claude'
  }
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $dest = Join-Path $dir 'claude-stack.stamp'
  $stampedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $lines = @(
    '# claude-stack install stamp - machine-local, written by claude-stack.sh / claude-stack.ps1.'
    '# The revision every artifact of this install was copied from. To see what changed since:'
    "#   open $StackRepoUrl/compare/$($script:StackSha)...main"
    '# /claude-stack:configure reports exactly this diff. Then re-run the installer''s'
    "# '$Action' action (or that skill) to take the changes."
    "source: $StackRepoUrl"
    "ref: $($script:StackRef)"
    "sha: $($script:StackSha)"
    "version: $version"
    "installed: $stampedAt"
    "action: $Action"
    "scope: $ClaudeScope"
  )
  Set-Content -LiteralPath $dest -Value $lines -Encoding utf8
  $shortSha = $script:StackSha.Substring(0, [Math]::Min(12, $script:StackSha.Length))
  Log "  stamp: $dest @ $shortSha"
}

function Set-HookSettings {
  # INSTALL + UPDATE: ensure the hook PreToolUse blocks + secret-read deny-list + mcp allow-list are in settings.json (idempotent).
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
  # generated-docs root: the authoritative value the baseline-docs-root rule resolves at session start.
  # Forward slashes DELIBERATELY, also on Windows - the value is consumed by Node hooks and the
  # model, both of which resolve '/' fine; backslashes would need JSON escaping and break parity.
  if (-not $data.env.PSObject.Properties['CLAUDE_DOCS_PATH']) {
    $data.env | Add-Member -NotePropertyName CLAUDE_DOCS_PATH -NotePropertyValue '.claude/docs'
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
  # rm the manifest skills under the scope dest, so update starts from a clean slate.
  $dest = Get-SkillsDest
  Log "skills [$ClaudeScope]: removing $($Skills.Count) for clean reinstall"
  foreach ($entry in $Skills) {
    $name = $entry.Split('|', 2)[1]
    Remove-Item -LiteralPath (Join-Path $dest $name) -Recurse -Force -ErrorAction SilentlyContinue
  }
  # Renamed/retired upstream skills: their old dirs left the manifest, so the loop above never
  # clears them - prune the known old names explicitly (a leftover copy keeps firing forever).
  foreach ($name in @('project-task-flow')) {
    Remove-Item -LiteralPath (Join-Path $dest $name) -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Update-Skills {
  # Fresh clone + copy - the same as install (the copy overwrites), just cleared first.
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
    $spec = $parts[1].Replace('@SERENA_CONTEXT@', $SerenaContext)
    if (-not $env:CLAUDE_CONFIG_DIR) { $spec = $spec.Replace('${CLAUDE_CONFIG_DIR}', $ConfigDir) }
    $spec = $spec.Replace('${HOME_MEMORY_DIR}', (Join-Path $HOME '.memory-mcp'))
    # Same no-spaces-in-resolved-path assumption as Install-Mcps (see there); .Split(' ') is array, no glob.
    $argArr = @($spec.Split(' ') | Where-Object { $_ -ne '' })
    Log "mcp refresh [$ClaudeScope]: $name"
    try { & claude mcp remove $name -s $ClaudeScope 2>$null } catch {}
    if ($spec -eq '@HTTP@') {
      # remote (hosted) server - url/header keyed by name: sentry, else context7
      $url = if ($name -eq 'sentry') { $SentryRemoteUrl } else { $Context7RemoteUrl }
      $hdr = if ($name -eq 'sentry') { $SentryRemoteHdr } else { $Context7RemoteHdr }
      try { & claude mcp add --transport http --scope $ClaudeScope $name $url --header $hdr } catch {}
      if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
      continue
    }
    try { & claude mcp add --scope $ClaudeScope $name @argArr } catch {}
    if ($LASTEXITCODE -ne 0) { Add-Failure "mcp $name failed" }
  }
}

function Update-Hooks { Get-Hooks; Set-HookSettings }   # UPDATE: refresh hook files + re-ensure the settings.json wiring (idempotent - a new hook block, deny rule, or env key ships to updated projects too)
function Update-Agents { Get-Agents } # UPDATE: refresh subagent files
function Update-Rules { Get-Rules }   # UPDATE: refresh rule files

# ===========================================================================
# KEEP-PINS (-KeepPins) - preserve local model/effort frontmatter edits across the refresh.
# The agent fetch and the skills clean-reinstall reset every file to upstream, wiping a per-project
# model/effort re-pin. With -KeepPins the values are snapshotted BEFORE the refresh and re-applied
# AFTER it - only keys present in both the old local file and the refreshed one (no add/remove), and
# the local value always wins over an upstream pin change (the switch cannot tell the two apart).
# ===========================================================================
function Get-FrontmatterPin([string]$Path, [string]$Key) {
  # Return the key's value from the leading frontmatter block ('' if absent).
  try { $lines = [System.IO.File]::ReadAllLines($Path) } catch { return '' }
  if (-not $lines -or $lines.Count -eq 0 -or $lines[0] -notmatch '^---\s*$') { return '' }
  for ($i = 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^---\s*$') { break }
    if ($lines[$i] -match ('^' + [regex]::Escape($Key) + ':\s*(.*?)\s*$')) { return $Matches[1] }
  }
  return ''
}

function Set-FrontmatterPin([string]$Path, [string]$Key, [string]$Value) {
  # Rewrite the key's line INSIDE the frontmatter block only. .NET IO keeps UTF-8 intact
  # (Set-Content on PS 5.1 would re-encode the body), and the LF join keeps the fetched files'
  # Unix line endings (WriteAllLines would rewrite the whole file CRLF on Windows).
  $lines = [System.IO.File]::ReadAllLines($Path)
  if (-not $lines -or $lines.Count -eq 0 -or $lines[0] -notmatch '^---\s*$') { return }
  for ($i = 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^---\s*$') { break }
    if ($lines[$i] -match ('^' + [regex]::Escape($Key) + ':')) {
      $lines[$i] = "${Key}: $Value"
      [System.IO.File]::WriteAllText($Path, (($lines -join "`n") + "`n"))
      return
    }
  }
}

function Get-PinFiles {
  # Every locally-installed pin-bearing target: manifest agents + skill SKILL.md files.
  $files = @()
  $root = Get-RepoRoot
  if ($root) {
    foreach ($f in $Agents) {
      $p = Join-Path $root ".claude/agents/$f"
      if (Test-Path -LiteralPath $p) { $files += $p }
    }
  }
  $skillsDir = if ($Scope -eq 'project') { if ($root) { Join-Path $root '.claude/skills' } } else { Join-Path $ConfigDir 'skills' }
  if ($skillsDir) {
    foreach ($entry in $Skills) {
      $p = Join-Path $skillsDir ($entry.Split('|', 2)[1] + '/SKILL.md')
      if (Test-Path -LiteralPath $p) { $files += $p }
    }
  }
  return $files
}

$script:PinSnapshot = @{}
function Save-Pins {
  # -KeepPins: record each installed agent/skill file's model/effort before the refresh.
  if (-not $KeepPins) { return }
  foreach ($f in Get-PinFiles) {
    $m = Get-FrontmatterPin $f 'model'
    $e = Get-FrontmatterPin $f 'effort'
    if ($m -or $e) { $script:PinSnapshot[$f] = @{ model = $m; effort = $e } }
  }
  Log "keep-pins: snapshotted model/effort from $($script:PinSnapshot.Count) file(s)"
}

function Restore-Pins {
  # -KeepPins: re-apply every snapshotted value the refresh changed.
  if (-not $KeepPins) { return }
  $kept = 0
  foreach ($f in Get-PinFiles) {
    if (-not $script:PinSnapshot.ContainsKey($f)) { continue }
    # Display name matching the .sh twin: agents/<file> or skills/<skill>/SKILL.md.
    $disp = if ($f -match '[\\/]\.claude[\\/]agents[\\/]') { 'agents/' + (Split-Path -Leaf $f) } else { 'skills/' + (Split-Path -Leaf (Split-Path -Parent $f)) + '/SKILL.md' }
    foreach ($key in @('model', 'effort')) {
      $saved = $script:PinSnapshot[$f][$key]
      if (-not $saved) { continue }
      $cur = Get-FrontmatterPin $f $key
      if ($cur -and $cur -ne $saved) {
        Set-FrontmatterPin $f $key $saved; $kept++
        Log "  pin kept: $disp $key=$saved (upstream: $cur)"
      }
    }
  }
  $script:PinSnapshot = @{}
  Log "keep-pins: re-applied $kept local pin value(s)"
}

function Remove-AgentsCache {
  # Legacy cleanup: an npx-skills-era install staged an agent-neutral .agents/ store. The git-copy
  # install_skills never creates one, so this is a no-op on a fresh install and only matters for a
  # project upgrading from the old flow. Guard: keep it if any skill entry under .claude/skills is a
  # symlink (a symlinked tree still depends on .agents/; removing it would dangle).
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
  #   2) delegate the idempotent patch to scripts/os/fix-serena-ts-windows.ps1 (single source of truth),
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

  # From the run's source clone, like every other repo-owned file - so this patch is the same
  # revision as the rest of the install rather than whatever the raw CDN happens to be serving.
  if (-not (Get-StackSrc)) { Write-Warning '  serena TS-LSP fix skipped - stack source unavailable'; return }
  $fixSrc = Join-Path $script:StackSrc (Join-Path 'scripts/os' 'fix-serena-ts-windows.ps1')
  if (-not (Test-Path -LiteralPath $fixSrc -PathType Leaf)) { Write-Warning '  serena TS-LSP fix skipped - fix-serena-ts-windows.ps1 not found in the source'; return }
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $fixSrc   # child process: its `exit` won't kill this installer
  }
  catch { Write-Warning "  serena TS-LSP fix skipped (run failed): $($_.Exception.Message)" }
}

# ===========================================================================
# DISPATCH
# ===========================================================================
# -SkillsOnly: run ONLY the skill step and exit, before any prerequisite check or claude-CLI-
# dependent step (testability - drives just the git-copy with no claude/gh/network dependency).
if ($SkillsOnly) {
  if ($Action -eq 'install') { Install-Skills } else { Update-Skills }
  Write-Stamp      # a skills-only run still installs FROM a revision - record it
  Remove-StackSrc
  exit 0
}

Test-Prerequisites
Install-GitHubCli

# claude-only steps fail soft (Get-Command claude) if the CLI is not installed.
Save-Pins   # -KeepPins only: no-op without the switch (install re-adds skills unconditionally too, so both actions refresh)
# try/finally is the .ps1 stand-in for the .sh EXIT trap: the source clone is removed even if a step
# throws. Write-Stamp runs after every copy step, so the stamp only ever names a revision that fully landed.
try {
  if ($Action -eq 'install') { Install-Skills; Install-Plugins; Install-Mcps; Get-Hooks; Set-HookSettings; Get-Agents; Get-Rules; New-ClaudeMd; Repair-SerenaTsLspWindows }
  else { Update-Skills; Update-Plugins; Update-Mcps; Update-Hooks; Update-Agents; Update-Rules; Repair-SerenaTsLspWindows }
  Restore-Pins
  Write-Stamp
}
finally { Remove-StackSrc }

Remove-AgentsCache
Write-Host ''
Log "done: $Action [scope=$Scope, account=$ConfigDir, agent=$Agent]"
$summary = "  skills=$($Skills.Count), plugins=$($Plugins.Count), mcps=$($Mcps.Count), hooks=$($Hooks.Count), agents=$($Agents.Count), rules=$($ClaudeRules.Count)"
if ($Space) { $summary += "; space=$Space, memory DB=$MemoryDbFile" }
if ($KeepPins) { $summary += '; keep-pins=on' }
Log "$summary; context7=$Context7"
if ($script:ClaudeMissing) { Log "  !! claude CLI absent - plugins, MCPs, and settings.json wiring were SKIPPED (install it, then re-run)" }
if ($script:FailCount -gt 0) { Log "  !! $($script:FailCount) item(s) failed above - re-run '$Action' to retry" }

Log 'next steps:'
Log "  - write your project's CLAUDE.md top from the template's authoring-outline comment (framework, stack, conventions, secret/config globs) - install seeds a starter from the template when the project has none; the claude-md-management plugin can help audit it"
Log "  - if this repo has sibling projects (a backend/frontend pair, a consumed package), run /project-related-context with their paths/URLs - it generates the awareness rule (baseline-project-related-context.md) + docs/PROJECT-RELATED-CONTEXT.md"
Log "  - run /project-agent-capabilities once - it inventories the installed skills/agents/MCPs and generates baseline-project-agent-capabilities.md (re-run after update or a manifest trim)"
Log "  - once oriented, run the other two captures the CLAUDE.md rules table names: /project-architecture-analyzer (architecture map + assessment + awareness rule) and /project-code-style-analyzer (docs/PROJECT-CODE-STYLE.md + the inject-code-style hook)"
Log '  - restart Claude Code (or reopen the project) to load the new MCPs, hooks, and settings'
if ($script:PrereqMissing) { Log '  - install the missing prerequisites flagged above, then re-run' }
if ($Context7 -eq 'remote') { Log "  - context7 is remote; add CONTEXT7_API_KEY to $ConfigDir\settings.json 'env' for higher rate limits (or re-run with -Context7 local)" }
if ($GitHubCli) { Log "  - run 'gh auth login' if gh is not yet authenticated (needed before PRs/issues)" }

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
Write-Host ''
Write-Host "Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git\info\exclude):"
Write-Host '  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)'
Write-Host '  .claude/*        Claude Code project config + local state (settings.local.json, hooks) - ignore the contents...'
Write-Host '  !.claude/CLAUDE.md   ...but TRACK the project instructions: they live at .claude/CLAUDE.md and must be committed (git can only re-include a file if the parent dir is not wholesale-ignored, hence .claude/* not .claude/)'
Write-Host '  .slopwatch       dotnet-slopwatch output'
Write-Host '  .playwright      playwright MCP user-data-dir + screenshots'
Write-Host '  .mcp.json        generated MCP server config (machine-local)'
Write-Host ''
Write-Host "The generated-docs root is CLAUDE_DOCS_PATH in .claude\settings.json env (seeded '.claude/docs') -"
Write-Host 'generated docs inherit the .claude ignore above and are machine-local: not committed, not shared,'
Write-Host 're-captured after a fresh clone. To share them with the team, set CLAUDE_DOCS_PATH to a committed'
Write-Host "path (e.g. 'docs', forward slashes on every OS) and track <docs-path>/superpowers/ too."
