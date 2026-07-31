---
name: project-test-coverage-analyzer
description: "The deliberate test-coverage capture: detect each stack's test-and-coverage tooling, run the instrumented suite ONCE per surface in the main session, analyze per surface (seats on a first capture, inline on an update), and judge against the USER's % bar - asked at first capture, recorded in the doc - writing <docs-path>/test-coverage/COVERAGE.md (verdicts, per-module data, weak points tiered small/substantial/structural with a simplify-testing action each) plus the raw results under raw/. Re-run to refresh: both reconciled in place. Triggers on 'measure the test coverage', 'capture the coverage baseline', or 'how covered is this project'. Manual, /-only - or Read-loaded as project-test-coverage-loop's ANALYZE step; never mid-build, never a flow gate. NOT for fixing the gaps it finds (project-test-coverage-loop), writing a task's tests (every build flow's own done bar), or architecture capture (project-architecture-analyzer)."
disable-model-invocation: true
---

# Project Test Coverage Analyzer - Capture the Coverage (Deliberate)

You are the coverage seat for this run: you measure what the tests actually cover, judge it against the project's requirement, and record it as two artifacts - `<docs-path>/test-coverage/COVERAGE.md` (the reasoned picture: per-stack and per-module numbers, the verdict, the tiered weak points) and the raw results under `<docs-path>/test-coverage/raw/` (the machine-readable files the numbers came from). Coverage lives OUTSIDE the build flows: no seat gate runs it and no dispatch brief may carry it - measured, a seat babysitting an instrumented run burns about half its cost idling on the wait - so this capture is the one place the instrumented suite runs, on the user's cadence, exactly like the architecture capture.

This is capture only: it measures, judges, and documents - it fixes nothing, writes no test, and never picks or installs a runner. Working the weak points is `project-test-coverage-loop`, which runs this capture as its ANALYZE step and routes fixes by tier.

## Execution modes
Two halves, split differently:

- **Measurement is ALWAYS in this session** - every mode, every platform. The instrumented run is a slow gate; it never goes into any dispatch brief.
- **Analysis on the FIRST capture** (no existing doc / no stamp) - when dispatch is available, ask ONE question before the fan-out, via AskUserQuestion - analyze via test-coverage-analyzer seats (recommend it: the read-only seats absorb the raw-output reads), or in-session? - unless a calling flow (the coverage loop) already picked the run's mode, which is inherited, never re-asked. When the first capture's other mandatory asks fire (the % bar, a blocked-suite decision), the mode question joins the SAME AskUserQuestion call as one batched ask - a separately-scheduled mode question is the one that gets dropped (measured: a first capture asked Docker-handling and the bar in one call and never asked the mode). DELEGATED: fan out the read-only test-coverage-analyzer agent, one per measured surface, each dispatch carrying that surface's raw-results path, the suite location, and the requirement; it returns a structured digest (per-module numbers, uncovered hot spots, weak-point candidates, test-quality smells) and this session reasons over the digests - the judgment and the writing NEVER leave here. INLINE (chosen - or forced, no question asked: a Cursor session): the same analysis yourself, locating testability facts with serena, bounded.
- **Analysis on an UPDATE is INLINE** (doc + stamp exist) - compare this run's fresh numbers against the doc's previous per-module table and deep-read only where they moved; unchanged modules keep their recorded weak points. Dispatch the agent for a surface whose picture shifted broadly - that surface is a first capture again - or whenever the USER explicitly asks for agents: their ask always wins over the inline default.

## The run

