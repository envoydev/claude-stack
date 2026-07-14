# AGENTS.md (stack-neutral template)

Copy this into a new project's `AGENTS.md` and fill the `<placeholders>`. It is the language- and
framework-neutral skeleton of the Cursor base: the Cursor-mechanism routing plus the per-project
structure, with every stack-specific detail (house-style skills, convention rules, secret-file globs,
the per-language LSP extension) left blank for you to complete. The cross-cutting engineering
conventions themselves live in the always-on `baseline-*.mdc` rules, not here. Cursor injects `AGENTS.md`
(and matching `.cursor/rules`) into model context, so keep it lean and high-signal - the skills' and
rules' own descriptions already cover a lot; this file adds only what they do not surface, and routes
work by a concrete, observable trigger (an artifact, a command, a checkpoint), never a vibe. Project
specifics go under `## Per-project additions`.

> **Filling in the placeholders - do this before it becomes the project's `AGENTS.md`.** Every
> `<placeholder>` is a prompt, not literal text: replace each with what this project *actually* has,
> and trim the inventories to match (drop rows that don't apply, add ones that do). Investigate the
> project first, then fill:
> - **Skills** - what's installed (the `.cursor/skills/` dir, agentskills.io) and which house-style skill
>   governs which file type -> the *House-style skills* table.
> - **MCP servers** - what's registered (the repo's `.cursor/mcp.json`) -> the *MCP servers* table.
> - **Rules** - which `.cursor/rules/*.mdc` carry the per-file-type conventions -> the *Convention rules* table.
> - **Plugins** - Cursor has no `/plugin install`; "plugin" capability is MCPs / native features (Skills,
>   Bugbot, Rules) / Open-VSX extensions, plus any `/add-plugin` ones (e.g. superpowers). Reflect what is in use.
>
> Leave no `<placeholder>` behind; if a whole section does not apply to this project, delete it.

## How to work here

The cross-cutting engineering conventions - communication style, adversarial review of your
proposals, planning/execution thresholds, code quality, the definition-of-done gate, security, git
and pull requests, and code navigation - are the always-on `baseline-*.mdc` rules in `.cursor/rules/`
(`baseline-interaction.mdc`, `baseline-quality-gates.mdc`, `baseline-security.mdc`, `baseline-git.mdc`,
`baseline-navigation.mdc`). The stack installs and refreshes them and Cursor loads them every turn
(`alwaysApply: true`), so they are NOT restated here. This file carries only the Cursor-mechanism
routing below and the per-project structure under `## Per-project additions`.

## Skills, rules, hooks and MCPs

How routing works, and the rules that matter most:

