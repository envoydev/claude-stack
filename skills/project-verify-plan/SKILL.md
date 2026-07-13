---
name: project-verify-plan
description: Use when you have an implementation plan or design in hand and want to audit it BEFORE writing code - a risk-coverage review that checks the plan names the non-obvious traps its stack will actually hit, matches the requirement's scope, covers the edge and safety cases, and stays minimal. The cheapest place to catch a design error, since a flawed plan built perfectly is still wrong. Pairs with writing-plans (which creates the plan) and precedes /code-review (which reviews the built code). Trigger on review this plan, is this design sound, does the plan miss anything, before I build.
---

# Verify Plan - a risk-coverage audit of a plan before you build

A plan built perfectly is still wrong if the plan was wrong - the design carries the quality: a build handles the traps its plan names and ships the ones it misses, and catching the miss here on the page is cheaper than any downstream gate (the code, the tests, /code-review). This reviews an EXISTING plan or design (yours, or one `writing-plans` produced) for the defects that are expensive to discover later. It does not write or fix code; it flags gaps in the plan and hands them back.

## When to use / not

- Use it the moment a plan exists and before implementation starts - especially for anything with a boundary, state, auth, migration, or concurrency surface.
- Not code review - that is `/code-review`, after the build.
- Not plan *creation* - that is `writing-plans` / `superpowers:brainstorming`. This audits a plan that already exists.

## The audit - four passes, in order

Load the plan's target stack skill FIRST, so you check against the right trap list, not a generic one.

1. **Risk coverage - the highest-leverage pass.** Does the plan NAME the non-obvious failure modes this feature will hit? Do not carry a generic checklist - load the stack's house skill and check the plan against ITS traps:
   - ASP.NET / EF -> `dotnet-web-backend` + `dotnet-data-access` (N+1, tracking on read paths, entity-across-the-boundary, one-SaveChanges owner, overflow / boundary math, concurrency token).
   - Angular -> `angular-conventions` (signal reactivity, OnPush, RxJS teardown).
   - WPF -> `dotnet-wpf` (cross-thread UI, silent binding failure, INotifyPropertyChanged correctness).
   - SQL / data -> `database-conventions` + the engine skill; DevOps -> `devops`; Ionic/mobile -> `ionic`.
   A trap the plan does not name is a trap the build inherits - flag each missing one and where in the plan it belongs.
2. **Scope match.** The plan covers exactly what was asked - nothing missing, nothing speculative added (the ponytail 'ultra' test). A step for a requirement that is not there, or a missing step for one that is, is a finding.
3. **Edges + safety.** Boundary, empty, and error cases are named, not assumed. Any auth / migration-order / data-loss / concurrency surface is called out WITH its safeguard. Silence on a safety-critical edge is a finding.
4. **Soundness.** The approach matches the repo's existing architecture (match it, never introduce a second), dependencies are ordered, and it is the smallest plan that meets the requirement.

## Output

A short punch-list, not a rewrite. One line per finding: `severity | the gap | the fix to the PLAN`. If the plan is sound, say so plainly and name what you checked. Then it is safe to build against; if not, fix the plan first - that is the whole point of doing this before code.

## Example

Auditing the `project-solution-design` CSV-export plan ('add CSV export to the orders list' - three tasks: an IOrderQueries projection, a streamed /orders/export endpoint, a WebApplicationFactory test), one finding per pass:

```text
1 risk      | MAJOR | no task names request cancellation on the streamed export - a client abort leaks the open reader | thread a CancellationToken through Tasks 1-2 (dotnet-web-backend trap list)
2 scope     | MINOR | Task 2 adds an Excel-BOM option the requirement never asked for | drop it (the ponytail 'ultra' test)
3 edges     | MAJOR | empty result set unspecified - header-only CSV or 404?           | name the expected shape in Task 2; assert it in Task 3
4 soundness | pass  | extends the existing IOrderQueries seam, tasks in dependency order, smallest plan
```

Verdict: fix the plan (2 MAJOR), re-check the two lines, then build.
