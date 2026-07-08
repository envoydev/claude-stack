# AGENTS.md (stack-neutral template)

Copy this into a new project's `AGENTS.md` and fill the `<placeholders>`. It is the language- and
framework-neutral skeleton of the Cursor base: the same cross-project engineering conventions and
routing rules, with every stack-specific detail (house-style skills, convention rules, secret-file
globs, the per-language LSP extension) left blank for you to complete. Cursor injects `AGENTS.md`
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

### Communication

- Direct. Cut preamble. Assume strong stack knowledge. Push back when wrong; useful disagreement beats polite agreement. If uncertain, say so.
- Recommend one option with reason. Tradeoffs only if material.
- Ambiguous *goal*: ask. Ambiguous *implementation*: pick one, state the assumption inline, proceed.
- Mid-task redirect: acknowledge explicitly, restate the new direction in one sentence, continue. No quiet course-correct.
- Default for coding: apply the change, then summarize in 1-3 sentences. 'just do it' = skip the summary. 'walk me through' / 'plan it' = explain or plan first, no edits.
- Single dashes, not em-dashes. Single quotes in prose.

### Planning and execution

- Non-trivial code (new feature, refactor, 3+ files): plan first, and write tests first. Routine requests: apply-then-summarize.
- Mid-size mechanical change (rename touching 10+ files): confirm the scope list, skip the full plan.
- Skip planning for typos, one-line fixes, formatting, dep bumps, single-file rename.
- Code fails: read the full error, quote the relevant part, reproduce if ambiguous. No shotgun debugging.
- Inherited code: codebase conventions win over these rules unless broken or unsafe.

### Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple. No speculative abstractions, no error handling for impossible cases. Touch only what the task requires.
- Inline comments explain *why*, not *what*.

### Definition of done

Observable gate - the claim words are the trigger. Before you type 'done', 'fixed', 'passing',
'works', or 'ready' about your own change: STOP, and do not emit the claim until the build +
relevant tests have run and you have quoted the output (no new warnings, files formatted). Satisfy
the gate honestly - fix the cause, never game it: no suppressing or downgrading a warning, disabling
or weakening a test, or stubbing code to go green. Report
what changed and what was deliberately not. Cannot run it? Say so, never silently skip. Partial
work: state complete vs not vs why, then ask continue / redirect / stop.

### Security

- Crypto / secret / auth / payment / data-access work: run **Bugbot** (`/review`) on the diff before presenting.
- Never log PII, tokens, passwords, or full payment data.
- Hardcoded secret found: stop, flag, redact in output (`<redacted>`), recommend rotation + git-history removal. Never propagate the value or send it to any tool (memory, context7, web, external service).
- `.env`, `*.pem`, `*.pfx`, `*.key`, and whatever config files your stack keeps secrets in (`<stack secret/config globs>`) are sensitive - never read or echo them.

### Git and pull requests

- Conventional Commits. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Before committing, show the `git diff` / `git status` and let the user review - commit only on their go, never automatically, and never push without an explicit ask. Never mention yourself: no AI/assistant attribution in the commit message, the branch name, or the PR title/body (a deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches. Prefer `--force-with-lease` over `--force`; force-pushing `main`/`master`/`develop` is *blocked* by a Cursor hook (below), not just discouraged.
- Non-trivial git beyond add/commit/push - rebase, cherry-pick, history recovery, conflict resolution - work reversibly (know the undo before you run it); the protected-branch force-push guard still applies.

### Navigation and code reading

- Read only what's needed; before editing, read the body end-to-end and any function it depends on. To *locate* a symbol, its callers, or its resolved type, use `serena` (`find_symbol` / `find_referencing_symbols`) or the editor's `LSP` - serena is the default navigator and owns symbol-level *edits*. (The hard rule against a brute-force `Read`/grep just to locate a symbol is under `### MCP servers`.)
- Ambiguous reference (e.g. 'the OrderService' with multiple matches): list the matches, ask. Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.

## Skills, rules, hooks and MCPs

How routing works, and the rules that matter most:

- **The trigger is an artifact, a task shape, or a checkpoint - never a vibe.** Load a skill for the *work* (a file you're about to edit, a command you're about to run, a diff you're about to show), not to answer a question or explain. Over-loading a simple turn is the failure to avoid.
- **Match the mechanism to the job, one home per piece, no duplication.** A deterministic gate at a discrete event → a Cursor hook (`.cursor/hooks.json`). Per-file-type conventions → a `.cursor/rules/*.mdc` rule (auto-attaches by glob). A keyword-fired capability → the skill's own description. Everything else cross-cutting or project-specific → this file. Never state one trigger in two places.
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

**Hard rule - never `Read` a whole file to find a symbol.** Locating a symbol, its definition, or its
callers goes through serena (`find_symbol` / `find_referencing_symbols`) or the `LSP` - not a
brute-force `Read` or grep over whole files. `Read` is for code you have *already* located. Name the
enabled LSP extension(s) under `## Per-project additions`.

## Related projects

When this repo is one of several that make up a product (a backend and its frontend, an app and a
package it consumes, peer services), list the siblings here so an investigation can cross the seam.
This static graph is the cross-project *structure* - it lives here in `AGENTS.md` (committed, loaded
every session), never in the `memory` MCP; `memory` carries only the *dynamic* cross-repo findings
on top. Describe *edges* (relationships), not roles, so any topology fits:

```yaml
related_projects:
  - name:       <sibling name>
    location:   <path or git URL>              # how to find it
    relation:   consumes | provides-to | peer | depends-on | embeds   # this repo's edge to it
    read_first: [AGENTS.md, README.md]          # its docs - read these to orient before its code
    interface:  <optional - where the seam is: an API spec, a package's public surface, shared types>
    visit_when: <optional - what sends you there, e.g. 'a bug traces into this package'>
```

- **Orient from `read_first` before code.** When an edge sends you into a sibling, `Read` its agent
  brief (`AGENTS.md` / `CLAUDE.md`) then `README.md` (and any other `read_first` doc) first - they
  are plain files, so no cross-project indexing is needed.
- **Navigation stays per-repo.** serena binds to *this* repo; you can `Read` / `Grep` a sibling's
  files directly, but real serena symbol-navigation of a sibling happens in a context rooted in that
  sibling, never cross-navigated from here.
- **Dynamic findings go to `memory`.** A cross-repo outcome ('the contract moved to v3, endpoint X
  must change') is stored in the `memory` MCP (product-scoped via `MCP_MEMORY_SQLITE_PATH`), not here.
- **Inline or a file.** A short list lives inline in this section; a richer or growing one moves to a
  committed `docs/RELATED-PROJECTS.md`, with a one-line pointer kept here. The pointer must stay in
  `AGENTS.md` - it is always loaded and is what makes the agent aware the siblings exist; the file
  itself is read on demand and must be tracked (never gitignored), so it travels with the repo.

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
