---
name: dotnet
description: "Router and complete index for .NET / C# specialist skills - maps a concrete work area (a construct, command, file, or task) to the one focused skill to load, across language & types, architecture & structure, ASP.NET Core & web, cross-cutting hardening, data & EF, messaging & orchestration, testing & quality, diagnostics & performance, and WPF desktop. Routes per area, does not restate the skills. Companion: csharp (always, for any C#)."
---

# dotnet (skill router)

The single source-of-truth index mapping a concrete .NET work area - a construct, command, file, or task - to the one focused skill to load. It routes, it does not restate: load the named skill for the actual guidance. Pick by what you are about to do; if several rows match, load several.

**Companion, not optional:** load `csharp` whenever you write or refactor any C# - naming, layout, modern syntax, async, dispose, exceptions/Result, logging, DI lifetimes. Every row below is *in addition to* the C# baseline, never instead of it.

**The trigger is the artifact**, not "am I doing .NET". In a specific repo, that repo's `CLAUDE.md` binds these rows to its own file names and folders.

## Language and types

| You are about to... | Load |
|---|---|
| write or refactor any C# (naming, async, dispose, exceptions/Result, logging, DI lifetimes, modern syntax) | `csharp` (always) |
| add a `Channel<>`, `lock`, `SemaphoreSlim`, `Interlocked`, `Thread`, or other synchronization / producer-consumer code | `csharp-concurrency-patterns` |
| define a type where allocation or memory layout matters (struct vs class, `readonly struct`, pooling, `Span`) | `type-design-performance` |
| (de)serialize JSON, reuse `JsonSerializerOptions`, or add a `JsonSerializerContext` | `serialization` |
| author a Roslyn `IIncrementalGenerator`, or consume `[GeneratedRegex]` / `[LoggerMessage]` / `[JsonSerializable]` | `dotnet-source-generators` |
| choose or implement a GoF design pattern (factory, strategy, observer, undo/redo, plugin seams) or fix pattern misuse | `csharp-design-patterns` |

## Architecture and structure

| You are about to... | Load |
|---|---|
| model a domain type - aggregate, value object, domain event, strongly-typed ID | `ddd` |
| decide which layer something belongs in, or define a cross-layer port | `clean-architecture` or `vertical-slice-architecture` (which one, and the load-exactly-one rule, is owned by `dotnet-web-backend`) |
| enforce layer / dependency / naming / isolation boundaries as automated tests (fitness functions) that fail the build | `dotnet-architecture-tests` |
| register services, build an `Add*` extension, or reason about DI lifetimes | `dependency-injection-patterns` |
| bind or validate settings - `IOptions`, `IValidateOptions`, startup validation | `microsoft-extensions-configuration` |
| set up a new project, `.slnx`, `Directory.Build.props`, or `global.json` | `dotnet-project-structure` |
| add or upgrade a NuGet package, or edit `Directory.Packages.props` | `package-management` |
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
| write EF Core data access - `Include`/`ThenInclude`, `AsSplitQuery`, `AsNoTracking`, query shaping | `efcore-patterns` |
| diagnose read-path performance - N+1, projection shape, change tracking, row count | `database-performance` |

## Messaging and orchestration

| You are about to... | Load |
|---|---|
| build broker-backed async messaging - Wolverine/MassTransit, transactional outbox, choreography vs sagas, message contracts | `dotnet-messaging` |
| wire local cloud-native orchestration - Aspire AppHost (`AddProject`/`AddPostgres`/`WithReference`/`WaitFor`), ServiceDefaults, dashboard | `dotnet-aspire` |

## Hosting and background work

| You are about to... | Load |
|---|---|
| write a worker service or in-process background task - `BackgroundService`/`IHostedService`, the `ExecuteAsync` exception trap, scoped services from the host, `PeriodicTimer`, graceful shutdown, `Channel<>`-backed work | `dotnet-hosted-services` |

## Testing and quality

| You are about to... | Load |
|---|---|
| write, modify, or review .NET tests, or configure coverage (per-layer strategy, AAA, xUnit/NSubstitute/FluentAssertions) | `dotnet-testing` (test hub) |
| add container-backed integration tests | `testcontainers-integration-tests` |
| test an Aspire-orchestrated app end-to-end | `aspire-integration-testing` |
| add Verify / snapshot assertions | `snapshot-testing` |
| check a diff for reward-hacking / coverage gaming, or CRAP-score risk before claiming done | `dotnet-slopwatch` + `crap-analysis` |

## Diagnostics and performance

| You are about to... | Load |
|---|---|
| add OpenTelemetry tracing / metrics instrumentation | `OpenTelemetry-NET-Instrumentation` |
| write a microbenchmark (BenchmarkDotNet) | `microbenchmarking` |
| capture or analyze a crash / hang dump | `dump-collect` |
| inspect a compiled assembly's real API or behavior | `ilspy-decompile` |
| install or pin a .NET local tool (`dotnet tool` / manifest) | `dotnet-local-tools` |

## Desktop

| You are about to... | Load |
|---|---|
| build a WPF desktop UI - strict MVVM, bindings, dependency/attached properties, async commands, `INotifyDataErrorInfo`, threading | `dotnet-wpf` |

## Notes

- **Router, not a copy.** This lists *where to look*, not the guidance. Always load the named skill; this file never restates it.
- **External specialists - not local skills, not typos.** Many rows route to targets that ship from third-party kits, installed live by the stack installer, not authored in this repo: `ddd`, `clean-architecture`, `vertical-slice-architecture`, `efcore-patterns`, `csharp-concurrency-patterns`, `type-design-performance`, `OpenTelemetry-NET-Instrumentation`, and more come from `aaronontheweb/dotnet-skills`, `dotnet/skills`, and `codewithmukesh/dotnet-claude-kit`. They resolve externally once the kits are installed; a name here with no matching local folder is one of these, not a dangling reference.
- **Hubs vs leaves.** `csharp` is the C# baseline hub, `dotnet-web-backend` the web hub, `database-conventions` the data hub, `dotnet-testing` the test hub - a leaf specialist points UP to its hub, the hub points DOWN to its deep specialists, and this router indexes them all. Load the web hub before a web specialist; load the data hub before EF/SQL specialists.
- **Out of this router's scope.** Web front-end work routes through `frontend` (and `mobile` for Ionic/Capacitor), not here. Cross-cutting flow that is not .NET-specific - `/security-review`, `/code-review`, `context7` library docs, git - lives in the project's `CLAUDE.md`.
