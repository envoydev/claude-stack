---
name: dotnet-hosted-services
description: "Personal .NET hosted-service and worker conventions - the long-running background work the generic host runs. Covers the two host shapes (a Host.CreateApplicationBuilder worker binary versus a hosted task in a web app), IHostedService versus BackgroundService versus IHostedLifecycleService, the ExecuteAsync unobserved-exception trap and BackgroundServiceExceptionBehavior, scoped services from the singleton host via IServiceScopeFactory, PeriodicTimer over a Task.Delay loop, graceful shutdown via the stopping token, StopAsync and ShutdownTimeout, and queue-backed work via System.Threading.Channels. Floors at .NET 8 / C# 12; later additions flagged optional. Load when writing a worker service, a BackgroundService or IHostedService, a periodic job, or any in-process background task hung off the host. This skill owns the host a worker runs in. Companions: dotnet-messaging owns the broker and consumer contract, dotnet-web-backend the surrounding HTTP service, csharp the async and Channels mechanics. Do NOT load for broker-driven consumers, HTTP endpoints, or reactive in-memory streams."
---

# .NET hosted services - background work on the generic host

This skill owns the host a long-running task runs inside: how the work is registered, which base type to derive from, what happens when it throws, how it reaches a scoped dependency, how it loops, and how it stops cleanly. It stops at the host boundary. When the work is *driven by a broker* - a queue consumer, an outbox relay, a saga - the delivery contract, idempotency, and retry policy are `dotnet-messaging`; this skill only owns the host process those consumers happen to live in. The HTTP service around an in-process background task is `dotnet-web-backend`. The async, `Task`, and `Channel<T>` language mechanics are `csharp`. Floor is .NET 8 / C# 12; anything newer is marked optional.

## The two host shapes

There is one hosting model and two ways to enter it. Pick by what the process *is*.

A standalone worker - no HTTP surface, just background work - is a worker binary. The project uses the `Microsoft.NET.Sdk.Worker` SDK and `Host.CreateApplicationBuilder`:

```csharp
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<IngestWorker>();
var host = builder.Build();
host.Run();
```

`Host.CreateApplicationBuilder` (the post-.NET-6 linear builder, preferred over the old `CreateDefaultBuilder`/callback style) wires configuration, logging, and DI the same way the web host does - the hosted services you register run under the same lifecycle.

A background task that belongs to a web app is the same `AddHostedService<T>()` call against `WebApplicationBuilder.Services`. Do not stand up a second process for work that shares the web app's configuration and DI:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHostedService<OutboxFlushWorker>();
```

Both register an `IHostedService` in the DI container; the host starts every registered one on startup and stops them on shutdown. Register a worker as a singleton via `AddHostedService` - never resolve and start one yourself.

## Which base type: IHostedService, BackgroundService, IHostedLifecycleService

- **`BackgroundService`** is the default. It is the abstract base for a long-running task: override one method, `ExecuteAsync(CancellationToken)`, and the framework calls it on start and signals the token on stop. Reach for it for essentially all continuous or looping work.
- **`IHostedService`** directly - implementing `StartAsync`/`StopAsync` yourself - only when there is no long-running loop: a one-shot startup action, registering and unregistering a resource, a fire-and-configure step. A common mistake is to do real work *inside* `StartAsync`; that method must return quickly, because the host awaits every service's `StartAsync` in sequence before the app is considered started. Block there and you stall startup. Long work goes in `ExecuteAsync`, which the host does not await.
- **`IHostedLifecycleService`** (.NET 8+, so on the floor) adds four finer hooks - `StartingAsync`/`StartedAsync`/`StoppingAsync`/`StoppedAsync` - that bracket the ordinary `StartAsync`/`StopAsync`. The full order is StartingAsync -> StartAsync -> StartedAsync, then StoppingAsync -> StopAsync -> StoppedAsync. Implement it (often on a `BackgroundService` subclass) only when you genuinely need to run code *before all* services start or *after all* have stopped - a pre-flight check, a post-shutdown flush. Most workers need none of it.

## The ExecuteAsync unobserved-exception trap

This is the single most important thing about `BackgroundService`. `ExecuteAsync` returns a `Task`. If your override lets an exception escape, the host does not crash at the throw site - the exception is captured into that returned task, and what happens next is governed by `HostOptions.BackgroundServiceExceptionBehavior`:

- **`StopHost`** is the default (since .NET 6). The exception is logged, and then the *entire host stops* - every other service goes down with it. One unhandled fault in one worker takes the whole process with it.
- **`Ignore`** logs the exception and lets the host keep running - but the faulted worker is now *gone*. It does not restart. The process stays up looking healthy while the background work it was doing has silently stopped forever. This is the classic trap: a worker that "mysteriously stopped" days ago because something threw once and the behavior was set to `Ignore`.

Neither default is "keep working." So own the failure explicitly. Wrap the body in a `try`/`catch` and decide, per exception, whether to log-and-continue or let it propagate:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (!stoppingToken.IsCancellationRequested)
    {
        try
        {
            await DoOneCycleAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            break;                       // normal shutdown - swallow and exit
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ingest cycle failed; continuing");
            // transient: log and loop. fatal: rethrow to stop the host.
        }
    }
}
```

