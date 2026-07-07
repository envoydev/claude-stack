# Concurrency correctness (async, cancellation, synchronization)

The async-correctness rules a worker loop leans on: how to await without deadlocking, how to thread a cancellation token to the leaves, and the three synchronization primitives worth reaching for when shared state is genuinely unavoidable. The producer/consumer channel that a `BackgroundService` drains is already in `SKILL.md` - this file does not restate it, and the `Task`/`Channel<T>` language mechanics are `csharp`.

## async/await correctness

- **No `async void`.** An `async void` method's exceptions escape onto the thread pool where no caller can `await` or `catch` them - they crash the process. The one exception is an event handler, whose signature forces `void`; keep its body tiny and wrap it in a `try`/`catch`. Everything else returns `Task` or `Task<T>`.
- **Never block on async with `.Result` or `.Wait()`.** Sync-over-async deadlocks whenever a captured `SynchronizationContext` (classic ASP.NET, WPF/WinForms UI thread) is waiting on the thread the continuation needs to resume on - each side holds what the other wants. It also burns a thread pool thread for the whole wait. The fix is not a clever workaround - it is to make the caller async and `await`. Async all the way up.

```csharp
// deadlock-prone: blocks the current thread waiting on a continuation that needs it
var user = GetUserAsync(id).Result;

// correct: await propagates without blocking
var user = await GetUserAsync(id);
```

- **`ConfigureAwait(false)` in library code.** A method in a reusable library has no reason to resume on the caller's captured context, so append `ConfigureAwait(false)` to every `await` in it - the continuation runs on any thread pool thread, avoiding the deadlock above and skipping the context hop. Application code (a `BackgroundService`, an ASP.NET Core handler - neither captures a context) does not need it; library code does.

## Cancellation propagation

A `CancellationToken` is only useful if it reaches the operation that must stop. Take one as the last parameter of every async method and pass it down the whole call chain to the leaf I/O call - a token that stops at your method boundary cancels nothing.

```csharp
public async Task ProcessAsync(Order order, CancellationToken ct)
{
    await _repo.SaveAsync(order, ct);           // thread it through
    await _bus.PublishAsync(order.Id, ct);      // ... to every await
}
```

In a loop, honor the token at the top of each iteration - `ct.ThrowIfCancellationRequested()` or a `while (!ct.IsCancellationRequested)` guard - so a long-running loop unwinds promptly instead of running to completion after shutdown was requested. The stopping token a worker gets from `ExecuteAsync` is exactly this token; see `SKILL.md` for the graceful-shutdown contract it drives.

## SemaphoreSlim for async mutual exclusion

`lock` cannot span an `await` - the monitor is thread-affine and the continuation may resume on a different thread. When a critical section must `await` (an async cache refresh, a bounded number of concurrent callers), use `SemaphoreSlim` and its async `WaitAsync`. Release in a `finally` so an exception inside the section cannot leak the permit and wedge every future caller.

```csharp
private readonly SemaphoreSlim _gate = new(1, 1);   // 1,1 = async mutex

await _gate.WaitAsync(ct);
try
{
    await RefreshCacheAsync(ct);   // exclusive, and may await
}
finally
{
    _gate.Release();
}
```

Constructing it `new(n, n)` instead caps concurrency at `n` - a bounded gate in front of a downstream that only tolerates so many simultaneous calls.

## Interlocked and lock

For a lock-free counter or a compare-and-swap on a single word, `Interlocked` (`Increment`, `Add`, `Exchange`, `CompareExchange`) is atomic without any lock - the right tool for a shared count updated from many threads.

```csharp
private long _processed;
Interlocked.Increment(ref _processed);
```

A plain `lock` is still correct for a short, purely synchronous critical section that guards more than one field at once and never awaits. Keep the body tiny and allocate nothing inside it; the moment the section needs to `await`, switch to `SemaphoreSlim`. Before either, prefer designing shared mutable state away - an immutable snapshot, a `ConcurrentDictionary`, or serializing writes through the channel the worker already drains.

## Bounded parallelism

To fan work out across a collection with a hard cap on simultaneous operations, `Parallel.ForEachAsync` carries both the degree limit and the token in `ParallelOptions` - the right tool for I/O-bound or CPU-bound batch work.

```csharp
await Parallel.ForEachAsync(orders,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (order, token) => await ProcessOrderAsync(order, token));
```

An unbounded `Task.WhenAll(items.Select(ProcessAsync))` launches every operation at once - fine for a handful of independent calls, a way to exhaust a connection pool or hammer a downstream for a large set. When you must use `WhenAll` over many items, throttle it with a `SemaphoreSlim` acquired inside each task. Do not accumulate results into a shared `List<T>` from parallel bodies - that races; collect into a `ConcurrentBag<T>` or return each result and let `WhenAll` gather them.
