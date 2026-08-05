---
description: House baseline - git, pull requests, and the pre-commit checkpoint. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Git and pull requests

- Conventional Commits - or the ticket-id header shape below; the two are the only valid headers. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Do NOT commit or push until the user explicitly says to - not when a task looks finished, not proactively because it seems done. Show the diff and let them review; commit only on their explicit word, and push only when they ask.
- Never mention yourself: no AI/assistant attribution in commits, branches, or PR text (deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`. Non-trivial git (rebase, cherry-pick, recovery): know the undo before you run it.

## Commit message shape

- **Header** - the ticket id (`PROJ-142`) or the feature delivered (a Conventional-Commits subject such as `feat(auth): token refresh` counts as the feature). One line.
- Then a blank line, then the body: one short, understandable sentence per thing done, each on its own line, indented two spaces, with NO blank line between them.
- A critical caveat (a constraint a later change must not break, a footgun, a silent tradeoff) goes LAST, after a blank line, indented, prefixed `Critical:`. Omit it when there is none.

```
PROJ-142

  Added a /healthz endpoint to the orders API.
  Wired it into the container readiness probe.
  Updated the deployment runbook.

  Critical: the probe path must stay /healthz or the readiness probe breaks the rollout.
```

## Pre-commit checkpoint

On any non-trivial diff, before committing or presenting: run the formatter, then the house
review `project-verify-code` - model-invocable, so the gate holds in autonomous flows too
(`/code-review` is a user-run parallel sweep, not this gate; `/simplify` applies its quality
findings in place) - plus any diff gates named in the project's
`CLAUDE.md` - then satisfy the Definition-of-done gate. Findings caught here land in the same
commit; found later they become fixup noise or shipped defects. Skip for typos / one-line /
formatting-only diffs - and for a diff the active quality-loop's own dispatched re-verify plus
final gate just cleared (an equivalent-or-stronger check already ran; a self-granted skip on any
other reasoning is not this exemption). The formatter half is never skipped: one unformatted
commit is a red CI run and a fixup commit (measured). A quality-loop stage-boundary commit may
exceed the one-logical-change size guidance when its stages share touched files - name the stages
in the commit body rather than splitting an unverifiable diff.

The checkpoint ends by writing its receipt: `<docs-path>/flow/COMMIT-GATE`, first line
`VERIFIED <what was reviewed, one phrase>` when the gates passed (the quality-loop re-verify
exemption counts as VERIFIED - name the loop), or `WAIVED - "<the user's words, verbatim>"` only
on their explicit waiver - 'commit it' is an instruction to commit, never a waiver of the review.
The `guard-ungated-commit` hook blocks a non-trivial `git commit` without a fresh receipt
(measured: 8 ungated commit events across 6 audited sessions rode on prose alone, including one
where this rule was read into context the same session). Clear the file once the commit lands -
a leftover receipt is the stale-stamp failure the hook's 2h age cap exists for.