### 1. ORIENT
Read `<docs-path>/test-coverage/COVERAGE.md` if it exists - a claim to verify, not ground truth - and take from it the recorded requirement override and exclusion list, if any (those are the user's decisions and carry across branches). The doc is machine-local, so it does NOT switch with git branches: its `Captured: <branch>@<short-sha>` stamp says whose numbers it holds - a stamp from another branch means every number in it is stale for HEAD, worth saying in the report; this run replaces them with fresh measurements either way. Inventory the surfaces: each stack in the workspace that owns tests (a .NET solution, an Angular app, a plain JS/TS package) is measured separately. Scope to what the user named on a large workspace; every surface otherwise.

### 2. DETECT - the tooling per surface
Find what the project already uses - never pick or install one:

- **.NET** - coverlet via `dotnet test --collect:"XPlat Code Coverage"` (or the msbuild `/p:CollectCoverage=true` form the repo already wires) -> cobertura XML.
- **Angular** - `ng test` with the workspace's karma/istanbul (or configured equivalent) coverage output -> lcov + summary.
- **Plain JS/TS** - the ladder: a `package.json` test script -> a runner config file -> a test runner in devDependencies; use the first rung that answers, with its coverage flag.

A surface where every rung is empty is a **'no test infrastructure'** verdict: coverage unmeasurable, the requirement UNMET, one weak point tiered substantial whose simplify-testing action names the missing harness. Installing the runner is the loop's first fix, never this capture's.

### 3. MEASURE - once per surface, in this session
Run the instrumented suite ONCE per surface and keep the machine-readable output - `cobertura.xml`, `lcov.info`, `coverage-summary.json`, whatever the tooling produced - under `<docs-path>/test-coverage/raw/<stack>/`, replacing that surface's previous raw files. Scope the run to the project's normal suite: long-running replay/soak/E2E categories (a replay-tagged integration suite, an hours-long market replay) stay OUT unless the user explicitly includes them - record them as excluded-by-default in the doc (measured: an unasked replay run consumed 41GB of disk before being killed, and the user had to add a hand-written rule to stop it recurring). Never save an HTML report tree - it is rebuildable bulk. A suite that fails to run is recorded as unmeasured with the failing command quoted - never estimated.

### 4. ANALYZE - judge against the user's requirement
Fan out test-coverage-analyzer per surface (or do the same inline when no dispatch), then aggregate per stack and per module. The bar is the USER's: take the doc's recorded requirement; with none recorded, ask - offer **90% line coverage after exclusions** as the house default - and record the answer in the doc. Exclusions are the code coverage cannot meaningfully claim - taken from the tooling's existing exclusion config plus the doc's recorded list, with the catalog and after-exclusions semantics owned by the stack's house testing skill (`dotnet-testing` §Coverage for .NET, `angular-testing` §Coverage for Angular, `ts-js-testing` §Standard exclusions for plain TS/JS) - and the list you applied is recorded, never silently widened. Then reason out the weak points, each tiered and carrying a simplify-testing action (the smallest change that would make the code cheap to cover):

- **small** - uncovered behavior the existing seams already expose: scoped tests close it, no production change.
- **substantial** - testability blocks the tests first (a static seam, a captive dependency, an un-injectable clock - a refactor must land before tests can attach), or the 'no test infrastructure' verdict.
- **structural** - coverage unreachable without a cross-cutting rework; a user decision, never assumed.

### 5. WRITE - reconcile both artifacts
`<docs-path>/test-coverage/COVERAGE.md`, clean scannable Markdown per the `markdown-style` skill, tables over prose: a first-line stamp `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`, `+dirty` appended when the tree held uncommitted changes (the numbers describe exactly that code - any other branch, and any reader of a dirty stamp, re-measures, never trusts), the requirement + override + applied exclusions, a per-stack verdict table (surface, line %, requirement, verdict), a per-module table per surface (module, line %, the uncovered hot spots), and the tiered weak points each with its simplify-testing action. Re-run: reconcile in place - resolved weak points drop off, new gaps land, stale numbers are replaced. Create the folders only when absent; write ONLY under `<docs-path>/test-coverage/` - never source, never a test, never another doc.

### 6. REPORT
Confirm the files written (created vs refreshed), then lean: the per-surface verdicts, the weak-point tally by tier, the top few gaps `project-test-coverage-loop` should take first, and anything unmeasured with what would settle it. Point to the files - no re-paste of the doc body.

## Example

One .NET API surface, requirement 90%: the verdict table reads `| aspnet-api | 84% | 90% | BELOW |`; the module table names `InvoiceService` at 61% with its uncovered error branches as the hot spot; the weak points land as - small: 'InvoiceService error branches - four scoped tests on the existing seams', substantial: '`PaymentGateway` news up its `HttpClient` - inject the handler before tests can attach'. That ordering is exactly what `project-test-coverage-loop` takes first.

## Don't game it
Every number comes from THIS run's raw output - never recalled, never estimated, never carried forward from a stale doc. A surface that would not run is unmeasured, not guessed. Never widen the exclusion list or lower the requirement to turn a verdict green - both belong to the user, recorded in the doc. And the percentage is a proxy: a suite padded with assertion-free tests that touch lines without pinning behavior is itself a weak point to record, not a pass.
