# CLAUDE.template.md restructure audit

Audit of `claude/CLAUDE.template.md` - the stack-neutral base seeded verbatim into every consuming
project's `CLAUDE.md` (`claude/claude-stack.sh:592-602` `seed_claude_md`, `claude/claude-stack.ps1:659-669`)
and therefore resident in every session of every consuming project. Scope: Claude stack only.
Method: token-count with a real tokenizer, classify every section and bullet against the verified
Claude Code loading mechanisms, adversarially stress every proposed removal, then rank by
tokens-saved / silent-behavior-loss. Measured 2026-07-12 at commit `0dd1eb9`.

## 1. Summary

**Recommendation: rewrite the template in place to the 148-line / 2,668-token version in section 7 -
a 50.2% cut (5,362 -> 2,668 tokens, o200k_base) - plus two ~3-line additions to `claude/README.md`.
Do NOT migrate content into new rules, skills, or hooks: none are needed.** The pure audit cut is
57.6% (2,269 tokens); the operator then added three behavior blocks post-audit (+399 tokens - see
the note in section 7), landing at 50.2%.

The hypothesis ('the template carries content that need not be resident') is confirmed, but the fix
is not re-homing - it is deleting duplicates and rationale:

- **~96% of the cut is rewrite + dedup.** The bulk of the removable text is already duplicated in a
  lazy home that exists today: the 37 agents' auto-injected frontmatter descriptions, the superpowers
  plugin skills' auto-injected descriptions, the 8 path-scoped rules in `claude/rules/`, the 3 hooks'
  own block messages, and the orchestration skills' bodies. Deleting the template's copy loses nothing.
- **~4% is genuine re-homing**, all of it to `claude/README.md` (repo-side install/env mechanics that
  the model never acts on per-turn). No new files ship to consuming projects.
- **Installer impact: zero mandatory edits.** The template is fetched from GitHub `main` at install;
  committing the slim version ships it. No `HOOKS` / `CLAUDE_RULES` / `SKILLS` manifest changes in
  either `claude-stack.sh` or `claude-stack.ps1`.

Context for urgency: official guidance targets 'under 200 lines per CLAUDE.md' (docs: memory.md,
costs.md). The template alone is 198 lines *before* a project adds its `## Per-project additions` top,
so every filled project starts over the cap.

Savings split: rationale/duplication trimming inside sections that stay ~1,100 tokens; deletion of
text whose lazy home already exists ~1,800 tokens; DOC moves ~200 tokens.

## 2. Mechanism model - verified

Every verdict below leans on these, so they were verified first (official docs via the
claude-code-guide agent; repo files for the payload facts). Corrections to the working premise are
bolded.

| Claim | Verdict |
|---|---|
| `CLAUDE.md` always resident, every main session | CONFIRMED (memory.md) |
| `CLAUDE.md` injected into every subagent | **UNVERIFIABLE from official docs; empirically CONFIRMED for `general-purpose` subagents** (claude CLI 2.1.207, scratch-project probe 2026-07-12: a subagent instructed to use no tools still listed markers planted in both `CLAUDE.md` and a path-less `.claude/rules/` file, source-attributed - so both are context-injected into dispatched subagents). Built-in Explore/Plan remain the documented exception. The cut is therefore worth more than the main-session-only cost model assumed. |
| Skill `description` auto-injects; body loads on trigger | CONFIRMED (skills.md) |
| `disable-model-invocation: true` = zero passive cost, `/`-only | CONFIRMED (skills.md): the description is removed from context entirely. **Consequence: `CLAUDE.md` is the only resident home for the 5 orchestration skills' existence - a one-line pointer must stay.** |
| Rules with `paths:` lazy-load on a matching file touch | CONFIRMED (memory.md). **Rules trigger on file reads, never on Bash commands. A rule without `paths:` loads at launch with the same priority as CLAUDE.md - a path-less rule saves nothing.** |
| Hooks cost zero context until they fire | CONFIRMED (hooks.md). **PreToolUse stdout is not model-visible; only a deny (exit 2) reaches the model. A hook can enforce at a command but cannot pre-inform - command-triggered guidance has no lazy delivery mechanism.** |
| `permissions.deny` `Read(...)` also blocks `cat`/`head`/`tail`/`sed` | CONFIRMED (permissions.md) - but not arbitrary subprocesses, exactly as template line 65 states. |

Payload facts grounding the dedup verdicts:

- 59 skills in `skills/`; exactly 5 carry `disable-model-invocation: true` (`main-stack-agents-flow`,
  `cross-stack-agents-flow`, `project-scaffold`, `project-quality-loop`, `architecture-quality-loop`).
- 37 agents in `claude/agents/`, every one with `name`/`description`/`tools`/`model`/`effort`
  frontmatter; the descriptions are auto-listed to the model each session and each carries its own
  'use when / do NOT use' routing plus dispatch preconditions ('Do NOT use without a task + contract').
- 8 rules in `claude/rules/`, all `paths:`-scoped: 6 convention routers plus 2 repair-loop routers
  (`dotnet-repair-agents.md`, `angular-repair-agents.md`) that already carry the
  delegate-don't-loop-in-session discipline and the resolver contracts.
- 3 wired hooks; each block message cites CLAUDE.md and teaches the recovery path
  (e.g. `guard-read-whole-file.js`: 'locate first with serena: get_symbols_overview then find_symbol').
- The serena hand-off protocol (`<feature>__<contract_version>__<seat>`) lives in
  `skills/main-stack-agents-flow/SKILL.md` (memory-hygiene section) and in 33 of 37 agent bodies.
- `claude/claude-stack.html` is hand-authored but CI-validated by `scripts/lint-skills.js`
  (parses its `const personal` data and checks parity against `skills/` and all four installer
  manifests; `.github/workflows/lint.yml` runs it on every push). Working tree clean at audit time -
  **treat the HTML as authoritative, not stale.**

## 3. Measurement

