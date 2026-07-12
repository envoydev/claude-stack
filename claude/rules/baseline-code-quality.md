---
description: House baseline - code quality. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple: no speculative abstractions; touch only what the task requires.
- Inline comments explain *why*, not *what*.
