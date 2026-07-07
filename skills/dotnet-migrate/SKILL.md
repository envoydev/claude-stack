---
name: dotnet-migrate
description: "Personal safe-migration playbook for .NET - the disciplined way to evolve a schema with EF Core, lift a solution onto a newer target framework, and refresh NuGet dependencies without breaking production. Every change is previewed before it lands, carries a known rollback, and is re-verified by build plus tests, with one logical change per step so a regression can be bisected. A process skill, version-neutral with a .NET 8 floor. Load when you run a database migration, raise the target framework or SDK, or bump packages - trigger words migrate, upgrade, update packages. Companions: `dotnet-data-access` for query and migration mechanics, `dotnet-project-setup` for central package management, `dotnet-web-backend` for the surrounding service. Skip it for ordinary feature work that touches no schema, no version, and no package."
---

# Safe migration workflow (.NET)

Migrations are where a working codebase quietly acquires risk: a column drop that loses data, a framework bump that breaks at runtime not compile time, a transitive package that shifts behavior under you. The defense is the same four rules in every flow below.

- **Preview before you apply.** Read the generated SQL, the breaking-change list, the changelog - never run a step blind.
- **Carry a rollback.** Know the exact command or commit that undoes the step *before* you take it.
- **Re-verify after every step.** Build and run the tests; a green pre-flight that you never re-check proves nothing.
- **One logical change per step.** A migration, an upgrade, a bump - keep them atomic so a break bisects cleanly.

Assess blast radius with serena (`find_symbol`, `find_referencing_symbols`) or the LSP. Do not `Read` whole files hunting for who touches a type - that is exactly the work the symbol tools do faster.

## Flow A - EF Core schema migration

1. **See where you are.** `dotnet ef migrations list` shows what is applied versus pending. Use serena to find the entities you are about to change and everything that references them.
2. **Generate one named migration.** `dotnet ef migrations add <Name>` - name it Verb-then-subject so the history reads as a log: `AddOrderShippedAt`, `MakeEmailUnique`, `DropLegacyStatus`. The one-change-per-migration discipline itself is `database-conventions`'s to state; this step is just the EF naming and generation mechanics.
3. **Preview the SQL.** `dotnet ef migrations script --idempotent` (or `--idempotent <from> <to>` for a range). Read it for the dangerous shapes: dropped or renamed columns, a non-nullable add with no default, a type narrowing that truncates, an index or constraint added to a large table under a lock. The `--idempotent` flag guards each step with an `__EFMigrationsHistory` check so the script is safe to run against a database at any applied state, and re-running it is a no-op. EF cannot see your data - you have to.
4. **Stage destructive change in two deploys.** Anything that can lose data or that the old code still depends on is expand-then-contract: first add the new column and backfill (the old code keeps working), ship, then in a later migration drop the old column once nothing reads it. Never collapse both halves into one migration against a live database. A wide backfill is a data migration, not a schema one - run it in batches outside the `ALTER`, never as a single `UPDATE` under a table lock.
5. **Apply and verify.** In dev, `dotnet ef database update`, then build and run the tests. For anything past a local box, do not apply from a developer machine or call `Database.Migrate()` on app start under load (it serializes startup and needs schema-owner rights at runtime). Build a migrations bundle once - `dotnet ef migrations bundle -o efbundle` (add `--self-contained -r <rid>` to fold the runtime in too) - and run that single-file executable as a gated deploy step. Like `dotnet ef database update` it checks `__EFMigrationsHistory` and applies only the migrations still missing, so it needs neither the SDK, the EF tool, nor the project source on the target and is the zero-downtime artifact.
6. **Know the undo.** Roll the database back with `dotnet ef database update <PreviousMigration>`, then delete the migration files with `dotnet ef migrations remove` (which un-snapshots cleanly - never delete the files by hand). Never hand-edit an already-applied migration - add a new one. Once a migration has shipped to any shared environment its rollback is a *new* forward migration, not a `remove`. Query, tracking, and configuration mechanics live in `dotnet-data-access`.

## Flow B - target framework / SDK upgrade

1. **Start clean.** Green tests and zero pending migrations before you touch a version - you want any new red to be unambiguously the upgrade's fault.
2. **Move the SDK first.** Bump `global.json` if it pins one, then `<TargetFramework>` and `<LangVersion>` in each project. Sweep the whole solution for stragglers on the old TFM - a mixed-framework solution is its own class of bug.
3. **Match the packages to the framework.** Update Microsoft and third-party packages to the line that targets the new framework, build, and work through the breaks. The official breaking-changes list for the release is the map; read it rather than guessing at each error. For a large or legacy solution an automated sweep drives the mechanical TFM and package bumps and surfaces the analyzers - the .NET Upgrade Assistant (`dotnet tool install -g upgrade-assistant`) still ships but is now deprecated in favor of the GitHub Copilot app modernization agent; whichever you use, still read the breaking-changes list for the behavioral breaks it cannot catch.
4. **Adopt new features on purpose.** A release's additions (`TimeProvider` for testable time, `HybridCache`, keyed services, primary constructors) are opt-in - take them where they pay, in their own follow-up commits, not bundled into the bump.
5. **Verify the full set.** Build, test, then `dotnet format` so the diff is upgrade-only and not noise. The floor is .NET 8 / C# 12; how far you go above it is the target you chose.

## Flow C - NuGet package updates

1. **Audit first.** `dotnet list package --outdated` for what is behind, `dotnet list package --vulnerable` (add `--include-transitive`) for what is unsafe. Security fixes jump the queue.
2. **Sort by semver risk.** Patch and minor are usually safe; a major is a contract change - read its release notes before you commit to it. Group the work so the riskiest bumps are isolated.
3. **One package at a time.** Update a package, build, test, then the next. A single-package step is the only step you can bisect; a mass bump turns one regression into a hunt across a dozen libraries.
4. **Centralize versions.** With central package management the version lives once in `Directory.Packages.props`, not scattered across `.csproj` files - that mechanism is `dotnet-project-setup`.
5. **Undo cleanly.** Back out a bad update with `git revert` of that step's commit. Never silently downgrade an unrelated dependency to paper over the break.

## Anti-patterns

- Applying a migration without reading its SQL, or folding several unrelated schema changes into one migration (the one-change-per-migration and reversibility rules `database-conventions` owns).
- A destructive column change in a single migration against a live database instead of expand-then-contract.
- A wide backfill folded into the schema migration, taking a table lock for the duration instead of batching it separately.
- Applying schema from a developer machine, or calling `Database.Migrate()` on app start under load, instead of a gated idempotent bundle.
- Upgrading the framework on top of red tests or outstanding pending migrations.
- Bumping every package in one commit so the regression cannot be bisected.
- Hand-editing an applied migration, deleting its files by hand, or downgrading a sibling package to compensate for a bad bump.