Tokenizer: tiktoken `o200k_base` (Claude's tokenizer differs slightly; relative shares hold).
Directive vs rationale measured line-by-line: each line classed directive / rationale / mixed
(mixed splits 50/50). 'Rationale' = text that changes no decision: justifications, parentheticals,
restatements of Claude Code mechanics, background.

| Section | Tokens | % of file | Directive:Rationale |
|---|---|---|---|
| Preamble (H1 + intro + fill block) | 413 | 7.7% | 68:32 |
| Communication | 155 | 2.9% | 100:0 |
| Planning and execution | 131 | 2.4% | 83:17 |
| Code quality | 73 | 1.4% | 100:0 |
| Definition of done | 158 | 2.9% | 88:12 |
| Security | 197 | 3.7% | 74:26 |
| Git and pull requests | 272 | 5.1% | 60:40 |
| Navigation and code reading | 203 | 3.8% | 63:37 |
| Skills/plugins/hooks/MCPs intro | 276 | 5.1% | 50:50 |
| Personal (house-style) skills | 38 | 0.7% | 100:0 |
| Stack hooks | 80 | 1.5% | 54:46 |
| **Stack agents** | **1,281** | **23.9%** | **12:88** |
| Pre-commit and done checkpoints | 129 | 2.4% | 88:12 |
| **MCP servers** | **1,003** | **18.7%** | **49:51** |
| Related projects | 557 | 10.4% | 63:37 |
| Per-project additions | 390 | 7.3% | 88:12 |
| **Total** | **5,362** | 100% | **54:46** |

The rationale share is large (46%) and concentrated: `Stack agents` is 88% rationale/duplication,
and together with `MCP servers` those two sections are 2,284 tokens - 43% of the file.

## 4. Decision table

One verdict per section; per-line dispositions (every deleted line with its justification) in
section 10.

| Section | Tokens | D:R | Verdict | Destination | Trigger | Failure mode if absent | Keep or move |
|---|---|---|---|---|---|---|---|
| Preamble | 413 | 68:32 | REWRITE | stays (fill-time block, self-deleting) | template instantiation | mis-filled template; silent | keep, compress |
| Communication | 155 | 100:0 | ALWAYS | stays, expanded by the post-audit additions (section 7 note) | none observable | tone/format drift; silent | keep |
| Planning and execution | 131 | 83:17 | REWRITE | stays; skill-name references deleted | task shape | thresholds lost; silent | keep, compress |
| Code quality | 73 | 100:0 | ALWAYS | stays, one clause trimmed | none observable | quality drift; silent | keep |
| Definition of done | 158 | 88:12 | REWRITE | stays; skill-mechanics restatement deleted | claim words 'done/fixed/passing/works/ready' | reward-hacking clause has no other home | keep, compress |
| Security | 197 | 74:26 | **ALWAYS** | stays; only deny-list mechanics compress | none observable (bullets 1-3) | secret logged/echoed on a Bash-only turn; silent | keep (premise wrong) |
| Git and pull requests | 272 | 60:40 | **ALWAYS** | stays compressed; hook/skill restatements deleted | `git commit`/`git push` - but no lazy mechanism can pre-inform | attribution/auto-push before any gate can fire; silent | keep (premise wrong) |
| Navigation and code reading | 203 | 63:37 | REWRITE | stays; absorbs the LSP paragraph | symbol lookup | delegate-inline half is prose-only (hook covers Read half only) | keep, compress |
| Skills intro | 276 | 50:50 | REWRITE | stays as 4 bullets | skill/agent invocation | over-loading, self-dispatch; silent | keep, compress |
| Personal (house-style) skills | 38 | 100:0 | DELETE | `## Per-project additions` item 6 (already the home) | - | none - pure duplicate | delete |
| Stack hooks | 80 | 54:46 | REWRITE | one clause in skills intro | hook fires | none - hooks fire and self-announce regardless | fold in |
| Stack agents | 1,281 | 12:88 | **DELETE ~90%** | agent descriptions (roster), skill bodies (flows), rules (repair loops), `claude/README.md` (env var) | `@agent-` mention / orchestration skill | self-dispatch - mitigated by the kept policy bullet + each description's own preconditions | keep 2 bullets, delete rest |
| Pre-commit checkpoints | 129 | 88:12 | ALWAYS | stays compressed; plugin-behavior sentence deleted | commit / diff presentation - no lazy mechanism | gates skipped; silent | keep, compress |
| MCP servers | 1,003 | 49:51 | REWRITE ~65% | table stays; protocol -> skill+agent bodies; install mechanics -> `claude/README.md`; LSP -> Navigation | tool choice | context7/memory disciplines fail silently -> their directives stay | keep, compress |
| Related projects | 557 | 63:37 | REWRITE in place | stays: schema + 2 bullets | none observable (awareness must pre-exist) | cross-repo blindness; silent | keep (premise partially wrong) |
| Per-project additions | 390 | 88:12 | REWRITE (light) | stays (fill-time scaffolding) | template instantiation | mis-structured project top; silent | keep, trim |

### Ranked moves - the line sits after #8

| # | Move | Tokens saved | Risk of silent behavior loss |
|---|---|---|---|
| 1 | Stack agents dedup vs agent descriptions + skill bodies | ~1,170 | LOW - every surviving home verified (section 10) |
| 2 | MCP mechanics dedup + the two README DOC moves | ~670 | LOW-MED |
| 3 | Related projects in-place compression | ~300 | LOW - schema and pointer stay |
| 4 | Skills-intro + Stack-hooks + Personal-skills compression | ~280 | LOW |
| 5 | Preamble compression | ~180 | LOW - fill-time only |
| 6 | Git compression (every before-command directive stays) | ~120 | LOW-MED |
| 7 | Definition-of-done compression (claim-words + no-gaming stay) | ~65 | MED |
| 8 | Security bullet-4 mechanics compression | ~55 | LOW |
| - | **the line** | | |
| 9 | Delete the 'keep it simple' bullet (ponytail duplicate) | ~20 | MED - dies silently in a project that trims ponytail from `PLUGINS` -> kept, trimmed |
| 10 | Commit-format / attribution enforcement hook | 0 resident | enforcement-only value; adds 2-installer + HTML + lint surface -> optional follow-up, not this change |

## 5. Where the premise is wrong

Sections proposed for moving that must not move:

1. **Security stays resident.** A `paths:`-scoped rule loads on file reads only (confirmed) - a
   Bash-only turn (`cat`, `curl`, `env`, a build script) would carry zero security guidance, and that
   is exactly the window where a secret gets echoed or logged. The installer's `permissions.deny`
   (`claude-stack.sh:423-430`) covers `Read` + recognized file commands on six globs only - not
   `python -c "open(...)"`, not log statements, not propagation into a tool call. Bullets 1-3 have no
   observable pre-trigger and silent failure modes -> ALWAYS. Only bullet 4's restatement of the
   deny-list mechanics compresses (~55 tokens): enforcement is the settings' job, and the deny block
   message self-announces when it fires.
2. **Git stays resident.** `git commit` is not a reliable lazy trigger: rules cannot fire on commands,
   and PreToolUse stdout is not model-visible (only a deny message is) - so a hook can block a bad
   commit but cannot deliver the guidance the model needs *before composing the command* ('never push
   without an explicit ask', 'no AI attribution', Conventional Commits). Compression only (~120
   tokens). An enforcement hook for attribution/format is feasible (same pattern as
   `guard-protected-force-push.js`) but saves zero resident tokens - the prose must stay to prevent
   first-try bounces - so it is ranked below the line as optional hardening.
3. **Related projects shrinks in place; it does not move.** The template's own argument is sound and
   now mechanism-verified: no lazy mechanism can create sibling awareness (rules key on this-repo file
   paths; skills key on keywords the model won't emit about a repo it doesn't know exists). The
   always-loaded pointer is the feature. What compresses is the authoring guidance around the schema
   (~300 tokens): the yaml fields are self-describing, and the memory-split explanation duplicates the
   `memory` MCP row.
4. **One place the template over-serves a correct premise:** the 5 orchestration skills are genuinely
   invisible to the model (`disable-model-invocation` removes their descriptions from context -
   confirmed), so a resident pointer is mandatory - but it needs ~40 tokens, not the current
   ~250-token mechanics lecture about how the flag works.

Also flagged: the 'every subagent context' half of the cost premise is unverifiable from official
docs (built-in Explore/Plan skip CLAUDE.md; custom-agent injection undocumented). Main-session
residency alone justifies the cut, so nothing in this audit depends on it.

## 6. New file map

**No new rules, no new skills, no new hooks.** Two existing-file additions:

| File | Change | Content moved in | Installer edits |
|---|---|---|---|
| `docs/CLAUDE-TEMPLATE-AUDIT.md` | new (this document) | the audit | none - repo doc, not installed |
| `claude/README.md` | +~6 lines in the install notes | (a) `CLAUDE_CODE_SUBAGENT_MODEL` silently overrides every agent model pin - leave it unset (from template line 102); (b) the generated `settings.json` carries an `enabledMcpjsonServers` allow-list naming exactly the registered servers, never `enableAllProjectMcpServers`; `chrome-devtools` / `appium-mcp` fail at launch without their native deps (from template lines 133-139) | none - README is repo-side only |

Installer integrity check for the whole migration: `seed_claude_md` (`claude-stack.sh:592-602`) and
`New-ClaudeMd` (`claude-stack.ps1:659-669`) fetch `claude/CLAUDE.template.md` verbatim from GitHub
`main` - the slim template ships automatically once committed, both platforms, no script edits.
`scripts/lint-skills.js` validates backticked skill tokens inside `CLAUDE.template.md` (check 6), so
the rewrite keeps only real skill names; `npm run lint` runs after every migration step.

## 7. The proposed slim template, in full

Measured: **2,668 tokens / 148 lines** (o200k_base) vs the current 5,362 / 198.

### Post-audit additions (operator-requested)

Three behavior blocks were requested after the audit baseline - net-new content, not audit
findings; the numbers above include them (+399 tokens over the pure-audit 2,269 draft).
Classification: ALWAYS - a proposal or a conversational reply is not an artifact a rule or skill
can trigger on, and the failure mode (sycophancy, fluff, name leakage) is silent - so the resident
template is the only possible home. Disposition of every requested line:

- 'Direct / no filler openers / just answer' + 'casual but professional / don't over-explain' - merged into Communication bullet 1 (deduped against the existing 'Direct. Cut preamble. Assume strong stack knowledge').
- 'Concise by default / clear structure, no walls of text' + 'overridable on explicit ask for depth' - Communication bullet 2.
- 'Recommendation first, then why / never open with it depends / tradeoffs only if material' - Communication bullet 3 (replaces 'Recommend one option with reason', same rule strengthened).
- 'Grounded in facts / label confidence / verify anything current before asserting' - Communication bullet 4 (the tool route for library APIs stays in the `context7` row; this is the general discipline).
- 'Silently correct language mistakes' + 'analogies only for non-technical or abstract ideas' - Communication bullet 8.
- 'Never use or mention the personal name in responses or skill output' - Communication bullet 9.
- 'No em dashes / single quotes' - already present (last Communication bullet); kept once, not duplicated.
- The whole 'How to evaluate my ideas' block - the new `### Evaluating proposals` section; all nine rules preserved in compressed house voice, including the exemption for lookups / syntax / factual / casual turns.

````markdown
# CLAUDE.md (stack-neutral template)

> **Fill-in block - delete once done.** Copy this file into a new project as `CLAUDE.md`, then:
> replace every `<placeholder>` with what the project actually has (inspect first: `.claude/skills/`,
> `.mcp.json`, `claude plugin list`); trim every inventory to the stack(s) this project uses; delete
> any section that does not apply; add the project top per `## Per-project additions`. This file
> auto-injects every session - keep it lean: add only what the system prompt and the skills'
> auto-injected descriptions do not surface, route work by an observable trigger (an artifact, a
> command, a checkpoint), and give every rule exactly one home - a deterministic gate is a hook, a
> per-file-type pointer is a path-scoped rule, a keyword capability is the skill's own description.

## How to work here

### Communication

- Direct. Cut preamble and filler openers - just answer. Casual but professional: assume strong stack knowledge, don't over-explain. Push back when wrong; useful disagreement beats polite agreement.
- Concise by default; a longer answer needs clear structure, never a wall of text. An explicit ask for more depth overrides.
- Recommendation first, then why - never open with 'it depends'. Tradeoffs only if material.
- Grounded in facts: if uncertain, say so and label confidence. Anything current (versions, prices, tools, market data): verify before asserting.
- Ambiguous *goal*: ask. Ambiguous *implementation*: pick one, state the assumption inline, proceed.
- Mid-task redirect: acknowledge explicitly, restate the new direction in one sentence, continue. No quiet course-correct.
- Default for coding: apply the change, then summarize in 1-3 sentences. 'just do it' = skip the summary. 'walk me through' / 'plan it' = explain or plan first, no edits.
- The user's language mistakes: silently use the correct phrasing, never point them out. Analogies only for non-technical or abstract ideas.
- Never use or mention the user's personal name in responses or any skill output unless the user or an instruction explicitly says so.
- Single dashes, not em-dashes. Single quotes in prose.

### Evaluating proposals

When the user proposes a design, architecture, plan, or decision (technical, product, business, or
career), act as an adversarial reviewer - validate or kill the idea, don't cheer it. Lookups,
syntax, factual questions, and casual conversation are exempt: just answer.

- Lead with the strongest objection. Rank each one: BLOCKER (fails if shipped), MATERIAL (real cost, needs a decision), MINOR (mention only if nothing bigger exists).
- Objections are concrete - failure mode, trigger condition, cost. 'May not scale' is noise. Never manufacture criticism to look rigorous.
- Sound idea: say so in one line with the reason it beats the alternatives - then attack its weakest assumption anyway. Name what would have to be true for it to work, and the cheapest test of that.
- Rejecting an approach: name what you'd do instead and the tradeoff you're accepting.
- Ambiguous proposal: ask one clarifying question before critiquing.
- Don't soften because the user sounds confident, invested, or already started - sunk cost is not an argument. Push-back without new facts: restate the objection; change position only on evidence.
- No praise for effort or ambition. Praise a specific decision only when it beats the obvious alternative - one sentence, move on.

### Planning and execution

- Non-trivial code (new feature, refactor, 3+ files): plan and write tests first. Routine requests: apply-then-summarize.
- Mid-size mechanical change (rename touching 10+ files): confirm the scope list, skip the full plan.
- Skip planning for typos, one-line fixes, formatting, dep bumps, single-file rename.
- Code fails: read the full error and quote the relevant part before fixing.
- Inherited code: codebase conventions win over these rules unless broken or unsafe.

### Code quality

- No dead code, commented-out blocks, or `TODO` without a ticket ref.
- Unit tests for new code; integration tests for DB / external service.
- Keep it simple: no speculative abstractions; touch only what the task requires.
- Inline comments explain *why*, not *what*.

### Definition of done

Before typing 'done', 'fixed', 'passing', 'works', or 'ready' about your own change: STOP and
satisfy `verification-before-completion` - build + relevant tests run, output quoted. Satisfy the
gate honestly - fix the cause, never suppress a warning, weaken a test, or stub code to go green.
Report what changed and what deliberately did not. Cannot run it? Say so, never silently skip.
Partial work: state complete vs not vs why, then ask continue / redirect / stop.

### Security

- Crypto / secret / auth / payment / data-access work: run `/security-review` on the diff before presenting.
- Never log PII, tokens, passwords, or full payment data.
- Hardcoded secret found: stop, flag, redact as `<redacted>`, recommend rotation + git-history removal. Never propagate the value into any tool.
- `permissions.deny` blocks reading secret files (`.env*`, key/cert globs; add `<stack secret/config globs>`) but not arbitrary subprocesses - never read or echo a secret's value by any route.

### Git and pull requests

- Conventional Commits. Branch `<type>/<short-description>` or `<type>/<ticket-id>`.
- Show the diff and let the user review; commit only on their go, never automatically, and never push without an explicit ask.
- Never mention yourself: no AI/assistant attribution in commits, branches, or PR text (deliberate override of the platform default).
- One logical change per PR, under 400 LOC. Body: what / why / how to test. Link the ticket; screenshots if UI.
- Squash or rebase, no merge commits on feature branches; prefer `--force-with-lease`. Non-trivial git (rebase, cherry-pick, recovery): know the undo before you run it.

### Navigation and code reading

- Read only what's needed; before editing, read the body end-to-end and any function it depends on.
- Locate symbols, callers, and resolved types with `serena` - inline, never delegated to `Explore` / `general-purpose`; reserve those for genuinely broad multi-file sweeps. An installed `LSP` plugin adds compiler-exact lookups and inline diagnostics for its language.
- Ambiguous reference with multiple matches: list the matches, ask. Do not guess.
- Pasted code in chat is illustrative unless stated otherwise; confirm the target file before editing.

## Skills, agents, hooks and MCPs

- Load a skill for the work at hand - a file you're about to edit, a command you're about to run, a diff you're about to show - never to answer a question. Over-loading a simple turn is the failure to avoid.
- One home per rule: route here only what an auto-injected description does not already cover. Path-scoped rules (`.claude/rules/`) own per-file-type routing; hooks (`.claude/hooks/`) own deterministic gates and announce their own blocks - add a new gate as a hook, not prose.
- Subagent dispatch is explicit, never automatic: a user `@agent-<name>` mention, or an orchestration skill routing to it. Never self-delegate off a description match; the descriptions say when each agent applies, for the explicit paths to use.
- The orchestration skills are slash-invoked only and invisible to you until run (`disable-model-invocation`): `/main-stack-agents-flow` (one stack's design -> build -> verify vertical), `/cross-stack-agents-flow` (routes multi-stack work, freezes the shared contract; home of the shared subagent policies), `/project-scaffold`, `/project-quality-loop`, `/architecture-quality-loop`. Suggest the matching one when the task calls for multi-agent work.

### Pre-commit checkpoint

On any non-trivial diff, before committing or presenting: run the formatter, then `/code-review`
(`/simplify` applies its quality findings in place), plus any diff gates named under
`## Per-project additions` - then satisfy the Definition-of-done gate. Skip for typos /
one-line / formatting-only diffs.

### MCP servers

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
````

## 8. Migration order

Each step is one commit, independently revertible, verified by `npm run lint` + a token recount.

1. **This audit doc lands** (done). Verify: lint green (docs/ is outside lint's scan set; the run
   confirms no repo-wide regression), user review of the audit.
2. **`claude/README.md` additions** (the two DOC moves from section 6). Land these *before* the
   template lines they absorb are deleted. Verify: lint; both notes present.
3. **Dedup deletions in `CLAUDE.template.md`**: the Stack agents bulk (lines 102, 106 mechanics, 108,
   110), line 73's force-push-guard restatement, line 74, lines 92-94, lines 118-119, lines 133-139,
   lines 141-149, the serena-row protocol detail. Verify: lint; for each deletion, the surviving home
   in section 10 exists at the cited path.
4. **Rewrite-for-density of the staying sections** (order: Preamble, Git, Related projects, MCP table,
   Definition of done, Planning, Skills intro) **plus the post-audit additions** (Communication
   expansion + `### Evaluating proposals`, per the section 7 note). Verify per commit: lint + token
   recount + a manual check that every ALWAYS directive in section 4's table survives verbatim or
   equivalent.
5. **Final**: token recount vs the 2,668 target, line count under 200 with headroom, `npm run lint`,
   `git diff --stat`.

Rollback: any single commit reverts cleanly; the only ordering constraint is step 2 before step 3.

## 9. Anti-duplication check - single homes after migration

- Force-push / catastrophic-rm / whole-file-read guards -> the hooks' own block messages only.
- Repair-loop delegation -> `claude/rules/dotnet-repair-agents.md` + `claude/rules/angular-repair-agents.md` only.
- Per-file-type conventions -> the 6 convention rules only (template item 6 names the mechanism once).
- Agent when-to-use -> the 37 agent descriptions only; the explicit-dispatch *policy* -> template, once.
- Orchestration flows -> the 5 skill bodies; their existence pointer -> template, once (mandatory: `disable-model-invocation` hides their descriptions).
- serena hand-off protocol -> `skills/main-stack-agents-flow/SKILL.md` + the agent bodies; the template keeps one clause that the bus exists.
- memory-vs-serena split -> the `memory` MCP row, once; Related projects touches it in one clause (structure lives here, dynamic findings there). This is the one deliberate two-touch: the row answers 'when do I use the tool', the section answers 'where does sibling structure live'.
- Install / env mechanics -> `claude/README.md` only.

Duplication defects in the *current* template (it violates its own line 88, 'never state one trigger
in two places') - all resolved by the slim version:

1. Force-push guard: line 73 restates it; line 98 says hook behavior is never restated.
2. serena-first navigation: lines 78-79 and the serena MCP row (line 126).
3. memory-vs-CLAUDE.md split: the memory row (line 128) and Related projects (lines 155-157, 176-177).
4. `finishing-a-development-branch`: line 74 duplicates the plugin skill's auto-injected description.
5. Repair-loop delegation: line 108 duplicates the two repair-agent rules.
6. Rules mechanics: line 90 and line 193 (item 6).
7. Plan / TDD / debugging routing: lines 36 and 39 duplicate the superpowers descriptions
   (`writing-plans`, `test-driven-development`, `systematic-debugging`).

## 10. Line-by-line disposition - every deleted line and its justification

Line numbers refer to `claude/CLAUDE.template.md` at commit `0dd1eb9`.

### Preamble (1-21)

| Lines | Content | Disposition |
|---|---|---|
| 1 | H1 | kept |
| 3-10 | intro paragraph | REWRITE: the fill directive and the lean/trigger/one-home policy merge into the fill block. Deleted sentences: 'It is the language- and framework-neutral skeleton... left blank for you to complete' (self-description, changes no decision); 'the system prompt and the skills' own auto-injected descriptions already cover a lot' (kept in compressed form); 'Project specifics go under...' (kept as 'add the project top per...'). |
| 12-21 | fill blockquote | REWRITE: compressed to one block; the three per-inventory investigation bullets become one parenthetical ('.claude/skills/', '.mcp.json', 'claude plugin list'); 'Leave no placeholder behind; delete any section that does not apply' kept; added 'delete once done' so the block stops costing tokens after instantiation. |

### How to work here (23-81)

| Lines | Content | Disposition |
|---|---|---|
| 25-32 | Communication | kept, expanded by the post-audit additions (section 7 note) |
| 36 | 'plan and write tests first - `writing-plans` then `test-driven-development`' | skill names DELETED: both superpowers descriptions auto-inject and self-fire on exactly this trigger ('Use when you have a spec or requirements for a multi-step task', 'Use when implementing any feature or bugfix'). The house threshold (3+ files) stays. |
| 37-38 | mechanical-change + skip-planning thresholds | kept verbatim |
| 39 | 'read the full error, quote the relevant part, reproduce if ambiguous. No shotgun debugging' | 'reproduce if ambiguous. No shotgun debugging' DELETED: the superpowers `systematic-debugging` description self-fires ('Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes') and its body carries the method. The cheap read-and-quote discipline stays. |
| 40 | inherited-code precedence | kept verbatim |
| 44-45, 47 | dead code / tests / comments | kept verbatim |
| 46 | 'Keep it simple. No speculative abstractions, no error handling for impossible cases.' | 'no error handling for impossible cases' DELETED: the ponytail plugin (baseline `PLUGINS`) injects its full minimalism ruleset every session. The umbrella clause stays as insurance for projects that trim ponytail (ranked move #9, kept). |
| 51-54 | DoD trigger + evidence mechanics | REWRITE: claim-words trigger stays; 'do not emit the claim until the build + relevant tests have run and you have quoted the output' compresses to 'build + relevant tests run, output quoted' - the method lives in `verification-before-completion`'s body. '(no new warnings, files formatted)' DELETED: 'never suppress a warning' (kept) covers the first; the Pre-commit checkpoint's 'run the formatter' covers the second. |
| 55-56 | 'never game it: no suppressing or downgrading a warning, disabling or weakening a test, or stubbing code to go green' | KEPT (compressed). Verified: the `verification-before-completion` body covers honesty but NOT these concrete reward-hacking modes - no other home exists. |
| 56-58 | report-what-changed, cannot-run, partial-work | kept, lightly compressed |
| 62-64 | security bullets 1-3 | kept; line 64's tool enumeration '(memory, context7, web, external service)' compressed to 'into any tool' |
| 65 | deny-list mechanics | REWRITE: 'are hard-blocked from the Read tool (and cat/head/tail/sed) by the permissions.deny the stack installer writes into settings.json' DELETED - enforcement is the settings' job and the deny self-announces on trigger; the glob enumeration compresses; the placeholder and the subprocess caveat ('never read or echo a secret's value regardless') STAY - the caveat is the one directive enforcement cannot cover. |
| 69 | Conventional Commits + branch | kept verbatim |
| 70 | review-before-commit, never auto-push, no attribution | kept, split into two bullets; '(a deliberate override of the platform default)' KEPT - load-bearing against the platform's own attribution default. |
| 71 | PR shape | 'never a change-statistics dump (file count, lines added/removed); that noise is generated, not decision-relevant' DELETED - rationale; the positive spec (what / why / how to test) already excludes it. |
| 72-73 | squash/rebase, force-with-lease, non-trivial git | merged into one bullet; 'the protected-branch force-push guard still applies' DELETED - hook self-announces (defect #1 in section 9); 'work reversibly (know the undo before you run it)' KEPT. |
| 74 | `finishing-a-development-branch` close-out | DELETED - the plugin skill's description self-fires on exactly this trigger ('Use when implementation is complete, all tests pass, and you need to decide how to integrate'). Defect #4. |
| 78-79 | serena/LSP navigation + no-delegation | REWRITE: merged with the LSP paragraph (141-147); '(they fall back to grep)' DELETED - rationale. The delegate-inline discipline stays (the whole-file-read hook covers only the Read half). |
| 80-81 | ambiguous ref, pasted code | kept verbatim |

### Skills, plugins, hooks and MCPs (83-149)

| Lines | Content | Disposition |
|---|---|---|
| 85 | 'How routing works, and the rules that matter most:' | DELETED - scaffolding prose |
| 87 | trigger-is-artifact | kept, compressed; 'Over-loading a simple turn is the failure to avoid' KEPT - it is the anti-trigger, not rationale |
| 88 | match-mechanism / one-home | kept, compressed into bullet 2 |
| 89 | 'Skill descriptions auto-inject... House-style skills fire on their own keywords' | REWRITE: compressed into 'route here only what an auto-injected description does not already cover'; the third-party-vs-house distinction survives in Per-project item 8's parenthetical (its single home). |
| 90 | path-scoped rules mechanics ('lazy-load only when a matching file is touched, so they cost nothing') | DELETED - runtime mechanics the model doesn't act on; the pointer 'path-scoped rules own per-file-type routing' stays in bullet 2. Defect #6. |
| 92-94 | Personal (house-style) skills section | DELETED whole - it only points at Per-project item 6, which is the actual home. |
| 96-98 | Stack hooks section | REWRITE to one clause in bullet 2 ('hooks own deterministic gates and announce their own blocks - add a new gate as a hook, not prose'). The three-guard enumeration DELETED - hooks fire and self-explain regardless of the model knowing the roster. |
| 102 | Stack agents intro: roster shape + `CLAUDE_CODE_SUBAGENT_MODEL` | DELETED: the roster is auto-injected per session (37 agent descriptions) and inventoried in `claude/claude-stack.html` + `claude/README.md`; the env-var warning moves to `claude/README.md` (DOC - an operator concern, not per-turn guidance). |
| 104 | invocation-is-explicit policy + justification | REWRITE: the policy stays as bullet 3 (~40 tokens); the justification lecture ('Claude Code has no per-agent flag to disable auto-delegation; this rule is the lever...', ''A first delegation on its trigger' below means...') DELETED - rationale explaining why the rule works. |
| 106 | `disable-model-invocation` mechanics + skill list + Cursor aside | REWRITE to bullet 4: the five `/`-commands with one-clause roles STAY (mandatory - the flag hides their descriptions, this is their only resident home); the flag mechanics, the nested-invocation explanation, and '(This is Claude-only; Cursor ignores the flag...)' DELETED - mechanics/off-platform asides; the nested-dispatch policy lives in the orchestration skill bodies (`cross-stack-agents-flow` is 'the home of the shared subagent policies' per its own body). |
| 108 | cross-cutting agent inventory (repair loops, 8 opus analysis agents with role parentheticals, 2 sonnet support seats) | DELETED whole: repair-loop routing lives in `claude/rules/dotnet-repair-agents.md` + `angular-repair-agents.md` (defect #5); every agent's role, trigger, and do-not-use routing lives in its auto-injected description (verified for all 37); `docs/architecture/` + `docs/CODE-STYLE.md` ownership lives in the `architecture-analyzer` / `style-analyzer` descriptions. |
| 110 | per-domain triad + full orchestration narrative | DELETED whole: the vertical's flow is the body of `main-stack-agents-flow`; mode selection, contract freeze, `integration-reviewer` gating, and the shared policies are the body of `cross-stack-agents-flow`; the seat roles are the agent descriptions. Bullet 4 keeps the one-clause entry points. |
| 114-117, 120 | pre-commit checkpoint | kept, compressed; 'language-specific diff gates the project's CLAUDE.md names' -> 'named under `## Per-project additions`' |
| 118-119 | '`security-guidance` plugin hooks run automatically on edits / Stop / commit; heed their warnings' | DELETED - plugin behavior statement; the hooks fire and present their warnings unprompted. |
| 126 | serena row | REWRITE ~75% smaller. Kept: navigator/editor default, locate-before-Read, 'self-activates (never call `activate_project`)' (prevents a wasted call), one clause that `.serena/memories/` is the agent-flow hand-off store. DELETED: `--context claude-code` / `--project-from-cwd` / `SERENA_HOME` launch mechanics (config, not per-turn decisions); the hand-off naming protocol `<feature>__<contract_version>__<seat>` (home: `skills/main-stack-agents-flow/SKILL.md` memory-hygiene section + 33/37 agent bodies); the durable-orientation paragraph (home: the `architecture-analyzer` / `style-analyzer` descriptions, which name the docs they own). Defect #2 resolved (navigation routing now lives in Navigation only). |
| 127 | context7 row | kept; 'skipping it is *silent* (no error), so it's a discipline' DELETED - rationale; 'The rule is the *category*, not a fixed list' compressed into the directive itself. |
| 128 | memory row | kept, compressed; 'Distinct from the system-prompt per-project file memory' and the shared-DB design aside DELETED - mechanics; 'comment this out in a standalone project' KEPT (fill-time directive). Defect #3 resolved (split stated here once). |
| 129 | playwright row | kept verbatim |
| 130 | framework-cli row | kept, compressed; '(framework-gated; `angular-cli` in the Angular baseline)' and 'A framework-specific complement to context7...' DELETED - the row's directive already says 'keep only in a matching project'. |
| 131 | tracker row | kept, compressed |
| 133-139 | heavy MCPs + `enabledMcpjsonServers` mechanics | REWRITE: the comment-out directive for `chrome-devtools` / `appium-mcp` stays as one line; the allow-list mechanics paragraph DELETED -> `claude/README.md` (DOC - install-time behavior the model never acts on). |
| 141-147 | LSP tool paragraph | REWRITE: one clause merged into Navigation (compiler-exact lookups + diagnostics) and one post-table line (enable the language's plugins). 'It **complements** serena and does **not** edit' DELETED - restates what the kept serena-default line already implies; the language-agnostic plugin roster DELETED - install inventory (`claude/README.md` / `claude-stack.html`). |
| 149 | name plugins per-project | kept, folded into the post-table line |

### Related projects (151-181)

| Lines | Content | Disposition |
|---|---|---|
| 153-157 | intro + structure-vs-memory + edges-not-roles | REWRITE to two lines: the awareness argument stays ('this committed, always-loaded list is what makes the agent aware they exist'); 'never in the `memory` MCP; memory carries only the dynamic...' compressed into the closing bullet (defect #3); 'so any topology fits' DELETED - rationale. |
| 159-167 | yaml schema | kept; field comments trimmed ('# how to find it' deleted - self-evident; 'its docs - read these to orient before its code' compressed into the `read_first` comment) |
| 169-171 | orient-from-read_first bullet | DELETED - the schema's `read_first` field plus its inline comment carry the directive; 'they are plain files, so no cross-project indexing is needed' was rationale. |
| 172-175 | navigation-stays-per-repo bullet | REWRITE to one line: serena binds to this repo; sibling symbol-navigation happens from a context rooted there. 'a dispatched sub-investigation or a session with its cwd there' enumeration DELETED. |
| 176-177 | dynamic-findings-to-memory bullet | compressed into the closing bullet |
| 178-181 | inline-or-a-file bullet | REWRITE to one clause: growing list -> committed `docs/RELATED-PROJECTS.md`, one-line pointer kept here. 'it is always loaded and is what makes the agent aware the siblings exist' DELETED here - already stated in the section intro; 'must be tracked (never gitignored), so it travels with the repo' compressed to 'committed'. |

### Per-project additions (183-197)

| Lines | Content | Disposition |
|---|---|---|
| 185-187 | intro | kept; '(the system prompt and skill descriptions carry the rest)' DELETED - already the preamble's rule. |
| 188-197 | the 10 items | kept; item 2's LSP parenthetical compressed; item 6's mechanics tail ('soft guidance, not a block. The stack ships five - angular/web/ionic, asp.net, wpf, sql, devops') DELETED - the rule files are their own inventory and the stack-specific list leaks into the neutral skeleton; the both-globs-load-both-skills clause KEPT (decision-relevant). |

## 11. Reproduction

```bash
uv run --with tiktoken python3 - <<'EOF'
import tiktoken, re
enc = tiktoken.get_encoding('o200k_base')
text = open('claude/CLAUDE.template.md').read()
lines, sections, cur = text.split('\n'), [], ('PREAMBLE', [])
for ln in lines:
    m = re.match(r'^(#{2,3}) (.+)$', ln)
    if m: sections.append(cur); cur = (m.group(2), [ln])
    else: cur[1].append(ln)
sections.append(cur)
total = len(enc.encode(text))
print('TOTAL', total)
for name, ls in sections:
    t = len(enc.encode('\n'.join(ls)))
    print(f'{t:6d} {100*t/total:5.1f}%  {name}')
EOF
```

The directive:rationale split additionally classifies each line D / R / M (mixed = 50/50) per the
definitions in section 3; the per-line classes are derivable from section 10's dispositions.

## 12. Follow-up executed: baseline split into an always-on rule

After the migration landed, the evergreen half of the template moved into
`claude/rules/house-baseline.md` (no `paths:` frontmatter - loads at launch and into subagents,
per the probes in section 2), leaving `claude/CLAUDE.template.md` a purely per-project skeleton:

- **Rule** (1,719 tokens / 97 lines): `## How to work here` (all eight subsections) + the
  skills/agents routing bullets + the pre-commit checkpoint. Zero placeholders - the security-globs
  fill instruction became an extend-`settings.json` instruction, and the two self-references now
  point at 'the project's `CLAUDE.md`'.
- **Template** (1,056 tokens / 60 lines): fill block (now pointing at the rule, forbidding
  restatement) + MCP servers table + Related projects + Per-project additions.
- **Combined resident cost 2,775 tokens** (+107 vs the 2,668 single file - the rule's header
  explaining its update-clobber semantics). The win is distribution, not tokens: `update_rules`
  re-fetches the baseline fleet-wide on every `update`, while a seeded `CLAUDE.md` never refreshes;
  per-project exclusion is a `CLAUDE_RULES` manifest comment-out.
- Wiring: `CLAUDE_RULES` in both installers, the HTML `rules` data + group caption, both
  `claude/README.md` rows (Rules 8 -> 9), the root repo map. `npm run lint` green. Live probe: a
  scratch project with the real rule + template answered the em-dash and proposal-review questions
  from rule content.
- Section 9's single homes that read 'template' now read 'house-baseline rule' for the evergreen
  items; the one-home property is unchanged. The tradeoff accepted: local edits to the baseline
  rule in a consuming project are overwritten on `update` - project-specific guidance belongs in
  `CLAUDE.md`, never in the rule.

**Superseded by the single-job split (same branch):** the one `house-baseline.md` was further split
into nine always-on `baseline-*.md` rules (one concern per file: communication,
evaluating-proposals, planning, code-quality, definition-of-done, security, git + pre-commit,
navigation, agents-skills - individually excludable via the `CLAUDE_RULES` manifest), and
`web-conventions.md` - the one path-scoped rule routing to three independently-installable skills -
split into `typescript-conventions.md` / `angular-conventions.md` / `angular-styling-conventions.md`
(a TypeScript-only project no longer installs a rule pointing at absent Angular skills; the other
path-scoped rules already routed to a single skill each, so they did not split). The template
gained a `## Rules` index table (loads + job per rule; the baseline set as one row). Cost
accounting: split overhead +147 tokens (nine frontmatter headers), index +347 - combined always-on
now 3,269 tokens vs 2,775 pre-split and 5,362 original (-39%). Rules count 9 -> 19 across both
installers, the HTML data, both READMEs, and the repo map; lint green; a live probe answered three
questions from three different baseline files in one fresh session.

**Refined (same branch, 8ce0284):** the template's `## Rules` table became a baseline-only map -
one detailed row per `baseline-*` rule (path-scoped rules dropped from it: their own `paths:`
frontmatter is the trigger, no index needed); the MCP servers table moved out of the template into
a tenth always-on rule (`baseline-mcp-tools.md`, placeholder-free - the `<framework>-cli` row
became an `angular-cli`-as-example row, the comment-out fill notes became registration facts); and
`## Per-project additions` was regrouped into a Project group (what it is: intro, architecture,
patterns, operational notes, checklists) and a Stack group (what it's built with: stack, commands,
conventions, testing, load-by-artifact). Rules 19 -> 20. Combined always-on 3,470 tokens
(vs 5,362 original, -35%). Probes: a fresh session routed third-party-SDK work to context7 (from
`baseline-mcp-tools`) and resolved the done-claim gate to `baseline-definition-of-done` via the
template's map.

**Refined (rules-audit pass, ab9cc90):** a rubric audit of the full layer (20 rules + template -
mechanism/placement, quality/conflicts, token efficiency, reuse; all 21 files grade A, zero
mechanism moves - the always-on payload confirmed already-optimal) landed four correctness fixes:
`baseline-agents-skills` now names the path-scoped repair-loop rules as the third sanctioned
dispatch path (a literal reading of the two-path enumeration contradicted the routers' own
'default to delegating'); `dotnet-repair-agents` gained `**/*.slnx` and `angular-repair-agents`
gained `**/*.component.html` (coverage the rules intended - the dotnet twin already carried its
view layer `.xaml`); both repair rules trimmed to the routing delta over the auto-injected
resolver descriptions (~14 lines - the descriptions already carry the loop, triage, and
anti-gaming language, per the route-only-the-delta principle); `devops-conventions` now states
that AppHost / deploy scripts don't match its globs instead of implying they auto-attach. Also
cut: typescript-conventions' prose restatement of its own glob list, and the template's 'read the
file for exact wording' parenthetical (rules are already in context every session, incl.
subagents - section 2's probe). Deliberately kept and scored, not 'fixed': the detailed baseline
map (the 8ce0284 operator decision) and `baseline-mcp-tools`' conditionally-registered rows.

## 13. Open questions

1. **Stack agents**: the slim version keeps only the dispatch policy and the five orchestration-skill
   pointers. Should one orientation line on the triad shape (designer -> implementers -> verifier per
   stack, ~25 tokens) survive too, or is that the skills' job?
2. **'Keep it simple' bullet**: retained (trimmed) so it survives a project trimming ponytail from
   `PLUGINS`. Delete instead and accept the coupling?
3. **Optional enforcement hook** for commit-message format / attribution (saves zero resident tokens,
   adds 2-installer + HTML + lint surface): file as a follow-up, or drop the idea?
4. **CLAUDE.md-in-subagents** - ANSWERED empirically 2026-07-12 (see the mechanism table): a
   no-tools `general-purpose` subagent sees both `CLAUDE.md` and path-less `.claude/rules/` files
   as injected context (claude CLI 2.1.207). The same probe confirmed a path-less rule loads at
   launch in the main session, and `update_rules` (`claude-stack.sh:719` -> `download_rules`)
   re-fetches rules from GitHub `main` while `seed_claude_md` never refreshes a seeded `CLAUDE.md` -
   so an evergreen-baseline rule would be fleet-updatable at zero token delta. Splitting the
   baseline out of the template into a path-less rule is a possible follow-up, not part of this
   migration.
