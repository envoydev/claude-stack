# CLAUDE.md (stack-neutral template)

<!-- Fill-in block - delete once done. Copy this file into a new project as CLAUDE.md, then:
1. Write the project top from the authoring outline in the comment below - the project intro
   usually comes first, above ## Rules - then delete that comment.
2. Trim the ## Rules table to what the installer actually laid down.
3. Run the four captures that write the rows marked GENERATED: /project-capabilities,
   /project-architecture-analyzer, /project-code-style-analyzer, /project-related-context.
If the repo's canonical agent instructions already live in an AGENTS.md (for other agent
tooling), keep this file thin and import it with @AGENTS.md instead of filling the same
content twice - but never @import anything under .claude/rules/: those files auto-load,
so an import pays for them twice.
This file auto-injects every session and into subagents - keep it lean and route work by an
observable trigger (an artifact, a command, a checkpoint). The cross-project working conventions
are NOT here: they load from the always-on baseline rules in .claude/rules/ (installer-managed,
refreshed on update) - never restate them in this file. (HTML comment: stripped from injection,
so an unfilled template pays nothing for this block.) -->

## Rules

The always-on baseline set in `.claude/rules/` - one concern per file, all loaded every session;
this table maps where each behavior rule lives (the detail is in the rules, not here). Path-scoped
rules in the same directory attach on a matching file touch - their own `paths:` frontmatter says when.

| Baseline rule | What it governs |
|---|---|
| `.claude/rules/baseline-interaction.md` | communication style, adversarial review of user proposals, planning/execution thresholds |
| `.claude/rules/baseline-quality-gates.md` | code-quality bars and the done-claim verification gate |
| `.claude/rules/baseline-security.md` | /security-review routing, PII/secret handling, the permissions.deny caveat |
| `.claude/rules/baseline-git.md` | commits, branches, PRs, push discipline, the pre-commit checkpoint |
| `.claude/rules/baseline-navigation.md` | symbol-lookup and code-reading discipline |
| `.claude/rules/baseline-project-capabilities.md` (GENERATED - run /project-capabilities after install or a trim) | the usage policy plus this project's real skill / seat / MCP inventory |
| `.claude/rules/baseline-project-architecture.md` (GENERATED - run /project-architecture-analyzer) | architecture awareness - the micro-summary plus the read-the-map trigger into docs/architecture/ |
| `.claude/rules/baseline-project-related-context.md` (GENERATED - run /project-related-context with the sibling paths/URLs) | sibling-repo awareness - name / location / relation / seam per sibling |
| inject-code-style hook (GENERATED - run /project-code-style-analyzer; a hook + doc, not a rule) | the project's actual code style - docs/PROJECT-CODE-STYLE.md surfaced at edit time, filtered to the observed file types |

### Generated docs root

The skill-generated project docs - the architecture map (`architecture/`), `PROJECT-CODE-STYLE.md`,
`PROJECT-RELATED-CONTEXT.md`, and the quality-loop prompts (`loops/`) - all live under a single
**docs root**, `docs/` by default. To relocate them, set the root here:

- **Docs root:** `docs/`

Wherever a skill or agent instruction names a generated project doc as `docs/<name>` (for example
`docs/architecture/ARCHITECTURE.md`), resolve it under the configured root instead - so with the
default the path is unchanged. Relocating to `.claude/docs/` keeps the docs local: `.claude/` is
gitignored, so they will NOT be committed, will not survive a fresh clone, and will not reach a
teammate - keep the root under a committed path (the `docs/` default) unless you specifically want
them machine-local.

Superpowers writes its implementation plans and design specs under this root too -
`<root>/superpowers/plans/` and `<root>/superpowers/specs/` (default `docs/superpowers/plans/` and
`docs/superpowers/specs/`) - overriding its own default location so they are committed alongside the
other project docs, not left as local scratch. Track them: do NOT gitignore `docs/superpowers/`.

<!-- Authoring outline - write these sections into the project-specific top of this file
(each section lean; interleave as reads best - the project intro usually comes first, above
## Rules), then delete this comment block. Comments are stripped from injection, so this
outline costs nothing even while it sits here.

Project - what it is:

1. What this project is - one paragraph: domain, shape (binary / service / library), persistence, surfaces.
2. Architecture - layers / modules, dependency rules, folder organization.
3. Key patterns - the non-obvious in-house patterns a newcomer would trip on.
4. Operational notes - runtime constraints and gotchas that shape code decisions.
5. Cross-cutting checklists - for each change that must move several files in lockstep, the full touch-point list.

Stack - what it is built with:

6. Stack - languages, frameworks, key libraries, test stack + coverage gate, the LSP plugin
   for the primary language(s). MCP routing is NOT hand-filled here - it lives in the generated
   .claude/rules/baseline-project-capabilities.md (run /project-capabilities).
7. Commands - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
8. Code conventions - the house-style skill for each file type (auto-attached by the path-scoped rules above).
9. Testing approach - per-layer strategy, what's excluded, the integration / regression net.
10. Load by artifact - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
-->
