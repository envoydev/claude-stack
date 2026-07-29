---
name: project-architecture-quality-loop
description: "The deliberate architecture analyze-assess-improve loop. Runs the project-architecture-analyzer capture, works the ASSESSMENT's weaknesses by tier - small to a domain implementer, substantial through a designer -> implementers -> verifier (plan approved first), structural flagged for a user decision and never auto-applied - prunes the fixed weaknesses from the ASSESSMENT itself (one capture reconcile at stop, not per round), and loops until the fixable cons resolve or plateau. Manual, /-only. Triggers on 'run the architecture quality loop' or 'analyze and improve the architecture'. NOT for a code-quality polish (project-quality-loop), a single feature build (project-solve-cross-task), or a capture-only run with no fixes (/project-architecture-analyzer alone)."
disable-model-invocation: true
model: opus
---

# Architecture Quality Loop - Analyze, Assess, Improve (Deliberate)

You drive a deliberate loop that improves a project's architecture: analyze it, produce a reasoned assessment, work the fixable weaknesses by tier, reconcile the docs, and loop until the fixable ones are resolved or the loop plateaus. This is the heavy, on-purpose counterpart to the code-focused `project-quality-loop` - it runs only when a user invokes it (`/project-architecture-quality-loop`), never automatically, because architecture analysis is expensive and architecture changes are consequential.

Best run in Claude Code, where you can dispatch the analysis and build seats and edit files across rounds. On a large codebase, scope it - point it at one bounded context or module subtree per run. The frontmatter pins the invoking turn to `opus` (the architecture judgment runs in-session, per the capture) - but the pin lasts one turn and this loop pauses for approvals, so a long run wants the session itself on Opus rather than the pin alone.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence - a project can carry the agent files on disk with no Agent tool to dispatch them, which is still INLINE. Detection only names what is possible; the user picks: when dispatch is available, ask ONE question before ANALYZE, via AskUserQuestion - run the loop in the current session, or dispatch the stack seats? - then hold the answer for the run. No dispatch capability is INLINE without asking - never offer seats that cannot run:

- **DELEGATED** (the user chose agents) - the main session dispatches every seat - architecture-analyzer for the capture's gathering, then the domain designer / implementers / verifier for a substantial fix, or an implementer for a small one - never doing their work itself (the architecture reasoning itself runs in the main session, per the capture). This skill is manual (`disable-model-invocation`) and stays the orchestrator: a substantial fix runs the stack vertical by dispatching that stack's seats directly - the loop discipline is this skill's own `references/domain-trio-protocol.md`, never a re-entry into the full router (the loop already owns the scoping the router would re-derive).
- **INLINE** (the user chose the current session - or forced, no question asked: Cursor, a non-stack project, or a scope too small to fan out) - do the same steps in-session: map and assess the architecture yourself against the house architecture skills, then apply the fixable cons directly, smallest blast radius first.

## The loop

### 1. ANALYZE + ASSESS
Run the `project-architecture-analyzer` capture over the target - its protocol owns the gather-and-reason mechanics. Exception - the assessment is already fresh in THIS context: when it was produced or reconciled this session and its `Captured:` stamp matches HEAD, take its weaknesses as the work list directly and skip the capture; any older stamp runs the capture (its UPDATE path is diff-scoped and cheap). What this loop consumes is its output: `<docs-path>/architecture/ARCHITECTURE.md` (the structure map) and `<docs-path>/architecture/ASSESSMENT.md` (10 reasoned strengths + 10 reasoned weaknesses, each weakness carrying a remediation and a tier: small / substantial / structural). Read `<docs-path>/architecture/ASSESSMENT.md`: the weaknesses are this loop's work list, the tier on each is its routing key, and any weakness the summary marks a deliberate tradeoff is left alone - do not 'fix' a conscious choice.

### 2. TRIAGE + FIX by tier
Take the open weaknesses in leverage order (the assessment's top-few first). Route each by its tier - and confirm the green baseline (build + tests) before you start, so a regression is visible. Hold every fix against the assessment's Strengths list: a remediation whose entry names a strength tension is applied the way the entry preserves the strength, and a fix that turns out mid-round to erode a listed strength stops - resolving a weakness by breaking a strength is a net loss, and a genuine strength-vs-weakness tradeoff is a structural-tier user decision, never an auto-fix:

- **small** (a localized edit) - dispatch the matching domain implementer with the remediation as a scoped brief (the file/symbol, the smallest correct change, the check that proves it). Re-run build + tests.
- **substantial** (a designer-led multi-task change) - dispatch the domain solution-designer to turn the remediation into a decomposition, **get the user's approval on that plan before building** (an architecture refactor is consequential - never fan out against an unapproved structural plan), and record it: write `<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` (the dispatch hook blocks an unstamped implementer; delete the file when the run completes). Then fan the tasks out to the domain implementers and gate the assembled result with the domain verifier, looping its punch-list back. This is the domain-trio vertical (this skill's own `references/domain-trio-protocol.md`), dispatched directly.
- **structural** (a risky, cross-cutting rework) - do NOT auto-apply. Present the weakness, its reasoning, and the remediation to the user and get an explicit decision; only then, if approved, route it as a substantial change. A structural rework the user has not approved is flagged in the final report, not attempted.

Keep the build and tests green across the round: after each fix batch, re-run them, and a red routes to the matching resolver (dotnet-build-error-resolver / dotnet-test-failure-resolver / ng-build-error-resolver / angular-test-resolver) before the next weakness.

