---
name: database-conventions
description: "Personal database conventions across Postgres, SQL Server/T-SQL, SQLite, and MongoDB - the engine-neutral rules for schema, migrations, indexes, foreign keys, transactions, connection management, query safety, N+1 prevention, and secret handling, plus the per-engine pitfalls that bite. This is the convention gate the hook loads before any persistence work; deeper engine tuning and all .NET data access route out to companion skills. Load before designing or modifying a schema, writing SQL raw or through an ORM, modeling a document store, or creating a migration, view, procedure, or index - do not rely on recall. Do NOT load for app-only in-memory data structures or a project with no persistence layer."
---

# Database conventions

A database is the one part of a system where a careless change is permanent: a dropped column takes its data with it, a missing index turns a query into a table scan under load, an unbounded result set is a memory incident waiting for the row count to grow. These conventions are the engine-neutral defaults that keep that from happening. They are deliberately not deep tuning - this skill is the gate that loads before persistence work, and it routes the deep work out to the companions named below rather than restating it.

## Engine-specific routing

The rules in this skill hold across engines; the deep, engine-specific mechanics live elsewhere and this skill defers to them rather than duplicating them.

- **PostgreSQL** - `supabase-postgres-best-practices` for query patterns, indexing, and partitioning. Ignore its RLS and Supabase-tenancy rules unless the project actually enforces tenancy in the database.
- **SQL Server / T-SQL** - `query-optimization` for rewrites, SARGability, and plan reading; `index-strategies` for the clustered / nonclustered / filtered / columnstore decision; `tsql-functions` for the function catalog.
- **SQLite** - no dedicated skill; treat it as Postgres-lite. WAL mode by default, one writer per file, pragmas applied at connection open, `INTEGER PRIMARY KEY` for autoincrement, and no concurrent writers across processes.
- **MongoDB / document stores** - no dedicated skill; apply document-modeling care. Embed versus reference by access pattern, index every queried field path, bound array growth, and never run an unbounded `$lookup`.

## Query safety

Every query is either parameterized or it is a vulnerability. Never build SQL by string concatenation, not even for inputs you believe are safe - use parameterized queries or the ORM's query API, because the one "trusted" value that turns out to be user-controlled is the whole exploit. Keep parameter values out of logs too: query text that carries PII or secrets must never be logged verbatim.

Read with the least authority the work needs. Default reads to read-only intent and `READ COMMITTED` isolation; reach for `SNAPSHOT` or `REPEATABLE READ` only when a specific consistency requirement justifies the extra cost, and say why. Bound every result set that could grow - a `LIMIT` or `TOP` on any open-ended query - and never `SELECT *`, which drags unused columns over the wire and breaks the moment the schema changes.

Injection avoidance and connection-string handling are also OWASP concerns; the application-hardening posture around them is owned by `dotnet-security`, and this skill stops at the query.

## N+1 prevention

The N+1 query is the most common performance regression in data access, and it hides in code that reads perfectly: a loop over rows that lazily fetches a relation per iteration. Eager-load the relations you know you need explicitly rather than letting per-row lazy loads fire; for a document store that is a `Populate` (Mongoose) or a single shaped read. And do the join in the database - never pull two tables into the application and join them in memory, which fetches more rows than the result needs and throws away the engine's join optimizer.

This skill is engine and SQL only. All .NET data access routes out: the EF Core mechanics (`Include` / `ThenInclude`, `AsSplitQuery`, `AsNoTracking`) belong to `efcore-patterns`, and read-path performance - N+1 detection, projection shape, change-tracking cost, row count - belongs to `database-performance`. Do not restate either here.

## Migrations

The migration *workflow* - previewing the generated SQL, carrying a rollback, re-verifying after each step, and the matching .NET / SDK and NuGet update flows - is owned by `dotnet-migrate`. What stays here are the engine-level rules the workflow assumes:

- **Every migration is reversible.** No destructive change ships without an explicit down path; an irreversible step is a deliberate, reviewed exception, not a default.
- **One logical change per migration**, with a descriptive name (`AddOrderShippingAddress`, never `Migration1` or `Update001`) so the history reads as a log.
- **Idempotent at deploy time** - running the migration twice produces the same schema, so a re-run after a partial deploy is safe.
- **Backfills run separately from schema changes** when the row count is large. Reshape the schema in one step and move the data in batches in another, so neither holds a long table lock.
- **Production migrations are reviewed for lock impact** before they ship: an `ALTER TABLE` or an index rebuild on a large table can lock it for the duration, and that is a downtime decision, not an afterthought.

## Naming

