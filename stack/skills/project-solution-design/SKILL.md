---
name: project-solution-design
description: Use when you have a feature or change to build in a single chat and want to settle how it fits the existing code before writing any - the single-chat form of the solution-designer seat - orient, judge the fit, decompose into an ordered minimal plan. Trigger on analyse how to integrate this, how does this fit, design this feature, where does this belong, break this into tasks, plan this change. Not for a one-line edit; not the multi-agent flow with its own verifier and fan-out (that is project-solve-cross-task) - this keeps the whole design in your context by default so you check each step, and dispatches the designer seat only if you ask.
---

# Solution Design - how a change fits, then decomposed, in one chat

The design carries the quality: a build handles the traps its plan named and ships the ones it missed. This is the single-chat form of the solution-designer seat - it works out where a feature belongs in the code you already have and breaks it into an ordered plan, all in the current context so you can inspect and correct each step instead of reading a dispatched agent's final report. It plans; it does not write the code (that is the build step under the stack skill) and it does not audit its own plan (that is `project-verify-plan`).

## Design mode - inline by default

Default: design inline in this chat, the method below, so you inspect each step. On an explicit agents request, dispatch the `<stack>-solution-designer` seat instead - on its frontmatter model unless you name one - and take its returned plan; the seat runs this same method, isolated. Only one designer runs, there is no fan-out here. Dispatch nothing you were not asked to.

## When not

- Not for a change with an obvious single home - just make it.
- Not plan *audit* (`project-verify-plan`) or built-code review (`project-verify-code`) - those come after.

## The method - orient, judge, decompose

1. **Orient from the project docs, don't re-derive them.** Read `docs/architecture/ARCHITECTURE.md` (and the linked topic under `docs/architecture/references/` for the area you touch) for the layers, boundaries, dependency directions, and patterns already in place, and `docs/PROJECT-CODE-STYLE.md` for the project's actual code style so the plan's code matches it. Absent those docs, take a bounded pass over the modules involved (`get_symbols_overview` per module, never a whole-file read) - map the surface, don't read everything.
2. **Load the house skill for the stack you're in, for its real trap list.** Your project's convention rules auto-attach it the moment you touch a matching file; load it explicitly if you're designing before touching code. Carry the stack's real traps, not a generic checklist, and follow that skill's own routing to its specialist siblings (the stack -> skill map lives in the project's convention rules and router skills, not restated here).
3. **Judge the fit - one verdict, tied to the forcing edge.** Extend an existing seam when the work lands inside a boundary whose dependency arrow already points the right way and that already carries the concern; refactor first when landing it as-is would open a cycle, invert a layer, or overload a shared grab-bag (name the exact edge); isolate a new boundary when it is a genuinely new concern with no existing home. Verify each dependency claim against located code, never a name.
4. **Decompose into an ordered, minimal plan.** Break the work into tasks that each own a clear slice, in dependency order, each naming the files it touches, the stack traps it must handle, and the `file:symbol` anchors you located. The smallest plan that meets the requirement - nothing speculative added, nothing required left out. Where tasks may build in parallel, give every file two tasks would both edit - the route registry, a root config or DI composition root, a barrel or shared index - exactly one owning task, and forbid the rest from touching it, so concurrent work never collides on a shared file.

## Output

An ordered task plan: the fit verdict and its forcing edge first, then one entry per task - what it does, the files, the traps to handle, the located anchors - in build order. The plan file opens with an `Oriented:` header line - the architecture doc read (or the bounded pass) from step 1 plus the house skill(s) loaded in step 2, or `none - <reason>`. It is a required field, not a nicety: `project-verify-plan` fails a plan without it, and if you cannot fill it those steps did not happen - do them now, a plan designed blind ships the traps it never saw. Write it to `<docs-path>/superpowers/plans/<feature>.md` (docs root = `CLAUDE_DOCS_PATH` from `.claude/settings.json` env, default `.claude/docs`) before handing off - the FILE is the handoff artifact: it survives compaction and a fresh session, where the chat copy does not. Then hand off: gate the plan with `project-verify-plan` before building, build each task with `project-implementer` under the stack skill, and review the built code with `project-verify-code` (`project-solve-task` drives this whole chain with a user gate between every step). Pairs with `superpowers:writing-plans` for the plan format; this adds the house architecture-fit and stack-trap layer that a generic plan is silent on.

## Example

Brief: 'Add data export to the records list.'

Plan (single-chat output):
- **Fit - extend an existing seam.** The records module already owns the read paths and an export is another read projection, so no new boundary. Forcing edge: the export must not pull the full object graph, so it reads through the existing query-projection seam, never the raw persistence surface.
- **Task 1** - add the export projection to the query seam and its implementation. Trap: stream the rows, never materialize the full set (the stack skill's unbounded-result trap). Anchor: the located query seam (`file:symbol`).
- **Task 2** - add the export entry point returning a streamed response. Trap: map to a transfer shape at the edge, never the persistence entity (the stack skill's boundary trap). Anchor: the located edge (`file:symbol`).
- **Task 3** - an integration test asserting the header row, one data row, and the success status. Anchor: the located test suite.

Then gate with `project-verify-plan`, build each task with `project-implementer` under the stack's house skills, and review with `project-verify-code`.
