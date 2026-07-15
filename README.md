# Personal coding-agent skills & stacks

A collection of personal agent skills - reusable coding conventions and small utilities - plus
per-agent **stack installers** for [Claude Code](https://code.claude.com/docs/en/skills) and
[Cursor](https://cursor.com). Skills install via a git-clone-and-copy step built into the
installers; the full stack (skills + MCP servers + hooks/rules, plus plugins on Claude) is laid
down by the same installers under `claude/` and `cursor/`.

## Installation

Install just the skills into the current project (no MCP servers, hooks, rules, or plugins):

```bash
mkdir -p .claude && curl -fsSL https://raw.githubusercontent.com/envoydev/agents-stack/main/claude/claude-stack.sh -o .claude/claude-stack.sh
bash .claude/claude-stack.sh install --skills-only   # Claude Code -> .claude/skills/
```

```bash
mkdir -p .cursor && curl -fsSL https://raw.githubusercontent.com/envoydev/agents-stack/main/cursor/cursor-stack.sh -o .cursor/cursor-stack.sh
bash .cursor/cursor-stack.sh install skills-only   # Cursor      -> .cursor/skills/
```

Add `--scope global` to install into the account-wide `~/.claude/skills/` or `~/.cursor/skills/`
instead of the project. The agent picks up the `SKILL.md` files automatically the next session.

**Want the whole stack** (skills + MCP servers + hooks/rules, plus plugins on Claude), not just the
skills? Use the per-agent installers - see [`claude/`](claude/README.md) for Claude Code and
[`cursor/`](cursor/README.md) for Cursor.

## Bootstrapping a project with the setup plugin

Install the setup plugin once, then run it inside any project to install a curated subset of the stack:

```
claude plugin marketplace add envoydev/agents-stack
claude plugin install claude-stack-setup@agents-stack
```

Then, in a target project, run `/claude-stack` (the `setup-claude-stack` skill): it detects the OS, analyses the project, checks prerequisites, lets you review a dependency-complete selection, and runs the installer against just that subset. The installer scripts and `stack-select.js` remain the source of truth; the plugin is the guided front end.

## Managing installed skills

```bash
bash .claude/claude-stack.sh update --skills-only   # refresh every skill to latest (Claude Code)
bash .cursor/cursor-stack.sh update skills-only      # refresh every skill to latest (Cursor)
```

Skills are plain directories under `.claude/skills/` / `.cursor/skills/` - `ls` the directory to
see what's installed, delete a folder to drop a skill.

## Available skills

- **create-ticket** - Generate a well-structured bug, user story, epic, or technical
  task ticket in English from a raw description (Ukrainian or English), for any issue tracker. Detects the type and routes to a per-type template.
- **dev-log-convert** - Convert mixed Ukrainian/English daily work notes into a
  structured English work log. Triggers on `dev-log`.
- **explain-code-tutor** - Explain code, a bug, a concept, or an approach trade-off like a
  patient senior engineer: one fitted analogy, numbered steps with real project snippets, a marked break/insight/verdict, the real fix, and a one-line takeaway. Depth ELI5/intermediate/expert.
- **angular-conventions** - Angular 17+ conventions: signals, standalone
  components, OnPush, reactive forms, accessibility (TS baseline → typescript).
- **angular-material** - Angular Material + CDK conventions: selective imports,
  M3 theming, CDK primitives, and component test harnesses (the @angular/material library specifically, not generic MD3).
- **angular-styling** - Angular CSS/SCSS architecture (Material or not):
  ViewEncapsulation, `:host` / `:host-context`, the discouraged `::ng-deep` and its sanctioned ways out, design tokens as CSS custom properties, mobile-first + container queries, and accessibility-affecting styling (Material token work → angular-material).
- **angular-security** - Angular / web frontend security hardening: XSS and the DomSanitizer
  `bypassSecurityTrust*` escape hatches, CSP, CSRF via HttpClient XSRF, no secrets in the bundle, token storage, and SSR/TransferState leaks (server side → dotnet-security, native shell → mobile-security).
- **frontend** - Web frontend router: indexes Angular, TypeScript,
  distinctive production-grade UI (in-skill design-quality guidance), and Ionic/Capacitor (→ mobile).
- **mobile** - Ionic / Capacitor router/index over the Angular + TypeScript
  baselines; in-app navigation and page lifecycle owned by ionic.
- **ionic** - House Ionic / Capacitor conventions: Ionic UI (standalone +
  signals), navigation, lifecycle/permissions, and Capacitor plugin sourcing + wrapping.
- **capacitor-release** - House Ionic / Capacitor release pipeline: cap sync +
  native build, iOS/Android signing, store submission, OTA / live updates, version sync, Fastlane/Actions CI, and dSYM/sourcemap upload.
- **mobile-security** - Ionic / Capacitor mobile security hardening: Keychain/Keystore secret
  storage (never plaintext Preferences), deep-link input validation, least-privilege permissions, cleartext/WebView hardening, and data-at-rest protection (web layer → angular-security, signing → capacitor-release).
- **csharp** - C# style and runtime conventions: layout, naming, modern
  syntax, async, exceptions, logging, dependency injection.
- **csharp-design-patterns** - All 23 GoF design patterns with modern
  .NET 8+ idioms: selection table, anti-pattern checks, framework-native forms.
- **database-conventions** - Database conventions across Postgres,
  SQL Server/T-SQL, SQLite, and MongoDB: schema, migrations, indexes, query safety.
- **data-security** - SQL / data-layer security hardening: parameterized-only
  injection (no interpolated FromSqlRaw, sp_executesql for dynamic proc SQL), least-privilege DB accounts, row-level security + tenant isolation, connection-string secrets, encryption at rest/in transit, and audit-logging (app-layer EF → dotnet-security, primitives → dotnet-cryptography, migrations → dotnet-migrate).
- **dotnet** - Router that points to the focused .NET/C# specialist
  skill for the area you are working in.
- **dotnet-architecture** - Choose and hold a .NET architecture: the decision hub (topology,
  internal style, DDD-additive) with clean-architecture / ddd / vertical-slice / modular-monolith / microservices in references/. .NET 8 floor.
- **dotnet-architecture-tests** - Architecture fitness tests: encode layer /
  dependency / naming / isolation rules as build-failing tests with NetArchTest (default) or ArchUnitNET. .NET 8 floor.
- **dotnet-aspire** - .NET Aspire local orchestration: AppHost,
  ServiceDefaults, service discovery, dashboard. Orchestration-only; .NET 8 floor.
- **dotnet-authentication** - ASP.NET Core authentication/authorization:
  JWT/OIDC/Identity, policy-based authorization, secret storage. .NET 8 floor.
- **dotnet-code-quality** - Mechanically enforce the C# house style: CSharpier
  formatter ownership, SDK analyzers (AnalysisLevel / .editorconfig severity), TreatWarningsAsErrors + legacy batch promotion, Roslynator, the dotnet build CI gate. .NET 8 floor.
- **dotnet-console-apps** - The console app's interface surface on the generic host:
  CLI argument parsing (System.CommandLine 2.0 / Spectre.Console.Cli / Cocona) and bots / gateway consumers (Telegram / Discord / Slack / exchange) run in a BackgroundService. .NET 8 floor.
- **dotnet-cryptography** - System.Security.Cryptography: SHA-2, AES-GCM,
  RSA/ECDSA, PBKDF2/Argon2id, constant-time comparison, deprecated-algorithm matrix. .NET 8 floor.
- **dotnet-data-access** - EF Core + NHibernate data access: DbContext/session lifetime, change
  tracking, N+1 and loading, projection to read models, bounded results, bulk ops; per-ORM depth in references/.
- **dotnet-error-handling** - Result pattern + ProblemDetails (RFC 9457) +
  global exception handler (IExceptionHandler) + FluentValidation. .NET 8 floor.
- **dotnet-grpc** - gRPC: .proto/codegen, ASP.NET Core host, four streaming
  modes, JWT/mTLS, interceptors, health checks, gRPC-Web. .NET 8 floor.
- **dotnet-hosted-services** - Hosted-service / worker conventions:
  BackgroundService vs IHostedService, the ExecuteAsync exception trap, scoped scopes, PeriodicTimer, graceful shutdown, Channels; references/ add 24/7 hardening (I/O resilience, rate limiting, ClientWebSocket reconnect), scheduling + leader election, and deployment/signals. .NET 8 floor.
- **dotnet-messaging** - Event-driven messaging: Wolverine (MIT) /
  MassTransit, transactional outbox, choreography vs sagas, RabbitMQ / Azure Service Bus. .NET 8 floor.
- **dotnet-migrate** - Safe migration workflow for EF Core schema, .NET
  upgrades, and NuGet updates - rollback + verification at each step.
- **dotnet-minimal-api** - Minimal API endpoint mechanics: MapGroup,
  TypedResults, endpoint filters, parameter binding, metadata. .NET 8 floor.
- **dotnet-mvc-controllers** - Controller-based Web API mechanics:
  [ApiController], attribute routing, ActionResult<T>, the automatic-400 filter, action filters, thin controllers. .NET 8 floor.
- **dotnet-openapi** - OpenAPI document generation (Swashbuckle / built-in
  .NET 9+) and the Scalar docs UI. .NET 8 floor.
- **dotnet-realtime** - ASP.NET Core SignalR real-time push: strongly-typed
  Hub<TClient>, IHubContext, groups/presence, reconnection, JWT-over-query-string auth, and Redis / Azure SignalR scale-out. .NET 8 floor.
- **dotnet-security** - OWASP Top 10 (2021) mapped to .NET 8 mitigations;
  delegates auth and crypto to their dedicated skills. .NET 8 floor.
- **dotnet-source-generators** - Roslyn IIncrementalGenerator authoring +
  built-in generators (GeneratedRegex / LoggerMessage / System.Text.Json). .NET 8 floor.
- **dotnet-testing** - .NET testing conventions: AAA structure, per-layer
  strategy, coverage thresholds, and test-library routing.
- **dotnet-web-backend** - ASP.NET Core HTTP-service cross-cutting
  conventions: HttpClientFactory, Polly, API versioning, OpenAPI, observability.
- **dotnet-winforms** - WinForms conventions: logic out of code-behind,
  control / component / GDI disposal discipline, high-DPI, with per-version
  (4.8 vs .NET 8/9/10) mechanics and migration deltas in references.
- **dotnet-wpf** - WPF conventions: strict MVVM, binding modes, UI
  threading, list virtualization, localization.
- **postgres** - PostgreSQL engine specialist: index-type selection, JSONB / full-text, SARGable
  rewrites, the planner (EXPLAIN, pg_stat_statements, autovacuum), connection pooling.
- **sqlite** - SQLite engine specialist: WAL / single-writer concurrency, PRAGMAs, type affinity vs
  STRICT, limited ALTER TABLE, connection-per-thread, FTS5.
- **project-quality-loop** - Autonomous review-and-fix loop pipeline: run a `docs/loops/` folder of
  numbered prompts in order, looping each on a target to zero findings, deciding autonomously.
- **project-architecture-quality-loop** - Deliberate architecture analyze-assess-improve loop: the
  project-architecture-analyzer capture writes `docs/architecture/ARCHITECTURE.md` + a reasoned strengths/weaknesses `docs/architecture/ASSESSMENT.md`,
  then fixes the weaknesses by tier (small -> implementer, substantial -> designer-led build, structural ->
  flagged for approval) and reconciles the docs. Manual, `/`-only - the heavy counterpart to project-quality-loop.
- **project-architecture-analyzer** - Deliberate architecture capture: dispatches code-analyzer per
  module, reasons over the digests in the main session, and writes `docs/architecture/ARCHITECTURE.md` +
  `docs/architecture/ASSESSMENT.md` + the generated always-on awareness rule
  `baseline-project-architecture.md` (micro-summary + read-the-map trigger). Capture only - fixing the weaknesses is project-architecture-quality-loop.
  Manual, `/`-only.
- **project-version-upgrade** - Deliberate flow for any breaking version event (framework, runtime,
  or package major): plan in-session from the real breaking surface (context7 + usage digests),
  approval gate (auto mode only on an explicit ask), then staged execution - implementers edit,
  resolvers clear reds, a gate after every stage. Manual, `/`-only.
- **project-capabilities** - Deliberate capabilities capture: inventories the installed skills,
  seats, MCPs, and plugins, and generates the always-on awareness rule
  `baseline-project-capabilities.md` from the real inventory - so sessions are never steered at a
  capability the project doesn't carry. Re-run after install/update/trim. Manual, `/`-only.
- **project-code-style-analyzer** - Deliberate project code-style capture: fans out code-style-analyzer
  agents (one per detected language, parallel), merges their reports into `docs/PROJECT-CODE-STYLE.md`
  (the project's actual style - config-enforced rules + idioms a linter cannot encode), then generates
  the inject-code-style hook - extension filter from the observed extensions - and wires it into
  `settings.json`. The hook injects the doc once per session on the first code-file edit. Manual, `/`-only.
- **project-related-context** - Deliberate related-projects capture, args-driven (paths or git URLs,
  never a scan): fans out related-project-analyzer agents (one per sibling, parallel) and writes both
  tiers from their YAML entries (evidence-grounded or UNVERIFIED) - the always-on awareness rule
  `.claude/rules/baseline-project-related-context.md` (name/location/relation/seam) and
  `docs/PROJECT-RELATED-CONTEXT.md` (first_read + evidence, read on a seam touch).
  Re-run upserts entries per passed sibling in both files. Manual, `/`-only.
- **project-verify-plan** - Audit an implementation plan before writing code: a risk-coverage review that
  checks the plan names the traps its stack will hit (routing to the stack skill), matches scope,
  covers the edges, and stays minimal - the cheapest place to catch a design error, upstream of code review.
- **project-implementer** - Single-chat build step: execute a verified plan task by task - honor each
  card's contract, gate every task green (resolver agents absorb stubborn reds), flag scope beyond
  the plan, finish via `/code-review` + the done-gate. Completes the in-session
  design -> audit -> build -> review vertical.
- **project-solution-design** - Work out how a feature fits the existing code before building, in a single
  chat: read the committed architecture, judge where the change belongs (extend a seam, refactor
  first, or isolate a new boundary), load the stack skill for its traps, and decompose into an
  ordered, minimal plan. The in-context twin of the designer agent; feeds `project-verify-plan`.
- **project-failure-signatures** - Match a runtime crash to its signature and isolate the real cause: a
  lookup of the common local-runtime signatures (null-reference, DI resolution, async deadlock,
  disposed-lifecycle, config drift, boundary, database contention, HTTP-status) each mapped to where the cause lives -
  usually not the line that threw. Pairs with the systematic-debugging method.
- **project-ci-failure-signatures** - Triage a red CI pipeline or PR check in the current chat: match the failure to a
  signature (compile/restore, green-locally-red-on-runner, quality gate, signing, workflow drift,
  infra flake), make the code-vs-environment call, and route it. The single-chat twin of the
  `ci-failure-diagnoser` agent; the CI sibling of `project-failure-signatures`.
- **project-build-from-scratch** - Build a new application or major module from scratch: routes greenfield
  work to the right architecture skill and scaffolding command, then drives design -> scaffold ->
  slice-by-slice build over the agent pipeline.
- **project-task-flow** - Entry-point orchestrator for multi-agent engineering work: classify a
  feature or bug, pick the smallest safe execution mode, run a single stack's design-build-verify
  trio per its domain-trio protocol (the designer decomposes, implementers build in parallel, the
  verifier gates and loops back), and for cross-domain work freeze the shared contract, run the
  stack pipelines in parallel, then gate the assembled whole through the integration-reviewer
  before commit. Home of the shared subagent policies (contract change, structured output, model
  and token routing).
- **devops** - Containers, CI/CD, and safe deploys for the .NET/Angular house: multi-stage
  digest-pinned non-root Docker, GitHub Actions CI/CD (lockfile-hash caching, service-container
  tests, masked secrets, SHA-pinned actions, OIDC), and health-gated expand-contract deploys.
- **typescript** - Framework-agnostic TypeScript/JavaScript baseline:
  strict typing, type modeling, modules, async, error handling, JS with JSDoc.
- **markdown-style** - Markdown authoring and review: a syntax canon (valid,
  portable Markdown) plus an opinionated house style overlay, applied in a
  two-pass procedure. Form only, not prose (Vale) or spelling.
- **ilspy-decompile** - Decompile a compiled .NET assembly with ilspycmd to
  read its real implementation: framework internals, NuGet source, or
  behavior confirmation before a framework upgrade.
- **dotnet-project-setup** - Set up a new .NET solution's build spine: the
  src / tests / .config layout, .slnx, Directory.Build.props, global.json,
  central package management, and dotnet-tool pinning. A hub with references.
- **dotnet-performance** - Performance-aware .NET design: allocation and type
  layout (struct vs class, Span, ValueTask, frozen collections) plus
  serialization-format choice (System.Text.Json source-gen, Protobuf,
  MessagePack). A hub with references.
- **dotnet-diagnostics** - Measure and diagnose a live .NET process: BenchmarkDotNet
  microbenchmarks and crash / hang / OOM dump capture (dotnet-dump, dotnet-gcdump,
  containers) with a first-look SOS pass. A hub with references.
- **nx** - Nx monorepo project-graph layer: navigate via nx show projects / nx graph /
  nx affected instead of dumping config, scope build / test / lint to affected projects,
  scaffold with nx generate, enforce module boundaries with tags. Draws the serena-vs-Nx
  routing line; teaches the CLI over the (minimal-mode) Nx MCP.

## Working in a single chat

The same build/diagnose flow runs two ways: dispatch the **subagents** (isolated contexts,
parallel fan-out) or load the **skills that reproduce each seat inside your current chat**
(visible, checkpointed, at your model). The single-chat form is the cheaper path for
small-to-medium single-stack work - you see and correct every step instead of reading a
dispatched agent's report.

| Agent seat | Load this in a single chat |
|---|---|
| `<stack>-solution-designer` | `project-solution-design` |
| verifier (before build) | `project-verify-plan` |
| `<stack>-implementer` | just code - conventions auto-load on file touch |
| verifier (after build) | `/code-review` + `verification-before-completion` |
| `issue-diagnoser` | `systematic-debugging` + `project-failure-signatures` |
| `ci-failure-diagnoser` | `project-ci-failure-signatures` |

The trio loop is `project-solution-design` -> `project-verify-plan` -> build under the auto-loaded conventions
-> `/code-review`, with a checkpoint after each step.

The inverse path runs the same flow as a dispatched team of 33 model-pinned subagents - the
`project-task-flow` orchestration skill owns that ladder (the roster is laid out at the top of
[claude/claude-stack.html](claude/claude-stack.html)). Pick by size: stay in chat for small
single-stack work, dispatch the team for large, parallel, cross-domain, or log-heavy work.

## Repository layout

```text
skills/                 # the personal skills - one <skill-name>/SKILL.md per skill (some carry a references/ subfolder)
claude/                 # Claude Code stack: claude-stack.{sh,ps1,html} (agent roster viz + full inventory), CLAUDE.template.md, hooks/, agents/, rules/
cursor/                 # Cursor stack: cursor-stack.{sh,ps1,html}, AGENTS.template.md, hooks/, rules/, agents/
scripts/lint-skills.js  # repo lint (keeps skills / manifests / HTML in sync)
```

`skills/` is the flat layout the per-agent installers copy directly from (one `<skill-name>/SKILL.md`
per skill). `claude/` and `cursor/` are the per-agent stacks (each has its own README); each ships a
stack-neutral `*.template.md` you copy into a project and fill in.

## Maintenance

After adding, renaming, or removing a skill, plugin, or MCP, run the repo
lint. The per-agent installer scripts (`claude/claude-stack.{sh,ps1}` and
`cursor/cursor-stack.{sh,ps1}`) are the single source of truth for everything in
use; the lint verifies every skill directory is registered in the manifests
and this README, that each `SKILL.md` frontmatter loads as valid YAML (using
js-yaml, so a malformed block fails here instead of reaching a project
uncaught), that cross-skill references
resolve everywhere they appear (`SKILL.md` files, the Claude subagents, the base
templates, and the Claude + Cursor rules - a renamed skill is caught in all of them),
that all four
installers agree (4-way: `SKILLS` + `MCPS` identical across both agents and both
shells, in the SAME ORDER, `PLUGINS` claude-only), that the on-disk subagents match
the set the installers fetch, that every per-agent README headline count (skills /
plugins / MCPs / hooks / agents / rules) matches the installer, and that the stack
inventory HTML matches the manifests in both directions:

```bash
npm install              # one-time: the lint needs js-yaml
node scripts/lint-skills.js   # or: npm run lint
```

## License

[MIT](LICENSE) © 2026 envoydev
