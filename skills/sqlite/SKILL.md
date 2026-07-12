---
name: sqlite
description: "SQLite engine specialist - the SQLite-specific delta on top of the cross-engine database-conventions hub: when SQLite fits, the single-writer / WAL concurrency model and busy-timeout, PRAGMAs (foreign_keys, journal_mode, synchronous), type affinity vs STRICT tables and date/bool storage, limited ALTER TABLE and the table-rebuild, connection-per-thread and in-memory test DBs, B-tree-only indexing, FTS5, and backup. Load for a SQLite .db, a PRAGMA, an embedded/desktop/mobile/test store, or an EF Core SQLite provider quirk. Not the cross-engine schema/transaction rules (-> database-conventions) or a server-class concurrent-writer workload (-> postgres). Companions: database-conventions (cross-engine hub - load first), dotnet-data-access (the EF Core / ORM side), postgres (the other engine)."
---

# sqlite (engine specialist)

The SQLite-specific layer. **Cross-engine conventions live in `database-conventions` - load that hub first and do not restate it.** The EF Core side lives in `dotnet-data-access`. This is only what changes *because the engine is SQLite*.

## When it fits

- Good: embedded / desktop / mobile app storage, single-node edge, a local cache, and test databases. It is a file, not a server.
- Bad: high-write-concurrency multi-client web. SQLite allows **one writer at a time** for the whole database - reach for `postgres` there.

## Concurrency

- Enable WAL: `PRAGMA journal_mode=WAL` - readers no longer block the single writer, which is the big throughput win. WAL persists on the file.
- `PRAGMA busy_timeout=5000` (ms) so a contended writer waits instead of failing instantly with `SQLITE_BUSY`.
- `PRAGMA synchronous=NORMAL` with WAL is the usual durability/speed balance (`FULL` is safest, slower).

## PRAGMAs and typing

- `PRAGMA foreign_keys=ON` on **every connection** - FK enforcement is OFF by default.
- SQLite is dynamically typed (type *affinity*, not strict) - a column will accept any type. Declare `STRICT` tables (3.37+) to enforce the declared types.
- No native boolean or date/time type: store dates as ISO-8601 `TEXT` or epoch `INTEGER`, booleans as `0`/`1`. Sort/compare accordingly.

## Schema changes

- `ALTER TABLE` is limited to `RENAME`, `ADD COLUMN`, `DROP COLUMN` (3.35+, but blocked on a column that is a PK / unique / indexed / in an FK / CHECK / generated expression), and toggling a column's `NOT NULL` (3.53+).
- Any other change - retype a column, reorder, add other constraints - needs the documented 12-step rebuild, in this order (skipping steps is how FK enforcement and views silently break):
  1. `PRAGMA foreign_keys=OFF` (outside the transaction).
  2. Begin a transaction.
  3. Save the SQL of the table's indexes, triggers, and views (query `sqlite_schema`).
  4. `CREATE TABLE new_X` with the revised schema.
  5. `INSERT INTO new_X SELECT ... FROM X`.
  6. `DROP TABLE X`.
  7. `ALTER TABLE new_X RENAME TO X`.
  8. Recreate the indexes and triggers from step 3.
  9. Drop and recreate any views the change affects.
  10. `PRAGMA foreign_key_check` (if FKs were on).
  11. Commit.
  12. `PRAGMA foreign_keys=ON` again.
- EF Core migrations on SQLite rebuild tables for many operations - can be slow and occasionally lossy. Review the generated SQL before applying.

## Queries and indexes

- No `RIGHT`/`FULL OUTER JOIN` before 3.39 - rewrite as `LEFT JOIN`.
- B-tree indexes only (no GIN/BRIN); partial and expression indexes are supported. Run `ANALYZE` / `PRAGMA optimize` for planner statistics, and `EXPLAIN QUERY PLAN` to confirm an index is used.
- Full-text search: use an FTS5 virtual table, not `LIKE '%term%'`.

## Connections and testing

- No server, no pooling - a connection is a file handle. Keep a connection per thread; do not share one connection across threads.
- An in-memory database (`:memory:`) is private to its connection unless you use a shared-cache name. For tests, hold the connection open for the database's lifetime, or the schema vanishes when it closes.

## Backup

The database is a single file: copy it while idle, or use the online backup API / `VACUUM INTO 'backup.db'` for a consistent copy of a live database.
