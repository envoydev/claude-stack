# Scheduling and single-instance coordination

Two questions a plain `BackgroundService` loop does not answer on its own: when the schedule gets complicated enough to need a real scheduler, and how to make a job run on exactly one instance when the deployment is scaled out.

## When a BackgroundService is not enough - scheduling libraries

Start with a plain `BackgroundService` (a `PeriodicTimer` loop or a `Channel<T>` consumer). Reach for a library only when you need something it cannot give you - persistence, a dashboard, retries you do not want to hand-roll, or cluster-aware scheduling:

| Reach for | When | What it adds over a BackgroundService |
|---|---|---|
| **plain `BackgroundService`** | continuous loops, queue consumers, no persistence or dashboard needed | nothing to add, zero dependencies - the default |
| **Coravel** | small app that wants fluent scheduling / queuing / mailing, no external store | DI-native fluent API, in-memory - a light middle ground |
| **Hangfire** | fire-and-forget / delayed / recurring jobs where ops needs visibility and manual re-run | persistence (SQL / Redis), automatic retries (`AutomaticRetryAttribute`), a built-in dashboard |
| **Quartz.NET** | complex cron / calendar schedules, timezone / holiday calendars, HA scheduling | `[DisallowConcurrentExecution]`, clustering with a persistent job store, cron triggers |

Rule of thumb: `BackgroundService` -> Hangfire when you need persistence + dashboard + retries -> Quartz.NET when scheduling *itself* is mission-critical and must survive and cluster. A recurring pitfall: co-hosting a CPU- or memory-heavy job processor in the same process as a user-facing API degrades the API's tail latency - isolate the heavy worker into its own process.

## Single-instance work across a scaled-out deployment

When a job must run on exactly one instance of a horizontally-scaled worker (a nightly reconciliation, a single market-data subscriber), elect a leader with a distributed lock:

- **`RedLock.net`** (Redis Redlock) - the acquiring instance auto-extends the lock while alive and releases on failure, so another instance takes over on a crash. Keep the lock TTL 5-10x the normal operation time.
- **A SQL row lock or Postgres advisory lock** - `SELECT ... FOR UPDATE` / `pg_advisory_lock` - safer and needs no extra infrastructure when a database is already in the picture.

**The Kleppmann caveat:** Redlock is *not* linearizable under a network partition - do not use it as a correctness guarantee for financial or strict-consistency state. Use it for coarse leader election, and make the business logic idempotent regardless of who holds the lock. A large share of 'we need a distributed lock' cases are really idempotency problems in disguise - solve those with a dedup key (see `references/resilience-and-io.md` and `dotnet-messaging`) before reaching for a lock.