Catch `OperationCanceledException` only when the stopping token actually requested it - that distinguishes a clean shutdown from a real timeout. For a worker whose failure *should* take the process down (so an orchestrator restarts it), let the exception propagate and leave the behavior on `StopHost`. The wrong move is to do neither and discover the silent stop in production.

## Scoped services from a singleton host - the captive-dependency pitfall

A `BackgroundService` is a singleton. Inject a scoped service (an EF Core `DbContext`, a per-request repository) into its constructor and you capture it for the entire process lifetime - a captive dependency. The `DbContext` is never disposed, accumulates tracked entities, and is shared unsafely across every loop iteration. Do not do it.

Inject `IServiceScopeFactory` instead and open a fresh scope per unit of work - one per loop iteration, so each cycle gets a clean `DbContext` that is disposed at the end of the cycle:

```csharp
public sealed class IngestWorker(IServiceScopeFactory scopeFactory, ILogger<IngestWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var repo = scope.ServiceProvider.GetRequiredService<IOrderRepository>();
            await repo.ProcessPendingAsync(stoppingToken);
        }
    }
}
```

`CreateAsyncScope` (over `CreateScope`) so the scope's `IAsyncDisposable` services dispose correctly. Only singletons - the logger, the scope factory, the `TimeProvider` - belong in the constructor; everything scoped is resolved from the scope.

## Periodic work: PeriodicTimer, not a Task.Delay loop

