---
name: project-quality-loop
description: "Autonomous review-and-fix loop pipeline driven from a folder of numbered prompt files. Runs each prompt in numeric order, looping it on a target until its bar (default: zero findings at every severity) is met, then advances - making and logging judgment calls itself, never pausing for input. Use when running a multi-stage review/polish pipeline (e.g. a loops/ folder of architecture/naming/quality/comments/tests prompts) over a codebase or module; triggers on 'run the project quality loop' or 'run the loops pipeline'. This is a folder-driven, multi-pass, fix-and-re-run pipeline, distinct from the single-shot built-in /code-review and /security-review - reach for those for one diff sweep, this for an iterated stage-by-stage polish to a bar (one forward pass; re-run for a true fixpoint). Do NOT fire for a single ad-hoc review pass, without a folder of prompt files, or when the user wants findings reported without auto-fixing - in a stack-installed project it drives the domain verifiers, implementers and resolvers from the main session."
---

# Project Quality Loop - Review-and-Fix Folder Pipeline (Autonomous)

You drive a pipeline of review-fix loops from a folder. You run each prompt file in the folder, in numeric order, looping it on the target until its bar is met, then advance to the next file. Run fully autonomously - never ask for input, pause for approval, or wait for a human. When a decision is needed, make it yourself, apply it, and log it.

Best run in Claude Code, where you can edit files and re-read them across passes. On a large codebase the context can fill - if so, run it per module (point TARGET at one module at a time).

## INPUTS (fill these in)
- LOOP_DIR - the folder of prompt files. Default: `loops/`. Each file is named `{number}.{name}.md` (e.g. `1.architecture.md`, `2.naming.md`, `3.code-quality.md`, `4.comments.md`, `5.tests.md`).
- TARGET - the one scope every file runs against, in order, each pass re-reading its current on-disk state so earlier fixes persist. Name a path or glob - preferred, since the loop re-reads between passes. Paste code inline only for a throwaway snippet with no file to edit; the fence below just delimits a pasted block, so omit it when you name a path.
  <<<TARGET
  {{PASTE CODE, OR NAME A PATH/GLOB}}
  TARGET>>>
- BAR - default: zero findings at every severity - BLOCKER, MAJOR, AND MINOR all fixed. Nothing is left as acceptable or debatable; a minor finding is still a finding and must be resolved. A file may set its own bar inside it - that wins for that file.
- MAX_PASSES - per file, default 5.

## EXECUTION MODES
Pick the mode once, before DISCOVERY, and hold it for the whole run.

- **DELEGATED** - the default whenever the current session can dispatch subagents (the Task/Agent tool is available). This is a capability check, not a file-presence check: a Cursor session editing a stack-installed project has the same agent files on disk (in `.cursor/agents/`) but no dispatch tool, so it runs INLINE regardless of what is on disk. When dispatch is available, prefer DELEGATED - it keeps the main session's context clean across passes and hands the audit and fix work to a specialist built for it.
- **INLINE** - the fallback, and the mode this skill originally shipped as; its behavior is unchanged below. Use it when dispatch is unavailable, TARGET is pasted code with no file to hand a subagent, or TARGET is a single small file where dispatch overhead outweighs the work. In INLINE mode the whole INNER LOOP (RUN, SCORE, CHECK, STOP?, FIX) runs in the current session exactly as written in that section.

  One INLINE deployment note: in a project that carries the path-scoped convention rules (`.claude/rules/`), an edit to a matching file - a .cs, .ts/.js, hand-written .sql, or an Angular component/service/style file - auto-attaches that file type's convention-skill guidance. It is a soft nudge, never a block, so a FIX never exit-2's and the inner loop cannot thrash on it. Still, load the governing skill (`csharp`, `typescript`, or `angular-conventions`) before the loop starts editing - conventions are the source of truth, not recall. web-conventions now auto-attaches `angular-styling` on .scss/.css edits too, but `angular-material` has no file trigger, so name it explicitly in a Material-heavy stage. None of this binds in DELEGATED mode: the rule attaches inside the editing subagent's own session, and the domain implementers / the resolvers load the convention skills themselves - see DOMAIN CONVENTIONS below.

### DELEGATED mode - who does what
The main session is the orchestrator for the whole pipeline; it hands off only the audit and the fix work, never the bookkeeping.

