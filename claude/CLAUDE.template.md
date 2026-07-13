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
| baseline-interaction | communication style (direct, concise, recommendation-first, label uncertainty), adversarial review of any user proposal (strongest objection first, BLOCKER / MATERIAL / MINOR), and when to plan and write tests first (3+ files) vs apply-then-summarize |
| baseline-quality-gates | no dead code or ticketless TODOs, unit + integration test expectations, keep-it-simple, comments explain why - and the done-claim gate: build + tests run and output quoted before saying done / fixed / works, never game the gate |
| baseline-security | /security-review routing for sensitive diffs, never log PII / secrets, hardcoded-secret protocol, the permissions.deny subprocess caveat |
| baseline-git | Conventional Commits + branch naming, review-before-commit, never auto-push, no AI attribution, PR shape, force-with-lease, the pre-commit checkpoint |
| baseline-navigation | serena-first symbol lookup, read-before-edit, ambiguous-reference handling, pasted-code-is-illustrative |
| baseline-agents-skills | skill-loading discipline, explicit-only subagent dispatch; the per-project inventory (orchestration skills, seats, MCP routing) is the GENERATED baseline-project-capabilities.md - run /project-capabilities after install or a trim |

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

6. **Stack** - languages, frameworks, key libraries, test stack + coverage gate, the LSP plugin
   for the primary language(s). MCP routing is NOT hand-filled here: it lives in the generated
   `baseline-project-capabilities.md` - run `/project-capabilities` after install, an update, or a
   manifest trim, and it stamps routing rows for exactly the servers `.mcp.json` registers.
7. **Commands** - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
8. **Code conventions** - the house-style skill for each file type (a path-scoped rule in `.claude/rules/` glob-attaches it; a file matching two globs loads both skills).
9. **Testing approach** - per-layer strategy, what's excluded, the integration / regression net.
10. **Load by artifact** - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
