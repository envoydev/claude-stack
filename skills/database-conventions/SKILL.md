---
name: database-conventions
description: "Personal database conventions across Postgres, SQL Server/T-SQL, SQLite, and MongoDB - the engine-neutral rules for schema design, migrations, indexes, foreign keys, transactions, connection management, query safety, N+1 prevention, and secret handling, plus the per-engine pitfalls that bite. Load before designing or modifying a schema, writing SQL raw or through an ORM, modeling a document store, or creating a migration, view, procedure, or index. Deeper work routes out: engine tuning to `postgres` / `sqlite`, .NET data access to `dotnet-data-access`, migration mechanics to `dotnet-migrate`, security posture to `data-security`. Do NOT load for app-only in-memory data structures or a project with no persistence layer."
---

# Database conventions

A database is the one part of a system where a careless change is permanent: a dropped column takes its data with it, a missing index turns a query into a table scan under load, an unbounded result set is a memory incident waiting for the row count to grow. These conventions are the engine-neutral defaults that keep that from happening; the deep, engine-specific work routes to the companions cited per section.

**SQL writing style is authoritative in `references/sql-style.md`** - casing, formatting and layout, naming style, query construction, data-type choice, NULL handling, dialect portability, and the per-engine cheat-sheet (PostgreSQL / SQL Server / SQLite). This SKILL.md owns schema design and operational safety (schema, migrations, indexes, transactions, connections); where the two overlap on naming, query safety, or engine data types, the style reference wins. **Above both, a project's own SQL style - a co-located `SQL_STYLE.md` or its `docs/PROJECT-CODE-STYLE.md` - is higher priority: where a project diverges from these general conventions, follow the project.**

## Choosing a store

Relational is the default store; reach for a document, key-value, graph, or time-series engine only when the access pattern genuinely mismatches SQL, and expect to run it alongside the relational database rather than in place of it. A cache (Redis and the like) is a performance layer, never the source of truth - the system must be able to rebuild it from the database, and every cached key carries a TTL so a stale or orphaned entry cannot grow until it runs the instance out of memory.

## Schema design

The schema is the one place integrity is cheap to enforce and expensive to retrofit, so decide these before the first table ships.

- **Default to a surrogate primary key** - a `BIGINT` identity for most tables, a UUID only when you need distributed or non-guessable generation - never a natural key like an email or SKU, which eventually changes or collides and cascades that change through every referencing table. Keep a `UNIQUE` constraint on the natural identifier so you still get its uniqueness without making it the key. When a write-heavy table does need a UUID key, use a time-ordered variant (UUID v7 or ULID), not random v4, whose scattered inserts fragment the index and drag insert throughput down as the table grows.
- **Normalize operational tables to 3NF by default** - the balance of integrity and practicality most schemas want, and a clean 3NF design is usually already in BCNF. Denormalize only deliberately and only after profiling a proven read bottleneck, as a cached or computed field on that one hot path. Both failure modes bite equally: over-normalizing a simple read into a ten-way join, and under-normalizing multi-valued data into comma-separated strings that turn 'find every row matching X' into string parsing.
- **Model many-to-many through a junction table** with a composite primary key (or unique constraint) on the two foreign keys so a duplicate pairing cannot be inserted, index both columns so you can traverse from either side, and put any relationship attributes - a role, a quantity, an enrollment date - on the junction row itself. A polymorphic association (one child pointing at several possible parents) trades away database-level referential integrity, so guard it with a `CHECK` that exactly one target column is set and validate the target in the application.
- **Store every timestamp in UTC** and convert to local only at display in the application; reach for a timezone-aware type (`TIMESTAMPTZ`, `DATETIMEOFFSET`) only when the originating offset itself must be preserved. Put non-nullable `created_at` and `updated_at` on every table - the audit trail you always end up needing. For anything you might have to recover or audit, prefer a soft delete (a nullable `deleted_at`) over a hard `DELETE`, and filter rows whose `deleted_at` is set out of every normal read.

