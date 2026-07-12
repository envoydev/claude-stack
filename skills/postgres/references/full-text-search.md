# Postgres full-text search - the tsvector recipe

`like '%term%'` cannot use an index. Store a generated `tsvector`, index it with GIN, query with `@@`:

```sql
alter table articles add column search_vector tsvector generated always as
  (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored;
create index articles_search_idx on articles using gin (search_vector);
select * from articles where search_vector @@ to_tsquery('english', 'postgres & performance') order by ts_rank(...);
```

- The generated `stored` column keeps the vector consistent with its source columns - no trigger to forget.
- `to_tsquery` operators: `&` AND, `|` OR, `:*` prefix. For raw user input prefer `websearch_to_tsquery`, which parses free text safely instead of erroring on syntax.
- Rank with `ts_rank(search_vector, query)` in `order by`; keep the language configuration (`'english'`) identical between the stored vector and the query or nothing matches.
