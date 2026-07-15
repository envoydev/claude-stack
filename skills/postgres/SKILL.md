---
name: postgres
description: "PostgreSQL engine specialist - the Postgres-specific delta on top of the cross-engine database-conventions hub: identifier folding and idempotent DDL, index-type selection (B-tree/GIN/GiST/BRIN/hash), JSONB and full-text indexing, SARGable predicate rewrites, the planner (EXPLAIN ANALYZE, pg_stat_statements, autovacuum/ANALYZE, work_mem), connection pooling modes, and array-batching/ON CONFLICT/COPY. Load for any hand-written Postgres SQL, an .sql file on a Postgres project, an EXPLAIN plan, a slow query, or an index/pooling decision. Not the cross-engine schema/transaction rules (-> database-conventions), the ORM side (-> dotnet-data-access), or another engine's SQL. Companions: database-conventions (cross-engine hub - load first), data-security (RLS/privileges), dotnet-data-access (the EF Core / ORM side)."
---

# postgres (engine specialist)

The Postgres-specific layer. **Cross-engine conventions live in `database-conventions` - load that hub first and do not restate it here.** RLS basics and least-privilege logins live in `data-security`. The .NET/EF Core side lives in `dotnet-data-access`. This file is only what changes *because the engine is Postgres*.

## Schema and types

- Keep every identifier lowercase `snake_case` and unquoted. Postgres folds unquoted identifiers to lowercase; a quoted mixed-case name (`"firstName"`) must be quoted forever and breaks ORMs and tools. Inheriting mixed-case? Wrap a `snake_case` view as a compatibility layer.
- `ADD CONSTRAINT IF NOT EXISTS` does not exist in Postgres - it is a syntax error. Guard idempotent constraint DDL with a `pg_constraint` check:

```sql
do $$ begin
  if not exists (select 1 from pg_constraint
                 where conname = 'profiles_owner_unique' and conrelid = 'public.profiles'::regclass)
  then alter table public.profiles add constraint profiles_owner_unique unique (owner_id);
  end if;
end $$;
```

- Growable value set: `text` + `check (col in (...))`. A native `create type ... as enum` only for a truly fixed set - adding a value needs `ALTER TYPE`, reordering is painful.
- Partition (`partition by range`) once a table passes ~100M rows or is time-series with date-scoped reads: the planner prunes to relevant partitions, and dropping old data is an instant `drop table events_2023_01`, not a lock-heavy `DELETE` + `VACUUM`.
- Postgres never auto-indexes foreign-key columns. Every FK needs its own index or joins and `on delete cascade` become full scans - audit with `pg_constraint` vs `pg_index`.

## Indexing - match the type to the query

| Access pattern | Index |
|---|---|
| `=`, `<`, `>`, `between`, `in`, `is null`, `order by` | B-tree (default) |
| `jsonb` containment, arrays, full-text `tsvector` | GIN |
| geometric / range types, nearest-neighbor (KNN) | GiST |
| huge naturally-ordered / append-only (e.g. `created_at`) | BRIN (10-100x smaller than B-tree) |
| pure equality, marginal win over B-tree | Hash |

- Composite leftmost-prefix: an index on `(a, b)` serves `where a` and `where a and b`, never `where b` alone. (Equality-first / range-last ordering is owned by `database-conventions`.)
- A partial index is used only when the planner proves the query predicate implies the index `WHERE` - keep that predicate identical to the query's own condition, and beware parameterized queries that can't match a literal-based filter.
- JSONB: a B-tree cannot serve `@>`. Use `gin`; default `jsonb_ops` covers all operators, `jsonb_path_ops` covers only `@>`, `@?`, `@@` (not the key-existence `?`/`?&`/`?|`) at ~half the size. For scalar-key equality use an expression index, not GIN:

```sql
create index products_attrs_gin on products using gin (attributes);         -- @>, ?, ?&, ?|
create index products_brand_idx on products ((attributes->>'brand'));       -- attributes->>'brand' = 'Nike'
```

