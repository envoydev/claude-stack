---
name: dotnet-web-backend
description: "Personal .NET web / HTTP service conventions - the architecture-neutral cross-cutting baseline every ASP.NET Core service shares: IHttpClientFactory, FluentValidation, resilience via Microsoft.Extensions.Http.Resilience, API versioning, OpenAPI, typed options with startup validation (IOptions / ValidateOnStart), observability (structured logging, OpenTelemetry to OTLP, correlation IDs, health checks), and caching (IMemoryCache, HybridCache, Redis). This is the web hub - load it first for any ASP.NET Core / Web API / minimal API / microservice work, then the focused companion for the how. It owns the 'pick exactly one architecture' rule but mandates no specific one. Floors at .NET 8 / C# 12. Do NOT load for console binaries, CLI tools, desktop apps, WPF/MAUI, daemons, or message-only consumers."
---

# .NET Web / HTTP Service Conventions

This is the web hub - the first skill to load for any HTTP service, the place the cross-cutting concerns every ASP.NET Core app shares are decided once. It is deliberately architecture-neutral: it tells you how the HTTP client, validation, resilience, observability, and caching layers behave, and it sends you to a focused companion for endpoint mechanics, errors, OpenAPI, and auth. It mandates no particular architecture - that is a separate, deliberate choice covered below. Floor is .NET 8 / C# 12; anything that needs a later runtime is flagged.

On .NET Framework 4.8 the classic pipeline (MVC 5 / Web API 2 / Web Forms) differs materially - the single-threaded request context, no `IHttpClientFactory`, the OWIN pipeline - see `references/net-framework-48.md`.

## Architecture - pick exactly one, here

This is the single home of the architecture rule, and it has one job: stop two patterns living side by side in one repo.

- In an established codebase, the existing architecture wins. Match its structure exactly; do not introduce a second pattern alongside the one already there, even a 'better' one. A repo with two architectures has neither.
- For greenfield work the architecture is a deliberate decision - load `dotnet-architecture` and follow its pick-one rule (one internal style per codebase, plus the topology and DDD-additive axes). The decision layer and each style's depth live in that hub; do not restate it here.
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
- When you are designing or evolving a contract that other people consume - a REST surface or a published NuGet / shared library API - its `references/api-versioning.md` owns extend-only design, binary compatibility, API-approval testing, and safe versioning.

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

That covers the wiring this skill owns - registering the providers, the auto-instrumentation, and the OTLP exporter for traces, metrics, and logs. Deep manual instrumentation is a different job: custom `Activity` / span creation, getting metric cardinality right, zero-alloc `TagList`, and propagators all belong to its `references/observability.md`. Defer to that rather than hand-rolling spans here - do not restate its rules in service code.

- **Correlation IDs:** propagate on every cross-service hop via the W3C `traceparent` header (OpenTelemetry handles this once it is wired) and include the trace / correlation id in every log entry so a log line ties back to a trace.
- **Health checks:** `MapHealthChecks` for liveness and readiness on every web service, on separate endpoints per probe - liveness answers 'is the process alive', readiness answers 'can it serve traffic yet'. Map readiness only where an orchestrator polls it.

If the service runs under Aspire, ServiceDefaults is the composition point that registers exactly this OpenTelemetry, health-check, and resilience setup in one call - this skill decides *what* goes in, `dotnet-aspire` owns *where* it is assembled.

- **Mask secrets before they reach a sink:** log `apiKey[..4] + "***"`, a user id rather than an email, and never a raw token, password, connection string, or key. A structured sink is queryable and long-retained, so a secret logged once is leaked for as long as the logs live.

## Caching

Match the cache to the topology, and always set an expiry.

- `IMemoryCache` for a single-process, short-TTL cache - fastest, but invisible to other instances.
- `HybridCache` (the `Microsoft.Extensions.Caching.Hybrid` package) when you want both an in-process L1 and a distributed L2 behind one API, with stampede protection and tag-based invalidation built in. It is now GA and the default for any multi-instance service; the package targets down to .NET Standard 2.0, so it runs on the .NET 8 floor, not just .NET 9:

```csharp
builder.Services.AddHybridCache();

// in a service:
var order = await cache.GetOrCreateAsync(
    $"order:{id}",
    async ct => await repo.GetOrderAsync(id, ct),
    cancellationToken: ct);
```

