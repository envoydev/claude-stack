---
description: Trigger patch - a content edit to any .md misses the doc skills' keyword triggers, so this glob routes it.
paths: ["**/*.md"]
---

Authoring or restructuring any .md (README, ADR, runbook) loads the `markdown-style` Skill - its own
keywords only catch explicit lint asks, so a content edit misses it. ADR / Mermaid-diagram / C4 work
also loads `docs-as-code` (same blind spot). Skip one-line tweaks.

<!-- Maintainer note: the one-line-tweak carve-out stays in prose on purpose - `paths:` takes globs and brace
     expansion only (checked against the Claude Code memory docs: no negation form, and an invalid pattern
     matches nothing), so an exclusion cannot live in the glob. -->

**When this rule reaches you it is already too late for the write that triggered it.** A path-scoped
rule attaches ON a file touch, so it can never precede its own trigger - measured 9.9 s AFTER the edit
it governs. So: load the skill now, before the NEXT write to that file, and
treat the load as a precondition of the SKILL that owns the deliverable, not of this rule. A run that
works through the shell gets no attach at all until it uses a file tool (measured: 0 attaches over 123
`.md` write targets); `guard-read-whole-file.js` names this rule on the first shell touch instead.

**The generated docs root is NOT governed here, and neither are the generated rules.** Every document
under `<docs-path>` belongs to the capture skill that writes it, and so does every generated
`.claude/rules/baseline-project-*.md` and `.claude/rules/project-code-style.md` - those are MACHINE
output whose shape the generating skill fixes verbatim, down to the frontmatter. That skill's own
body states the shape and loads `markdown-style` itself. Two owners pulling one file in opposite
directions is worse than either alone, and measured across three bundles this attach cost a whole
message (~328 tokens of rule read against 92.5k re-sent) before a rule write that then correctly
did NOT load the style skill - and it was obeyed in only 1 of 2 identical runs, so it was neither a
reliable gate nor a free one.
