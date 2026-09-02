---
name: project-implementer
description: "Use when you have a task plan in hand - from project-solution-design, ideally gated by project-verify-plan - and want to BUILD it in the current chat, task by task: the single-chat form of the implementer seat's execution protocol. Honors each task's contract, builds code + tests per task, gates each task green before the next, resolves every red INLINE (in this chat, dispatching nothing), and hands to the build review (`project-verify-code` inline or the `<stack>-verifier` seat) + the done-gate. Trigger on execute the plan, build the plan, implement the tasks, build task 2, continue the plan. On an agents answer (the run-start ask, or the calling flow's recorded mode) it hands each task to its `<stack>-implementer` seat instead (up to 3 at once, each on its frontmatter model unless you name one); the full multi-agent flow with its own designer and verifier is project-solve-cross-task. Not a plan-less ad-hoc edit - just make that."
---

# Project Implementer - execute a verified plan, task by task, in one chat

This is the build step of the single-session vertical: `project-solution-design` produced the plan, `project-verify-plan` audited it, this executes it - one task at a time, in the plan's dependency order, in your context so every diff is inspectable as it lands. It carries the implementer seat's *execution protocol* only; the coding conventions themselves need no restating - the path-scoped rules auto-attach the house skill per file type, the generated path-scoped project-code-style rule attaches the project's actual style on any matching file touch, and the plan's task cards name the stack traps.

The plan FILE is the whole input - not the chat that produced it. Run this in a fresh session (or `/clear` between tasks) and the context stays at plan size instead of dragging the design run forward with every call - in a long build that carried conversation, not the tools, is the dominant token cost; the per-task ticks below make any task boundary a safe resume point.

## Build mode - this chat or the implementer seats

In-chat: build in this chat, the protocol below. On an agents answer, dispatch each task to its `<stack>-implementer` seat instead - up to 3 at once, each on its frontmatter model unless you name one - writing the approval gate file first (`<docs-path>/flow/APPROVAL`, first line `APPROVED <plan id> - "<the user's words, verbatim>"` on their explicit approval, or `AUTO - "<their words, verbatim>"` only on a literal no-stops ask; the dispatch hook blocks an unstamped implementer; delete the file when the run completes), Write the stamp at the ABSOLUTE path `$CLAUDE_PROJECT_DIR/<docs-path>/flow/APPROVAL` with the Write tool - `.claude/` is a protected path, so the first write in a session prompts; take the prompt's 'allow Claude to edit its own settings for this session' option and the rest of the run is free (no settings key can pre-approve it: `permissions.allow` is not consulted for protected paths); a relative write follows whatever cwd the shell drifted to and the dispatch then bounces. The stamp belongs to the session that dispatches - written when its own decision lands, deleted at its own close; an earlier session's leftover stamp is not consent. If BOTH the Write tool and an absolute-path Bash write are refused by the harness's classifier, stop and put the choice through AskUserQuestion (retry the stamp, or run this stage inline) rather than retrying blind or dispatching around the gate. Keep the main session the only orchestrator, routing a red per the repair-agent rules, and ticking the plan file as reports land - and each seat's gate is build + fast tests only, never a minutes-long run like integration replays or an E2E pass; the full suite stays with this session's finish step. Dispatch nothing you were not asked to. When the invocation names no mode and no calling flow has already recorded one (`project-solve-task`'s `mode <session|agents>` approval line, an orchestrator's brief), ask ONE question before building, via AskUserQuestion - this chat, or the implementer seats? - and hold the answer; a mode the run already picked is inherited, never re-asked.

## The protocol - per task, in plan order

1. **Take exactly one task.** Its card is the contract: the files it owns, the traps it names, the `file:symbol` anchors, and its acceptance criterion. When the plan lives in a file (it should - `project-solution-design` writes it to `<docs-path>/superpowers/plans/`), mark the task `IN_PROGRESS` there before touching code. Jump to the anchors - the designer already located them; do not re-navigate the repo.
2. **Build the slice + its tests together.** The acceptance criterion is what the tests prove; a task without its test is not built, it is drafted. The card's `log_points` go in with the slice, through the repo's logging seam at the level and with the identifiers the card names - never left for a later pass, never a second logger. Stay inside the task's boundary - a needed change outside it is a flag, not a detour (see below).
3. **Gate the task green.** Build + the relevant tests after each task, not at the end of the plan. Resolve every red INLINE in this session - keep the fix loop here, quoting each build/test run so every attempt stays inspectable; the in-chat build dispatches nothing. Load the stack's convention skills for the trap list when the red points at one. (To offload a large, noisy fix loop to a specialist resolver seat instead, that is the dispatched multi-agent `project-solve-cross-task`; this single-chat skill stays inline.)
4. **Close the task honestly** - the `superpowers:verification-before-completion` gate per task: run it, quote the output, then tick the task `DONE` with its evidence line in the plan file and refresh the plan's one-line resume note (next task + any mid-task state). The file, not the chat, is what a compacted or fresh session resumes from - it must never be more than one task stale. Then the next task. Partial is stated as partial.

## When the plan meets reality

- **A task proves wrong mid-build** (the seam isn't where the plan said, a trap the audit missed): stop the task, name the delta, and re-enter `project-solution-design` on that slice - never silently redesign while implementing. The plan is the contract; reality wins, but through a revision, not a drift.
- **Scope beyond the plan** (a bug discovered nearby, a refactor itch): flag it and put the call through AskUserQuestion - add it to the plan vs leave it for later (plain-text options where the harness lacks the tool). Never rides along. The same ask covers a bug reported AFTER a cycle stamped COMPLETE or outside any active cycle - fix now ad hoc vs open a new cycle vs defer (measured: two post-cycle bug reports were fixed and committed with no decision point between them).
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