## Queries and the planner

- SARGability is engine-neutral and owned by `database-conventions` (its `references/sql-style.md` SARGability section): leave the indexed column bare. The Postgres spellings of the trap:

| Non-sargable | Rewrite |
|---|---|
| `extract(year from d) = 2026` | `d >= '2026-01-01' and d < '2027-01-01'` |
| `date_trunc('day', ts) = :d` | `ts >= :d and ts < :d + interval '1 day'` |
| `id::text = '42'` (cast on the column) | `id = 42` |

- Must filter on a function (e.g. case-insensitive email)? The escape hatch is a matching expression index: `create index on users ((lower(email)))` then `where lower(email) = :v`.
- When only existence matters, use `exists` (semi-join) not a join - a join on a non-unique key multiplies rows, and a predicate on the right table's columns in `WHERE` silently turns a `LEFT JOIN` into an inner join.
- Rewrite `OR` across different columns as `union all` branches so each branch can seek. Avoid the catch-all `col = :p or :p is null` on hot paths - use a query per shape.
- Batch instead of N+1: `where user_id = any($1::bigint[])`, one round trip, not N.
- Atomic upsert closes the check-then-insert race:

```sql
insert into settings (user_id, key, value) values (123,'theme','dark')
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
insert into page_views (page_id, user_id) values (1,123) on conflict do nothing;
```

- Bulk load: multi-row `insert ... values (...),(...)` (~1000 rows/statement) over per-row; `COPY` for large imports (fastest path).

## Read-path diagnostics

- `explain (analyze, buffers)` is the primary tool - it runs the query and shows real timing and IO. Read for:
  - `Seq Scan` on a large table -> missing index.
  - high `Rows Removed by Filter` -> poor selectivity.
  - `Buffers: read >> hit` -> not cached (memory pressure).
  - `Sort Method: external merge` -> `work_mem` too low.
  - estimate-vs-actual row gap of 10x+ -> stale statistics, run `ANALYZE`.
- Rank findings by measured impact (actual rows/buffers/time), never by the estimated cost percentage.
- Enable `pg_stat_statements`; rank by `total_exec_time` (aggregate cost) and `mean_exec_time` (worst per-call); `pg_stat_statements_reset()` after a fix to re-measure.
- Autovacuum handles most tables; tune per-table for high churn and `ANALYZE` after a bulk change:

```sql
alter table orders set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
analyze orders;
```

- `work_mem` is per sort/hash node, not per connection - keep `work_mem * max_connections` under ~25% of RAM or sorts spill to disk.
- A prepared statement can lock in a generic plan that hurts skewed values; if a prepared query degrades, force per-value planning (`plan_cache_mode = force_custom_plan`).

## Connections and pooling

- Each backend is a real process (~1-3MB) - always pool (PgBouncer or built-in). Rule of thumb `pool_size ~= cores*2`; a few dozen real connections serve hundreds of clients.
- Transaction-mode pooling is the default. Session mode is required only for features bound to one backend: server-side prepared statements, temp tables, session GUCs, session advisory locks.
- Size `max_connections` to RAM (100-200), not to peak client count - that is the pooler's job, and `work_mem * max_connections` must stay bounded.
- Behind a transaction pooler, disable driver-side prepared statements: Npgsql `Max Auto Prepare=0` (see `dotnet-data-access`), postgres.js `{ prepare: false }`, JDBC `prepareThreshold=0`.

## Full-text search

`like '%term%'` cannot use an index. Use a stored `tsvector` column + GIN + `@@` - the working recipe (generated column, index, query operators) is in `references/full-text-search.md`.

## RLS policy performance

Only when RLS is the tenancy mechanism (policy *basics* are owned by `data-security`): make policy functions evaluate once per query instead of per row, and index the column every policy filters on - the patterns are in `references/rls-performance.md`.
