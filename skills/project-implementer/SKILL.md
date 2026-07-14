---
name: project-implementer
description: "Use when you have a task plan in hand - from project-solution-design, ideally gated by project-verify-plan - and want to BUILD it in the current chat, task by task: the single-chat form of the implementer seat's execution protocol. Honors each task's contract (files owned, traps named, anchors, acceptance criterion), builds code + tests per task, gates each task green before the next, routes a stubborn red to the matching resolver agent, and finishes by handing to /code-review + the done-gate - completing the in-session designer -> implementer -> verifier vertical. Trigger on execute the plan, build the plan, implement the tasks, build task 2, continue the plan. Not for dispatching parallel implementers (that is project-task-flow), and not a plan-less ad-hoc edit - just make those."
disable-model-invocation: true
---

# Project Implement - execute a verified plan, task by task, in one chat

This is the build step of the single-session vertical: `project-solution-design` produced the plan, `project-verify-plan` audited it, this executes it - one task at a time, in the plan's dependency order, in your context so every diff is inspectable as it lands. It carries the implementer seat's *execution protocol* only; the coding conventions themselves need no restating - the path-scoped rules auto-attach the house skill per file type, the generated code-style hook injects the project's actual style on the first edit, and the plan's task cards name the stack traps.

## The protocol - per task, in plan order

1. **Take exactly one task.** Its card is the contract: the files it owns, the traps it names, the `file:symbol` anchors, and its acceptance criterion. Jump to the anchors - the designer already located them; do not re-navigate the repo.
2. **Build the slice + its tests together.** The acceptance criterion is what the tests prove; a task without its test is not built, it is drafted. Stay inside the task's boundary - a needed change outside it is a flag, not a detour (see below).
3. **Gate the task green.** Build + the relevant tests after each task, not at the end of the plan. A red that resists one honest fix attempt routes to the stack's matching build/test resolver agent where the stack ships one (the repair-loop rules name them per file family) - it absorbs the fix loop and returns the diagnosis; trivial reds, and stacks without a resolver seat, fix inline.
4. **Close the task honestly** - the `superpowers:verification-before-completion` gate per task: run it, quote the output, then the next task. Partial is stated as partial.

## When the plan meets reality

- **A task proves wrong mid-build** (the seam isn't where the plan said, a trap the audit missed): stop the task, name the delta, and re-enter `project-solution-design` on that slice - never silently redesign while implementing. The plan is the contract; reality wins, but through a revision, not a drift.
- **Scope beyond the plan** (a bug discovered nearby, a refactor itch): flag it and ask - it enters the plan explicitly or waits. Never rides along.
- **A shared contract surfaces** (a DTO both sides compile against, a schema semantic): stop - that is `project-task-flow` territory, the same BLOCKED_CONTRACT_CHANGE discipline the dispatched seats follow.

## Finish - the in-session verifier

All tasks green: run the full suite once, then `/code-review` over the assembled diff (the single-chat form of the verifier seat) and apply its findings; then the done-gate on the whole feature. Report against the plan, one line per task - `task | status (DONE / deferred / revised) | evidence (the green command and what it proved)` - then the suite + `/code-review` result, and anything deferred or revised with its reason. The vertical is complete: design (`project-solution-design`) -> audit (`project-verify-plan`) -> build (this) -> review (`/code-review`) - one session, every step inspectable.

## Example

Executing the records-list export plan (the `project-solution-design` example, gated by `project-verify-plan` - three tasks, plus the audit's cancellation fix folded into Tasks 1-2):

- Task 1 - jump to the plan's query-seam anchor, add the export projection + its streaming test (rows streamed, never materialized - the card's trap), thread the cancellation token per the audit. Module tests green, output quoted. DONE.
- Task 2 - the streamed export entry point on the Task 1 seam, mapped to a transfer shape at the edge (the card's boundary trap). Tests green. DONE.
- Task 3 - integration test: header row, one data row, success status, and the audit's empty-set shape. Green on the full suite. DONE.
- Finish - full suite once, `/code-review` over the assembled diff (one finding: a stray debug log - fixed), done-gate run.

```text
task 1 export projection | DONE | module tests green (streamed, cancellation threaded)
task 2 streamed endpoint | DONE | tests green (edge maps to transfer shape)
task 3 integration test  | DONE | full suite green incl. empty-set shape
suite + /code-review: green, 1 finding fixed; nothing deferred
```

## Don't game it

The acceptance criterion is satisfied by behavior, never by weakening the test that checks it. A green gate means the commands ran and their output says green - quoted, not assumed. Never suppress a warning, stub a path, or narrow a test to advance to the next task; a task that cannot go green honestly goes back to design as a named delta.
