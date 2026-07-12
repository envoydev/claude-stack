---
name: dotnet-aspire
description: "Personal .NET Aspire conventions for local cloud-native orchestration - the AppHost that declares the topology, the shared ServiceDefaults extension every service calls once, name-based service discovery, AppHost-injected connection strings, and the developer dashboard. This is the local run, NOT production deployment or container publishing. Floors at .NET 8 / C# 12. Load when scaffolding or editing an AppHost or ServiceDefaults, declaring resources and references, wiring discovery, or when the user says Aspire, AppHost, AddProject, WithReference, service discovery, or Aspire dashboard. Companions: dotnet-web-backend, dotnet-testing. Do NOT load for non-Aspire projects, production deployment, or publishing images."
---

# .NET Aspire - local orchestration

Aspire describes a distributed app as one object graph and runs the whole thing with a single F5 - everything starts together with the right connection strings already threaded between resources, and one dashboard shows every process's traces, logs, and metrics. Floor is .NET 8 / C# 12.

Aspire is two cooperating pieces, and this skill is about both:
- the **AppHost**, a small project that declares the topology and orchestrates the local run;
- **ServiceDefaults**, a shared library every service calls into for the cross-cutting plumbing.

The cross-cutting plumbing itself - OpenTelemetry exporters, the health-check probes, the resilience handlers - is configured by `dotnet-web-backend`. ServiceDefaults is just the composition point where they all get registered in one call. This skill owns the orchestration; it does not re-teach what goes inside the defaults.

## What Aspire is and is not

- It orchestrates a **local development run**. It is not a deployment system. The graph you write here drives `dotnet run` on the AppHost; getting the app onto a server is a separate concern that belongs to your CI and container tooling, and is out of scope for this skill.
- It does not change how your services are written. A service still reads a connection string from configuration and constructs its clients the ordinary way - the AppHost is what hands it that connection string. Keep Aspire's client packages and resource types out of business logic; if you find yourself reaching for an Aspire type inside a handler, the wiring has leaked into the wrong layer.
- Prefer the first-party integrations - Postgres, Redis, RabbitMQ, SQL Server, and the rest - over standing up a bare container and configuring it yourself. Each integration package handles the connection string, registers a health check, and emits traces, so you inherit observability and readiness for free instead of bolting them on.

## The AppHost owns the topology

One AppHost project is the single place that knows which resources exist and how they depend on each other. It is a normal console app whose `Program.cs` builds a `DistributedApplication`:

- Start with `DistributedApplication.CreateBuilder(args)`.
- Declare infrastructure with the resource builders: `AddPostgres(...)`, `AddRedis(...)`, `AddRabbitMQ(...)`, `AddSqlServer(...)`. These return resource references you hold onto.
- Declare each of your own services with `AddProject<Projects.SomeApi>("some-api")`. The generated `Projects.*` type comes from a project reference, so the AppHost compiles against the actual service projects.
- Finish with `builder.Build().Run()`.

Give every resource a stable, lowercase name (`"orders-api"`, `"postgres"`, `"cache"`). That name is the identity the rest of the system resolves against, so treat renaming a resource as a breaking change.

### Wire dependencies with references, not strings

The point of the AppHost is that you express *which resource talks to which* and let the runtime produce the wiring:

- `.WithReference(resource)` connects a service to a dependency. For a database or cache this injects the connection string into the service's configuration under a predictable key; for another project it registers that project for service discovery. This is how a connection string reaches a service - you never type one into the AppHost or the service.
- `.WaitFor(resource)` holds a service's start until its dependency reports healthy. Use it where startup order actually matters - a service that runs migrations against Postgres on boot should wait for Postgres - and leave it off where the service tolerates a not-yet-ready dependency, since waiting serializes startup.

A small AppHost reads as a dependency graph:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume()
    .AddDatabase("ordersdb");

var cache = builder.AddRedis("cache");

builder.AddProject<Projects.Orders_Api>("orders-api")
    .WithReference(postgres)
    .WithReference(cache)
    .WaitFor(postgres);

builder.Build().Run();
```

### Keep dev-only extras out of other environments

Conveniences like `.WithPgAdmin()`, `.WithRedisInsight()`, a broker's management UI, or a seeded data volume are for the developer loop and must never travel further. Gate them behind `builder.ExecutionContext.IsRunMode` (or an explicit dev check) so they only attach during a local run and are absent when the manifest is published. The same applies to fixed host ports - pin them only where a developer genuinely needs a stable address, and let Aspire assign the rest.

## ServiceDefaults: one call per service

ServiceDefaults is a shared library every service depends on, exposing a single `AddServiceDefaults()` extension that each service's `Program.cs` calls once. That one call is the composition root for the cross-cutting concerns:

- OpenTelemetry tracing, metrics, and logging with the OTLP exporter the dashboard reads;
- the standard health checks;
- the default HTTP resilience handler;
- service discovery registration.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
// ... service-specific registrations ...
var app = builder.Build();
app.MapDefaultEndpoints();
```

What goes *inside* each of those - which spans to record, what the readiness probe checks, how aggressive the retry policy is - is `dotnet-web-backend`'s call, not this skill's. ServiceDefaults is the place those decisions get registered, not where they get made.

Pair the registration with `MapDefaultEndpoints()`, which maps the health endpoints. Keep the liveness-versus-readiness distinction that `dotnet-web-backend` defines: liveness answers is the process alive, readiness answers can it serve traffic yet (dependencies reachable, warmup done). Map the readiness probe only in environments where an orchestrator will poll it.

## Service discovery and configuration

- Address other services by their Aspire resource name, never by a hardcoded host or port. With service discovery wired through ServiceDefaults, a typed `HttpClient` configured with a base address of `https+http://orders-api` resolves to wherever that resource is actually running. Hardcoding `localhost:5217` defeats the whole orchestration model and breaks the moment a port shifts.
- Connection strings arrive as configuration, courtesy of the `WithReference` in the AppHost. The service should read them through the options pattern (`dotnet-web-backend`) and bind them to a typed options class - not pull magic strings out of `IConfiguration` ad hoc, and never hardcode a value the AppHost is already supplying.
- The contract between AppHost and service is the resource name plus the configuration key it injects under. Keep both stable; changing either is a wiring break even though nothing in the service signatures changed.

## The dashboard

A local run launches the Aspire dashboard automatically. Lean on it instead of standing up Seq, Jaeger, or a local Grafana for the inner loop - it consumes the same OTLP that ServiceDefaults already exports, so traces, structured logs, and metrics for every resource are there with zero extra setup. Use it to follow a request across services, watch a resource's health flip, and read environment variables and console output per process. It is a development tool only; do not treat it as a production observability backend.

## Testing the orchestrated app

To spin up the full graph in a test and assert against it, use `DistributedApplicationTestingBuilder` to build the AppHost in-process. The harness specifics - waiting on resources, resolving endpoints, fixture lifetime - belong to `dotnet-testing` (its `references/aspire-integration-testing.md`); load that when you write those tests rather than reinventing the setup here.
