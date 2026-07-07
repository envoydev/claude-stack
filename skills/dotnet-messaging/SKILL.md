---
name: dotnet-messaging
description: "Personal .NET asynchronous messaging conventions - broker-backed, event-driven communication between modules and services using Wolverine (recommended, MIT open-core - only the separate CritterWatch console is commercial) over MassTransit, the transactional outbox for exactly-publish-on-commit, idempotent consumers under at-least-once delivery, choreography versus sagas for multi-step flows, immutable versioned message contracts, and RabbitMQ or Azure Service Bus transports configured (never hardcoded). Floors at .NET 8 / C# 12. Load when wiring a message bus, publish and consume, an outbox, a saga or process manager, integration events, or background message processing, or when the user names Wolverine, MassTransit, RabbitMQ, Azure Service Bus, queue, or pub/sub. Companions: dotnet-hosted-services (the host the consumer runs in), dotnet-realtime (SignalR is the last hop), dotnet-aspire (broker as a local resource), csharp (records, TimeProvider). Do NOT load for in-process reactive streams (r3-reactive-extensions) or synchronous request/response over HTTP (dotnet-web-backend)."
---

# .NET messaging - event-driven communication

This is about durable, broker-backed messages crossing a process or module boundary asynchronously. The defining traits: the sender does not wait for the receiver, the broker persists the message, and delivery is at-least-once. Everything here exists to make that delivery model safe.

Floor is .NET 8 / C# 12. What this skill does NOT cover: in-memory reactive streams (Rx / System.Reactive), and synchronous in-process cross-cutting concerns - HTTP, mediation, resilience pipelines - which are `dotnet-web-backend`. If the caller is awaiting a reply right now, it is not messaging. This skill owns the broker and the consumer contract - delivery, idempotency, retries; the generic *host* a consumer runs inside (the `BackgroundService`/worker process, its lifecycle and shutdown) is `dotnet-hosted-services`. Pushing a handled message's outcome to connected clients in real time (SignalR) is the server-to-client last hop, not broker delivery - that is `dotnet-realtime`.

## Pick the library: Wolverine

Default to Wolverine. Its core is MIT (open-core; the CritterWatch monitoring console is the only commercial piece, and you do not need it to ship), and it folds the in-process mediator and the out-of-process message bus into one programming model, so a handler that today runs inline can be moved onto a queue by changing routing, not code. The outbox, sagas, scheduled messages, and convention-discovered handlers are all in the box.

MassTransit is mature and well-documented, but it went to a commercial license from v9 onward. The house rule is OSS-first, so reach for MassTransit only when there is a deliberate, paid-for reason - an existing licensed estate, a transport only it supports. New code starts on Wolverine.

```csharp
builder.Host.UseWolverine(opts =>
{
    opts.UseRabbitMq(builder.Configuration.GetConnectionString("rabbit"))
        .AutoProvision();                       // dev convenience; see Transport

    opts.Policies.UseDurableInboxOnAllListeners();
    opts.Policies.AutoApplyTransactions();      // wraps handlers in a tx
});
```

## Reliability is the whole point

Get-it-delivered-once is harder than it looks, and three rules carry the load.

### The transactional outbox - never dual-write

The trap: a handler writes to the database, then calls the broker to publish. Two separate I/O operations with no shared transaction. If the process dies between them, you have committed state with no message, or a published message that rolls back - silent inconsistency either way.

The outbox closes the gap. The outgoing message is written to a table inside the same transaction as the business data; a relay then forwards it to the broker. Commit publishes; rollback un-publishes. With Wolverine on EF Core, enable the EF Core outbox integration and `AutoApplyTransactions()` so every handler's database work and outgoing messages share one unit of work. The mirror on the receive side is the inbox (durable inbound storage), which also gives you the dedupe needed below.

### Idempotent consumers

At-least-once means a consumer will, eventually, see the same message twice - a redelivery after a transient failure, a relay that retried. So a handler must be safe to run more than once on the same message. Dedupe on the message id (the inbox does this for you), or make the effect naturally idempotent - upsert rather than insert, set-state rather than increment. Never assume exactly-once from the transport; design for the retry.

### Bounded retries and a dead-letter path

