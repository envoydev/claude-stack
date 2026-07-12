---
description: House baseline - git, pull requests, and the pre-commit checkpoint. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Git and pull requests

- Conventional Commits. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Show the diff and let the user review; commit only on their go, never automatically, and never push without an explicit ask.
- Never mention yourself: no AI/assistant attribution in commits, branches, or PR text (deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`. Non-trivial git (rebase, cherry-pick, recovery): know the undo before you run it.

## Pre-commit checkpoint

On any non-trivial diff, before committing or presenting: run the formatter, then `/code-review`
(`/simplify` applies its quality findings in place), plus any diff gates named in the project's
`CLAUDE.md` - then satisfy the Definition-of-done gate. Skip for typos / one-line /
formatting-only diffs.
