---
description: "House baseline - quality gates: code quality and the done-claim gate. Always-on (no paths), installer-managed - update overwrites local edits."
---

# Quality gates

## Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple: no speculative abstractions; touch only what the task requires.
- Inline comments explain *why*, not *what*.
- Throwaway probe/scratch code (a diagnostic dump, a hypothesis check) is written OUTSIDE the tracked tree - the harness scratchpad or an untracked temp dir - never into the project's source or test folders (measured: a probe class heredoc-landed in the tracked test tree). And an interrupted compound write (heredoc, chained command) may have already executed before the interrupt - existence-check the target instead of trusting the rejection.

## Definition of done

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy `superpowers:verification-before-completion` - build + relevant tests run, output quoted. Bound that output: a pass/fail check needs the summary line, not `--verbose` (measured: 4.5k tokens to learn one spec passed) - tail long runs to the verdict. Satisfy the
gate honestly - fix the cause, never suppress a warning, weaken a test, or stub code to go green.
Report what changed and what deliberately did not. Cannot run it? Say so, never silently skip.
Partial work: state complete vs not vs why, then put continue / redirect / stop through the
AskUserQuestion tool - one option each, recommendation marked (a prose-only ask gets skipped).
Background work: a polling wait or a 'what is running' answer keys on a specific PID, marker
file, or output sentinel - never a bare process-name grep (`pgrep -f 'dotnet test'` matches a
sibling project's run; measured: one session nearly wrote a false coverage collapse and another
told the user nothing was running while its own orphaned waiter was live). Task lists track
created tasks only, never background shells - check the shell's own PID and listening ports
before claiming nothing runs.
