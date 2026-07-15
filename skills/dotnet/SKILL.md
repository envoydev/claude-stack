---
name: dotnet
description: "Router and complete index for .NET / C# specialist skills - maps a concrete work area (a construct, command, file, or task) to the one focused skill to load, across language & types, architecture & structure, ASP.NET Core & web, cross-cutting hardening, data & EF, messaging & orchestration, hosting & background work, testing & quality, diagnostics & performance, and WPF desktop. Routes per area, does not restate the skills. Load when starting or navigating any .NET / C# backend or desktop work - typed asks like 'add an endpoint to the orders API', 'my BackgroundService stopped overnight', or 'which skill covers EF Core queries' all start here. Companion: csharp (always, for any C#). For web front-end see frontend; for Ionic/Capacitor see mobile."
---

# dotnet (skill router)

The single source-of-truth index mapping a concrete .NET work area - a construct, command, file, or task - to the one focused skill to load. It routes, it does not restate: load the named skill for the actual guidance. Pick by what you are about to do; if several rows match, load several.

**Companion, not optional:** load `csharp` whenever you write or refactor any C# - naming, layout, modern syntax, async, dispose, exceptions/Result, logging, DI lifetimes. Every row below is *in addition to* the C# baseline, never instead of it.

**Required vs optional.** The always-on spine of any .NET work is three skills: this router, `csharp` (every `.cs` file), and `dotnet-testing` (the moment a test is written or changed - tests are part of the done gate). Add exactly one surface hub for the app under build - `dotnet-web-backend` (ASP.NET Core), `dotnet-console-apps` + `dotnet-hosted-services` (worker / CLI / bot / daemon), or `dotnet-wpf` / `dotnet-winforms` (desktop). Every other row below is an optional specialist, loaded only when its area is in play - never up front.

**The trigger is the artifact**, not 'am I doing .NET'. In a specific repo, that repo's `CLAUDE.md` binds these rows to its own file names and folders.

## Language and types

| You are about to... | Load |
|---|---|
| write or refactor any C# (naming, async, dispose, exceptions/Result, logging, DI lifetimes, modern syntax) | `csharp` (always) |
| add a `Channel<>`, `lock`, `SemaphoreSlim`, `Interlocked`, `Thread`, or other synchronization / producer-consumer code | `dotnet-hosted-services` (its `references/concurrency.md`) |
| define a type where allocation or memory layout matters (struct vs class, `readonly struct`, pooling, `Span`) | `dotnet-performance` (its `references/type-design.md`) |
| (de)serialize JSON, reuse `JsonSerializerOptions`, or add a `JsonSerializerContext`, or pick a wire format (Protobuf/MessagePack) | `dotnet-performance` (its `references/serialization.md`) |
| author a Roslyn `IIncrementalGenerator`, or consume `[GeneratedRegex]` / `[LoggerMessage]` / `[JsonSerializable]` | `dotnet-source-generators` |
| choose or implement a GoF design pattern (factory, strategy, observer, undo/redo, plugin seams) or fix pattern misuse | `csharp-design-patterns` |

## Architecture and structure

| You are about to... | Load |
|---|---|
| model a domain type - aggregate, value object, domain event, strongly-typed ID | `dotnet-architecture` (its `references/ddd.md`) |
| decide which layer something belongs in, define a cross-layer port, or draw a module/service boundary | `dotnet-architecture` (the style decision + load-one rule live in its hub) |
| enforce layer / dependency / naming / isolation boundaries as automated tests (fitness functions) that fail the build | `dotnet-architecture-tests` |
| register services, build an `Add*` extension, or reason about DI lifetimes | `csharp` (lifetimes in the hub; `Add*` / keyed / factory composition in its `references/dependency-injection.md`) |
| bind or validate settings - `IOptions`, `IValidateOptions`, `ValidateOnStart` | `dotnet-web-backend` (its typed-options section) |
| set up a new solution - the layout, `.slnx`, `Directory.Build.props`, or `global.json` | `dotnet-project-setup` |
| add or upgrade a NuGet package, or edit `Directory.Packages.props` | `dotnet-project-setup` (its `references/central-package-management.md`) |
| set up or enforce C# formatting and analyzers - CSharpier, SDK analyzers, `.editorconfig` severity, `TreatWarningsAsErrors`, the CI quality gate | `dotnet-code-quality` |
| run a .NET migration workflow - EF schema, .NET/SDK version upgrade, or NuGet update with preview/rollback/verify | `dotnet-migrate` |

## ASP.NET Core and web

