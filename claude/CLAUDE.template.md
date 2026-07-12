# CLAUDE.md (stack-neutral template)

> **Fill-in block - delete once done.** Copy this file into a new project as `CLAUDE.md`, then:
> replace every `<placeholder>` with what the project actually has (inspect first: `.claude/skills/`,
> `.mcp.json`, `claude plugin list`); trim every inventory to the stack(s) this project uses; delete
> any section that does not apply; add the project top per `## Per-project additions`. This file
> auto-injects every session and into subagents - keep it lean and route work by an observable
> trigger (an artifact, a command, a checkpoint). The cross-project working conventions are NOT
> here: they load from the always-on `.claude/rules/house-baseline.md` (installer-managed,
> refreshed on `update`) - never restate them in this file.

## MCP servers

| Server | Use for |
|---|---|
| `serena` | default symbol navigator + symbol-level editor - `find_symbol` / `find_referencing_symbols` before any whole-file Read; self-activates on launch (never call `activate_project`). Also holds the per-project memory (`.serena/memories/`) the agent flows use for hand-off notes. |
| `context7` | up-to-date docs for any API you don't own. Before writing or changing hand-written code against a third-party package, vendor SDK, or version-sensitive framework surface: resolve + query first; never answer library-API questions from recall. Generated code doesn't count. |
| `memory` | *cross-project* recall only - search when this project's context is thin; store a significant cross-project outcome at task end (decision / gotcha / architecture, + project & date). Per-project hand-off lives in serena, not here. Comment out in a standalone project. |
| `playwright` | drive a browser for visual checks / large HTML reports - don't text-read them |
| `<framework>-cli` | the framework CLI's own docs / commands - keep only in a matching project |
| Issue-tracker connector | the project's tracker read-write; ticket skills write the content, the connector files it - always confirm before filing |

`chrome-devtools` and `appium-mcp` ship active but need native deps - comment out where the
project isn't a browser / mobile target. LSP plugins (`csharp-lsp`, `typescript-lsp`) feed the
`LSP` tool - enable the project's language(s). Name any project-added MCPs and plugins under
`## Per-project additions`.

## Related projects

When this repo is one of several that make up a product, list the siblings here - this committed,
always-loaded list is what makes the agent aware they exist. Describe edges, not roles:

```yaml
related_projects:
  - name:       <sibling name>
    location:   <path or git URL>
    relation:   consumes | provides-to | peer | depends-on | embeds
    read_first: [CLAUDE.md, README.md]   # orient from these before its code
    interface:  <optional - where the seam is>
    visit_when: <optional - what sends you there>
```

- serena binds to *this* repo: `Read` / `Grep` a sibling directly, but symbol-navigate it only from a context rooted there.
- Dynamic cross-repo findings go to the `memory` MCP, never this file. A growing list moves to a committed `docs/RELATED-PROJECTS.md`, one-line pointer kept here.

## Per-project additions

A project's `CLAUDE.md` is this base plus a project-specific top. Add, in roughly this order,
keeping each section lean:

1. **What this project is** - one paragraph: domain, shape (binary / service / library), persistence, surfaces.
2. **Stack** - languages, frameworks, key libraries, test stack + coverage gate, the LSP plugin for the primary language(s).
3. **Commands** - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
4. **Architecture** - layers / modules, dependency rules, folder organization.
5. **Key patterns** - the non-obvious in-house patterns a newcomer would trip on.
6. **Code conventions** - the house-style skill for each file type (a path-scoped rule in `.claude/rules/` glob-attaches it; a file matching two globs loads both skills).
7. **Testing approach** - per-layer strategy, what's excluded, the integration / regression net.
8. **Load by artifact** - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
9. **Operational notes** - runtime constraints and gotchas that shape code decisions.
10. **Cross-cutting checklists** - for each change that must move several files in lockstep, the full touch-point list.