A poison message must not loop forever. Configure a finite retry policy - a few attempts with backoff - and after that route the message to a dead-letter queue for inspection, do not drop it. Distinguish transient faults (retry: timeout, broker hiccup) from permanent ones (dead-letter immediately: malformed payload, validation failure). Wolverine expresses this per-exception-type:

```csharp
opts.OnException<TimeoutException>()
    .RetryWithCooldown(50.Milliseconds(), 250.Milliseconds(), 1.Seconds());

opts.OnException<ValidationException>().MoveToErrorQueue();  // no retry
```

## Messages are contracts

A message that has left the process is a published interface - other deployables depend on its shape, and you cannot refactor across that boundary in one commit.

- Define message types as immutable `record`s of primitive and simple types. Put them in a dedicated Contracts assembly that producers and consumers both reference; do not let a consumer reach into the producer's internal model.
- Version additively. Add optional fields; never repurpose, retype, or remove an existing one - an old consumer may still be reading the old shape from a queue. When a breaking change is unavoidable, publish a new versioned message type alongside the old.
- Carry identifiers and the minimum facts the consumer needs, not whole domain entities. A fat contract welds two services' models together and breaks the moment one evolves.
- Timestamps come from an injected `TimeProvider`, never `DateTime.Now` - see `csharp`. This keeps message-stamping testable and timezone-correct.

```csharp
public sealed record OrderPlaced(
    Guid OrderId,
    Guid CustomerId,
    decimal Total,
    DateTimeOffset PlacedAt);
```

## Shape of the flow: choreography or saga

Match the coordination mechanism to the flow's complexity, and do not over-build.

- **Choreography** for a short flow (roughly two or three steps) with nothing to undo. Each service reacts to an event and may emit its own; no central coordinator. `OrderPlaced` -> inventory reserves stock and emits `StockReserved` -> billing charges. Simple, decoupled, but the end-to-end path lives in no single place, so keep it short.
- **A saga / process manager** once there is real workflow state to hold or a compensating action to run when a later step fails. This is the explicit, stateful path: the saga is correlated by a key, persists its state, and reacts to each step's outcome - including firing compensation (refund, release-stock) on failure. Use the library's saga support (Wolverine sagas), not a hand-rolled `status` column polled by a job. Hand-rolled status tracking is the anti-pattern a saga exists to replace.

Keep handlers thin regardless: one handler per message type, all side effects through injected services, no business logic smeared across the messaging plumbing. Where the library supports cascading messages, return the follow-on event from the handler rather than publishing imperatively - it keeps the handler pure and lets the outbox capture the outgoing message in the same transaction.

```csharp
public static class OrderPlacedHandler
{
    // returning StockReserved cascades it through the outbox
    public static StockReserved Handle(OrderPlaced placed, IInventory inventory)
    {
        inventory.Reserve(placed.OrderId);
        return new StockReserved(placed.OrderId);
    }
}
```

## Transport and local development

- RabbitMQ or Azure Service Bus is the broker. RabbitMQ is the default for self-hosted and local; Azure Service Bus when the platform is already on Azure and you want a managed queue with sessions and dead-lettering built in.
- The host and connection string come from configuration via the options pattern - never a literal in code. Different environments point at different brokers with no recompile.
- `.AutoProvision()` is fine for declaring queues and exchanges on startup in dev. Auto-purge is dev-only; never wipe a queue outside local. Do not auto-provision blindly into a shared environment where topology is owned by infrastructure.
- Run the broker as an Aspire resource (`dotnet-aspire`) for local orchestration when the project uses Aspire - it gives you the container, the connection wiring, and the dashboard without a hand-managed `docker run`.

## Anti-patterns

- Dual-write: save to the database, then publish with no outbox. The single most common source of lost or phantom messages.
- Non-idempotent consumers that assume exactly-once and break on the inevitable redelivery.
- Unbounded or infinite retries with no dead-letter queue - a poison message that spins forever.
- Fat contracts carrying domain entities or mutable message classes; both couple services that should be independent.
- Brokers wired with hardcoded connection strings instead of configuration.
- A hand-rolled status column standing in for a saga when there is genuine workflow state or compensation to manage.
