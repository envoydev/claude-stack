---
name: dotnet-web-backend
description: "Personal .NET web / HTTP service conventions - the architecture-neutral cross-cutting baseline every ASP.NET Core service shares: IHttpClientFactory, FluentValidation, resilience via Microsoft.Extensions.Http.Resilience, API versioning, OpenAPI, observability (structured logging, OpenTelemetry to OTLP, correlation IDs, health checks), and caching (IMemoryCache, HybridCache, Redis). This is the web hub - load it first for any ASP.NET Core / Web API / minimal API / microservice work, then the focused companion for the how. It owns the 'pick exactly one architecture' rule but mandates no specific one. Floors at .NET 8 / C# 12. Do NOT load for console binaries, CLI tools, desktop apps, WPF/MAUI, daemons, or message-only consumers."
---

# .NET Web / HTTP Service Conventions

This is the web hub - the first skill to load for any HTTP service, the place the cross-cutting concerns every ASP.NET Core app shares are decided once. It is deliberately architecture-neutral: it tells you how the HTTP client, validation, resilience, observability, and caching layers behave, and it sends you to a focused companion for endpoint mechanics, errors, OpenAPI, and auth. It mandates no particular architecture - that is a separate, deliberate choice covered below. Floor is .NET 8 / C# 12; anything that needs a later runtime is flagged.

## Architecture - pick exactly one, here

This is the single home of the architecture rule, and it has one job: stop two patterns living side by side in one repo.

- In an established codebase, the existing architecture wins. Match its structure exactly; do not introduce a second pattern alongside the one already there, even a 'better' one. A repo with two architectures has neither.
- For greenfield work the architecture is a deliberate decision, made by loading exactly one architecture skill - `vertical-slice-architecture` for feature-folder / VSA work, or one layered reference (`clean-architecture` or DDD). Load one and only one. Never load two architecture skills in a single project; they describe mutually exclusive ways to slice the same code.
- Everything below this section - HTTP, validation, resilience, API design, observability, caching - applies unchanged whichever architecture you picked. These are pipeline concerns; they sit underneath the architecture, not inside it.

## HTTP and packages

Reach for `IHttpClientFactory` and never `new HttpClient()`. A factory-managed client pools and rotates its handlers, so it picks up DNS changes and avoids the socket exhaustion a long-lived raw client causes. Prefer a typed client (`AddHttpClient<TClient>()`) so the call surface is an injected, testable interface rather than a stringly-keyed lookup, and so the resilience handler below has one obvious place to attach.

Use `Directory.Packages.props` (central package management) wherever the project supports it, so every project resolves one version of each dependency. Pin exact versions for anything security-sensitive rather than floating a range.

## Validation

FluentValidation is the default validator. Reserve ASP.NET Core `ModelState` / data annotations for genuinely trivial DTOs where a `[Required]` says all there is to say. The validation-error shape, the `ProblemDetails` mapping, and the endpoint filter that runs the validator are owned by `dotnet-error-handling` - do not assemble an error body or a filter here; this skill only fixes the library choice.

## Resilience

Outbound calls fail transiently; the policy for that is `Microsoft.Extensions.Http.Resilience` (Polly v8 under the hood). For an `HttpClient` pipeline, `AddStandardResilienceHandler()` adds a sensible default stack - rate limiter, total-request timeout, retry with backoff, circuit breaker, per-attempt timeout - in one line, and exposes the options for tuning:

```csharp
builder.Services.AddHttpClient<IOrdersClient, OrdersClient>(c =>
        c.BaseAddress = new Uri("https://orders"))
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(5);
        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
    });
```

Prefer the standard handler over a hand-rolled pipeline; the ordering of its strategies is the part that is easy to get subtly wrong. For a non-HTTP call - a database command, a broker publish - there is no handler to hang off, so build a Polly v8 `ResiliencePipeline` directly and invoke through it:

```csharp
var pipeline = new ResiliencePipelineBuilder()
    .AddRetry(new RetryStrategyOptions { MaxRetryAttempts = 3, BackoffType = DelayBackoffType.Exponential })
    .AddTimeout(TimeSpan.FromSeconds(10))
    .Build();

await pipeline.ExecuteAsync(async ct => await broker.PublishAsync(message, ct), ct);
```

One caution: do not stack a per-attempt resilience timeout on top of a client request timeout that is shorter - the outer one cancels mid-retry and the policy never gets to do its job. Let the resilience handler own the timing.

## API design

