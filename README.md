# Personal coding-agent skills & stacks

A collection of personal agent skills - reusable coding conventions and small utilities - plus
per-agent **stack installers** for [Claude Code](https://code.claude.com/docs/en/skills) and
[Cursor](https://cursor.com). The skills install with the [skills CLI](https://skills.sh) from
`skills.sh`; the full stack (skills + MCP servers + hooks/rules, plus plugins on Claude) is laid
down by the installers under `claude/` and `cursor/`.

## Installation

Install every skill in this repo into the current project:

```bash
npx skills add envoydev/agents-stack                 # Claude Code -> .claude/skills/
npx skills add envoydev/agents-stack --agent cursor  # Cursor      -> .cursor/skills/
```

Add `-g` to install globally (`~/.claude/skills/` or `~/.cursor/skills/`) instead. The agent picks
up the `SKILL.md` files automatically the next session.

**Want the whole stack** (skills + MCP servers + hooks/rules, plus plugins on Claude), not just the
skills? Use the per-agent installers - see [`claude/`](claude/README.md) for Claude Code and
[`cursor/`](cursor/README.md) for Cursor.

## Managing installed skills

```bash
npx skills ls          # list installed skills
npx skills find        # search and select skills interactively
npx skills update      # update installed skills to the latest version
npx skills remove      # uninstall skills
```

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
  M3 theming, CDK primitives, and component test harnesses (distinct from material-3 / generic MD3).
- **angular-styling** - Angular CSS/SCSS architecture (Material or not):
  ViewEncapsulation, `:host` / `:host-context`, the discouraged `::ng-deep` and its sanctioned ways out, design tokens as CSS custom properties, mobile-first + container queries, and accessibility-affecting styling (Material token work → angular-material).
- **frontend** - Web frontend router: indexes Angular, TypeScript, Material 3,
  the frontend-design plugin, and Ionic/Capacitor (→ mobile).
- **mobile** - Ionic / Capacitor router: ionic-angular, capacitor-angular,
  capacitor-plugins over the Angular + TypeScript baselines.
- **ionic** - House Ionic / Capacitor conventions: Ionic UI (standalone +
  signals), navigation, lifecycle/permissions, and Capacitor plugin sourcing + wrapping.
- **capacitor-release** - House Ionic / Capacitor release pipeline: cap sync +
  native build, iOS/Android signing, store submission, OTA / live updates, version sync, Fastlane/Actions CI, and dSYM/sourcemap upload.
- **csharp** - C# style and runtime conventions: layout, naming, modern
  syntax, async, exceptions, logging, dependency injection.
- **csharp-design-patterns** - All 23 GoF design patterns with modern
  .NET 8+ idioms: selection table, anti-pattern checks, framework-native forms.
- **database-conventions** - Database conventions across Postgres,
  SQL Server/T-SQL, SQLite, and MongoDB: schema, migrations, indexes, query safety.
- **dotnet** - Router that points to the focused .NET/C# specialist
  skill for the area you are working in.
- **dotnet-architecture-tests** - Architecture fitness tests: encode layer /
  dependency / naming / isolation rules as build-failing tests with NetArchTest (default) or ArchUnitNET. .NET 8 floor.
- **dotnet-aspire** - .NET Aspire local orchestration: AppHost,
  ServiceDefaults, service discovery, dashboard. Orchestration-only; .NET 8 floor.
- **dotnet-authentication** - ASP.NET Core authentication/authorization:
  JWT/OIDC/Identity, policy-based authorization, secret storage. .NET 8 floor.
- **dotnet-code-quality** - Mechanically enforce the C# house style: CSharpier
  formatter ownership, SDK analyzers (AnalysisLevel / .editorconfig severity), TreatWarningsAsErrors + legacy batch promotion, Roslynator, the dotnet build CI gate. .NET 8 floor.
- **dotnet-cryptography** - System.Security.Cryptography: SHA-2, AES-GCM,
  RSA/ECDSA, PBKDF2/Argon2id, constant-time comparison, deprecated-algorithm matrix. .NET 8 floor.
- **dotnet-error-handling** - Result pattern + ProblemDetails (RFC 9457) +
  global exception handler (IExceptionHandler) + FluentValidation. .NET 8 floor.
- **dotnet-grpc** - gRPC: .proto/codegen, ASP.NET Core host, four streaming
  modes, JWT/mTLS, interceptors, health checks, gRPC-Web. .NET 8 floor.
- **dotnet-hosted-services** - Hosted-service / worker conventions:
  BackgroundService vs IHostedService, the ExecuteAsync exception trap, scoped scopes, PeriodicTimer, graceful shutdown, Channels. .NET 8 floor.
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
- **dotnet-wpf** - WPF conventions: strict MVVM, binding modes, UI
  threading, list virtualization, localization.
- **project-quality-loop** - Autonomous review-and-fix loop pipeline: run a `loops/` folder of
  numbered prompts in order, looping each on a target to zero findings, deciding autonomously.
- **typescript** - Framework-agnostic TypeScript/JavaScript baseline:
  strict typing, type modeling, modules, async, error handling, JS with JSDoc.

## Repository layout

```text
skills/                 # the personal skills - one <skill-name>/SKILL.md per skill (some carry a references/ subfolder)
claude/                 # Claude Code stack: claude-stack.{sh,ps1,html}, CLAUDE.template.md, hooks/
cursor/                 # Cursor stack: cursor-stack.{sh,ps1,html}, AGENTS.template.md, hooks/, rules/
scripts/lint-skills.js  # repo lint (keeps skills / manifests / HTML in sync)
```

`skills/` is the flat layout the skills CLI discovers automatically. `claude/` and `cursor/` are the
per-agent stacks (each has its own README); each ships a stack-neutral `*.template.md` you copy into
a project and fill in.

## Maintenance

After adding, renaming, or removing a skill, plugin, or MCP, run the repo
lint. The per-agent installer scripts (`claude/claude-stack.{sh,ps1}` and
`cursor/cursor-stack.{sh,ps1}`) are the single source of truth for everything in
use; the lint verifies every skill directory is registered in the manifests
and this README, that each `SKILL.md` frontmatter loads as valid YAML (using
js-yaml, the same parser `skills.sh` uses, so a malformed block fails here
instead of silently dropping from the registry), that cross-skill references
resolve everywhere they appear (`SKILL.md` files, the Claude subagents, the base
templates, and the Cursor rules - a renamed skill is caught in all of them), that
the `require-convention-skill` hook only gates on skills that exist, that all four
installers agree (4-way: `SKILLS` + `MCPS` identical across both agents and both
shells, in the SAME ORDER, `PLUGINS` claude-only), that the on-disk subagents match
the set the installers fetch, that every per-agent README headline count (skills /
plugins / MCPs / hooks / agents / rules) matches the installer, and that the stack
inventory HTML matches the manifests in both directions:

```bash
npm install              # one-time: the lint needs js-yaml
node scripts/lint-skills.js   # or: npm run lint
```

## Credits / Acknowledgements

Two kinds of relationship, kept distinct:

**Live-installed dependencies (no incorporated text).** These MIT kits are installed by
the stack installers and pointed at by the `dotnet` / `frontend` routers; the house .NET
skills are original expression of standard .NET practices and carry no copied text from
them. Named voluntarily:

- [`codewithmukesh/dotnet-claude-kit`](https://github.com/codewithmukesh/dotnet-claude-kit) (MIT) - .NET skill kit (`clean-architecture`, `ddd`).
- [`aaronontheweb` (wshaddix)/`dotnet-skills`](https://github.com/wshaddix/dotnet-skills) (MIT, (c) 2025 Aaron Stannard) - .NET skill kit (`dotnet-slopwatch`, `OpenTelemetry-NET-Instrumentation`, and more).
- [Microsoft `dotnet/skills`](https://github.com/dotnet/skills) (MIT) - the official .NET skills.

**Incorporated content (attribution retained per MIT).** The two Angular skills
(`angular-conventions`, `angular-material`) fold in specific conventions mined from the
MIT sources below; their copyright notices are kept here, and an inline note marks each
skill:

- [`alfredoperez/angular-best-practices`](https://github.com/alfredoperez/angular-best-practices) (MIT) - signal queries, host-property syntax, `NgOptimizedImage`, route input-binding + resolvers, and testing-harness conventions folded into `angular-conventions` and `angular-material`.
- [`angular/skills`](https://github.com/angular/skills) (MIT, (c) 2026 Google LLC) - v20/v21 delta conventions folded into `angular-conventions`.

## License

[MIT](LICENSE) © 2026 envoydev