If you would rather not add the dependency, fall back to `IDistributedCache` (the Redis implementation) for the distributed tier and `IMemoryCache` for the local tier directly - but `HybridCache` is the better default now that it runs on the floor.

- Redis (StackExchange.Redis) is the distributed store behind either path. Always set an expiry; never cache forever.
- Put a version or schema marker in the cache key so a deploy invalidates stale entries automatically, and never cache user-specific data without partitioning the key by user identifier.
- For whole-response caching, use output caching (`AddOutputCache`), not response caching - response caching is header-driven and browsers routinely defeat it. Output caching caches only `200` responses to unauthenticated `GET`/`HEAD` requests by default. Do not back it with `IDistributedCache` (no atomic operations for tag eviction); to scale out across instances use the built-in Redis output-cache provider (`AddStackExchangeRedisOutputCache`, on the .NET 8 floor) and evict grouped entries by tag via `IOutputCacheStore.EvictByTagAsync`.

## Typed options and startup validation

Bind every configuration section to a strongly-typed class and validate it once, at startup - a misconfigured service should fail to boot with a clear message, not throw ten minutes into production from deep inside a request. That fail-fast discipline is the single most important rule here, and it is one registration chain:

```csharp
builder.Services.AddOptions<SmtpSettings>()
    .BindConfiguration(SmtpSettings.SectionName)
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

`.ValidateOnStart()` is the load-bearing call - without it validation runs lazily on first access, which defeats the point. Put simple rules on the class as data-annotation attributes (`[Required]`, `[Range]`). For anything an attribute cannot express - cross-property rules, conditional rules, or rules that depend on `IHostEnvironment` - implement `IValidateOptions<T>`, register it as a singleton, collect every failure into a list and return `ValidateOptionsResult.Fail`; never throw from a validator, as that breaks the chain. Use `PostConfigure` to normalize a bound value (append a trailing slash, apply a default) after binding but before validation.

Pick the lifetime by how the value changes: `IOptions` is a singleton read once at startup - the default for static config; `IOptionsSnapshot` is scoped and re-reads per request; `IOptionsMonitor` is a singleton that reloads on change and fires an `OnChange` callback, so it is the one for background services and hot reload.

Anti-patterns:
- Injecting `IOptions` where the value must track config changes - that read-once wants `IOptionsMonitor` instead.
- Reading raw `IConfiguration` (`config["Smtp:Host"]`) in a service - it skips binding and validation and resists testing; inject the typed options.
- Validating in a constructor or on first use - that is runtime, not startup; move the rule into a validator behind `ValidateOnStart`.

## Tooling

- Run `dotnet format` before every commit and enforce it in CI - formatting drift should never reach review.
- Audit dependencies with `dotnet list package --vulnerable` before any release-bound change.

## Deep specialists

This skill is the cross-cutting baseline; load the focused companion for the *how*:

Default a new HTTP surface to minimal APIs; the full minimal-vs-controllers decision - when controllers earn their place, chosen per surface, not per repo - is owned by `dotnet-mvc-controllers` (its decision section).

- Endpoint mechanics (MapGroup, TypedResults, filters, binding, uploads) -> `dotnet-minimal-api`
- Controller-based Web API ([ApiController], attribute routing, action filters) -> `dotnet-mvc-controllers`
- AuthN / authZ (JWT/OIDC/Identity/policies) -> `dotnet-authentication`
- OWASP hardening / SSRF / dependency audit -> `dotnet-security`
- gRPC services -> `dotnet-grpc`
- Background workers / hosted tasks (a daemon, an in-process `BackgroundService`, a message-only consumer's host) -> `dotnet-hosted-services`
- Broker messaging / outbox / sagas -> `dotnet-messaging`
- Per-layer tests -> `dotnet-testing`

Errors (`dotnet-error-handling`), the OpenAPI document (`dotnet-openapi`), deep manual OpenTelemetry (`references/observability.md`), and Aspire (`dotnet-aspire`) are routed where they arise in the sections above.

## See also

Full index of every .NET specialist skill: the `dotnet` router. Architecture choice (exactly one per project) is governed by `## Architecture` above.