For work on a fixed cadence, use `PeriodicTimer` rather than a hand-rolled `await Task.Delay(interval)` loop. `Task.Delay` measures from the moment it is called, so the period drifts by however long each cycle took; `PeriodicTimer.WaitForNextTickAsync` ticks on a true interval and takes the cancellation token directly, so shutdown is immediate rather than waiting out the current delay:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
    while (await timer.WaitForNextTickAsync(stoppingToken))
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // ... one cycle, threading stoppingToken through
    }
}
```

`WaitForNextTickAsync` returns `false` (rather than throwing) when the token cancels, so the `while` exits cleanly on shutdown. Be aware it does not overlap ticks: if a cycle runs longer than the interval, the next tick fires immediately after, never concurrently. Get the interval from configuration via the options pattern, not a literal. Derive any timestamps from an injected `TimeProvider`, never `DateTime.Now` - see `csharp`.

## Graceful shutdown

Shutdown is cooperative - the host signals, your code must respond. Honour the signal in three places:

- **The stopping token.** When the host stops, it cancels the `CancellationToken` passed to `ExecuteAsync` (and `StopAsync`). Check `IsCancellationRequested` in every loop and thread the token into every async call so an in-flight operation is asked to wind down. A worker that ignores the token blocks shutdown until the timeout below forces it.
- **`StopAsync`.** Override it to release resources or finish a final flush. The host awaits it. The total time it allows across all services is `HostOptions.ShutdownTimeout`, which defaults to 30 seconds; raise it (`builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60))`) only if a clean drain genuinely needs longer, and never let `StopAsync` run unbounded.
- **`IHostApplicationLifetime`** when a worker must *itself* request shutdown - a fatal config error, a completed one-shot job. Inject it and call `StopApplication()`; register on `ApplicationStopping` to run last-gasp cleanup. This is how a worker ends the process deliberately rather than by throwing.

The contract is simple: cancel propagates in, the work drains within the timeout, the host exits. Code that does not observe the token is the reason a shutdown hangs.

## Queue-backed work with Channels

When one part of the app produces work and a background worker consumes it *in the same process*, use a `System.Threading.Channels` channel as the in-memory queue - a bounded `Channel<T>` registered as a singleton, written by the producer, drained by a `BackgroundService`:

```csharp
var channel = Channel.CreateBounded<WorkItem>(
    new BoundedChannelOptions(capacity: 100) { FullMode = BoundedChannelFullMode.Wait });

protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    await foreach (var item in _channel.Reader.ReadAllAsync(stoppingToken))
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        // handle item
    }
}
```

Prefer a **bounded** channel so a runaway producer applies backpressure instead of growing the queue until the process runs out of memory. `ReadAllAsync` with the stopping token drains until shutdown. The channel mechanics - readers, writers, completion, backpressure modes - are `csharp`; this skill only fixes that an in-process producer/consumer split belongs on a channel drained by a hosted service. The hard boundary: this is for work that stays inside one process. The moment the work must survive a restart, cross a process boundary, or be delivered at-least-once, it is not a channel - it is a broker, and that is `dotnet-messaging`. Do not build a durability story on top of an in-memory channel.

## Anti-patterns

- Letting an exception escape `ExecuteAsync` with no strategy - the host silently stops the worker (`Ignore`) or the whole process (`StopHost`, the default) and nobody notices until the work has been dead for days.
- Injecting a scoped service (a `DbContext`, a repository) into a `BackgroundService` constructor - a captive dependency. Open an `IServiceScopeFactory` scope per unit of work instead.
- Real work inside `StartAsync` instead of `ExecuteAsync` - it blocks host startup until that work finishes.
- A `while (true) { ...; await Task.Delay(interval); }` loop for periodic work, where `PeriodicTimer` would hold the cadence and cancel instantly.
- A worker loop that never checks the stopping token or thread it into its awaits - shutdown hangs until `ShutdownTimeout` forces a kill.
- An unbounded in-memory channel or `ConcurrentQueue` standing in for a durable queue - it loses everything on restart. Cross-process or at-least-once work is a broker, per `dotnet-messaging`.
- Spinning up a separate worker binary for background work that shares a web app's configuration and DI, when `AddHostedService<T>()` inside the web app would do.

## Newer versions (optional)

- **.NET 11+:** `IHost.RunAsync`/`StopAsync` (and their synchronous forms) will *throw* the captured `BackgroundService` exception instead of completing quietly when a worker fails under `StopHost` - making the trap above far louder. Until then, on the .NET 8 floor, you only get the log entry, so the explicit handling stands.

## Companions

- `dotnet-messaging` - broker-backed consumers, outbox/inbox, idempotency, and at-least-once delivery; owns any work that crosses a process boundary or must survive a restart.
- `dotnet-web-backend` - the cross-cutting baseline for the HTTP service a background task may live inside.
- `csharp` - the async, `Task`, cancellation, and `Channel<T>` language mechanics this skill builds on.