Naming is a convention, which means its only job is to be consistent - the specific choice matters far less than not mixing two. Keep all identifiers in English. Pick one case per project and hold it: `snake_case` for PostgreSQL by default, `PascalCase` for SQL Server unless the project overrides it. Pick singular or plural table names once and never mix the two. Foreign-key columns follow the related table - `<related_table>_id` or `<RelatedTable>Id` to match the project's case. Indexes self-describe (`ix_orders_customer_id_status`), so a name tells you what it serves; leave anonymous index names to the tool only when the migration generator produces them.

## Indexes

An index is a write-time cost paid for a read-time gain, so add each one deliberately and be able to name the query it serves - an index with no query behind it is pure overhead on every insert and update. Order a composite index by predicate type: equality columns first, the range column last, so the engine can seek rather than scan. Before widening a composite index to satisfy a hot query, cover it instead - add the extra columns as `INCLUDE` columns (SQL Server and Postgres) so the index answers the query without a key lookup and without bloating the seek key. Use a filtered or partial index for a sparse predicate (`WHERE IsActive = 1`) so the index stays small. And drop indexes that no query uses - verify against `sys.dm_db_index_usage_stats` or `pg_stat_user_indexes` over a representative window first, because an index that looks idle in a five-minute sample may serve a nightly job.

## Constraints

Integrity belongs in the schema, where it cannot be bypassed, not in application logic that one code path will forget. Enforce foreign keys at the database level - a "soft" relation maintained only in application code is a relation that will drift. Default columns to `NOT NULL` and opt into nullability only where the model genuinely has an absent value. Express invariants the schema can state as `CHECK` constraints - a numeric range, an enum-as-string set. And enforce uniqueness with a `UNIQUE` constraint or a unique index, never an application-side "check then insert", which races two concurrent requests straight into a duplicate.

## Transactions

Scope a transaction to exactly one unit of work - one request or use-case - opened at the boundary, committed on success, rolled back on exception. The cardinal mistake is holding a transaction open across external I/O: a transaction that waits on an HTTP call or a message bus holds its locks for the duration of a network round trip. Read what you need first, then open the transaction, do the writes, and close it. Design writes to be idempotent - an `UPSERT` or `MERGE` keyed on a natural or supplied id - so a retry after a timeout re-applies the same write instead of duplicating it.

## Connection management

Let the driver pool connections, which it does by default, and tune the pool to expected concurrency rather than the largest number the server will accept - an oversized pool just moves contention from the application to the database. Connections are scarce and must always be released: rely on `using` / `Dispose` (ORMs handle this for you) and, for raw access, scope the connection explicitly so it cannot leak on an exception path. Keep connections short-lived - one per unit of work - and never hold a long-lived shared connection, which serializes work behind it and survives the failures that a fresh connection would surface.

## Secrets

A connection string is a credential. It comes from configuration or a secret store, never from a source-controlled file, and production credentials stay separate from local and staging so a leaked dev secret cannot reach production data. If a credential is even suspected of exposure, rotate it - and never commit a connection string carrying a password to git history, where it survives every later "deletion". The wider secret-handling posture is `dotnet-security`.

## Stored procedures and views

Default to keeping logic in the application, where it is testable, diffable, and version-controlled with the rest of the code. Reach for a stored procedure only when set-based work in the engine genuinely beats application-side composition - a bulk operation that would otherwise round-trip per row. Use views for stable read projections, and a materialized view when the refresh cost is acceptable for the staleness it buys. Keep business logic out of triggers entirely: a trigger is reserved for auditing or for an integrity rule the schema itself cannot express, never for behavior a reader of the application code would never think to look for.

## Engine pitfalls

The defaults above are engine-neutral; these are the per-engine traps worth naming because the obvious choice is the wrong one.

- **PostgreSQL** - `SERIAL` is legacy; use `GENERATED ALWAYS AS IDENTITY` for new tables (it is SQL-standard and avoids the sequence-ownership surprises `SERIAL` carries). Prefer `TEXT` over `VARCHAR(n)` unless you need a hard length cap, since the two perform identically and `TEXT` never forces a migration to widen a limit.
- **SQL Server** - use `NVARCHAR` over `VARCHAR` for any user-facing text so Unicode is preserved. Avoid `DATETIME`; use `DATETIME2` for higher precision and a sane range, or `DATETIMEOFFSET` when the value is timezone-aware.
- **SQLite** - there is no native `BOOLEAN`; store `INTEGER` 0/1 with a `CHECK` constraint. There is no native date type; store ISO-8601 in `TEXT` or a Unix epoch in `INTEGER`. Foreign keys are *off by default* - issue `PRAGMA foreign_keys = ON` on every connection or the constraints you declared do nothing.
- **MongoDB** - the 16 MB document limit is a hard ceiling, so design to sit well under it rather than near it. The `ObjectId` already embeds a creation timestamp - read it from there instead of duplicating a separate created-at field.
