---
description: House baseline - planning and execution. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Planning and execution

- Non-trivial code (new feature, refactor, 3+ files): plan and write tests first. Routine requests: apply-then-summarize.
- Mid-size mechanical change (rename touching 10+ files): confirm the scope list, skip the full plan.
- Skip planning for typos, one-line fixes, formatting, dep bumps, single-file rename.
- Code fails: read the full error and quote the relevant part before fixing.
- Inherited code: codebase conventions win over these rules unless broken or unsafe.
