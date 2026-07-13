---
description: "House baseline - quality gates: code quality and the done-claim gate. Always-on (no paths), installer-managed - update overwrites local edits."
---

# Quality gates

## Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple: no speculative abstractions; touch only what the task requires.
- Inline comments explain *why*, not *what*.

## Definition of done

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy `verification-before-completion` - build + relevant tests run, output quoted. Satisfy the
gate honestly - fix the cause, never suppress a warning, weaken a test, or stub code to go green.
Report what changed and what deliberately did not. Cannot run it? Say so, never silently skip.
Partial work: state complete vs not vs why, then ask continue / redirect / stop.
