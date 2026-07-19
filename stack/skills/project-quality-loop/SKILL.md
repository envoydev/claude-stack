---
name: project-quality-loop
description: "Autonomous review-and-fix pipeline driven from a folder of numbered prompt files (the docs root's loops/ folder of code-quality / naming / comments / tests). Runs each prompt in numeric order, looping it on a target until its bar is met, then advances - making and logging judgment calls itself, never pausing for input. Triggers on 'run the project quality loop' or 'run the loops pipeline'. Code-quality only - architecture restructuring is project-architecture-quality-loop; a single diff sweep is /code-review or /security-review, not this. Do NOT fire for a one-off review pass or when findings should be reported without auto-fixing (a missing loops folder is no blocker - the skill creates it from a bundled starter set to bootstrap)."
disable-model-invocation: true
---

# Project Quality Loop - Review-and-Fix Folder Pipeline (Autonomous)

You drive a pipeline of review-fix loops from a folder. You run each prompt file in the folder, in numeric order, looping it on the target until its bar is met, then advance to the next file. Run fully autonomously - never ask for input, pause for approval, or wait for a human. When a decision is needed, make it yourself, apply it, and log it.

Best run in Claude Code, where you can edit files and re-read them across passes. On a large codebase the context can fill - if so, run it per module (point TARGET at one module at a time).

## INPUTS (fill these in)
- LOOP_DIR - the folder of prompt files. When not given, resolve it: read `CLAUDE_DOCS_PATH` from `.claude/settings.json` env (absent = `.claude/docs`) and check `<docs-path>/loops/` - that existing folder IS the loop set; missing means BOOTSTRAP below. Each file is named `{number}.{name}.md` (e.g. `1.code-quality.md`, `2.naming.md`, `3.comments.md`, `4.tests.md`) - four stages. There is no architecture stage: code-quality reads the architecture map and audits conformance to it, and architecture-level restructuring is the separate `project-architecture-quality-loop` skill.
- TARGET - the one scope every file runs against, in order, each pass re-reading its current on-disk state so earlier fixes persist. Name a path or glob - preferred, since the loop re-reads between passes. Paste code inline only for a throwaway snippet with no file to edit; the fence below just delimits a pasted block, so omit it when you name a path.
  <<<TARGET
  {{PASTE CODE, OR NAME A PATH/GLOB}}
  TARGET>>>
- BAR - default: zero findings at every severity - BLOCKER, MAJOR, AND MINOR all fixed. Nothing is left as acceptable or debatable; a minor finding is still a finding and must be resolved. A file may set its own bar inside it - that wins for that file.
- MAX_PASSES - per file, default 5.

## EXECUTION MODES
DELEGATED vs INLINE - and the rule that detection keys on dispatch capability, not file presence - is the shared policy `project-solve-cross-task` owns. Pick the mode once, before DISCOVERY, hold it for the run, and apply it to this pipeline:

- **DELEGATED** (dispatch available) - prefer it whenever the Task/Agent tool is present: it keeps the main session's context clean across passes and hands the audit and fix work to a specialist built for it. The main session keeps ALL bookkeeping; INNER LOOP step RUN dispatches the domain verifier as a read-only auditor, and step FIX dispatches the domain implementer with a findings-plan (a red gate routes to the matching resolver instead). The full who-does-what - dispatch-prompt construction, the finding contract, gate stages, economy guidance, the opus first-find experiment - is `references/delegated-mode.md`; read it before the first dispatch.
- **INLINE** (no dispatch, TARGET is pasted code with no file to hand off, or a single small file) - the mode this skill originally shipped as; its behavior is unchanged: the whole INNER LOOP (RUN, SCORE, CHECK, STOP?, FIX) runs in the current session exactly as written in that section. For a .NET or Angular TARGET, load the domain's convention skills before the loop starts editing - conventions are the source of truth, not recall; the per-stack load list and the `angular-material` caveat are the DOMAIN CONVENTIONS section of `references/delegated-mode.md`.

## BOOTSTRAP - no `<docs-path>/loops/` folder yet?
This skill ships a starter set under its own `references/` folder - four stage prompts: code quality, naming, comments, and tests (the last is gate-based; the rest are audits). The code-quality stage reads `docs/architecture/ARCHITECTURE.md` (configured docs root) and audits TARGET for both quality and conformance to the recorded structure. When LOOP_DIR (the resolved `<docs-path>/loops/` from INPUTS) does not exist, create it yourself and seed it: make the folder (`mkdir -p "<LOOP_DIR>"`), then copy the four `references/` prompts into it, prefixing each with its order number - `1.code-quality.md`, `2.naming.md`, `3.comments.md`, `4.tests.md` - and edit to taste. Number them by blast radius - see NOTE ON CONVERGENCE - so later stages do not undo earlier ones. Do this silently as part of the run, then proceed to DISCOVERY; a missing folder is never a reason to pause.

## DISCOVERY (do this first, before any work)
1. Resolve the run order in one shot: list `LOOP_DIR/*.md` and sort ascending by the leading integer before the first dot in each filename - numerically, not lexically (`ls "<LOOP_DIR>"/*.md | sort -t. -k1,1n`, so `2.x` runs before `10.x`). Print the resolved order before starting; skip files with no numeric prefix (list them as skipped), and run same-numbered files in filename order (note it).
2. ORDER WARNING - sanity-check that numeric order against the blast-radius order in NOTE ON CONVERGENCE. If a wider-blast stage is numbered after a narrower one (a code-quality file after a tests file, say), print the warning - later stages invalidating earlier ones is the main cause of non-convergence - but do not reorder; the numeric sort stays authoritative.
3. GREEN BASELINE - confirm it before any stage runs (command-first): run the project's build and test gate commands in-session. A red baseline is a pre-existing failure - fix it first (route to the matching resolver) or record it explicitly, so each stage's changes are measured against a green start rather than blamed for a prior break. You re-gate at the end (see OUTER LOOP).

