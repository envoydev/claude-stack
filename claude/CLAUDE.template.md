# CLAUDE.md (stack-neutral template)

Copy this into a new project's `CLAUDE.md` and fill the `<placeholders>`. It is the
language- and framework-neutral skeleton of the house base template: the same
cross-project engineering conventions and routing rules, with every stack-specific detail
(house-style skills, language, secret-file globs) left blank for you to complete. It
auto-injects every session, so keep it lean and high-signal - the system prompt and the
skills' own auto-injected descriptions already cover a lot; this file adds only what they
do not surface, and routes work by a concrete, observable trigger (an artifact, a command,
a checkpoint), never a vibe. Project specifics go under `## Per-project additions`.

> **Filling in the placeholders - do this before it becomes the project's `CLAUDE.md`.** Every
> `<placeholder>` is a prompt, not literal text: replace each with what this project *actually* has,
> and trim the inventories to match (drop rows that don't apply, add ones that do). Investigate the
> project first, then fill:
> - **Skills** - what's installed (`npx skills ls`, or the `.claude/skills/` dir) and which house-style
>   skill governs which file type -> the *Personal (house-style) skills* table + the convention gate's args.
> - **MCP servers** - what's registered (`claude mcp list`, or the repo's `.mcp.json`) -> the *MCP servers* table.
> - **Plugins** - what's installed (`claude plugin list`) -> the LSP plugin(s) for the language(s) and any per-project routing.
>
> Leave no `<placeholder>` behind; delete any section that does not apply - and trim the multi-stack inventories (agent seats, skills, MCP servers) to the stack(s) this project actually uses, so its `CLAUDE.md` carries only its own stack.

## How to work here

### Communication

- Direct. Cut preamble. Assume strong stack knowledge. Push back when wrong; useful disagreement beats polite agreement. If uncertain, say so.
- Recommend one option with reason. Tradeoffs only if material.
- Ambiguous *goal*: ask. Ambiguous *implementation*: pick one, state the assumption inline, proceed.
- Mid-task redirect: acknowledge explicitly, restate the new direction in one sentence, continue. No quiet course-correct.
- Default for coding: apply the change, then summarize in 1-3 sentences. 'just do it' = skip the summary. 'walk me through' / 'plan it' = explain or plan first, no edits.
- Single dashes, not em-dashes. Single quotes in prose.

### Planning and execution

- Non-trivial code (new feature, refactor, 3+ files): plan and write tests first - `writing-plans` then `test-driven-development`. Routine requests: apply-then-summarize.
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

Observable gate - the claim words are the trigger. Before you type 'done', 'fixed',
'passing', 'works', or 'ready' about your own change: STOP, satisfy
`verification-before-completion`, and do not emit the claim until the build + relevant
tests have run and you have quoted the output (no new warnings, files formatted). Satisfy
the gate honestly - fix the cause, never game it: no suppressing or downgrading a warning,
disabling or weakening a test, or stubbing code to go green. Report
what changed and what was deliberately not. Cannot run it? Say so, never silently skip.
Partial work: state complete vs not vs why, then ask continue / redirect / stop.

### Security

- Crypto / secret / auth / payment / data-access work: run the built-in `/security-review` on the diff before presenting.
- Never log PII, tokens, passwords, or full payment data.
- Hardcoded secret found: stop, flag, redact in output (`<redacted>`), recommend rotation + git-history removal. Never propagate the value or send it to any tool (memory, context7, web, external service).
- `.env`, `*.pem`, `*.pfx`, `*.key`, and whatever config files your stack keeps secrets in (`<stack secret/config globs>`) are sensitive; the `settings.json` permissions deny-list already blocks reads of most.

### Git and pull requests

