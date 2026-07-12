# RLS policy performance

Patterns for when row-level security is the tenancy mechanism (policy *basics* - creating and enabling policies, least-privilege logins - are owned by `data-security`):

- Wrap a function call in a scalar sub-select so it evaluates once per query, not per row: `using ((select current_setting('app.user_id')::bigint) = user_id)`. A bare `current_setting(...)` in the policy re-runs on every candidate row.
- Always index the column a policy filters on - the policy predicate is appended to every query against the table, so an unindexed policy column turns every read into a scan.
- For complex checks, use a `security definer` helper function in a non-exposed schema, with an explicit caller-identity check inside and `execute` revoked from public - the planner can treat it as stable, and the check logic stays in one audited place.