## OUTER LOOP - strictly one file at a time, in order
Process the files strictly in ascending numeric order, beginning with the lowest-numbered file. Fully finish the current file - its inner loop must reach a STOP - before you open the next one. Never run files out of order, never skip ahead, and never work on more than one file at a time.

For each file F, lowest number first:
1. Load F as the active review prompt for this stage.
2. Run the INNER LOOP below on TARGET until it STOPs.
3. Record F's outcome (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED, on which pass) and advance to the next file. Do NOT abort the pipeline because a file plateaued, oscillated, diverged, or capped - log it and continue. A plateau on a judgment audit is expected, not a failure.
After the last file: re-run the GREEN BASELINE (build + tests) as a final gate. A red here means a stage regressed the build - route it to the matching resolver and re-verify before reporting done. Then emit the Final report.

## INNER LOOP - run the current file F to a stop
Repeat until you STOP (in DELEGATED mode, RUN and FIX are the two dispatched steps - `references/delegated-mode.md`; everything else stays in the main session):

Pass N:
1. RUN - apply F to TARGET in its current state. Produce its full result (findings, or gate result - see CHECK).
2. SCORE - print one line: `F | Pass N - BLOCKER: x, MAJOR: y, MINOR: z, DECIDED: d`, then the open-finding set on the next line: `open: [...]`, one entry per unresolved finding keyed by (severity, file:line-or-symbol, 3-6 word description), sorted. Identity is the (severity, file:line-or-symbol) pair; the description is a human label, so re-wording it alone does not make a finding new. That printed set is the single identity of this pass's findings - the STOP conditions are read off it across passes, never off an eyeball judgment. For a gate-based file (see CHECK), print the gate result instead: `F | Pass N - gate: <command> -> pass/fail`, with the command output standing in for the open set.
3. CHECK - decide if F's bar is met (BAR is defined once, in INPUTS - do not restate or soften it here):
   - Findings-based file (an audit) -> met only when BAR is met; with the default bar, you may not declare it met while any finding of any severity remains open.
   - Gate-based file (a transform that names a verifiable command - e.g. tests + coverage, or build + comment-only diff) -> the bar is that command exiting 0. Run it; do not judge it by eye. If it still fails and no new fix is available, re-running the identical command is a PLATEAU - stop and report the failure, do not burn passes on the same invocation.
4. STOP? - compare this pass's open set to the prior passes and check the STOP conditions below; if any holds, end F's inner loop. If the open-set count rose versus the previous pass, the last FIX over-reached - make the next FIX as minimal as possible.
5. FIX - for every open finding (every severity counts against BAR):
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

## Example - one file's inner loop
DELEGATED, `2.naming.md` over src/Orders/:
```
2.naming.md | Pass 1 - BLOCKER: 0, MAJOR: 1, MINOR: 2, DECIDED: 0
open: [(MAJOR, OrderSvc.cs:14, abbreviation in public type), (MINOR, OrderQueries.cs:22, vague 'data' param), (MINOR, OrderQueries.cs:41, vague 'tmp' local)]
```
- RUN dispatched aspnet-verifier as a read-only auditor; the open set above is its result.
- FIX: OrderSvc -> OrderService (clear); the two vague names renamed to follow the OrderQueries naming precedent, logged to DECISIONS. Dispatch aspnet-implementer with that findings-plan.
- Pass 2 re-runs the auditor -> `open: []` -> **SATISFIED**; advance to the next file.

## RULES (these keep autonomous self-judgment honest)
- Decide, do not ask. Every decision the work needs, you make - using the codebase's existing conventions as the tiebreaker - and record it.
- 'Satisfied' means the explicit bar is met - not 'this looks fine' or 'good enough'. Show the score; it is the proof.
- List every remaining item before you stop a file. Never declare a file done with hidden open items.
- Every finding is resolved one way: fixed, decided-and-applied, marked out of scope, or could-not-apply with a reason. Nothing is silently dropped.
- Never weaken, skip, or delete a check, test, or assertion to make a bar appear met. If a fix would break a test, that is a finding, not a fix.
- Make the smallest change that resolves each item. Avoid rewrites that introduce new findings - they make the loop diverge instead of converge.
- For gate-based files, the command is the bar - a passing command beats your opinion. Self-judgment is only the fallback for things no command can check, like naming or design quality.
- The main session is the only orchestrator - never instruct a subagent to dispatch another (the shared flat-fan-out policy `project-solve-cross-task` owns); the auditors and implementers this loop dispatches (domain verifiers, implementers, resolvers) carry no Agent tool. A stage needing a verdict and a fix is two dispatches from here, not one nested one.

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
This is a single forward pass through the files. A later file's edits are not re-checked against earlier files. If you want a full fixpoint, run the whole pipeline again - a clean second run (every file SATISFIED, or a stable PLATEAU) means it has converged. Order the files by blast radius so later stages do not invalidate earlier ones: code-quality (widest - it now carries architecture-conformance), then naming, then comments, then tests.
