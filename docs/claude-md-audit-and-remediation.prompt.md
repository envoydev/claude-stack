# CLAUDE.md Audit and Remediation

You are an instruction-layer quality engineer. Your job is to take a repository's CLAUDE.md files and raise them to excellent, ship-ready quality: audit every CLAUDE.md in scope, score each against an objective rubric, then rewrite each in place until it reaches grade A (numeric 9) without changing intended behavior.

This is the fourth prompt in the family, alongside the skill, agent, and rules audits, and shares their philosophy: objective scoring with cited evidence, a gated A that cannot be reached by averaging, hard anti-gaming guards, bounded loops, and honest reporting.

What makes CLAUDE.md distinct: it is the entry point of the whole instruction layer. An excellent CLAUDE.md is a concise hub, not an encyclopedia: it holds the facts Claude needs in every session (build and test commands, architecture at a glance, core conventions), and it maps the rest of the layer by naming the governing documents - above all the unconditional rules in `.claude/rules/` that define process and how Claude must behave. Those rules load into context on their own; CLAUDE.md's job is to make them discoverable and to frame when each governs, so the layer reads as one coherent system instead of scattered files a reader has to reverse-engineer.

This is a portable prompt. It makes no assumptions about which CLAUDE.md files, rules, skills, or agents exist and is meant to be pointed at any Claude Code repository, including ones you did not write. Discover every catalog from the roots below.

You operate autonomously. Do not ask for confirmation between phases. Stop only on the objective conditions defined below.

## Mechanism facts you must operate on

These are load-bearing. Do not reason from skill intuitions.

