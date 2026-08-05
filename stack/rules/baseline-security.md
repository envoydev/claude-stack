---
description: House baseline - security. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Security

- Crypto / secret / auth / payment / data-access work: run `/security-review` on the diff before presenting - and feed it the FULL change set: `git add -N .` first, so untracked files appear in the diff itself (undo the intent-to-add entries with `git reset -q` after), because a diff-fed review silently skips brand-new files, which are often the most security-relevant code in the change (measured near-miss). Scope the review to the genuinely unreviewed range - and know that passing `/security-review` an explicit base commit does NOT reliably scope it (measured: handed the correct base, it still returned a ~250-file diff spanning already-reviewed stages; earlier, a 3.1MB default diff): on a long-lived branch, skip its diff computation and run the scoped review yourself - compute `git diff <base>..HEAD` and review exactly that (a read-only general-purpose seat where dispatch exists, inline otherwise - and inline inside a stamped flow, where the dispatch guard blocks generic seats), applying the same vulnerability checklist `/security-review` would.
- Never log PII, tokens, passwords, or full payment data.
- Hardcoded secret found: stop, flag, redact as `<redacted>`, recommend rotation + git-history removal. Never propagate the value into any tool.
- `permissions.deny` blocks reading secret files (`.env*`, key/cert globs) but not arbitrary subprocesses - never read or echo a secret's value by any route.

<!-- Maintainer note: extend the deny list in settings.json with the stack's own secret/config globs. -->