## Engine-specific routing

The rules here hold across engines; the deep mechanics live with the engine skills.

- **PostgreSQL** - `postgres` for index-type selection, JSONB/full-text, SARGable rewrites, the planner (EXPLAIN / pg_stat_statements / autovacuum), and connection pooling.
- **SQLite** - `sqlite` for the WAL / single-writer concurrency model, PRAGMAs, type affinity, limited ALTER TABLE, and connection-per-thread.
- **SQL Server / T-SQL** - no dedicated engine skill; the engine-neutral rules here, plus `references/sql-style.md`'s T-SQL style and dialect gotchas (`TOP`/`OFFSET-FETCH`, `MERGE`, `THROW`, `IDENTITY`, `TRY/CATCH`), plus `postgres`'s transferable index/SARGability principles cover most of it.
- **MongoDB / document stores** - no dedicated skill; apply document-modeling care. Embed versus reference by access pattern, index every queried field path, bound array growth, and never run an unbounded `$lookup`.

## Query safety

The query-*writing* style - explicit column lists over `SELECT *`, ANSI `JOIN` syntax, `AS` aliases, column qualification, SARGable predicates, and clause order - is in `references/sql-style.md`. The operational safety rules here:

- **Every query is either parameterized or it is a vulnerability.** Never build SQL by string concatenation - the full injection treatment (per-ORM mechanics, dynamic SQL, identifier allowlisting) is owned by `data-security`. Keep parameter values out of logs too: query text that carries PII or secrets must never be logged verbatim.
- **Read with the least authority the work needs.** Default reads to read-only intent and `READ COMMITTED` isolation; reach for `SNAPSHOT` or `REPEATABLE READ` only when a specific consistency requirement justifies the extra cost, and say why.
- **Bound every result set that could grow** - a `LIMIT` or `TOP` on any open-ended query - and never `SELECT *`, which drags unused columns over the wire and breaks the moment the schema changes.
- **Deep pagination is keyset (seek), never `OFFSET`.** `OFFSET 20000` still scans and discards those 20000 rows, so page 1000 keeps getting slower; a keyset seek with a unique tiebreaker column holds every page equally fast:

```sql
select id, created_at, total
from orders
where (created_at, id) < (:last_created_at, :last_id)
order by created_at desc, id desc
limit 20;
```

(SQL Server has no row-value comparison - expand to `created_at < :ts OR (created_at = :ts AND id < :id)`.)

- The data-layer hardening posture around injection and connection strings - parameterization at every sink, least-privilege accounts, secrets out of the connection string - is owned by `data-security`; this skill stops at the query.

## N+1 prevention

- The N+1 query hides in code that reads perfectly - a loop over rows lazily fetching a relation per iteration; the fix (eager fetch or one set query) is the ORM read-path shape `dotnet-data-access` owns - for a document store, a single shaped read.
- Do the join in the database - never pull two tables into the application and join them in memory, which fetches more rows than the result needs and throws away the engine's join optimizer.
- This skill is engine and SQL only. All .NET data access routes out: the ORM mechanics (`Include` / `ThenInclude`, `AsSplitQuery`, `AsNoTracking`, and their NHibernate equivalents) and read-path shape belong to `dotnet-data-access`. Do not restate them here.

## Migrations

The migration *workflow* - previewing the generated SQL, carrying a rollback, re-verifying after each step, and the matching .NET / SDK and NuGet update flows - is owned by `dotnet-migrate`. What stays here are the engine-level rules the workflow assumes:

- **Every migration is reversible.** No destructive change ships without an explicit down path; an irreversible step is a deliberate, reviewed exception, not a default.
- **One logical change per migration**, with a descriptive name (`AddOrderShippingAddress`, never `Migration1` or `Update001`) so the history reads as a log.
- **Idempotent at deploy time** - running the migration twice produces the same schema, so a re-run after a partial deploy is safe.
- **Backfills run separately from schema changes** when the row count is large. Reshape the schema in one step and move the data in batches in another, so neither holds a long table lock.
- **Production migrations are reviewed for lock impact** before they ship: an `ALTER TABLE` or an index rebuild on a large table can lock it for the duration, and that is a downtime decision, not an afterthought.

