---
name: project-solve-task
description: "Use to run a task, feature, or bug through the whole single-chat vertical with a hard user gate between every step: design -> plan audit -> user approval + build-mode choice -> build -> build review (skippable): project-verify-code inline or the verifier seat -> done-gate. Every stop is a real pause - switch model or effort, add context, or edit the plan before saying go - and the plan file plus a serena cycle note make every step resumable after compaction or in a fresh session. Trigger on run the task cycle, build this with approvals, gated implementation, step-by-step with my sign-off. Not the dispatched multi-agent flow (project-solve-cross-task), not greenfield (project-build-from-scratch), not a one-line edit."
disable-model-invocation: true
---

# Solve Task - the gated single-chat vertical

One task/feature/bug, six steps, and the user holds the gate between every two. The four twin
skills do the work; this skill owns the chain, the stops, the mode choices, and the state that
survives a compaction or a fresh session. It never designs, builds, or reviews anything itself.

## State - two layers, split by durability

- **The plan file** (`<docs-path>/superpowers/plans/<feature>.md`, docs root = `CLAUDE_DOCS_PATH`
  from `.claude/settings.json` env, default `.claude/docs` - see the project CLAUDE.md docs-root
  section) is the durable truth: the tasks, every stamp this cycle adds (`Gated`, `Approved` +
  build mode, `Conformance` verdict or `skipped`, `Completed`), per-task status + evidence. On any
  conflict with memory or the chat, the file wins.
- **The serena cycle note** (`write_memory` named `<feature>__cycle`) is the working cursor:
  current step, chosen modes, resume pointer (plan path + next task), any mid-task scratch worth
  carrying. Update it at EVERY stop and after every task tick; it is never more than one step
  stale when compaction hits. Local and disposable - everything essential is in the plan file.

**On invocation, resume before starting:** `list_memories` -> `read_memory` the feature's cycle
note, and read the plan file's stamps. A cycle mid-flight resumes at its cursor - never restart a
step whose stamp says it already passed. A cycle mid-build looks like:

```
plan .claude/docs/superpowers/plans/csv-export.md:
  Gated: passed | Approved: 2026-07-16 - mode session
  task 1 DONE (dotnet test green - 4 passed) | task 2 IN_PROGRESS
cycle note 'csv-export__cycle': step 4 BUILD - resume at task 2, mode session
```

## The stop contract

At each stop: report one line of result, the artifact path, and what the next step will be - then
END THE TURN and wait. The stop is the user's window to switch model or effort, paste context, or
edit the plan file directly - and the cheap point to run the next step in a fresh session
(`/clear`): resume needs only the plan file + cycle note, so the step starts at a few k of
context instead of re-sending the finished steps' whole conversation with every call - in a long
cycle that carried-forward context is the single biggest token cost. Proceed only on their
explicit word; silence is not a go.

## The steps

1. **DESIGN** - run `project-solution-design`. It writes the plan to the plans folder above; the
   file, not the chat, is the artifact. *Stop.*
2. **GATE** - run `project-verify-plan` over the plan file. It stamps `Gated: passed` or the gaps
   found. Gaps route back to step 1 on the user's word. *Stop.*
3. **APPROVE** - present the gated plan and ask two things in one gate: approval to build, and the
   build mode - **session** (default: the build runs in this chat) or **agents** (each task
   dispatched to its stack's `<stack>-implementer` seat, up to 3 at once, each on its frontmatter
   model unless you name one). Stamp `Approved: <date> - mode <session|agents>`
   into the plan file. Nothing builds without this stamp. Agents mode exists only where subagent
   dispatch is available; otherwise session is the only mode - say so rather than pretending.
4. **BUILD** - per the approved mode:
   - *session*: run `project-implementer` - it marks each task `IN_PROGRESS` before code, ticks it
     `DONE` with evidence after its green gate, and keeps the plan's resume note current.
   - *agents*: fan the plan's task cards out to the matching `<stack>-implementer` seats - flat
     fan-out per the shared policy `project-solve-cross-task` owns, the main session the only
     orchestrator; a red build/test routes per the repair-agent rules; tick the same plan file
     per task as reports land.
   *Stop* - and this stop chooses the reviewer for step 5: run `project-verify-code` in-session
   (default - no dispatch, stays in this context), dispatch the stack's `<stack>-verifier` seat for
   isolated eyes (on its frontmatter model unless you name one), or **skip** the review straight to step 6's done-gate. (For a broad parallel sweep you can still invoke `/code-review` yourself - it is not part of this flow.) The user can
   inspect the diff themselves here first.
5. **CONFORMANCE** (unless skipped - a skip is stamped `Conformance: skipped by user`, an honest
   record, not a silent gap) - run the reviewer chosen at the step-4 stop over the assembled diff,
   pointed at the plan file so it reviews against the plan, not in isolation. The review protocol -
   build + tests rerun, plan conformance, stack traps, the live-run probe, the wire-contract trace -
   is `project-verify-code`'s (the inline default, twin of the verifier seat); the `<stack>-verifier`
   seat runs the same protocol dispatched.
   Deviations and findings become a punch list routed back to step 4. Stamp the verdict. *Stop.*
6. **CLOSE** - apply any fixes the step-5 review handed back, then the done-gate
   (`superpowers:verification-before-completion` on the whole feature - each acceptance criterion
   demonstrated by a run this session, quoted, not assumed). Stamp `Completed: <date>` with the
   per-task evidence table. Delete or archive the cycle note.

## Do not

- Never pass a stop without the user's explicit word, and never approve the plan yourself - the
  APPROVE stamp records the user's decision, not yours.
- Never dispatch a seat the user did not choose at a stop - dispatch is explicit-only house-wide.
- Never keep cycle state only in chat: a stamp or tick that is not in the plan file does not
  exist. The serena note is a cursor, never the truth.
- Never re-run a stamped step on resume; pick up at the cursor.
