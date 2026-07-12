---
description: House baseline - cross-repo sibling awareness. Always-on (no paths), installer-managed - update overwrites local edits. Comment out of the manifest in a standalone project.
---

# Related projects

When this repo is one of several that make up a product, the project's `CLAUDE.md` carries a
committed `## Related projects` section - the always-loaded awareness entries that make the
siblings exist for the agent. Keep each entry to the awareness minimum; describe edges, not roles:

```yaml
related_projects:
  - name:     <sibling name>
    location: <path or git URL>
    relation: consumes | provides-to | peer | depends-on | embeds
    seam:     <the shared surface a change here can break there - API, package, schema>
```

- Everything past awareness - what to read first to orient, what sends you there, interface
  detail - lives in a committed `docs/RELATED-PROJECTS.md`, read on demand when a task touches a seam.
- serena binds to *this* repo: `Read` / `Grep` a sibling directly, but symbol-navigate it only from a context rooted there.
- Dynamic cross-repo findings go to the `memory` MCP, never a committed file.