## Naming

The naming *style* - keyword casing, table singular/plural, column suffixes, and constraint/index name prefixes - lives in `references/sql-style.md`. The schema-side essentials here:

- Naming is a convention, which means its only job is to be consistent - the specific choice matters far less than not mixing two. Keep all identifiers in English.
- Pick one case per project and hold it: `snake_case` for PostgreSQL by default, `PascalCase` for SQL Server unless the project overrides it. Pick singular or plural table names once and never mix the two.
- Foreign-key columns follow the related table - `<related_table>_id` or `<RelatedTable>Id` to match the project's case. Indexes self-describe (`ix_orders_customer_id_status`) so a name tells you what it serves; leave anonymous index names to the tool only when the migration generator produces them.

## Indexes

- An index is a write-time cost paid for a read-time gain: add each one deliberately and be able to name the query it serves - an index with no query behind it is pure overhead on every insert and update.
- Order a composite index by predicate type: equality columns first, the range column last, so the engine can seek rather than scan.
- Before widening a composite index to satisfy a hot query, cover it instead - add the extra columns as `INCLUDE` columns (SQL Server and Postgres) so the index answers the query without a key lookup and without bloating the seek key. Use a filtered or partial index for a sparse predicate (`WHERE IsActive = 1`) so the index stays small.
- Drop indexes that no query uses - but verify against `sys.dm_db_index_usage_stats` or `pg_stat_user_indexes` over a representative window first, because an index that looks idle in a five-minute sample may serve a nightly job.
- Build or rebuild an index on a live, populated table without a table-length lock - Postgres `CREATE INDEX CONCURRENTLY` / `REINDEX CONCURRENTLY`, SQL Server `WITH (ONLINE = ON)` - so the build is not a downtime event; the read-side pair of the migrations lock-impact review.

## Constraints

Integrity belongs in the schema, where it cannot be bypassed, not in application logic that one code path will forget.

- Enforce foreign keys at the database level - a 'soft' relation maintained only in application code is a relation that will drift.
- Default columns to `NOT NULL`; opt into nullability only where the model genuinely has an absent value. Express invariants the schema can state as `CHECK` constraints - a numeric range, an enum-as-string set.
- Enforce uniqueness with a `UNIQUE` constraint or a unique index, never an application-side 'check then insert', which races two concurrent requests straight into a duplicate.
- Declare `ON DELETE` and `ON UPDATE` behavior explicitly on every foreign key - `RESTRICT`, `CASCADE`, or `SET NULL` per the business rule - because the engine default varies and leaning on it is a silent bug. Index every foreign-key column: an unindexed FK turns every join and every 'find the children of X' into a full scan at production volume.
- Never store a derived value that can drift from its inputs (an order `total` kept beside its `subtotal` and `tax`): compute it in the query or a view, or materialize it as a generated column the engine keeps consistent, so the stored copy can never disagree with its source.

## Transactions

- Scope a transaction to exactly one unit of work - one request or use-case - opened at the boundary, committed on success, rolled back on exception.
- The cardinal mistake is holding a transaction open across external I/O: a transaction that waits on an HTTP call or a message bus holds its locks for the duration of a network round trip. Read what you need first, then open the transaction, do the writes, and close it.
- Design writes to be idempotent - an `UPSERT` or `MERGE` keyed on a natural or supplied id - so a retry after a timeout re-applies the same write instead of duplicating it.
- When two transactions can race to modify the same row - a balance transfer, an inventory decrement, an oversell guard - take a pessimistic row lock (`SELECT ... FOR UPDATE`) on the rows you are about to change rather than reading them optimistically and hoping; the unlocked read-then-write window is exactly where the lost update lives.
- When a single transaction locks several rows, take them in a consistent order (`WHERE id IN (...) ORDER BY id FOR UPDATE`) or in one set-based statement - an inconsistent lock order between two transactions is precisely what produces a deadlock.
- Database-backed work queue: claim a row atomically with `FOR UPDATE SKIP LOCKED LIMIT 1` (SQL Server: `WITH (UPDLOCK, READPAST, ROWLOCK)`) so competing workers take different rows instead of blocking on the same one.
- A job that must run on a single instance coordinates through an application-level lock - Postgres `pg_advisory_xact_lock` / `pg_try_advisory_lock`, SQL Server `sp_getapplock` - rather than a dummy row `SELECT ... FOR UPDATE`.

