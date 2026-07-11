---
name: solution-design
description: Use when you have a feature or change to build in a single chat and want to settle how it fits the existing code before writing any - the single-chat form of the solution-designer seat. Reads the committed architecture, judges where the change belongs (extend an existing seam, refactor first, or isolate a new boundary) tied to the forcing edge, names the stack's real traps by loading that stack's house skill, then decomposes the work into an ordered, minimal build plan. Trigger on analyse how to integrate this, how does this fit, design this feature, where does this belong, break this into tasks, plan this change. Not for a one-line edit; not the multi-agent flow (that is cross-stack-agents-flow / main-stack-agents-flow dispatching the designer agent) - this keeps the whole design in your context so you check each step.
---

# Solution Design - how a change fits, then decomposed, in one chat

The design carries the quality: a build handles the traps its plan named and ships the ones it missed. This is the single-chat form of the solution-designer seat - it works out where a feature belongs in the code you already have and breaks it into an ordered plan, all in the current context so you can inspect and correct each step instead of reading a dispatched agent's final report. It plans; it does not write the code (that is the build step under the stack skill) and it does not audit its own plan (that is `verify-plan`).

## When to use / not

- Use it the moment you have a feature or non-trivial change and want the integration shape before building - especially across 2+ modules, a new component, or a new dependency.
- Not for a one-line edit or a change with an obvious single home - just make it.
- Not the multi-agent path: when you want isolated parallel seats, that is `cross-stack-agents-flow` / `main-stack-agents-flow` dispatching the designer agent. This is the in-context twin for single-chat work.
- Not plan *audit* (`verify-plan`) or built-code review (`/code-review`) - those come after.

## The method - orient, judge, decompose

1. **Orient from the committed docs, don't re-derive them.** Read `docs/architecture/ARCHITECTURE.md` (and the linked topic under `docs/architecture/references/` for the area you touch) for the layers, boundaries, dependency directions, and patterns already in place, and `docs/CODE-STYLE.md` for the project's actual code style so the plan's code matches it. Absent those docs, take a bounded pass over the modules involved (`get_symbols_overview` per module, never a whole-file read) - map the surface, don't read everything.
2. **Load the house skill for the stack you're in, for its real trap list.** Your project's convention rules auto-attach it the moment you touch a matching file; load it explicitly if you're designing before touching code. Carry the stack's real traps, not a generic checklist, and follow that skill's own routing to its specialist siblings (the stack -> skill map lives in the project's convention rules and router skills, not restated here).
3. **Judge the fit - one verdict, tied to the forcing edge.** Extend an existing seam when the work lands inside a boundary whose dependency arrow already points the right way and that already carries the concern; refactor first when landing it as-is would open a cycle, invert a layer, or overload a shared grab-bag (name the exact edge); isolate a new boundary when it is a genuinely new concern with no existing home. Verify each dependency claim against located code, never a name.
4. **Decompose into an ordered, minimal plan.** Break the work into tasks that each own a clear slice, in dependency order, each naming the files it touches, the stack traps it must handle, and the `file:symbol` anchors you located. The smallest plan that meets the requirement - nothing speculative added, nothing required left out.

## Output

An ordered task plan: the fit verdict and its forcing edge first, then one entry per task - what it does, the files, the traps to handle, the located anchors - in build order. Then hand off: gate the plan with `verify-plan` before building, build each task under the stack skill, and review the built code with `/code-review`. Pairs with `writing-plans` for the plan format; this adds the house architecture-fit and stack-trap layer that a generic plan is silent on.
