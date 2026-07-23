# .NET Framework services - the maintained shape and the migration path

Loaded from the `dotnet-windows-service` skill when maintaining a `ServiceBase` service or scoping its migration. Framework 4.8/4.8.1 is an OS component - supported as long as the Windows under it is, security-patches-only. Below 4.7.2 is the actual urgency (4.6.2 ends January 2027; older retired). Hold an existing service to this shape even if it never migrates - a service shaped this way migrates in days, not weeks.

## The shape to hold it to

```csharp
public partial class IngestService : ServiceBase
{
    private CancellationTokenSource _cts;
    private Task _worker;

    public IngestService()
    {
        ServiceName = "Contoso Ingest Service";
        CanStop = true;
        CanPauseAndContinue = false; // a button that silently does nothing unless you implement it
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        // MUST return promptly - blocking here is SCM error 1053.
        Directory.SetCurrentDirectory(AppDomain.CurrentDomain.BaseDirectory);
        _cts = new CancellationTokenSource();
        _worker = Task.Run(() => WorkerLoopAsync(_cts.Token));
    }

    protected override void OnStop()
    {
        RequestAdditionalTime(20000);
        _cts.Cancel();
        try { _worker?.Wait(TimeSpan.FromSeconds(15)); } // bounded - never block the SCM indefinitely
        catch (AggregateException) { /* logged inside the loop */ }
        _cts.Dispose();
    }

    private async Task WorkerLoopAsync(CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                await DoOneUnitOfWorkAsync(token).ConfigureAwait(false);
                await Task.Delay(TimeSpan.FromSeconds(30), token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Worker loop terminated");
            ExitCode = 1;  // surfaces to the SCM so recovery actions fire
            Stop();
        }
    }
}
```

Entry point: wire `AppDomain.CurrentDomain.UnhandledException` and `TaskScheduler.UnobservedTaskException` FIRST (without them a background-thread crash leaves a generic runtime event and no stack), then branch on `Environment.UserInteractive` (or a `--console` arg) into a console-mode wrapper for debugging, else `ServiceBase.Run`.

## Framework-specific rules

- `OnStart` returns promptly - start a task and get out; blocking there is the classic error 1053. `RequestAdditionalTime` is a per-service stopgap (a wait hint, not strictly additive, does not extend indefinitely) - design for fast startup instead, and never reach for the machine-wide `ServicesPipeTimeout` key.
- Timers: a single worker task with `Task.Delay(interval, token)` is the default - it avoids the overlap-and-swallowed-exception class entirely. If a `System.Timers.Timer` exists (never the Forms timer - it needs a message loop): its `Elapsed` swallows exceptions and overlaps ticks, so guard with an `Interlocked` in-flight flag and a try/catch inside the handler; `async void` is tolerable only there, only with that catch.
- No `TimeProvider` on Framework - inject a hand-rolled clock/delay abstraction so the loop is testable without real waits.
- Config: `ConfigurationManager` caches on first read; live reload needs a `FileSystemWatcher` + `RefreshSection`, or config moved to a store you control. EF6: one `DbContext` per unit of work, never per service lifetime - same captive-dependency rule as the modern host.
- `ServiceBase` is a hosting shell like `BackgroundService` - nothing testable lives in it; all logic in plain injectable classes taking a `CancellationToken`.

## Migration path (cheapest first)

1. **Audit dependencies** - every package against the current `-windows` TFM. This decides week-vs-quarter; do it before committing to a date.
2. **SDK-style csproj** still targeting `net48` - independently valuable cleanup.
3. **Extract logic out of `ServiceBase`** into plain injectable classes with a `CancellationToken` - if the service already matches the shape above, nearly free.
4. **Swap the shell**: `ServiceBase` -> `BackgroundService`, `OnStart`/`OnStop` -> `ExecuteAsync` + stopping token, manual CTS -> host-supplied, installutil -> `sc.exe`.
5. **Port config** (app.config -> appsettings + options) and **logging** (-> `ILogger<T>` with the sink behind it).

Sticking points that turn days into weeks: WCF server hosting (CoreWCF or gRPC/HTTP), custom `System.Configuration` sections, AppDomain isolation (no equivalent - separate processes or `AssemblyLoadContext`), MSMQ, COM interop assuming STA. None are blockers on Windows. Tooling: the deterministic .NET Upgrade Assistant is deprecated in favor of the paid Copilot modernization agent - treat any tool's output as a first draft needing full manual verification.
