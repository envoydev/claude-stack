# EF on .NET Framework 4.8

The ORM-agnostic access principles in SKILL.md hold on net48; the mechanics in `references/efcore.md`
assume a modern runtime. Two net48-specific points: which EF you can run, and the classic-ASP.NET
request lifetime.

## EF Core on 4.8 vs EF6 - a real choice

- **EF Core 3.1 runs on .NET Framework 4.8** (it targets .NET Standard 2.0); **EF Core 5.0+ dropped .NET
  Framework** (it needs net5.0+). So on 4.8 the choice is EF6 vs EF Core 3.1, not the latest EF Core.
- Keep EF6 for a stable data layer with EDMX or mature conventions; choose EF Core 3.1 for a
  greenfield-on-4.8 that will migrate later - it is the forward-compatible bet, since the eventual
  runtime move keeps EF Core. EF Core is not a drop-in replacement for EF6, so budget porting work. The
  upgrade path itself belongs to the .NET migration skill's own 4.8 notes.

## Request lifetime and the single-operation rule

- Scope the `DbContext` **per web request** through the DI container (the resolver wiring belongs to the
  controller-based Web API skill's own 4.8 notes). A `DbContext` is not thread-safe and runs
  one operation at a time - parallel `await`s on one context throw 'A second operation started on this
  context...'. EF async buys scalability, not intra-request parallelism; for genuinely parallel queries
  use separate contexts.
- Use async EF6 (`ToListAsync`, `SaveChangesAsync`) with `ConfigureAwait(false)` in the data layer (the
  SynchronizationContext reason is in the `csharp` baseline's own 4.8 notes). Reads use
  `AsNoTracking`; avoid N+1 by projection or `Include` - unchanged from SKILL.md.
- Enable a retrying execution strategy for Azure SQL (EF Core `EnableRetryOnFailure`; EF6
  `SqlAzureExecutionStrategy`). Caveat: a retrying strategy rejects a user-initiated `BeginTransaction`
  - wrap the transaction in `context.Database.CreateExecutionStrategy().Execute(...)`. Use explicit Code
  First migrations, disable automatic migrations in production, and script with `Update-Database -Script`
  to apply through the release pipeline.
