---
description: Trigger patch - a content edit to any .md misses the doc skills' keyword triggers, so this glob routes it.
paths: ["**/*.md"]
---

Authoring or restructuring any .md (README, ADR, runbook):
the FIRST action after this rule attaches is the `markdown-style` Skill call, before the NEXT write
to that file lands; its own
keywords only catch explicit lint asks, so a content edit misses it. ADR, Mermaid-diagram or C4 work
loads `docs-as-code` in that SAME first action, on top of it - same blind spot, one first action,
not two competing ones. Skip one-line tweaks.

<!-- Maintainer note: the one-line-tweak carve-out stays in prose on purpose - `paths:` takes globs and brace
     expansion only (checked against the Claude Code memory docs: no negation form, and an invalid pattern
     matches nothing), so an exclusion cannot live in the glob. -->

**When this rule reaches you it is already too late for the write that triggered it** - a
path-scoped rule attaches ON a file touch, measured 9.9 s AFTER the edit it governs, so the load is
a precondition of the SKILL that owns the deliverable, not of this rule. A run working through the
shell gets no attach at all until it uses a file tool (measured: 0 attaches over 123 `.md` write
targets); `guard-read-whole-file.js` names this rule on the first shell write instead.

**The generated docs root is NOT governed here, and neither are the generated rules.** Every document
under `<docs-path>` belongs to the capture skill that writes it, and so does every generated
`.claude/rules/baseline-project-*.md` and `.claude/rules/project-code-style.md` - MACHINE output
whose shape the generating skill fixes verbatim, down to the frontmatter, and which loads
`markdown-style` itself. Two owners pulling one file in opposite directions is worse than either
alone, and the attach here was obeyed in only 1 of 2 identical runs - neither a reliable gate nor a
free one.
