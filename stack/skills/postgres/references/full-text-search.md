# Postgres full-text search - the tsvector recipe

`LIKE '%term%'` cannot use an index. Store a generated `tsvector`, index it with GIN, query with `@@`:

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED;
CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);
SELECT * FROM articles WHERE search_vector @@ to_tsquery('english', 'postgres & performance') ORDER BY ts_rank(...);
```

- The generated `STORED` column keeps the vector consistent with its source columns - no trigger to forget.
- `to_tsquery` operators: `&` AND, `|` OR, `:*` prefix. For raw user input prefer `websearch_to_tsquery`, which parses free text safely instead of erroring on syntax.
- Rank with `ts_rank(search_vector, query)` in `ORDER BY`; keep the language configuration (`'english'`) identical between the stored vector and the query or nothing matches.
