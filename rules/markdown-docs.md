---
description: Trigger patch - a content edit to any .md misses the doc skills' keyword triggers, so this glob routes it.
paths: ["**/*.md"]
---

Authoring or restructuring any .md (README, ADR, runbook) - load `markdown-style` first - skip the load when it is already in context; its
own keywords only catch explicit lint asks, so a content edit misses it. ADR / Mermaid-diagram / C4 work also loads `docs-as-code` (same blind spot). Skip one-line tweaks.
