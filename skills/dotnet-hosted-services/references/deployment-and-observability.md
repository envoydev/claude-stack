# Deploying and observing a headless worker

Host integration (signals, the service manager, the container) and the observability a worker needs without an HTTP surface. The container image build and the CI pipeline are `devops`; allocation- and serialization-level performance design is `dotnet-performance`; this note owns the deployment-time runtime knobs (GC mode, AOT, signals) and observability specific to a long-running host process.

## Signals and shutdown

The Generic Host already maps `SIGTERM` and `SIGINT` to a graceful shutdown - the stopping token fires, `StopAsync` runs, the host drains within `HostOptions.ShutdownTimeout`. Do not re-implement that. Reach for explicit signal handling only for a side-effect on shutdown:

- **`PosixSignalRegistration.Create(PosixSignal.SIGTERM, ctx => { ... })`** (cross-platform, .NET 6+) over `Console.CancelKeyPress`, which catches only Ctrl+C (`SIGINT`), runs on a thread-pool thread, races host shutdown, and needs `ctx.Cancel = true` to avoid immediate termination.
- Do **not** rely on `AppDomain.ProcessExit` for async cleanup - it has no `await` and a tight time budget.

## Kubernetes shutdown contract

The .NET process must *receive* `SIGTERM` (.NET maps it to graceful host shutdown) - which means running as **PID 1**, or behind an init shim (`tini`, or the container runtime's `--init`) that forwards the signal (`devops`). Kubernetes runs the `preStop` hook, then sends `SIGTERM`, waits `terminationGracePeriodSeconds` (default 30s), then `SIGKILL`. Two rules follow:

- Use a `preStop` sleep (e.g. `sleep 15`) to let endpoint / load-balancer deregistration propagate before `SIGTERM` arrives, so in-flight work is not routed to a draining pod.
- Set `HostOptions.ShutdownTimeout` **less than** `terminationGracePeriodSeconds` *minus* that preStop sleep, so the host finishes draining before `SIGKILL` - the sleep eats into the same budget.

## Service-manager integration

- **systemd.** Add `Microsoft.Extensions.Hosting.Systemd` and call `builder.Services.AddSystemd()` (no-ops when not under systemd). Use `Type=notify` in the unit so the host signals readiness (`READY=1`) and `STOPPING=1` via sd_notify; logs map to journald priorities, so `journalctl -p 3` filters errors. Set the unit to restart on failure.
- **Windows Service.** The `AddWindowsService` wiring is in the main skill under *Hosting as a Windows Service*; the SCM-specific hardening lives here:
  - **Resolve every path against `AppContext.BaseDirectory`, never the current directory.** Under the SCM the process working directory is `C:\Windows\System32`, so `Directory.GetCurrentDirectory()` and every relative path silently resolve there - config not found, logs written to System32, `UnauthorizedAccessException`. `AddWindowsService` fixes the *host* content root, but your own file I/O does not inherit it; anchor it on `AppContext.BaseDirectory` (or `IHostEnvironment.ContentRootPath`).
  - **A clean host stop hides a fault from the SCM.** On the .NET 8 floor a fatal worker under `StopHost` shuts the host down cleanly - exit code 0 - so the SCM sees no failure and applies none of its recovery actions; the faulted process just stays stopped, looking healthy. For SCM-driven restart, end the process with a non-zero code (`Environment.Exit(nonZero)`) and configure matching recovery (`sc.exe failure`, typically restart/restart/take-no-action to avoid an infinite loop). The .NET 11+ change in the main skill's *Newer versions* makes the host task itself throw - revisit any `Environment.Exit` workaround on upgrade.
  - **Run under a least-privilege account.** Prefer `LocalService` (no network credentials) or `NetworkService` (network under the machine identity) over `LocalSystem`, whose near-full machine privilege should be reserved for work that genuinely needs it. Tightest is a dedicated local account granted only the 'Log on as a service' right.

## Containers

The SDK publishes an OCI image with no Dockerfile - `dotnet publish /t:PublishContainer` (in the SDK from 8.0.200; a worker/console project also needs `<EnableSdkContainerSupport>true`). The build invocation, the `ContainerFamily` choice, and the CI that ships the image are `devops`; what matters for the *host* running inside it:

- **Non-root by default** - the `app` user, UID 1654, exposed as `$APP_UID`; set `USER` by that UID (not by name) so Kubernetes `runAsNonRoot` is satisfied.
- **Run on a chiseled (distroless) runtime image** for the smallest attack surface - no shell, no package manager. Chiseled images omit ICU and tzdata unless you use the `-extra` variant, so a worker that formats cultures or converts time zones needs the extra family or `InvariantGlobalization` set deliberately.
- **PID 1, or an init shim** so the process receives `SIGTERM` - see the shutdown contract above.

## GC and AOT in a long-running process

- **GC mode.** DATAS (Dynamic Adaptation To Application Sizes) is on by default from .NET 9 - it shrinks the heap when load drops, which makes HPA / KEDA autoscaling metrics trustworthy for a bursty worker in a memory-limited container. Server GC (parallel per-CPU heaps) suits a single dominant latency-sensitive process such as a trading bot; Workstation GC suits many co-located processes. Server GC is **not** the container default - opt in with `<ServerGarbageCollection>true`. Cap the heap under a cgroup limit with `GCHeapHardLimit`, and disable DATAS on a measured throughput regression with `DOTNET_GCDynamicAdaptationMode=0`. The allocation- and type-layout design that decides whether any of this is worth tuning is `dotnet-performance`.
- **Native AOT** shrinks startup and footprint but has hard limits: no dynamic assembly loading, no `Reflection.Emit`, requires trimming, must be self-contained; `System.Text.Json` needs its source generator and EF Core is not AOT-friendly on the .NET 8 floor (dynamic LINQ / query syntax). Reach for it only when startup time or memory dominate and there is no EF Core / reflection dependency; otherwise ReadyToRun and TieredPGO are the lower-risk levers.

## Observability without an HTTP surface

A worker has no Kestrel, so the web hub's observability wiring does not apply. Cover it directly:

- **Health checks.** Add `Microsoft.Extensions.Diagnostics.HealthChecks` and either expose a tiny Kestrel endpoint just for `/health` and `/alive`, or push liveness to the orchestrator another way. `.NET Aspire`'s `AddServiceDefaults()` bundles OpenTelemetry, health endpoints, service discovery, and a standard resilience handler in one call - for a non-web worker, factor a custom ServiceDefaults class library so you get the bundle without an ASP.NET Core framework reference (`dotnet-aspire`).
- **Structured logging.** Use the `[LoggerMessage]` source generator for hot-path logs - it removes boxing and runtime template parsing, builds in the `IsEnabled` check, satisfies analyzer CA1848, and takes more than the six parameters `LoggerMessage.Define` caps at (`dotnet-source-generators`).
- **Telemetry.** Instrument with `ActivitySource` (traces) and `System.Diagnostics.Metrics.Meter` (metrics), export over OTLP. Alert on the signals that mean a worker is quietly broken: restart count, queue depth, gateway reconnect rate, and GC heap size.
