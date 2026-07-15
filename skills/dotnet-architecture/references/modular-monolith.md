# Modular monolith

The topology to reach for by default when one team-and-domain no longer fits, before microservices. Distinct bounded contexts live as modules in **one deployable, one process** - you get clear boundaries without the distributed-systems tax. Load when a system has several bounded contexts but should still deploy as one.

## Modules

- A module is a **bounded context with a public contract** - a small surface (interfaces, DTOs, integration events) that other modules use. Everything else is `internal`.
- Inside a module, pick an internal style as usual - clean or vertical-slice (see those references). The module is the boundary; its insides are its own business.
- **A module owns its data.** Its own schema (or table prefix); no cross-module foreign key or JOIN. Another module's data is reached only through the public contract, never by touching its tables.

## Boundaries and communication

- In-process, synchronous: call another module through its public interface (or a mediator), never its internals.
- Decoupled: raise an in-process domain/integration event another module subscribes to (see `dotnet-messaging` for the in-process bus and the outbox once a hop becomes async).
- No shared mutable state between modules; no shared 'common' dumping-ground that reaches into module internals.

## Keep it modular

- Enforce isolation with fitness tests - module A must not reference module B's internal namespaces (see `dotnet-architecture-tests`). Without enforcement a modular monolith rots into a big ball of mud one `using` at a time.
- Design each module so its data ownership and contract are clean enough that it *could* be extracted to a `microservice` later - but do not extract prematurely. The value of the modular monolith is keeping that option open at near-zero cost.

## When

Distinct bounded contexts, possibly multiple teams, maybe anticipated future scale - but you still want one deploy, in-process transactions where a use case spans modules, and none of the operational cost of a distributed system. This is the right answer for most non-trivial apps; go to `microservices` only when a specific boundary forces it.