- **The trigger is an artifact, a task shape, or a checkpoint - never a vibe.** Load a skill for the *work* (a file you're about to edit, a command you're about to run, a diff you're about to show), not to answer a question or explain. Over-loading a simple turn is the failure to avoid.
- **Match the mechanism to the job, one home per piece, no duplication.** A deterministic gate at a discrete event → a Cursor hook (`.cursor/hooks.json`). Per-file-type conventions → a glob-scoped `.cursor/rules/*.mdc` rule (auto-attaches by glob). An always-on cross-cutting convention → an `alwaysApply` `baseline-*.mdc` rule. A keyword-fired capability → the skill's own description. Project-specific structure → this file. Never state one trigger in two places.
- **Skill and rule descriptions auto-attach.** Route here only what they do not already make obvious.

### House-style skills (Cursor Skills)

No inventory here - house-style skills under `.cursor/skills/` auto-activate on their own keywords / file types and carry their own descriptions. Wire each convention-governed one to a `.cursor/rules/*.mdc` (Convention rules below), and name the set under `## Per-project additions`.

### Convention rules

For each convention-governed file type, add a `.cursor/rules/*.mdc` with a `globs` frontmatter so it
**auto-attaches** when a matching file is in context - guidance pointing at the matching house-style
skill, not a hard block. Replace the rows:

| Rule | File types → skill |
|---|---|
| `<language>-conventions.mdc` | `<file globs>` → `<house-style-skill>` |
| `<framework>-conventions.mdc` | `<framework file globs>` → `<framework-skill>` |

### Stack hooks

Two `beforeShellExecution` guards live in `.cursor/hooks/`, wired in `.cursor/hooks.json`, each blocking its own case: the protected-branch guard (`guard-protected-force-push.js`) and the catastrophic-rm guard (`guard-catastrophic-rm.js`). Add a new deterministic gate as a Cursor hook there, not as prose.

### Other routing

- **Any `.md`** (README, ADR, runbook) - authoring or restructuring → `markdown-style`. Skip one-line tweaks.
- **Security review** of a sensitive diff → **Bugbot** (`/review`), per the Security rules above.

### MCP servers

| Server | Use for |
|---|---|
| `serena` | primary symbol navigator + symbol-level *editor* - `find_symbol` / `find_referencing_symbols` / symbol edits *before* `Read`-ing a whole file to locate a symbol; default over grep and whole-file Read. Runs with `--context ide-assistant` and `--project-from-cwd`, so it self-activates on launch - no `activate_project` call needed; the relative `SERENA_HOME` assumes cwd is the project root. serena also holds this project's **local memory** (`.serena/memories/`, name-addressed and gitignored): the installed subagents use it as their hand-off bus - a seat `write_memory`s a compact note named `<feature>__<contract_version>__<seat>` at hand-off and the next `read_memory`s it by name, staying local to this project. |
| `context7` | up-to-date library / framework / SDK docs. **Before writing or changing code against any code you don't own** - any third-party package, vendor SDK, or standard-library / framework API whose behavior or signatures are version-sensitive (not just the few you use most) - resolve + query `context7` first; don't answer library-API questions from recall, even when confident. Packages this file names elsewhere are examples, not the whole set - the rule is the *category* (third-party API surface), not a fixed list. Skipping it is *silent* (no error, unlike a wrong symbol), so it's a discipline, not a reflex. Hand-written API code only - generated code (scaffolds, migrations, codegen output) doesn't count. |
| `memory` | *cross-project* recall and dynamic cross-repo findings - **active in the baseline**; the per-project subagent hand-off runs on serena's local memory (above), not here, so comment this out in a standalone project. Search when this project's context is thin and store a significant cross-project outcome at task end (decision / gotcha / architecture, + project & date). Its SQLite DB is shared across projects *and* accounts by design (one store under `$HOME`) - the lone cross-project store, every other server here is per-project. |
| `playwright` | drive a browser for visual checks / large HTML reports - don't text-read them |
| `<framework>-cli` (framework-gated; `angular-cli` in the Angular baseline) | the framework CLI's own docs / commands - shipped active in the Angular stack, commented out where the project isn't that framework. A framework-specific complement to `context7`, which stays the generic-docs route. |

Two further MCPs ship commented-out as opt-in - `chrome-devtools` (browser / extension debug) and
`appium-mcp` (native mobile E2E); uncomment per project. Name any other MCP the project adds under
`## Per-project additions`.

Adjacent but not an MCP: the editor's **`LSP`** - built-in TypeScript, plus an Open-VSX extension per
language (`<language LSP extension>`; on C# use a Roslyn-based extension - Microsoft's C# Dev Kit is
blocked in Cursor). An LSP gives compiler-accurate intelligence: inline diagnostics, go-to-definition,
find-references, resolved types. It **complements** serena and does **not** edit; serena stays the
default navigator, symbol editor, and local memory.

The never-`Read`-a-whole-file-to-locate-a-symbol hard rule is the always-on `baseline-navigation.mdc`
rule; serena (`find_symbol` / `find_referencing_symbols`) or the `LSP` is the locator, `Read` is for
code you have *already* located. Name the enabled LSP extension(s) under `## Per-project additions`.

## Related projects

When this repo is one of several that make up a product (a backend and its frontend, an app and a
package it consumes, peer services), list the siblings here so an investigation can cross the seam.
This static graph is the cross-project *structure* - it lives here in `AGENTS.md` (committed, loaded
every session), never in the `memory` MCP; `memory` carries only the *dynamic* cross-repo findings
on top. Keep each entry to the awareness minimum - name, location, relation, one seam line;
describe *edges* (relationships), not roles, so any topology fits:

```yaml
related_projects:
  - name:     <sibling name>
    location: <path or git URL>              # how to find it
    relation: consumes | provides-to | peer | depends-on | embeds   # this repo's edge to it
    seam:     <the shared surface a change here can break there - an API spec, a package's public surface, shared types>
```

- **Detail lives in `docs/PROJECT-RELATED-CONTEXT.md`, from the start.** What to read first to orient in a
  sibling (its `AGENTS.md` / `CLAUDE.md`, then `README.md`), what sends you there, interface
  elaboration - all of it goes in that committed file (tracked, never gitignored, so it travels with
  the repo), read on demand when a task touches a seam. The entries above must stay in `AGENTS.md` -
  always loaded, they are what makes the agent aware the siblings exist.
- **Navigation stays per-repo.** serena binds to *this* repo; you can `Read` / `Grep` a sibling's
  files directly, but real serena symbol-navigation of a sibling happens in a context rooted in that
  sibling, never cross-navigated from here.
- **Dynamic findings go to `memory`.** A cross-repo outcome ('the contract moved to v3, endpoint X
  must change') is stored in the `memory` MCP (product-scoped via `MCP_MEMORY_SQLITE_PATH`), not here.

## Per-project additions

A project's `AGENTS.md` is this base plus a project-specific top. Add, in roughly this order, keeping
each section lean (the skill and rule descriptions carry the rest):

1. **What this project is** - one paragraph: domain, shape (binary / service / library), persistence, surfaces.
2. **Stack** - languages, frameworks, key libraries, test stack + coverage gate, plus the per-language LSP extension (built-in TS; a Roslyn C# extension) for compiler-exact navigation + diagnostics.
3. **Commands** - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
4. **Architecture** - layers / modules, dependency rules, folder organization.
5. **Key patterns** - the non-obvious in-house patterns a newcomer would trip on.
6. **Code conventions** - the house-style skill for each file type; add a globbed `.cursor/rules/*.mdc` so it auto-attaches.
7. **Testing approach** - per-layer strategy, what's excluded, the integration / regression net.
8. **Load by artifact** - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
9. **Operational notes** - runtime constraints and gotchas that shape code decisions.
10. **Cross-cutting checklists** - for each change that must move several files in lockstep, the full touch-point list.