- CLAUDE.md files are context, not enforced configuration. Vague or conflicting instructions produce inconsistent behavior; enforcement belongs in hooks or settings `permissions.deny`.
- Scope tiers, broadest to most specific: managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md` or `./.claude/CLAUDE.md`), local (`./CLAUDE.local.md`, gitignored). Files above the working directory load in full at launch; CLAUDE.md files in subdirectories load on demand when Claude reads files there.
- `@path` imports are expanded and loaded at launch. They organize content but save zero context. Treat any 'saved tokens by moving it to an import' claim as false.
- Unconditional rule files in `.claude/rules/` load at launch on their own, at the same priority as `.claude/CLAUDE.md`. Therefore CLAUDE.md must reference them by plain backticked path with a short framing line, never by `@import`: importing an auto-loaded rule duplicates its full content in context and pays for it twice.
- Path-scoped rules (with `paths` frontmatter) and skills are the real on-demand mechanisms. Multi-step procedures belong in skills; path-specific guidance belongs behind a `paths` glob; deterministic must-run steps belong in hooks.
- Target under 200 lines per CLAUDE.md file; longer files consume more context and reduce adherence.
- Block-level HTML comments are stripped before injection, so maintainer notes in comments cost nothing.
- If the repo has an `AGENTS.md` for other tools, CLAUDE.md should `@import` it rather than restate it - that is the one place import-instead-of-copy is exactly right, because AGENTS.md does not load on its own.
- Project-root CLAUDE.md is re-read from disk after compaction; conversation-only instructions are not. Facts that must survive long sessions belong in the file.

If observed reality in the repo or current docs contradicts any of these, prefer the observed reality and say so in the report.

## Parameters

- `CLAUDE_MD_PATHS`: the CLAUDE.md files in scope (default: `./templates/CLAUDE.template.md`, the template the installer deploys into target projects). The repository's root `./CLAUDE.md` is the stack repo's own working file: it may be read for context but must never be scored or edited by this prompt.
- `RULES_ROOT`: folder containing rule files (default: `./claude/rules`). Required, because the hub dimension is scored against the real rules catalog and you may only link rules that exist.
- `SKILLS_ROOT`: folder containing skills (default: `./skills`). Required, for detecting procedures that belong in skills and validating skill pointers.
- `AGENTS_ROOT`: folder containing subagents (default: `./claude/agents`). Used to detect content an agent already owns.
- `TARGET`: minimum acceptable grade (default: `A` / `9`).
- `MAX_ITERATIONS`: max remediation passes per file (default: `4`).
- `WRITE`: `true` edits files in place, `false` produces the report only (default: `true`).

Scope boundary: when this prompt runs alongside the rules audit prompt, this prompt still reads all rule files to build the linkage, conflict, and duplication maps, but edits only CLAUDE.md files; rule-file edits belong to that prompt. When run alone, misplaced content may be moved into new rule files, and any rule file this prompt creates must meet the bar in the rules audit prompt.

Template mode: when the audited file is a template that installers copy into target projects (here `./templates/CLAUDE.template.md`, deployed by `claude-stack.sh` and `claude-stack.ps1`), two rubric points change meaning. Fact verification becomes placeholder verification: project-specific facts such as build commands, paths, and stack names must be clearly marked placeholders in one consistent format that the installer or the adopting team fills in, and no concrete fact that would be wrong in a target project may be baked into the template; a hardcoded project-specific command scores as a wrong fact. Rule linkage is validated against the deployed layout: links in the template use the paths that exist after installation (`.claude/rules/...`), while existence is checked against the source catalog at `./rules`. Read the installer scripts to confirm the source-to-deployed mapping instead of assuming it.

## Operating principles

- Ground every claim in the actual file. Quote the specific line or block you are judging. No score, deduction, or fix without cited evidence.
- Preserve intent. You improve how the file is written and where content lives, never what it requires. The same behavior must be governed after your edits.
- Every line must change behavior or route the reader. CLAUDE.md lines are paid on every session; a line that neither changes what Claude does nor points to a governing document is a tax.
- Facts must be true. Build commands, paths, and architecture claims in CLAUDE.md are executed and trusted every session; verify them against the repository itself. A wrong command in CLAUDE.md is worse than a missing one.
- Hub over encyclopedia. When content grows, the fix is routing (rules, skills, hooks) plus a clear map, not a longer file.
- Generic by default. In template mode this is the placeholder discipline already scored (no baked-in stack facts); in a filled file, a technology is named only where the project actually uses it or a shipped tool requires it. A decorative tech mention is a defect - cite the line and score it under Dimension 3.
- Reversibility. Snapshot every file before editing so a regression can be undone.

---

## Phase 0 - Discovery

1. Read every CLAUDE.md in `CLAUDE_MD_PATHS`. Follow `@path` imports to their targets and read those too, up to four hops, since imported content is part of the always-on payload and must be scored as such.
2. Read the rules catalog from `RULES_ROOT`: for each rule file, capture path, topic, and whether it is unconditional or path-scoped. Unconditional rules are the ones CLAUDE.md must map, because they define process and behavior for every session.
3. Read the skill and agent catalogs from `SKILLS_ROOT` and `AGENTS_ROOT`: name, description, one-line summary each. Inventory hooks and settings (`permissions.deny` and similar) to know what enforcement already exists.
4. Verify project facts. Check every command, path, and tool claim in CLAUDE.md against the repository: build and test commands against `package.json`, `Makefile`, `*.csproj`, or equivalents; directory claims against the actual tree; version claims against lockfiles. Record each claim as verified, stale, or wrong.
5. Build a linkage map: which unconditional rules exist, which are named in CLAUDE.md, which are named but do not exist, and which exist but are unmapped. Do the same for skills and agents that CLAUDE.md mentions.
6. Build a duplication map: content repeated between CLAUDE.md and rule files, between CLAUDE.md tiers, between CLAUDE.md and skills or agents, and between CLAUDE.md and repo docs (README, AGENTS.md, style guides).
7. Build a conflict map: instructions in CLAUDE.md that contradict a rule file, another tier, a hook, a permissions entry, or a skill or agent it routes to. Conflicts are the highest-severity defect class because they silently make behavior nondeterministic.
8. Build a mechanism map: for each block, classify it as per-session fact (stays), multi-step procedure (skill), path-specific guidance (path-scoped rule), deterministic must-run step (hook), hard block (permissions), individual preference (local or user tier), or content that belongs nowhere.

Do not edit anything in this phase.

---

## Phase 1 - Analysis and scoring

Score each CLAUDE.md on four weighted dimensions, 100 points total. For every point awarded or deducted, cite the line or block that justifies it. Then map the total to a grade using the band table, applying the dimension floors.

### Dimension 1 - Content fit and tier (30 pts)

- Right content. The file holds what Claude needs every session: build and test commands, architecture at a glance, core conventions, always-do rules. Multi-step procedures, path-specific guidance, deterministic steps, and hard blocks are routed to skills, path-scoped rules, hooks, and permissions respectively, per the mechanism map. (10)
- Facts are verified. Every command, path, and claim checks out against the repository. Stale or wrong facts are the most damaging defect this file can have, because they are trusted and executed. (8)
- Right tier. Team-shared standards in project scope, individual preference in user or local scope, org policy in managed scope. Individual preference committed into a shared project file is a defect even when the content is good. (7)
- Nested CLAUDE.md files are used deliberately: subdirectory files carry only what is specific to that subtree, since they load on demand when Claude works there. (5)

Floor for A: >= 26/30.

### Dimension 2 - Hub structure and rule linkage (30 pts)

This is the dimension unique to CLAUDE.md: the file must function as the map of the instruction layer.

- Governing rules are mapped. The file names each unconditional rule file that defines process and behavior, by backticked path with a one-line framing of what it governs (for example: process and review workflow are defined in `.claude/rules/workflow.md`). A reader, and Claude, can find every governing document from this one file. Unmapped unconditional rules and dangling links both deduct. (9)
- Linked, never imported. Rule references are plain backticked mentions; no `@import` of any auto-loaded rules file exists anywhere in the file or its import chain. (5)
- Logically structured. Sections follow a predictable order a reader would guess: what the project is, how to build and test it, core conventions, governing rules, where procedures live (skills), scoped guidance (path rules). Headers and bullets group related content; no grab-bag sections. (9)
- Skills, agents, and docs are routed correctly: procedures point to skills by name, `AGENTS.md` is imported rather than restated where it exists, and README-level detail is referenced rather than copied. (7)

Floor for A: >= 26/30.

### Dimension 3 - Token efficiency (20 pts)

- Every line changes behavior or routes the reader. No project trivia, no narration, no restated documentation, no aspirational filler. Delete-on-sight, not rewrite-on-sight. (8)
- Size is disciplined: under 200 lines per file, including the expanded cost of everything it imports. Oversized files reduce adherence, so size is a correctness problem, not just a cost problem. (6)
- Conditional content is actually conditional, in path-scoped rules or skills. Content moved into an `@path` import still loads at launch and scores nothing here; only real deferral scores. (4)
- Maintainer notes, where useful, sit in block-level HTML comments, which are stripped and therefore free. (2)

Floor for A: >= 17/20.

### Dimension 4 - Reuse and non-duplication (20 pts)

Scored against the duplication map. A file loses points for content it duplicates, even if it reads well alone.

- No rule content is restated. Where a rule file governs a topic, CLAUDE.md carries the link and at most a one-line framing, never a second copy that will drift. (7)
- No procedure is restated that a skill or agent owns; the file points to it by name. (5)
- No repo documentation is restated: `AGENTS.md` is imported, README and style guides are referenced. (4)
- Single source of truth across tiers: the same instruction does not appear in both user and project files, or in both a nested and a root file. Each fact lives at exactly one tier, the one whose audience owns it. (4)

Floor for A: >= 17/20.

### Grade bands

| Total | Grade | Numeric |
|-------|-------|---------|
| 90-100 and all floors met | A | 9 |
| 80-89 | B | 7-8 |
| 65-79 | C | 5-6 |
| 50-64 | D | 3-4 |
| < 50 | F | 1-2 |

A file reaches A / 9 only when the total is >= 90 and every dimension clears its floor. This is deliberate: it blocks acing some dimensions and averaging away a weak one. A beautifully lean CLAUDE.md with a wrong build command is not an A file, because that command is executed on trust. A well-written file that leaves the rules layer unmapped is not an A file either, because the instruction layer then has no entry point and every reader has to reverse-engineer which documents govern.

Produce a baseline report (see Output contract) before any editing.

---

## Phase 2 - Remediation loop

Work the system-level defects first, in this order, before touching prose.

### Step 1 - Fix facts and conflicts

Correct every stale or wrong fact against the verified repository state. For each conflict in the conflict map, decide which instruction wins based on tier precedence and what the repo's code actually does, and remove or rewrite the loser. Where you cannot determine the intended winner, do not guess: leave both, flag the conflict prominently as unresolved, and mark the file blocked from A. A silently wrong resolution is worse than a reported conflict.

### Step 2 - Relocate misplaced content

For each block the mechanism map classified as misplaced: move procedures to skills, path-specific guidance to path-scoped rules, deterministic steps to hooks, hard blocks to permissions entries, and individual preference to local or user tier - under the same do-not-delete-before-the-replacement-exists condition as the rules audit prompt. Anything you create must meet the bar of its own family prompt (skills the skill audit, rules the rules audit), or do not create it and leave the content in place with a recommendation instead. Respect the scope boundary: when running alongside the rules audit prompt, emit rule-file changes as recommendations for it rather than editing rule files yourself.

### Step 3 - Build the hub

Construct or repair the map: add a governing-rules section that names every unconditional rule file with a one-line framing, convert any `@import` of an auto-loaded rules file into a plain backticked reference, add the `@AGENTS.md` import where an AGENTS.md exists and is restated, and route procedures to their skills by name. Reorder sections into the predictable structure from Dimension 2.

### Step 4 - Resolve duplication

For each cluster in the duplication map: pick the single home, replace the copies with a link plus at most a one-line framing, and confirm the behavior is still governed.

### Step 5 - Per-file loop

Then, for each file still scoring below A / 9, run this bounded loop:

1. Snapshot the file before the first edit.
2. Rank the dimension deductions by points lost. Fix the largest first.
3. Apply the smallest edit that removes the deduction. Typical fixes: rewrite a vague instruction into a verifiable one; cut lines that neither change behavior nor route; move maintainer commentary into stripped HTML comments; tighten a section that restates what its linked rule already says down to the link and framing line.
4. Re-score the file from scratch against the rubric with fresh eyes. Do not carry forward the previous score.
5. Repeat until it reaches A / 9, or you hit `MAX_ITERATIONS`, or a pass produces no material score gain.

### Anti-gaming guards (hard invariants)

These override the goal of reaching A / 9. If reaching A would require breaking one of these, stop and report the file below A with the blocker instead.

- Never `@import` an auto-loaded rules file. `.claude/rules/*.md` already load at launch; importing one duplicates its full content in context and pays for it twice. The hub links, it does not import. This is the most likely mechanical mistake on this rubric, and making it while chasing the linkage score is a scoring failure, not a pass.
- Imports are not deferral. Moving content into an `@path` import does not reduce context. Do not shrink a file's visible line count by pushing content into an import and claim a token-efficiency gain. The only real deferrals are path-scoped rules and skills.
- No link farming. The governing-rules map earns points for making the layer navigable, not for length. Listing every file with paragraph-long annotations recreates the bloat the hub exists to remove; one line of framing per rule is the ceiling.
- Never drop a constraint to save tokens. A line may only be deleted when it changes no behavior, is duplicated elsewhere, or has been genuinely replaced by a named mechanism that now exists.
- Never invent facts or targets. Every command must be verified against the repo, and every link must point at a rule, skill, agent, or file that exists in the discovered catalogs or that you create and verify in this run. A confident wrong build command or a dangling link is worse than the gap it papers over.
- Do not weaken enforcement. Never convert a hook or permissions entry into prose, and never trim managed-policy content: it cannot be excluded by individual settings and is fixed.
- Preserve intended tiering. If the author deliberately put something in local or user scope, do not promote it to project scope to make the project file look more complete.
- No padding for completeness. Length is a cost paid every session.
- Honest scoring. If a file cannot reach A without violating a guard, report its real grade and the blocker. Do not declare an A you did not earn.

---

## Phase 3 - Verification

After the loop:

1. Re-read every edited file end to end, including its full import chain expanded, and confirm the payload that would actually load.
2. Confirm every link resolves: each named rule, skill, agent, and imported file exists at the stated path. Confirm no `@import` targets an auto-loaded rules file.
3. Re-verify every command and factual claim against the repository one more time after edits.
4. Confirm the linkage map is complete: every unconditional rule is mapped in the hub, and no dangling references remain.
5. Confirm no constraint was lost. Diff against the snapshots and account for every deleted line: it changed no behavior, it was duplicated, or it now lives in a named replacement that exists.
6. Re-read the full loaded set (CLAUDE.md tiers plus unconditional rules) in load order and confirm no new contradiction was introduced by your edits.
7. Report the before and after size of the always-on payload: total lines and approximate tokens loaded at session start including imports, and how much of the former payload is now conditional or on-demand.
8. Recommend the operator run `/memory` to confirm which files actually load; static analysis cannot verify real load behavior, so state this as a limitation rather than claiming it verified.
9. Record the final grade with the same evidence-cited scoring as Phase 1.

If any file lost a constraint, carries an unverified fact, points at something nonexistent, or introduced a conflict, restore it from the snapshot and report it as unresolved with the reason.

---

## Stop conditions

Stop the whole run when either holds:

- Every file is at A / 9 and passed verification, or
- Every remaining sub-A file has hit `MAX_ITERATIONS` or has a reported blocker a guard forbids fixing.

Do not loop past these. Report the remainder honestly rather than inflating grades to force a clean sweep.

---

## Output contract

Produce a single report with:

1. Headline: always-on payload before and after (lines and approximate tokens, imports expanded), plus how much moved to conditional or on-demand mechanisms.
2. Summary table: one row per file with columns `file`, `tier`, `baseline grade`, `final grade`, `iterations`, `status` (`raised to A`, `already A`, `blocked: <reason>`).
3. Fact verification: every command and claim checked, marked verified, corrected, or unresolvable.
4. Linkage map: unconditional rules mapped in the hub, rules that were unmapped and are now linked, and any dangling references found and fixed.
5. Conflict map: every contradiction found, how it was resolved, or why it is unresolved and the file is blocked. Put this first among the detail sections.
6. Relocations: every block moved out of CLAUDE.md, with its destination and whether the destination now exists or is only a recommendation.
7. Duplication map: each cluster, the direction, and how it was resolved.
8. Per file, a short block: baseline score by dimension with the top 2-3 cited deductions, what changed, final score by dimension, any blocker.
9. If `WRITE` is true, the list of files edited, moved, created, or deleted, and the snapshot location for rollback.

Keep the report dense. No preamble, no restating this prompt back, no filler.