## Connection management

- Let the driver pool connections, which it does by default, and tune the pool to expected concurrency rather than the largest number the server will accept - an oversized pool just moves contention from the application to the database.
- Connections are scarce and must always be released: rely on `using` / `Dispose` (ORMs handle this for you) and, for raw access, scope the connection explicitly so it cannot leak on an exception path. Keep connections short-lived - one per unit of work - and never hold a long-lived shared connection, which serializes work behind it and survives the failures that a fresh connection would surface.
- Set a server-side `idle_in_transaction_session_timeout` alongside `statement_timeout` (SQL Server `LOCK_TIMEOUT`) so an abandoned client cannot pin a connection and keep holding its locks - a separate guard from the driver's pool idle timeout.
- Server-side prepared statements break behind a transaction-mode pooler (PgBouncer, RDS Proxy) because the next call lands on a different backend - disable them driver-side or run session-mode pooling; the per-driver switches live in `postgres`.

## Secrets

A connection string is a credential. It comes from configuration or a secret store, never from a source-controlled file, and production credentials stay separate from local and staging so a leaked dev secret cannot reach production data. If a credential is even suspected of exposure, rotate it - and never commit a connection string carrying a password to git history, where it survives every later 'deletion'. The wider secret-handling posture is `data-security`.

## Stored procedures and views

Default to keeping logic in the application, where it is testable, diffable, and version-controlled with the rest of the code. Reach for a stored procedure only when set-based work in the engine genuinely beats application-side composition - a bulk operation that would otherwise round-trip per row. Use views for stable read projections, and a materialized view when the refresh cost is acceptable for the staleness it buys. Keep business logic out of triggers entirely: a trigger is reserved for auditing or for an integrity rule the schema itself cannot express, never for behavior a reader of the application code would never think to look for.

## Engine pitfalls

The full per-engine data-type tables (text, numbers, boolean, date/time, UUID) are in `references/sql-style.md`. The defaults above are engine-neutral; these are the per-engine traps worth repeating here because the obvious choice is the wrong one.

- **Money and exact quantities** - store as `decimal` / `NUMERIC(p,s)` on every engine, never `float` or `double`, since binary floats cannot represent decimal fractions and drift silently on sums.
- **PostgreSQL** - `SERIAL` is legacy; use `GENERATED ALWAYS AS IDENTITY` for new tables (it is SQL-standard and avoids the sequence-ownership surprises `SERIAL` carries). Prefer `TEXT` over `VARCHAR(n)` unless you need a hard length cap, since the two perform identically and `TEXT` never forces a migration to widen a limit.
- **SQL Server** - use `NVARCHAR` over `VARCHAR` for any user-facing text so Unicode is preserved. Avoid `DATETIME`; use `DATETIME2` for higher precision and a sane range, or `DATETIMEOFFSET` when the value is timezone-aware.
- **SQLite** - foreign keys are *off by default*: issue `PRAGMA foreign_keys = ON` on every connection or the constraints you declared do nothing. Type affinity and the boolean / date storage idioms are owned by `sqlite` (data-type tables in `references/sql-style.md`).
- **MongoDB** - the 16 MB document limit is a hard ceiling, so design to sit well under it rather than near it. The `ObjectId` already embeds a creation timestamp - read it from there instead of duplicating a separate created-at field.