| You are about to... | Load |
|---|---|
| build any ASP.NET Core / Web API / microservice (cross-cutting baseline: HttpClient, resilience, versioning, observability, caching) | `dotnet-web-backend` (web hub - load first) |
| write minimal-API endpoint mechanics - `MapGroup`, `TypedResults`/`Results<>`, `IEndpointFilter`, parameter binding, file uploads | `dotnet-minimal-api` |
| write controller-based Web API mechanics - `[ApiController]`, attribute routing, `ActionResult<T>`, the automatic-400 filter, action filters, binding sources | `dotnet-mvc-controllers` |
| generate the OpenAPI document (Swashbuckle vs .NET 9 built-in, transformers, security schemes) or serve Scalar/Swagger UI | `dotnet-openapi` |
| map Result-to-HTTP, return RFC 9457 `ProblemDetails`, add a global `IExceptionHandler`, or validate via a FluentValidation endpoint filter | `dotnet-error-handling` |
| add authentication / authorization - JWT bearer, cookies, OIDC, ASP.NET Identity, policy-based authz, API keys | `dotnet-authentication` |
| build a gRPC service or client - `.proto` codegen, streaming modes, interceptors, status mapping, gRPC-Web | `dotnet-grpc` |
| push real-time updates to connected clients - SignalR hubs, strongly-typed `Hub<T>`, `IHubContext`, groups/presence, reconnection, Redis/Azure backplane scale-out | `dotnet-realtime` |

## Cross-cutting hardening

| You are about to... | Load |
|---|---|
| harden against OWASP Top 10 - injection, broken access control, SSRF, dependency audit, deprecated-security patterns | `dotnet-security` |
| use `System.Security.Cryptography` - hashing, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare | `dotnet-cryptography` |

## Data and EF

| You are about to... | Load |
|---|---|
| design or modify a schema, write SQL (raw or ORM), model a NoSQL doc, or create migrations / views / procs / indexes | `database-conventions` (data hub) |
| write EF Core / NHibernate data access - `Include`/`ThenInclude`, `AsSplitQuery`, `AsNoTracking`, query shaping | `dotnet-data-access` (its `references/efcore.md` or `references/nhibernate.md`) |
| diagnose ORM read-path performance - N+1, projection shape, change tracking, row count | `dotnet-data-access` (engine-side EXPLAIN / index / planner -> `postgres` or `sqlite`) |

## Messaging and orchestration

| You are about to... | Load |
|---|---|
| build broker-backed async messaging - Wolverine/MassTransit, transactional outbox, choreography vs sagas, message contracts | `dotnet-messaging` |
| wire local cloud-native orchestration - Aspire AppHost (`AddProject`/`AddPostgres`/`WithReference`/`WaitFor`), ServiceDefaults, dashboard | `dotnet-aspire` |

## Hosting and background work

| You are about to... | Load |
|---|---|
| write a worker service or in-process background task - `BackgroundService`/`IHostedService`, the `ExecuteAsync` exception trap, scoped services from the host, `PeriodicTimer`, graceful shutdown, `Channel<>`-backed work | `dotnet-hosted-services` |
| harden a long-running worker's outbound I/O - `HttpClient`/socket exhaustion, Polly v8 resilience, rate limiting, `ClientWebSocket` reconnect | `dotnet-hosted-services` (its `references/resilience-and-io.md`) |
| pick a scheduler (Hangfire / Quartz.NET / Coravel) or run a job on exactly one instance (leader election) | `dotnet-hosted-services` (its `references/scheduling-and-coordination.md`) |
| deploy or observe a headless worker - signals, systemd / container / Kubernetes shutdown, health checks without Kestrel, `[LoggerMessage]` | `dotnet-hosted-services` (its `references/deployment-and-observability.md`) |
| build a CLI tool - argument parsing (`System.CommandLine` 2.0 / `Spectre.Console.Cli` / `Cocona`), subcommands, exit codes | `dotnet-console-apps` |
| build a chat or trading bot - a Telegram / Discord / Slack / exchange SDK plugged into a `BackgroundService`, command handlers in DI | `dotnet-console-apps` (its `references/bot-sdks.md`) |

## Testing and quality

| You are about to... | Load |
|---|---|
| write, modify, or review .NET tests, or configure coverage (per-layer strategy, AAA, xUnit/NSubstitute/FluentAssertions) | `dotnet-testing` (test hub) |
| add container-backed integration tests | `dotnet-testing` (its `references/testcontainers.md`) |
| test an Aspire-orchestrated app end-to-end | `dotnet-testing` (its `references/aspire-integration-testing.md`) |
| add Verify / snapshot assertions | `dotnet-testing` (its `references/snapshot-testing.md`) |
| check a diff for reward-hacking / coverage-gaming shortcuts, or CRAP-score risk before claiming done | `dotnet-code-quality` (its reward-hacking list + `references/crap-analysis.md`) |

## Diagnostics and performance

