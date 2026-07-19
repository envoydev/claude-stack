---
name: project-implementer
description: "Use when you have a task plan in hand - from project-solution-design, ideally gated by project-verify-plan - and want to BUILD it in the current chat, task by task: the single-chat form of the implementer seat's execution protocol. Honors each task's contract, builds code + tests per task, gates each task green before the next, resolves every red INLINE (builds in this chat by default, dispatching nothing), and hands to the build review (`project-verify-code` inline or the `<stack>-verifier` seat) + the done-gate. Trigger on execute the plan, build the plan, implement the tasks, build task 2, continue the plan. On an explicit agents request it hands each task to its `<stack>-implementer` seat instead (up to 3 at once, each on its frontmatter model unless you name one); the full multi-agent flow with its own designer and verifier is project-solve-cross-task. Not a plan-less ad-hoc edit - just make that."
---

# Project Implement - execute a verified plan, task by task, in one chat

This is the build step of the single-session vertical: `project-solution-design` produced the plan, `project-verify-plan` audited it, this executes it - one task at a time, in the plan's dependency order, in your context so every diff is inspectable as it lands. It carries the implementer seat's *execution protocol* only; the coding conventions themselves need no restating - the path-scoped rules auto-attach the house skill per file type, the generated code-style hook injects the project's actual style on the first edit, and the plan's task cards name the stack traps.

The plan FILE is the whole input - not the chat that produced it. Run this in a fresh session (or `/clear` between tasks) and the context stays at plan size instead of dragging the design run forward with every call - in a long build that carried conversation, not the tools, is the dominant token cost; the per-task ticks below make any task boundary a safe resume point.

## Build mode - inline by default

Default: build inline in this chat, the protocol below. On an explicit agents request, dispatch each task to its `<stack>-implementer` seat instead - up to 3 at once, each on its frontmatter model unless you name one - keeping the main session the only orchestrator, routing a red per the repair-agent rules, and ticking the plan file as reports land. Dispatch nothing you were not asked to; the inline build is the default.

## The protocol - per task, in plan order

1. **Take exactly one task.** Its card is the contract: the files it owns, the traps it names, the `file:symbol` anchors, and its acceptance criterion. When the plan lives in a file (it should - `project-solution-design` writes it under the docs root's `superpowers/plans/`), mark the task `IN_PROGRESS` there before touching code. Jump to the anchors - the designer already located them; do not re-navigate the repo.
2. **Build the slice + its tests together.** The acceptance criterion is what the tests prove; a task without its test is not built, it is drafted. Stay inside the task's boundary - a needed change outside it is a flag, not a detour (see below).
3. **Gate the task green.** Build + the relevant tests after each task, not at the end of the plan. Resolve every red INLINE in this session - keep the fix loop here, quoting each build/test run so every attempt stays inspectable; the default inline build dispatches nothing. Load the stack's convention skills for the trap list when the red points at one. (To offload a large, noisy fix loop to a specialist resolver seat instead, that is the dispatched multi-agent `project-solve-cross-task`; this single-chat skill stays inline.)
4. **Close the task honestly** - the `superpowers:verification-before-completion` gate per task: run it, quote the output, then tick the task `DONE` with its evidence line in the plan file and refresh the plan's one-line resume note (next task + any mid-task state). The file, not the chat, is what a compacted or fresh session resumes from - it must never be more than one task stale. Then the next task. Partial is stated as partial.

## When the plan meets reality

- **A task proves wrong mid-build** (the seam isn't where the plan said, a trap the audit missed): stop the task, name the delta, and re-enter `project-solution-design` on that slice - never silently redesign while implementing. The plan is the contract; reality wins, but through a revision, not a drift.
- **Scope beyond the plan** (a bug discovered nearby, a refactor itch): flag it and ask - it enters the plan explicitly or waits. Never rides along.
- **A shared contract surfaces** (a DTO both sides compile against, a schema semantic): stop - that is `project-solve-cross-task` territory, the same BLOCKED_CONTRACT_CHANGE discipline the dispatched seats follow.

## Finish - the in-session verifier

All tasks green: run the full suite once, then review the assembled diff against the plan - your choice of reviewer: `project-verify-code` (inline, dispatches nothing - the single-chat form of the verifier seat) or the `<stack>-verifier` seat (dispatched, isolated, on its frontmatter model unless you name one) - pointed at the plan file so it reviews against the plan, not in isolation, and apply its findings; then the done-gate on the whole feature. Report against the plan, one line per task - `task | status (DONE / deferred / revised) | evidence (the green command and what it proved)` - then the suite + the review result, and anything deferred or revised with its reason. The vertical is complete: design (`project-solution-design`) -> audit (`project-verify-plan`) -> build (this) -> review (`project-verify-code` / `<stack>-verifier`) - one session, every step inspectable.

## Example

Executing the records-list export plan (the `project-solution-design` example, gated by `project-verify-plan` - three tasks, plus the audit's cancellation fix folded into Tasks 1-2):

- Task 1 - jump to the plan's query-seam anchor, add the export projection + its streaming test (rows streamed, never materialized - the card's trap), thread the cancellation token per the audit. Module tests green, output quoted. DONE.
- Task 2 - the streamed export entry point on the Task 1 seam, mapped to a transfer shape at the edge (the card's boundary trap). Tests green. DONE.
- Task 3 - integration test: header row, one data row, success status, and the audit's empty-set shape. Green on the full suite. DONE.
- Finish - full suite once, `project-verify-code` over the assembled diff (one finding: a stray debug log - fixed), done-gate run.

```text
task 1 export projection | DONE | module tests green (streamed, cancellation threaded)
task 2 streamed endpoint | DONE | tests green (edge maps to transfer shape)
task 3 integration test  | DONE | full suite green incl. empty-set shape
suite + verify-code: green, 1 finding fixed; nothing deferred
```

## Don't game it

The acceptance criterion is satisfied by behavior, never by weakening the test that checks it. A green gate means the commands ran and their output says green - quoted, not assumed. Never suppress a warning, stub a path, or narrow a test to advance to the next task; a task that cannot go green honestly goes back to design as a named delta.
