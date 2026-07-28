# Concurrency in the worker loop

What a hosted worker adds on top of the general concurrency mechanics - awaiting without deadlock, cancellation threading, `SemaphoreSlim` / `Interlocked`, bounded parallelism - which are `csharp`'s `references/concurrency.md`; read that first. The producer/consumer channel a `BackgroundService` drains is already in `SKILL.md` - this file does not restate it.

## What the worker loop adds

- A `BackgroundService` body captures no `SynchronizationContext`, so it needs no `ConfigureAwait(false)` of its own and the sync-over-async deadlock cannot bite inside it - but every reusable library it calls still follows `csharp`'s library rule.
- In a 24/7 process an `async void` exception is not an abstract leak: it escapes to the thread pool with no caller to catch it and kills the host at an arbitrary later moment - so every worker entry point returns `Task` and funnels failures into the `ExecuteAsync` handling in `SKILL.md`.
- The stopping token `ExecuteAsync` hands you IS the cancellation token to thread to every leaf I/O call; the graceful-shutdown contract it drives is `SKILL.md`'s.
- Prefer designing shared mutable state away by serializing writes through the channel the worker already drains; when a critical section must genuinely `await` under exclusion, the `SemaphoreSlim` mechanics are `csharp`'s file.
