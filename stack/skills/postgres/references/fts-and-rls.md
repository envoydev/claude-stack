# Full-text search and RLS policy performance

Read when the work is actually one of these two: a text search that must use an index, or RLS as
the tenancy mechanism. Everything else Postgres-specific stays in `SKILL.md`.

## Full-text search

`LIKE '%term%'` cannot use an index. Store a generated `tsvector`, index it with GIN, query with `@@`:

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED;
CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);
SELECT * FROM articles WHERE search_vector @@ to_tsquery('english', 'postgres & performance');
```

- The generated `STORED` column keeps the vector consistent with its source columns - no trigger to forget.
- `to_tsquery` operators: `&` AND, `|` OR, `:*` prefix. For raw user input prefer `websearch_to_tsquery`, which parses free text safely instead of erroring on syntax.
- Rank with `ts_rank(search_vector, query)` in `ORDER BY`; keep the language configuration (`'english'`) identical between the stored vector and the query or nothing matches.

## RLS policy performance

Only when RLS is the tenancy mechanism (policy *basics* - creating and enabling policies, least-privilege logins - are the data-layer security skill's):

- Wrap a function call in a scalar sub-select so it evaluates once per query, not per row: `USING ((SELECT current_setting('app.user_id')::bigint) = user_id)`. A bare `current_setting(...)` in the policy re-runs on every candidate row.
- Always index the column a policy filters on - the policy predicate is appended to every query against the table, so an unindexed policy column turns every read into a scan.
- For complex checks, use a `SECURITY DEFINER` helper function in a non-exposed schema, with an explicit caller-identity check inside and `EXECUTE` revoked from public - the planner can treat it as stable, and the check logic stays in one audited place.
