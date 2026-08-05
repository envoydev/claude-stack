---
description: Trigger patch - a content edit to any .md misses the doc skills' keyword triggers, so this glob routes it.
paths: ["**/*.md"]
---

Authoring or restructuring any .md (README, ADR, runbook) - the FIRST action after this rule attaches is the `markdown-style` Skill call, before the write lands (measured: one session regenerated a generated doc with this rule attached and never loaded it) - skip only when it is already in context this session; its
own keywords only catch explicit lint asks, so a content edit misses it. ADR / Mermaid-diagram / C4 work also loads `docs-as-code` (same blind spot). Skip one-line tweaks.
