# Newer runtime versions (optional)

The SKILL.md body is written to the .NET 8 / C# 12 floor. These are the deltas above it - read them before assuming a newer runtime behaves the same way; nothing here changes the floor rules.

- **.NET 10:** all of `ExecuteAsync` now runs on a background thread - the runtime wraps it in `Task.Run` inside `StartAsync`, so its synchronous prefix (the code before the first real `await`) no longer blocks other services from starting. The classic `await Task.Yield()` at the top of `ExecuteAsync` is no longer needed. If you *want* code to run synchronously during startup, that is now the wrong place - put it in the constructor, override `StartAsync` before calling `base.StartAsync`, or implement `IHostedLifecycleService`.
- **.NET 11+:** `IHost.RunAsync`/`StopAsync` (and their synchronous forms) will *throw* the captured `BackgroundService` exception instead of completing quietly when a worker fails under `StopHost` - making the trap above far louder. Until then, on the .NET 8 floor, you only get the log entry, so the explicit handling stands.
