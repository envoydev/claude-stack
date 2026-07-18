---
name: project-verify-plan
description: Use when you have an implementation plan or design in hand and want to audit it BEFORE writing code - a risk-coverage review that checks the plan names the non-obvious traps its stack will actually hit, matches the requirement's scope, covers the edge and safety cases, and stays minimal. The cheapest place to catch a design error, since a flawed plan built perfectly is still wrong. Pairs with writing-plans (which creates the plan) and precedes project-verify-code (which reviews the built code). Trigger on review this plan, is this design sound, does the plan miss anything, before I build.
disable-model-invocation: true
---

# Verify Plan - a risk-coverage audit of a plan before you build

A plan built perfectly is still wrong if the plan was wrong - the design carries the quality: a build handles the traps its plan names and ships the ones it misses, and catching the miss here on the page is cheaper than any downstream gate (the code, the tests, project-verify-code). This reviews an EXISTING plan or design (yours, or one `superpowers:writing-plans` produced) for the defects that are expensive to discover later. It does not write or fix code; it flags gaps in the plan and hands them back.

## Audit mode - inline by default

Default: audit inline in this chat, the four passes below. On an explicit agents request, dispatch the plan's stack `<stack>-verifier` seat to run the same four passes over the plan file - on its frontmatter model unless you name one - and take its punch-list. There is no dedicated plan-auditor seat; the verifier seat runs the audit. Only one seat, no fan-out; dispatch nothing you were not asked to.

## When to use / not

- Use it the moment a plan exists and before implementation starts - especially for anything with a boundary, state, auth, migration, or concurrency surface. The plan file is the whole input: a fresh session (or a different model) audits it as well as the chat that designed it - and independent eyes on the page are the point.
- Not code review - that is `project-verify-code`, after the build.
- Not plan *creation* - that is `superpowers:writing-plans` / `superpowers:brainstorming`. This audits a plan that already exists.

## The audit - four passes, in order

Load the plan's target stack skill FIRST, so you check against the right trap list, not a generic one.

1. **Risk coverage - the highest-leverage pass.** Does the plan NAME the non-obvious failure modes this feature will hit? Do not carry a generic checklist - load the stack's house skill (the same one your project's convention rules auto-attach for its file types; its router names the specialist siblings) and check the plan against ITS trap list: the data-access, lifecycle, concurrency, and boundary traps that stack actually has. A trap the plan does not name is a trap the build inherits - flag each missing one and where in the plan it belongs.
2. **Scope match.** The plan covers exactly what was asked - nothing missing, nothing speculative added (the ponytail 'ultra' test). A step for a requirement that is not there, or a missing step for one that is, is a finding.
3. **Edges + safety.** Boundary, empty, and error cases are named, not assumed. Any auth / migration-order / data-loss / concurrency surface is called out WITH its safeguard. Silence on a safety-critical edge is a finding.
4. **Soundness.** The approach matches the repo's existing architecture (match it, never introduce a second), dependencies are ordered, and it is the smallest plan that meets the requirement.

## Output

A short punch-list, not a rewrite. One line per finding: `severity | the gap | the fix to the PLAN`. If the plan is sound, say so plainly and name what you checked. When the plan lives in a file (the docs root's `superpowers/plans/` - `project-solution-design` writes it there), stamp the verdict into it - one line, `Gated: passed | <N> gaps listed - <date>` - so a compacted or fresh session knows the audit already happened. Then it is safe to build against; if not, fix the plan first - that is the whole point of doing this before code.

## Example

Auditing the `project-solution-design` export plan ('add data export to the records list' - three tasks: a query projection, a streamed export endpoint, an integration test), one finding per pass:

```text
1 risk      | MAJOR | no task names cancellation on the streamed export - a client abort leaks the open reader | thread the stack's cancellation mechanism through Tasks 1-2 (its skill's trap list)
2 scope     | MINOR | Task 2 adds an export-format option the requirement never asked for | drop it (the ponytail 'ultra' test)
3 edges     | MAJOR | empty result set unspecified - header-only output or an error?    | name the expected shape in Task 2; assert it in Task 3
4 soundness | pass  | extends the existing query seam, tasks in dependency order, smallest plan
```

Verdict: fix the plan (2 MAJOR), re-check the two lines, then build.
