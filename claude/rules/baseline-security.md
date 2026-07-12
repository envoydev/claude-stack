---
description: House baseline - security. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Security

- Crypto / secret / auth / payment / data-access work: run `/security-review` on the diff before presenting.
- Never log PII, tokens, passwords, or full payment data.
- Hardcoded secret found: stop, flag, redact as `<redacted>`, recommend rotation + git-history removal. Never propagate the value into any tool.
- `permissions.deny` blocks reading secret files (`.env*`, key/cert globs; extend it in `settings.json` with the stack's own secret/config globs) but not arbitrary subprocesses - never read or echo a secret's value by any route.
