# CLAUDE.md (stack-neutral template)

> **Fill-in block - delete once done.** Copy this file into a new project as `CLAUDE.md`, then:
> replace every `<placeholder>` with what the project actually has (inspect first: `.claude/skills/`,
> `.mcp.json`, `claude plugin list`); trim the `## Rules` table to what the installer actually laid
> down; delete any section that does not apply; add the project top per `## Per-project additions`.
> This file auto-injects every session and into subagents - keep it lean and route work by an
> observable trigger (an artifact, a command, a checkpoint). The cross-project working conventions
> are NOT here: they load from the always-on baseline rules in `.claude/rules/` (installer-managed,
> refreshed on `update`) - never restate them in this file.

## Rules

The always-on baseline set in `.claude/rules/` - each file is one concern; all of them are loaded
every session, so this table is the map of where each behavior rule lives. Path-scoped rules in
the same directory attach themselves when a matching
file is touched and are not listed here - their own `paths:` frontmatter says when.

| Baseline rule | What it governs |
|---|---|
| baseline-communication | response style: direct, no filler openers, concise with structure, recommendation-first, label uncertainty, verify anything current, silently correct the user's language, name privacy, single dashes + single quotes |
| baseline-evaluating-proposals | adversarial review of any user proposal (design, plan, decision): strongest objection first, BLOCKER / MATERIAL / MINOR ranks, concrete failure modes, what-would-have-to-be-true + cheapest test, no sycophancy or manufactured criticism |
| baseline-planning | when to plan and write tests first (3+ files) vs apply-then-summarize, the skip-planning list, read-the-full-error discipline, inherited-code precedence |
| baseline-code-quality | no dead code or ticketless TODOs, unit + integration test expectations, keep-it-simple, comments explain why |
| baseline-definition-of-done | the done-claim gate: build + tests run and output quoted before saying done / fixed / works, never game the gate, partial-work protocol |
| baseline-security | /security-review routing for sensitive diffs, never log PII / secrets, hardcoded-secret protocol, the permissions.deny subprocess caveat |
| baseline-git | Conventional Commits + branch naming, review-before-commit, never auto-push, no AI attribution, PR shape, force-with-lease, the pre-commit checkpoint |
| baseline-navigation | serena-first symbol lookup, read-before-edit, ambiguous-reference handling, pasted-code-is-illustrative |
| baseline-agents-skills | skill-loading discipline, explicit-only subagent dispatch, the five slash-only orchestration skills |
| baseline-related-projects | cross-repo sibling awareness: the entry schema for this file's `## Related projects` section, orientation detail routed to `docs/RELATED-PROJECTS.md` (comment out in a standalone project) |

## Related projects

Multi-repo product only: the sibling awareness entries live here - committed and always-loaded,
shaped per `.claude/rules/baseline-related-projects.md` (name / location / relation / seam; the
orientation detail goes in a committed `docs/RELATED-PROJECTS.md`). Standalone project: delete
this section and comment the rule out of the installer manifest.

## Per-project additions

A project's `CLAUDE.md` is this base plus a project-specific top, in two groups (each section
lean; interleave as reads best - the project intro usually comes first):

**Project - what it is:**

1. **What this project is** - one paragraph: domain, shape (binary / service / library), persistence, surfaces.
2. **Architecture** - layers / modules, dependency rules, folder organization.
3. **Key patterns** - the non-obvious in-house patterns a newcomer would trip on.
4. **Operational notes** - runtime constraints and gotchas that shape code decisions.
5. **Cross-cutting checklists** - for each change that must move several files in lockstep, the full touch-point list.

**Stack - what it is built with:**

6. **Stack** - languages, frameworks, key libraries, test stack + coverage gate, the LSP plugin for the primary language(s), plus this MCP routing table trimmed to the servers the project actually registers:

   | Server | Use for |
   |---|---|
   | `serena` | default symbol navigator + symbol-level editor - `find_symbol` / `find_referencing_symbols` before any whole-file Read; self-activates on launch (never call `activate_project`). Also holds the per-project memory (`.serena/memories/`) the agent flows use for hand-off notes. |
   | `context7` | up-to-date docs for any API you don't own - resolve + query before writing or changing hand-written code against a third-party package, vendor SDK, or version-sensitive framework surface; never answer library-API questions from recall. Generated code doesn't count. |
   | `memory` | *cross-project* recall only - search when this project's context is thin; store a significant cross-project outcome at task end (decision / gotcha / architecture, + project & date). Per-project hand-off lives in serena, not here. Drop the row (and the server) in a standalone project. |
   | `playwright` | drive a browser for visual checks / large HTML reports - don't text-read them |
   | framework CLI (`angular-cli` in Angular projects) | the framework CLI's own docs / commands |
   | issue-tracker connector | the project's tracker read-write; ticket skills write the content, the connector files it - always confirm before filing |
   | `chrome-devtools` / `appium-mcp` | browser / native-mobile debug - only for browser / mobile targets |
   | `<project-added MCP>` | `<what it routes>` |
7. **Commands** - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
8. **Code conventions** - the house-style skill for each file type (a path-scoped rule in `.claude/rules/` glob-attaches it; a file matching two globs loads both skills).
9. **Testing approach** - per-layer strategy, what's excluded, the integration / regression net.
10. **Load by artifact** - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
