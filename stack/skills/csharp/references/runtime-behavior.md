# Async, disposal, and JSON serialization

The runtime-behavior rules that fire on a specific kind of edit rather than on every `.cs` touch: async and cancellation, types that own a resource, and `System.Text.Json` configuration. Everything a routine C# edit needs stays in `SKILL.md`. Formatting and language-feature style is `references/csharp-style.md`; applied concurrency mechanics are `references/concurrency.md`.

## Async
The async baseline - async all the way with no `.Result` / `.Wait()` / `.GetAwaiter().GetResult()`, no `async void` outside event handlers, `ValueTask` only where benchmarks justify it and never awaited twice, `await foreach` for async streams - is authoritative in `references/csharp-style.md`; the applied concurrency mechanics - deadlock avoidance, cancellation threading, `SemaphoreSlim` / `Interlocked`, `Channel<T>` basics, bounded parallelism - are `references/concurrency.md`. House additions:
- Always pass and forward `CancellationToken` for I/O-bound or long-running operations.
- Use `ConfigureAwait(false)` in library code; ignore it in ASP.NET Core application code (no sync context).
- Return `IAsyncEnumerable<T>` for streaming results (paged DB reads, long-running enumerations); annotate the `CancellationToken` parameter with `[EnumeratorCancellation]`.

## Dispose pattern
- Use `using` declarations (`using var x = ...;`) over `using` blocks where scope allows.
- Implement `IAsyncDisposable` for types holding async resources. Implement both `IDisposable` and `IAsyncDisposable` when both sync and async disposal paths are realistic.
- Never call `Dispose()` on injected dependencies - the DI container owns their lifetime.
- Use the full Dispose pattern (`protected virtual Dispose(bool disposing)`) only for unmanaged resources or when inheritance is in play. Otherwise a simple `Dispose()` is enough.

## JSON serialization
- `System.Text.Json` is the default. Newtonsoft.Json only for legacy compatibility or features missing from STJ (e.g. polymorphic serialization in older runtimes).
- Configure `JsonSerializerOptions` once and reuse - never construct per call.
- Naming policy: `JsonNamingPolicy.CamelCase` for external APIs unless a contract requires otherwise.
- Reach for source-generated `JsonSerializerContext` on hot paths and under AOT - the source-gen mechanics and the wire-format choice (Protobuf / MessagePack vs JSON) belong to the skill covering .NET performance and memory layout, when your skill list has one.
- Never deserialize untrusted JSON without size and depth limits.