### 3. UPDATE DOCS
Prune `<docs-path>/architecture/ASSESSMENT.md` yourself: delete each weakness this round resolved (its fix landed and build + tests are green), and add any weakness a fix exposed - reasoned, with a remediation and tier, shaped like the capture writes them. Land the whole round's prune as ONE batched edit at round close - collect the deletions and additions first, then touch the doc once (measured: per-weakness editing produced 53 serial edits to one assessment in a single session). Everything else stays: strengths, accepted tradeoffs, declined structural items, and the Captured stamp (it marks the last capture and the stop-time reconcile diffs from it - never advance it by hand). No capture re-run per round: the loop already knows which weaknesses it closed, and a full re-analysis to learn that is waste - a brand-new weakness only fresh analysis would surface waits for the next deliberate capture.

### 4. LOOP or STOP
Decide off the weakness set you just pruned - it is already in this context: re-read `<docs-path>/architecture/ASSESSMENT.md` only after a compaction or when the in-context copy is genuinely stale, never as a per-round habit (the doc grows across rounds, so each needless re-read costs more than the last - measured at 21 reads / 33.5k tokens in one session). On a LOOP verdict, run the fresh-session ask (Bounded and honest) before starting the next round - the resume invocation names the rounds already consumed so the 3-round cap survives a resume. Decide off the set, not by eye:

- **SATISFIED** - no fixable (small/substantial) weakness remains; only accepted tradeoffs and user-declined structural items are left.
- **PLATEAU** - the fixable-weakness set equals the previous round's and none is now resolvable - stop rather than re-run identically.
- **CAPPED** - you reached the improve-round cap (see Bounded and honest).
- **BLOCKED** - only structural weaknesses remain and the user has not approved a rework - report and stop.

On STOP, when any fix shipped, reconcile the docs ONCE: run the `project-architecture-analyzer` capture (its UPDATE path - the diff since the Captured stamp) so `<docs-path>/architecture/ARCHITECTURE.md` picks up the shipped boundaries and the pruned assessment is validated against the code as it now stands. A run that shipped nothing skips the reconcile - there is no drift to pick up. Then emit the final report:
- **Outcome** - SATISFIED / PLATEAU / CAPPED / BLOCKED, and on which round.
- **Resolved** - each weakness fixed, its tier, and the change that closed it.
- **Deferred** - structural items the user declined or has not decided, plus accepted tradeoffs left alone.
- **Docs** - the pruned `<docs-path>/architecture/ASSESSMENT.md` + the stop-time reconcile of `<docs-path>/architecture/ARCHITECTURE.md` (skipped when nothing shipped).
- **Baseline** - build + tests green at stop (or the red that blocked it).

## Example

DELEGATED, one run over the Orders module:
1. **ANALYZE + ASSESS** - run the project-architecture-analyzer capture; ARCHITECTURE.md + ASSESSMENT.md land with tiered weaknesses. The top two: a **small** con (a repository leaks an EF type across the boundary) and a **substantial** con (queries and handlers share one grab-bag namespace).
2. **FIX by tier** - confirm the green baseline. Small: dispatch aspnet-implementer with a scoped brief, re-run build + tests. Substantial: dispatch aspnet-solution-designer for a decomposition, get approval, fan out implementers, gate with aspnet-verifier. A **structural** con (invert the persistence dependency) is flagged for a user decision, not auto-applied.
3. **UPDATE DOCS** - delete the two fixed weaknesses from ASSESSMENT.md; the namespace split exposed nothing new.
4. **LOOP or STOP** - re-read ASSESSMENT.md: only the user-declined structural item and accepted tradeoffs remain -> **SATISFIED**. One capture UPDATE reconciles ARCHITECTURE.md with the namespace split; emit the final report.

## Bounded and honest
- **Hard cap: 3 improve rounds.** Architecture changes are expensive and consequential; do not loop indefinitely chasing the last debatable con.
- **Each round boundary is a fresh-session resume point** - the pruned `<docs-path>/architecture/ASSESSMENT.md` is the handoff; measured, carried-forward conversation (not tool output) dominates session cost. A step, not advice (the advice form was ignored in 4 of 4 audited long sessions): at each LOOP decision, ask via AskUserQuestion - resume in a fresh session from the pruned assessment (recommended) vs continue here; on 'fresh', print the exact resume invocation and end the turn.
- Never weaken a test or delete an assertion to make a con look resolved - that is a new weakness, not a fix.
- Make the smallest change that resolves each weakness; a rewrite that introduces new coupling makes the loop diverge.
- The assessment's tier is the routing authority - do not silently upgrade a small con into a rewrite, or downgrade a structural one to sneak it past the approval gate.

## Rules
- The main session is the only orchestrator. The build seats it dispatches - the domain designer / implementers / verifier / resolvers - carry no Agent tool, so the fan-out stays flat; a con needing analysis and a fix is separate dispatches from here, not one nested one. The capture's architecture-analyzer fan-out is also dispatched from here, flat - there is no dispatched architecture seat and no nesting.
- Substantial and structural changes are gated on user approval before building; small localized fixes proceed. Architecture changes are consequential - confirm before reshaping the structure.
- Keep this skill orchestration only. The architecture judgement lives in the project-architecture-analyzer capture and the house architecture skills it loads; the build knowledge lives in the domain seats. For a pure code-quality polish reach for `project-quality-loop`; for a single feature build reach for `project-solve-cross-task`.
