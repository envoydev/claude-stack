---
description: House baseline - security. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Security

- Crypto / secret / auth / payment / data-access work: run `/security-review` on the diff before presenting - and feed it the FULL change set: `git add -N .` first, so untracked files appear in the diff itself (undo the intent-to-add entries with `git reset -q` after), because a diff-fed review silently skips brand-new files, which are often the most security-relevant code in the change (measured near-miss). Scope the review to the genuinely unreviewed range - and know that passing `/security-review` an explicit base commit does NOT reliably scope it (measured: handed the correct base, it still returned a ~250-file diff spanning already-reviewed stages; earlier, a 3.1MB default diff): on a long-lived branch, skip its diff computation and run the scoped review yourself - compute `git diff <base>..HEAD` and review exactly that (a read-only general-purpose seat where dispatch exists, inline otherwise - and inline inside a stamped flow, where the dispatch guard blocks generic seats), applying the same vulnerability checklist `/security-review` would. On these paths the review is
part of the pre-commit checkpoint: the `COMMIT-GATE` receipt (baseline-git) is written `VERIFIED`
only after it ran - an auth-path diff committed on the code review alone shipped unreviewed to a
shared branch (measured).
- Three honesty rules on that path. A skip on 'the diff is test-only' is a claim - verify it from
the diff's own file list and name the carve-out in the close ('security review: skipped - test-only
diff: <paths>'), never a silent unilateral call (measured: stated unilaterally twice in one session).
An inline review is a substantive checklist pass with per-category findings named - a one-line 'no
issues' nod over a secrets-adjacent diff is not a review (measured both ways: the nod, and the
checklist pass that caught real findings). And when the user overrides a security recommendation,
proceed - their call - but the close and any receipt record the override with the risk named and
their words quoted, so the decision is auditable (measured: an override shipped with no recorded-risk
trail).
- Never log PII, tokens, passwords, or full payment data - and a change that WIDENS logging (a
default flipped verbose, a redaction removed, a new sink) is itself security-relevant work riding
the review path above (measured: a logging-default flip shipped unredacted tokens).
- Hardcoded secret found: stop, flag, redact as `<redacted>`, recommend rotation + git-history removal. Never propagate the value into any tool.
- `permissions.deny` blocks reading secret files (`.env*`, key/cert globs) but not arbitrary subprocesses - never read or echo a secret's value by any route.

<!-- Maintainer note: extend the deny list in settings.json with the stack's own secret/config globs. -->
