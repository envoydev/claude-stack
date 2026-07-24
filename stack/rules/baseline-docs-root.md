---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- Any doc a skill or agent generates lives under ONE root: the architecture map (`architecture/`),
  `PROJECT-CODE-STYLE.md`, `PROJECT-RELATED-CONTEXT.md`, the quality-loop prompts (`loops/`),
  superpowers plans + specs, ADRs with no existing home (`decisions/`), and any other generated
  markdown. A first-class repo doc with a conventional home (the top-level `README.md`, an existing
  ADR home) stays where it belongs.
- Resolve the root ONCE per session, before the first generated-doc read or write: the
  `CLAUDE_DOCS_PATH` env value in `.claude/settings.json`; absent = `.claude/docs`. Wherever an
  instruction names a doc as `<docs-path>/<name>` - or as legacy shorthand `docs/<name>` - it means
  this root.
- **This install's root: `__DOCS_ROOT__`** - stamped from the env value by every install, update,
  and configure run, so the resolved path is already in front of you. If the env value disagrees
  (edited by hand since the last run), the env value wins.
- To move the docs, change that env value and nothing else - forward slashes on every OS (hooks
  read `process.env.CLAUDE_DOCS_PATH`, PowerShell `$env:CLAUDE_DOCS_PATH`). Existing docs do not
  move with it: they stay under the old root until moved by hand or re-captured.
- The default root is machine-local (`.claude/*` is gitignored): nothing under it is committed or
  survives a fresh clone - re-run the captures after a re-clone. A committed root (e.g. `docs`)
  shares the generated docs with the team; then track `<docs-path>/superpowers/` (do not gitignore it).
- Superpowers (when installed) writes its implementation plans and design specs under this same
  root - `<docs-path>/superpowers/plans/` and `<docs-path>/superpowers/specs/`, never its own
  default location.

## Generated-doc lifecycle (every capture doc under this root)

- Capture docs open with `Captured: <branch>@<short-sha>, <date>` (`+dirty` = the tree held
  uncommitted work). Machine-local docs do NOT switch with git branches - the stamp says which
  code a doc describes.
- Reading one: a stamp from another branch, or `+dirty`, means approximate at best - verify
  against the code before relying on it; never treat it as ground truth for HEAD.
- Refreshing one: the owning capture skill fans out agents on a FIRST capture and runs an UPDATE
  in-session, scoped to the drift since the stamp - escalating to agents on big drift, an
  unreachable or dirty stamp, or the user's explicit ask.
- Nothing re-captures automatically: build flows may SUGGEST the right capture at close when
  something critical landed; the user decides.