- Version every public route explicitly - `/api/v1/...` in the path, or an `Api-Version` header - and treat a shipped contract as frozen. Never break a versioned contract; add a v2 alongside it instead.
- Generate OpenAPI for every public HTTP API and keep request, response, and error shapes documented. The generator choice (Swashbuckle vs the .NET 9+ built-in) and the Scalar / Swagger UI are owned by `dotnet-openapi`.
- When you are designing or evolving a contract that other people consume - a REST surface or a published NuGet / shared library API - load `api-design` for extend-only design, wire / binary compatibility, and safe versioning. The 'add v2, never break v1' discipline is its domain; this skill just states the rule.

## Observability

Three signals, one destination. Wire all of it to OTLP and let the collector or backend fan it out per environment - that keeps the app code identical from laptop to production.

- **Logging:** structured throughout, via Serilog or `Microsoft.Extensions.Logging` with a structured sink. Log with message templates and named properties, never interpolated strings - a structured sink can query `{OrderId}` but cannot query a baked-in number.
- **Tracing and metrics:** OpenTelemetry on any service that runs in production, exporting to OTLP. The standard wiring is one builder chain:

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());

builder.Logging.AddOpenTelemetry(o =>
{
    o.IncludeFormattedMessage = true;
    o.AddOtlpExporter();
});
```

That covers the wiring this skill owns - registering the providers, the auto-instrumentation, and the OTLP exporter for traces, metrics, and logs. Deep manual instrumentation is a different job and a different skill: custom `Activity` / span creation, getting metric cardinality right, zero-alloc `TagList`, and propagators all belong to `OpenTelemetry-NET-Instrumentation`. Defer to it rather than hand-rolling spans here - do not restate its rules in service code.

- **Correlation IDs:** propagate on every cross-service hop via the W3C `traceparent` header (OpenTelemetry handles this once it is wired) and include the trace / correlation id in every log entry so a log line ties back to a trace.
- **Health checks:** `MapHealthChecks` for liveness and readiness on every web service, on separate endpoints per probe - liveness answers 'is the process alive', readiness answers 'can it serve traffic yet'. Map readiness only where an orchestrator polls it.

If the service runs under Aspire, ServiceDefaults is the composition point that registers exactly this OpenTelemetry, health-check, and resilience setup in one call - this skill decides *what* goes in, `dotnet-aspire` owns *where* it is assembled.

## Caching

Match the cache to the topology, and always set an expiry.

- `IMemoryCache` for a single-process, short-TTL cache - fastest, but invisible to other instances.
- `HybridCache` (`Microsoft.Extensions.Caching.Hybrid`, .NET 9+) when you want both an in-process L1 and a distributed L2 behind one API, with stampede protection and tag-based invalidation built in. It is the default for any multi-instance service on .NET 9 or later:

```csharp
builder.Services.AddHybridCache();

// in a service:
var order = await cache.GetOrCreateAsync(
    $"order:{id}",
    async ct => await repo.GetOrderAsync(id, ct),
    cancellationToken: ct);
```

On .NET 8, `HybridCache` is not available - use `IDistributedCache` (the Redis implementation) for the distributed tier and `IMemoryCache` for the local tier directly, and reach for output caching (`AddOutputCache`, attach per group) for whole-response caching. Treat this as the floor behaviour you upgrade away from once on .NET 9.

- Redis (StackExchange.Redis) is the distributed store behind either path. Always set an expiry; never cache forever.
- Put a version or schema marker in the cache key so a deploy invalidates stale entries automatically, and never cache user-specific data without partitioning the key by user identifier.

## Tooling

- Run `dotnet format` before every commit and enforce it in CI - formatting drift should never reach review.
- Audit dependencies with `dotnet list package --vulnerable` before any release-bound change.

## Deep specialists

This skill is the cross-cutting baseline; load the focused companion for the *how*:

- Endpoint mechanics (MapGroup, TypedResults, filters, binding, uploads) -> `dotnet-minimal-api`
- Controller-based Web API ([ApiController], attribute routing, action filters) -> `dotnet-mvc-controllers`
- OpenAPI document + Scalar UI -> `dotnet-openapi`
- Result / `ProblemDetails` errors + the FluentValidation filter -> `dotnet-error-handling`
- AuthN / authZ (JWT/OIDC/Identity/policies) -> `dotnet-authentication`
- OWASP hardening / SSRF / dependency audit -> `dotnet-security`
- Deep manual OpenTelemetry (custom spans, metric cardinality, propagators) -> `OpenTelemetry-NET-Instrumentation`
- gRPC services -> `dotnet-grpc`
- Background workers / hosted tasks (a daemon, an in-process `BackgroundService`, a message-only consumer's host) -> `dotnet-hosted-services`
- Broker messaging / outbox / sagas -> `dotnet-messaging`
- Local cloud-native orchestration (Aspire) -> `dotnet-aspire`
- Per-layer tests -> `dotnet-testing`

## See also

Full index of every .NET specialist skill: the `dotnet` router. Architecture choice (exactly one per project) is governed by `## Architecture` above.