- **Main session owns all bookkeeping**, for the whole pipeline: DISCOVERY, every pass's SCORE line and open set, STOP detection (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED), the DECISIONS log, and the Final report. A dispatched subagent never sees or updates this state - it returns a result and the main session interprets it.
- **INNER LOOP step RUN dispatches a read-only auditor.** For the architecture stage, dispatch architecture-analyzer (instruct it, like the domain verifier, to return findings keyed (severity, file:line-or-symbol, 3-6 word description), sorted); for every other audit stage, dispatch the matching domain verifier (aspnet-verifier / angular-verifier / ...). Gate stages (a transform naming a verifiable command) run the gate command in-session first and only dispatch on a red result - never dispatch an audit for a stage whose bar is a passing command. Build the dispatch prompt from: the full text of stage file F, TARGET, the previous pass's open set (empty on pass 1), and the mandatory finding contract - the result must give one entry per finding keyed (severity, file:line-or-symbol, 3-6 word description), sorted. That contract is load-bearing: PLATEAU and OSCILLATION are read off set identity across passes, so an auditor result in a different shape breaks STOP detection. For a style-heavy stage, name `angular-styling` and/or `angular-material` explicitly in the dispatch prompt - the convention rules auto-attach only on a matching edit and a read-only auditor edits nothing, so a dispatched auditor that isn't told to load them will miss styling findings.
- **INNER LOOP step FIX stays a two-part split.** The main session resolves every judgment call itself first, exactly as INNER LOOP step 5 describes - clear fixes, ambiguity calls (logged to DECISIONS with the precedent), out-of-scope, could-not-apply. It then converts the resolved open set into a findings-plan: one step per finding, each naming the file and symbol, the smallest change already decided, and the check that proves it. For an audit stage, dispatch the matching domain implementer with that plan - the plan is what satisfies its no-plan-no-run contract, so never dispatch it with a bare finding list. For a red gate stage, dispatch the matching build or test failure resolver instead (dotnet-build-error-resolver, dotnet-test-failure-resolver, ng-build-error-resolver, angular-test-resolver).
- **Economy guidance.** The first RUN of an audit stage is always a dispatch - never skip straight to an inline audit on pass 1. From then on, if a dispatched auditor's returned open set is tiny (at most 3 MINOR findings, all in one file), the main session may fix and re-verify that stage's remaining passes inline instead of paying dispatch overhead on trivial cleanup. Any BLOCKER or MAJOR finding, or findings spanning more than one file, keeps dispatching.

## BOOTSTRAP - no loops/ folder yet?
This skill ships a starter set under its own `references/` folder - five stage prompts: architecture, naming, code quality, comments, and tests (the last is gate-based; the rest are audits). Copy them into your LOOP_DIR (default `loops/`), prefix each with its order number, and edit to taste. Number them by blast radius - see NOTE ON CONVERGENCE - so later stages do not undo earlier ones.

## DOMAIN CONVENTIONS - .NET / Angular targets (INLINE mode only)
This section applies to INLINE mode. In DELEGATED mode the convention rules auto-attach inside the editing subagent's own session, and architecture-analyzer / the domain verifiers / the domain implementers / the resolvers load the relevant convention skills themselves - the only thing DELEGATED mode still needs from you is naming `angular-styling` / `angular-material` in the dispatch prompt for a style-heavy stage (see DELEGATED mode above).

For a .NET or Angular TARGET, make each audit stage convention-aware: first load the domain's house skills, then audit TARGET against them - every deviation from a loaded convention is a finding, severity by blast radius. For .NET, load `csharp` plus the relevant hub (`dotnet-web-backend`, `database-conventions`, or `dotnet-error-handling`); for Angular, load `angular-conventions` and `typescript`, plus `angular-styling` and `angular-material` for CSS- or Material-heavy code. The convention rules auto-attach `csharp` / `typescript` / `angular-conventions` guidance on a matching edit, and `angular-styling` too now that web-conventions covers .scss/.css, but never `angular-material` (it has no file trigger) - so name the load step in the stage explicitly, and it stays correct on pasted code and on files no rule matches too.

## DISCOVERY (do this first, before any work)
1. List `LOOP_DIR/*.md`. Read the leading integer before the first dot in each filename as its order number.
2. Sort ascending by that integer, numerically not lexically (so `2.x` runs before `10.x`).
3. Skip files with no numeric prefix and list them as skipped. If two share a number, run them in filename order and note it.
4. Print the resolved run order before starting.
5. Sanity-check that numeric order against the blast-radius order in NOTE ON CONVERGENCE. If a wider-blast stage is numbered after a narrower one (an architecture file after a tests file, say), print an ORDER WARNING - later stages invalidating earlier ones is the main cause of non-convergence. Do not reorder; the numeric sort stays authoritative.

## OUTER LOOP - strictly one file at a time, in order
Process the files strictly in ascending numeric order, beginning with the lowest-numbered file. Fully finish the current file - its inner loop must reach a STOP - before you open the next one. Never run files out of order, never skip ahead, and never work on more than one file at a time.

For each file F, lowest number first:
1. Load F as the active review prompt for this stage.
2. Run the INNER LOOP below on TARGET until it STOPs.
3. Record F's outcome (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED, on which pass) and advance to the next file. Do NOT abort the pipeline because a file plateaued, oscillated, diverged, or capped - log it and continue. A plateau on a judgment audit is expected, not a failure.
After the last file: emit the Final report.

## INNER LOOP - run the current file F to a stop
Repeat until you STOP:

Pass N:
1. RUN - apply F to TARGET in its current state. Produce its full result (findings, or gate result - see CHECK).
2. SCORE - print one line: `F | Pass N - BLOCKER: x, MAJOR: y, MINOR: z, DECIDED: d`, then the open-finding set on the next line: `open: [...]`, one entry per unresolved finding keyed by (severity, file:line-or-symbol, 3-6 word description), sorted. Identity is the (severity, file:line-or-symbol) pair; the description is a human label, so re-wording it alone does not make a finding new. That printed set is the single identity of this pass's findings - the STOP conditions are read off it across passes, never off an eyeball judgment. For a gate-based file (see CHECK), print the gate result instead: `F | Pass N - gate: <command> -> pass/fail`, with the command output standing in for the open set.
3. CHECK - decide if F's bar is met (BAR is defined once in INPUTS):
   - Findings-based file (an audit) -> met only when zero findings remain at ANY severity. Minor findings get fixed too - none are left as acceptable. You may not declare it met while any finding of any severity exists.
   - Gate-based file (a transform that names a verifiable command - e.g. tests + coverage, or build + comment-only diff) -> the bar is that command exiting 0. Run it; do not judge it by eye. If it still fails and no new fix is available, re-running the identical command is a PLATEAU - stop and report the failure, do not burn passes on the same invocation.
4. STOP? - compare this pass's open set to the prior passes and check the STOP conditions below; if any holds, end F's inner loop. If the open-set count rose versus the previous pass, the last FIX over-reached - make the next FIX as minimal as possible.
5. FIX - for every open finding (all severities, since the bar is zero):
   - Clear fix -> apply the smallest correct change.
   - Judgment call or ambiguity -> decide it yourself. Pick the option most consistent with the codebase's existing patterns and conventions, apply it, and add a line to the DECISIONS log: the choice, and the concrete precedent it follows (a file:symbol or named rule); when no precedent exists, say so explicitly and still decide. Do not ask, pause, or wait.
   - Out of scope for F (owned by a different file in the pipeline) -> note under OUT OF SCOPE, leave it, do not count it against the bar.
   - Mechanically impossible here (depends on a file, service, or value that does not exist in this context) -> make the most reasonable assumption and proceed; if you truly cannot, record it under COULD-NOT-APPLY with the reason and continue.
6. Go to Pass N+1.

## STOP CONDITIONS (per file; stop at the first that holds)
Read these off the printed open set (SCORE) across passes, not by eye - PLATEAU and OSCILLATION compare set identity; DIVERGED also tracks whether you already minimized the last FIX.
- SATISFIED - the bar is met; the printed score proves it.
- PLATEAU - this pass's open set equals the previous pass's (ignore re-wording) and the count did not drop. The same items remain and none are now resolvable; do not re-run identically hoping for a different outcome. An equal count with a changed set is churn, not a plateau - keep going.
- OSCILLATION - this pass's open set differs from the immediately previous pass but matches an earlier one (a 2-cycle, or any longer cycle repeating) - so it is never also a PLATEAU. A fix and its reversal are ping-ponging; re-running will not converge. Log both competing states under DECISIONS, pick the one most consistent with the codebase's conventions, apply it, and leave it.
- DIVERGED - the open-set count rose again even after you minimized the last FIX (see INNER LOOP step 4). The stage is making the target worse, not better; stop and report it rather than burn the remaining passes.
- CAPPED - you reached MAX_PASSES.

## RULES (these keep autonomous self-judgment honest)
- Decide, do not ask. Every decision the work needs, you make - using the codebase's existing conventions as the tiebreaker - and record it.
- 'Satisfied' means the explicit bar is met - not 'this looks fine' or 'good enough'. Show the score; it is the proof.
- List every remaining item before you stop a file. Never declare a file done with hidden open items.
- Every finding is resolved one way: fixed, decided-and-applied, marked out of scope, or could-not-apply with a reason. Nothing is silently dropped, and no finding is left because it is 'only minor'.
- Never weaken, skip, or delete a check, test, or assertion to make a bar appear met. If a fix would break a test, that is a finding, not a fix.
- Make the smallest change that resolves each item. Avoid rewrites that introduce new findings - they make the loop diverge instead of converge.
- For gate-based files, the command is the bar - a passing command beats your opinion. Self-judgment is only the fallback for things no command can check, like naming or design quality.
- The main session is the only orchestrator - never instruct a subagent to dispatch another; the auditors and implementers this loop dispatches (domain verifiers, implementers, resolvers, analyzers) carry no Agent tool. A stage needing a verdict and a fix is two dispatches from here, not one nested one.

## OUTPUT
Per pass: the one-line score and open set, plus a short note of what you fixed and decided.
Per file: the outcome line.
Final report (whole pipeline):
- The run order, and each file's outcome.
- Remaining findings per file, if any.
- DECISIONS log: every judgment call across all files, each with the precedent it followed (or an explicit note that none existed) - reviewable after the fact.
- OUT OF SCOPE / COULD-NOT-APPLY: anything deliberately left, with reasons.
- Overall summary of changes.

## NOTE ON CONVERGENCE
This is a single forward pass through the files. A later file's edits are not re-checked against earlier files. If you want a full fixpoint, run the whole pipeline again - a clean second run (every file SATISFIED, or a stable PLATEAU) means it has converged. Order the files by blast radius so later stages do not invalidate earlier ones: structure, then naming, then code-quality, then comments, then tests.
