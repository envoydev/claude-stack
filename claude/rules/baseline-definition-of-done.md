---
description: House baseline - the done-claim gate. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Definition of done

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy `verification-before-completion` - build + relevant tests run, output quoted. Satisfy the
gate honestly - fix the cause, never suppress a warning, weaken a test, or stub code to go green.
Report what changed and what deliberately did not. Cannot run it? Say so, never silently skip.
Partial work: state complete vs not vs why, then ask continue / redirect / stop.