- Conventional Commits. Branch `<type>/<short-description>` or `<type>/<ticket-id>`. No AI/assistant attribution in commit messages or branch names (a deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches. Prefer `--force-with-lease` over `--force`.
- Non-trivial git beyond add/commit/push - rebase, cherry-pick, history recovery, conflict resolution - load `git-master`.
- Branch finished and all tests green: `finishing-a-development-branch` walks the close-out - merge / PR / cleanup - so integration is a deliberate choice, not an ad-hoc push.

### Navigation and code reading

- Read only what's needed; before editing, read the body end-to-end and any function it depends on. To *locate* a symbol, its callers, or its resolved type, use `serena` (`find_symbol` / `find_referencing_symbols`) or the per-project `LSP` plugin - serena is the default navigator and owns symbol-level *edits*; an installed `LSP` plugin adds compiler-exact lookups and inline diagnostics for its language.
- Navigate *inline* with serena - do not delegate a symbol / caller / type lookup to `Explore` / `general-purpose` (they fall back to grep). Reserve those agents for genuinely broad multi-file sweeps, not single-symbol lookups.
- Ambiguous reference (e.g. 'the OrderService' with multiple matches): list the matches, ask. Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.

## Skills, plugins, hooks and MCPs

How routing works, and the rules that matter most:

- **The trigger is an artifact, a task shape, or a checkpoint - never a vibe.** Load a skill for the *work* (a file you're about to edit, a command you're about to run, a diff you're about to show), not to answer a question or explain. Over-loading a simple turn is the failure to avoid.
- **Match the mechanism to the job, one home per piece, no duplication.** A deterministic gate at a discrete event → a hook. A keyword-fired capability → the skill's own auto-injected description. Everything else cross-cutting or project-specific → this file. Never state one trigger in two places.
- **Skill descriptions auto-inject.** Route here only what a description does not already make obvious. House-style skills fire on their own keywords; the project's `CLAUDE.md` routes the third-party skills it cannot re-describe.
- **Path-scoped rules** (`.claude/rules/`) carry glob-scoped routing (markdown authoring, per-language repair-loop delegation) - they lazy-load only when matching files are touched; conventions stay with the convention gate, never duplicated into rules.

### Personal (house-style) skills

Inventory only - they auto-inject and fire on their own keywords / file types (the convention
gate enforces the conventions ones), so their triggers are not restated elsewhere. Replace the rows:

| Skill | Governs / fires on |
|---|---|
| `<house-style-skill>` | `<language / file types it governs>` |
| `<framework-skill>` | `<framework area + the file suffixes it owns>` |
| `<testing-skill>` | `<test strategy + per-layer coverage>` |
| `<ticket / utility skill>` | `<what it generates / the keyword that fires it>` |

### Stack hooks

- **Convention gate** - `require-convention-skill.js` (PreToolUse `Edit|Write`): blocks an edit to a convention-governed file type until *every* house-style skill governing it is loaded this session - a file matching several suffixes needs the *union* of their skills. Enforced, not a request - so house-style triggers are *not* restated in routing prose. Opt-in variant keys add scss (`.scss`/`.css` -> `angular-styling`) and xaml (`.xaml` -> `dotnet-wpf`).
- **Protected-branch guard** - `guard-protected-force-push.js` (PreToolUse `Bash`): blocks a force-push to `main`/`master`/`develop`. Deterministic, fires ~never in normal work.
- **Catastrophic-rm guard** - `guard-catastrophic-rm.js` (PreToolUse `Bash`): blocks a recursive `rm` of `/`, `~`, `$HOME`, or a bare `*`. Deterministic, fires ~never in normal work.
- **Whole-file-read guard** - `guard-read-whole-file.js` (PreToolUse `Read`): blocks a whole-file `Read` of a source / template file over 100 lines with no `offset`/`limit` - locate via serena first, then read the range. Targeted reads, small files, and non-source files pass.

All four live in `.claude/hooks/` and are wired into `.claude/settings.json`. Add a new deterministic gate as a hook there, not as prose here.

### Stack agents

The stack's subagents ship in `.claude/agents/` (auto-discovered), each model/effort-pinned in its own frontmatter: a set of cross-cutting agents plus a per-domain team for each of the five stacks (ASP.NET, Angular, WPF, Ionic/mobile, data/SQL). A `CLAUDE_CODE_SUBAGENT_MODEL` env var silently overrides every model pin - leave it unset.

**Cross-cutting** - the four .NET/Angular build/test **repair loops** (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`, `ng-build-error-resolver`, `angular-test-resolver`, sonnet / high; per-language routing ships as `.claude/rules/`, loading only in matching projects): default to delegating a fix-the-build / make-the-tests-pass task to the matching resolver rather than looping in-session - it absorbs the build/test output and returns only a diagnosis. Plus the opus / xhigh **analysis** agents, each a first delegation on its trigger: `task-analyzer` (one feature or bug), `architecture-analyzer` (a cross-module picture), `greenfield-solution-designer` (new project or module - feeds the `project-scaffold` skill), `ci-failure-diagnoser` (red CI), `issue-diagnoser` (a bug of unknown cause - read-only, isolates the root cause to a file and symbol and routes the fix, never fixes it), `cross-stack-contract-designer` (freeze the shared backend / frontend contract before the per-stack designers, on a feature that spans stacks), and `framework-upgrade-planner` (a version or deprecation event -> an ordered upgrade plan).

**Per-domain team** - one triad per stack, same shape: a `<stack>-solution-designer` (opus / xhigh) designs the architecture and test strategy, then decomposes the work into independent parallel contracted tasks; several `<stack>-implementer`s (sonnet / medium) each build one task with its tests inside its contract; a `<stack>-verifier` (sonnet / xhigh) gates the assembled whole against plan and quality, looping a punch-list back until it signs off. The `domain-build` skill runs the vertical from the main session: detect the stack -> designer -> approve the design -> fan out the implementers -> verifier -> loop any punch-list back. Only the main session orchestrates the vertical - its seats never dispatch agents (the one sanctioned exception is the two diagnosers, which each dispatch a cheap read-only `evidence-gatherer` to keep log volume off the opus seat); for a feature that crosses stacks, have `task-analyzer` / `architecture-analyzer` split it by stack first, then run `domain-build` once per slice.

### Other routing

- **Library / SDK / API docs** → `context7` MCP - full rule (when, why, the silent-skip discipline) under *MCP servers* below.
- **Don't know which skill** → say so; skill discovery is a deliberate manual step (skills.sh / the stack repo), not an auto-installed capability.

### Pre-commit and done checkpoints

The `git commit` you're about to run, or the diff you're about to show, is the trigger.
On any non-trivial diff, before committing or presenting: run the formatter, then
`/code-review` (`/simplify` applies its quality findings in place), plus any
language-specific diff gates the project's `CLAUDE.md` names - then satisfy the
Definition-of-done gate above. `security-guidance` plugin hooks
run automatically on edits / Stop / commit; heed their warnings. Skip only for
typos / one-line / formatting-only diffs.

### MCP servers

| Server | Use for |
|---|---|
| `serena` | primary symbol navigator + symbol-level *editor* - `find_symbol` / `find_referencing_symbols` / symbol edits *before* `Read`-ing a whole file to locate a symbol; default over grep and whole-file Read. Runs with `--context claude-code` and `--project-from-cwd`, so it self-activates on launch (finds `.serena/project.yml` in its cwd) - no `activate_project` call needed; the relative `SERENA_HOME` assumes cwd is the project root. For an LSP-backed language, the `LSP` plugin (below) complements it. |
| `context7` | up-to-date library / framework / SDK docs. **Before writing or changing hand-written code against any API you don't own** - any third-party package, vendor SDK, or version-sensitive framework / standard-library surface - resolve + query `context7` first; don't answer library-API questions from recall, even when confident. The rule is the *category*, not a fixed list; skipping it is *silent* (no error), so it's a discipline. Generated code (scaffolds, migrations, codegen) doesn't count. |
| `memory` | *cross-project* recall, distinct from the system-prompt per-project file memory; search when this project's context is thin, store a significant cross-project outcome at task end (decision / gotcha / architecture, + project & date). Its SQLite DB is shared across projects *and* accounts by design (one store under `$HOME`) - that's the lone deliberate exception to the per-project-MCP stance every other server here follows. |
| `playwright` | drive a browser for visual checks / large HTML reports - don't text-read them |
| `<framework>-cli` (framework-gated; `angular-cli` in the Angular baseline) | the framework CLI's own docs / commands - shipped active in the Angular stack, commented out where the project isn't that framework. A framework-specific complement to `context7`, which stays the generic-docs route. |
| Issue-tracker connector (Claude built-in, not stack-wired) | the project's tracker read-write: search, create, update issues - your ticket-authoring skills generate the content, the connector files it (always confirm before filing) |

Two further MCPs ship active in the baseline but are heavy and fail at launch without their
native deps - `chrome-devtools` (browser / extension debug) and `appium-mcp` (native mobile
E2E, needs Xcode / Android SDK + Java); comment them out where the project isn't a browser /
mobile target. Name any other MCP the project adds under `## Per-project additions`.

Adjacent but not an MCP: the **`LSP` tool** is fed by the per-language LSP pair - `csharp-lsp`
(C#), `typescript-lsp` (TS / JS) - enable whichever match the project's language(s). An LSP gives
compiler-accurate intelligence: inline diagnostics on edit and, where supported, read-only
navigation (go-to-definition, find-references, resolved types, call-hierarchy). It **complements**
serena and does **not** edit; serena stays the default navigator, symbol-level editor, and memory.
The other shipped plugins are language-agnostic (`superpowers`, `claude-md-management`,
`security-guidance`, `frontend-design`, `claude-hud`, `ponytail`) and apply regardless of language.

Name the enabled plugin(s) under `## Per-project additions`.

### Token efficiency and auto-inject

- Skills that fire on their own keywords - the `superpowers` set and `using-superpowers`, beyond the few this file front-loads deliberately (`writing-plans`, `test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`) - and operator-invoked commands (`/code-review`, `/security-review`, `loop`, `schedule`, `run`) are not re-routed here.

## Per-project additions

A project's `CLAUDE.md` is this base plus a project-specific top. Add, in roughly this
order, keeping each section lean (the system prompt and skill descriptions carry the rest):

1. **What this project is** - one paragraph: domain, shape (binary / service / library), persistence, surfaces.
2. **Stack** - languages, frameworks, key libraries, test stack + coverage gate, plus the LSP language-server plugin for the primary language(s) (`csharp-lsp`, `typescript-lsp`) so compiler-exact navigation + diagnostics resolve for the right language.
3. **Commands** - copy-pasteable build / test / run / migrate / publish, with any environment quirks.
4. **Architecture** - layers / modules, dependency rules, folder organization.
5. **Key patterns** - the non-obvious in-house patterns a newcomer would trip on.
6. **Code conventions** - the house-style skill for each file type; wire its `PreToolUse` convention gate in `.claude/settings.json` (the stack convention hook above enforces it).
7. **Testing approach** - per-layer strategy, what's excluded, the integration / regression net.
8. **Load by artifact** - a table mapping this repo's concrete files / types / constructs to the third-party skills it can't re-describe (house-style skills self-fire, so they're not in it).
9. **Operational notes** - runtime constraints and gotchas that shape code decisions.
10. **Cross-cutting checklists** - for each change that must move several files in lockstep, the full touch-point list.
