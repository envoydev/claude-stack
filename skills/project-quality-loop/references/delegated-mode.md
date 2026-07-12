# Delegated mode - who does what (+ the INLINE domain conventions)

The main session is the orchestrator for the whole pipeline; it hands off only the audit and the fix work, never the bookkeeping.

## Main session owns all bookkeeping

For the whole pipeline: DISCOVERY, every pass's SCORE line and open set, STOP detection (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED), the DECISIONS log, and the Final report. A dispatched subagent never sees or updates this state - it returns a result and the main session interprets it.

## INNER LOOP step RUN dispatches the domain verifier as a read-only auditor

Every audit stage dispatches the matching domain verifier (aspnet-verifier / angular-verifier / ...). The code-quality stage instead has its verifier read `docs/architecture/ARCHITECTURE.md` and audit TARGET against it, so its findings cover both code quality AND architecture-conformance - code that violates the recorded structure (a cross-layer leak, a wrong-direction dependency, a rival pattern) is a finding.

Every RUN dispatches the verifier at its **sonnet/xhigh pin** by default. An **opus/xhigh first-find** - escalating only the thorough first RUN of a stage to opus, re-verify RUNs staying on the pin - is an OPT-IN experiment, not the default: it may catch materially more real issues, but that is an unproven pin change, so per the repo's prove-don't-assert rule it stays OFF until a benchmark on a real target shows it pays, then it can be adopted. Do not silently ship it on.

Gate stages (a transform naming a verifiable command) run the gate command in-session first and only dispatch on a red result - never dispatch an audit for a stage whose bar is a passing command.

Build the dispatch prompt from: the full text of stage file F, TARGET, the previous pass's open set (empty on pass 1), and the mandatory finding contract - the result must give one entry per finding keyed (severity, file:line-or-symbol, 3-6 word description), sorted. That contract is load-bearing: PLATEAU and OSCILLATION are read off set identity across passes, so an auditor result in a different shape breaks STOP detection.

For a style-heavy stage, name `angular-styling` and/or `angular-material` explicitly in the dispatch prompt - the convention rules auto-attach only on a matching edit and a read-only auditor edits nothing, so a dispatched auditor that isn't told to load them will miss styling findings.

## INNER LOOP step FIX stays a two-part split

The main session resolves every judgment call itself first, exactly as INNER LOOP step 5 describes - clear fixes, ambiguity calls (logged to DECISIONS with the precedent), out-of-scope, could-not-apply. It then converts the resolved open set into a findings-plan: one step per finding, each naming the file and symbol, the smallest change already decided, and the check that proves it. For an audit stage, dispatch the matching domain implementer with that plan - the plan is what satisfies its no-plan-no-run contract, so never dispatch it with a bare finding list. For a red gate stage, dispatch the matching build or test failure resolver instead (dotnet-build-error-resolver, dotnet-test-failure-resolver, ng-build-error-resolver, angular-test-resolver).

## Economy guidance

The first RUN of an audit stage is always a dispatch - never skip straight to an inline audit on pass 1. From then on, if a dispatched auditor's returned open set is tiny (at most 3 MINOR findings, all in one file), the main session may fix and re-verify that stage's remaining passes inline instead of paying dispatch overhead on trivial cleanup. Any BLOCKER or MAJOR finding, or findings spanning more than one file, keeps dispatching.

## DOMAIN CONVENTIONS - .NET / Angular targets (INLINE mode)

This section applies to INLINE mode. In DELEGATED mode the convention rules auto-attach inside the editing subagent's own session, and the domain verifiers / implementers / resolvers load the relevant convention skills themselves - the only thing DELEGATED mode still needs from you is naming `angular-styling` / `angular-material` in the dispatch prompt for a style-heavy stage (see RUN above).

In a project that carries the path-scoped convention rules (`.claude/rules/`), an edit to a matching file auto-attaches that file type's convention-skill guidance. It is a soft nudge, never a block, so a FIX never exit-2's and the inner loop cannot thrash on it. Still, load the governing convention skill before the loop starts editing - conventions are the source of truth, not recall.

For a .NET or Angular TARGET, make each audit stage convention-aware: first load the domain's house skills, then audit TARGET against them - every deviation from a loaded convention is a finding, severity by blast radius. For .NET, load `csharp` plus the relevant hub (`dotnet-web-backend`, `database-conventions`, or `dotnet-error-handling`); for Angular, load `angular-conventions` and `typescript`, plus `angular-styling` and `angular-material` for CSS- or Material-heavy code. The convention rules auto-attach `csharp` / `typescript` / `angular-conventions` guidance on a matching edit, and `angular-styling` too (`.claude/rules/angular-styling-conventions.md` globs .scss/.css), but never `angular-material` (it has no file trigger) - so name the load step in the stage explicitly, and it stays correct on pasted code and on files no rule matches too.
