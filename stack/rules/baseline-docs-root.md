---
description: House baseline - the generated-docs root. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Generated docs root

- EVERY doc file the assistant creates lives under ONE root: the architecture map (`architecture/`),
  `PROJECT-CODE-STYLE.md`, the related-projects folder (`related-context/` - the orientation doc
  `related-context/PROJECT-RELATED-CONTEXT.md` plus every doc about or for a sibling repo:
  cross-repo plans, change requests, issue notes, run recipes), the quality-loop prompts
  (`loops/`), the coverage capture (`test-coverage/`), the usage-audit bundles
  (`claude-stack-usage-report/`), superpowers plans + specs, ADRs with no existing home (`decisions/`),
  the instrumentation ledgers (`tools-usage/`), the task cards handed to another repo
  (`cross-project-tasks/`), and any other generated artifact. A doc outside it is invisible to
  every capture, status and prune step that reads `<docs-path>`, and to the next session.
- Creating a doc OUTSIDE this root - a committed `docs/`, the repo root - happens only on the
  user's asked-first approval of that exact location (AskUserQuestion, per the interaction
  baseline); never silently, however conventional the spot looks. A sibling repo is never
  written from this session unless the user allows it in the cross-project write guard's own
  ask - its `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt, this session only; by default a doc
  about it lives in `related-context/`, a change it must make is a task card in
  `cross-project-tasks/`. Editing an EXISTING first-class repo doc where it already lives (the top-level
  `README.md`, an established ADR home) is not a generated doc and needs no ask.
- **This install's root: `__DOCS_ROOT__`** - stamped by every install, update and configure run from
  the `CLAUDE_STACK_DOCS_PATH` env value in `.claude/settings.json`; absent = `.claude/docs`. Edited
  by hand since the last run, the env value wins. Wherever an instruction names a doc as
  `<docs-path>/<name>` - or as legacy shorthand `docs/<name>` - it means this root.
- To move the docs, change that env value and nothing else - forward slashes on every OS. Existing
  docs do not move with it: they stay under the old root until moved by hand or re-captured.
- Superpowers writes its implementation plans and design specs under this same
  root - `<docs-path>/superpowers/plans/` and `<docs-path>/superpowers/specs/`, never its own
  default location.
- Reading a capture doc: every one opens with `Captured: <branch>@<short-sha>, <date>` (`+dirty` =
  the tree held uncommitted work), and these docs do not switch with git branches, so the stamp says
  which code the doc describes. A foreign-branch stamp, or `+dirty`, means approximate at best -
  verify against the code before relying on it, never as ground truth for HEAD. Nothing re-captures
  automatically: a flow may SUGGEST the right capture at close, the user decides, and how a doc is
  refreshed is the owning capture skill's own contract.

<!-- Operator note: the default root is machine-local (`.claude/*` is gitignored) - nothing under it
     is committed or survives a fresh clone, so the captures are re-run after a re-clone. A committed
     root (e.g. docs) shares the generated docs with the team; then track <docs-path>/superpowers/
     (do not gitignore it). Configuration, not model behaviour, so it is not injected - the
     installer's next-steps say the same thing at install time. -->

<!-- Maintainer note: the env value is read as process.env.CLAUDE_STACK_DOCS_PATH by the hooks and
     $env:CLAUDE_STACK_DOCS_PATH by the PowerShell installer twin; both also read the pre-0.2.43
     CLAUDE_DOCS_PATH spelling as a fallback, and an install/update renames the key in place. That
     history changed no model behaviour, so it is not injected - meta/shared-rules.json's
     docs-root-resolution entry is where the fallback is recorded. -->