| You are about to... | Load |
|---|---|
| add OpenTelemetry tracing / metrics instrumentation | `dotnet-web-backend` (wiring in the hub; manual spans / metrics in its `references/observability.md`) |
| write a microbenchmark (BenchmarkDotNet) | `dotnet-diagnostics` (its `references/microbenchmarking.md`) |
| capture or analyze a crash / hang dump | `dotnet-diagnostics` (its `references/dumps.md`) |
| inspect a compiled assembly's real API or behavior | `ilspy-decompile` |
| install or pin a .NET local tool (`dotnet tool` / manifest) | `dotnet-project-setup` (its `references/local-tools.md`) |

## Desktop

| You are about to... | Load |
|---|---|
| build a WPF desktop UI - strict MVVM, bindings, dependency/attached properties, async commands, `INotifyDataErrorInfo`, threading | `dotnet-wpf` |
| build or maintain a WinForms desktop UI - logic out of code-behind (MVP / the .NET 8 binding engine), control/component/GDI disposal, high-DPI, 4.8-vs-modern deltas | `dotnet-winforms` |

## Legacy: .NET Framework 4.8 (net48)

Maintaining or hardening a .NET Framework 4.8 codebase - the deltas from the modern floor live as a `references/net-framework-48.md` inside each owner skill. Load the owner, then that file.

| You are about to... | Load |
|---|---|
| write C# for net48 - the C# 7.3 language ceiling, compiler-only vs CLR-dependent features, polyfill packages, and the SynchronizationContext / ConfigureAwait async caveat | `csharp` (its `references/net-framework-48.md`) |
| harden a net48 app - TLS registry keys, BinaryFormatter still shipping, ViewState / machineKey rotation, classic-ASP.NET headers, web.config secrets, dependency auditing | `dotnet-security` (its `references/net-framework-48.md`) |
| use crypto on net48 - the PBKDF2 SHA-1 default, the RNG API name, AES-GCM availability | `dotnet-cryptography` (its `references/net-framework-48.md`) |
| optimize on net48 - the 'slow span', NuGet-only fast-path packages, benchmarking on net48 | `dotnet-performance` (its `references/net-framework-48.md`) |
| configure a net48 project - packages.config -> PackageReference, LangVersion pinning, Server GC, binding redirects | `dotnet-project-setup` (its `references/net-framework-48.md`) |
| migrate off net48 - the frozen-platform stance and the upgrade-vs-replace blocker map | `dotnet-migrate` (its `references/net-framework-48.md`) |
| build or maintain classic ASP.NET (MVC 5 / Web API 2 / Web Forms) on net48 - the single-threaded request context, no IHttpClientFactory, OWIN pipeline, caching | `dotnet-web-backend` (its `references/net-framework-48.md`) |
| wire MVC 5 / Web API 2 controllers - the two separate DI resolvers, bind-DTOs-not-entities, anti-forgery | `dotnet-mvc-controllers` (its `references/net-framework-48.md`) |
| add auth to classic ASP.NET - OWIN / Katana, ASP.NET Identity 2.x, OAuth bearer + JWT validation | `dotnet-authentication` (its `references/net-framework-48.md`) |
| pick and scope EF on net48 - EF Core 3.1 vs EF6, DbContext-per-request, the single-operation rule | `dotnet-data-access` (its `references/net-framework-48.md`) |
| test classic ASP.NET on net48 - in-memory OWIN TestServer, HttpContextBase over sealed HttpContext.Current | `dotnet-testing` (its `references/net-framework-48.md`) |
| build or maintain a WPF app on net48 - CommunityToolkit.Mvvm source-generator constraints, Generic Host composition, app-level exception handlers | `dotnet-wpf` (its `references/net-framework-48.md`) |

The async deadlock angle (why `ConfigureAwait(false)` is load-bearing here) is in `dotnet-hosted-services`' `references/concurrency.md`.

## Notes

- **Every target is house-owned.** This router points only to skills authored in this repo - hubs that carry a `references/` folder (`dotnet-architecture`, `dotnet-data-access`, `dotnet-project-setup`, `dotnet-performance`, `dotnet-diagnostics`) and the leaf specialists. Some rows route into a hub's reference file rather than a standalone skill - load the named skill and open that reference; nothing here installs from a third-party kit.
- **Hubs vs leaves.** `csharp` is the C# baseline hub, `dotnet-web-backend` the web hub, `database-conventions` the data hub, `dotnet-testing` the test hub - a leaf specialist points UP to its hub, the hub points DOWN to its deep specialists, and this router indexes them all. Load the web hub before a web specialist; load the data hub before EF/SQL specialists.
- **Out of this router's scope.** Web front-end work routes through `frontend` (and `mobile` for Ionic/Capacitor), not here. Cross-cutting flow that is not .NET-specific - `/security-review`, `/code-review`, context7 library docs, git - lives in the project's `CLAUDE.md`.
