---
name: project-stack-usage-analyzer
description: "Token/tool usage audit of claude-stack skill runs in THIS project - is Claude Code with the stack EFFICIENT here, in tokens and in effectiveness: finds EVERY session transcript with a stack-skill run (or the SESSIONS named), runs the stack's analyze-usage.js over each, and writes a per-session report (tokens, tool calls, the efficiency scorecard - cache misses, compaction re-reads, whole-suite runs, unchecked commits, green claims with no check, correction streaks, dispatch overhead - waste, protocol check, efficiency verdict, verdict) plus the raw data for a follow-up agent - and a cross-session SUMMARY.md when several sessions are audited. Manual, /-only. Triggers on 'analyze the stack usage', 'usage report for the skill runs', 'audit all sessions for this project', 'how many tokens did the flow burn', 'is the stack efficient here'. NOT for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices."
disable-model-invocation: true
---

# Project Stack Usage Analyzer - token/tool report on stack skill runs

You audit what claude-stack skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data next to it, so a later agent can re-analyze without re-collecting. The question every bundle answers is whether Claude Code with the stack is EFFICIENT in this project - in tokens (what the session paid against what it delivered) and in effectiveness (did the work land, how many corrections it took, how many claims had a check behind them) - so the analyzer prints an efficiency scorecard per session and the report carries an authored efficiency verdict built from it. The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

Run the audit from a FRESH session that names the target session id(s) - never from the tail of the session being audited. The work is offline (a node script plus report writing) and needs none of the audited chat's context, and an in-session run re-sends its whole accumulated context on every message for a report a fresh session produces from ~20k.

## Inputs

### SESSIONS - which of this project's sessions to audit

An invocation that names the scope (session ids, 'the last 3', a since-date, 'all') IS the answer - never re-ask; the one exception is a scope that includes the CURRENT session, which always routes through the fresh-session self-check below (that ask resolves HOW to honor the fresh-session rule, it does not re-ask the scope). Otherwise resolve the candidates first (step 1's grep), then ask ONE question via AskUserQuestion, each option carrying its real count:

- **Up to 12 unaudited, oldest first (recommended)** - the batch bound, and re-run for the rest.
- **All matching** - every transcript with a stack-skill run, N unaudited, and say plainly that N over 12 will force compactions.
- **Today's sessions** - the matching transcripts started today, N.
- **Current session only** - routes through the fresh-session self-check below (exclude it from this run, or hand the invocation to a fresh session - it is never audited from its own tail).
- A custom scope arrives via the built-in Other.

Hold the answer for the run. **The batch is BOUNDED at 12 bundles per run and the marker goes on the bounded option, not the largest one** - the biggest scope marked Recommended is what forces compactions. Over the bound, audit the oldest 12, then close the run naming exactly what is left and the invocation that resumes it.

### SKILLS - the skill names to hunt in the transcripts

Default: DETECT - sweep the transcripts for the stack skills that actually RAN (a `<command-name>` slash block or a Skill-tool call against the installed roster; a name appearing only in injected CLAUDE.md/rules text is a mention, not a run) and audit those, stating the detected list in the report. The user can name specific skills instead to narrow the audit.

Two run modes, opposite expectations:

- A single-chat skill (the `project-solution-design` / `project-implementer` / `project-verify-plan` trio) runs in-session and dispatches NOTHING - its cost is all main-context, so the interesting numbers are tool-result sizes and cache behavior.
- A dispatch-mode run (`project-solve-cross-task`, an agents build mode, a capture fan-out, a DELEGATED quality loop) is the reverse: subagents are EXPECTED, and the interesting split is main-session vs per-seat cost - the analyzer reads the session's `subagents/` files and emits both.

## The run

### 1. FIND the transcripts
Claude Code writes one JSONL per session under `~/.claude/projects/<encoded-project-path>/` - the folder whose name is this project's absolute path with slashes replaced by dashes. Grep the `*.jsonl` files there for each SKILLS name (on the DETECT default: for the invocation markers of any installed stack skill) and list which session file(s) contain which skill RUN - invocation markers only, never bare mentions. A `<session-id>/subagents/` folder next to a session file belongs to that session - note it (for the default trio, its existence is already a finding; see the report shape).

With the matches listed, resolve SESSIONS: unless the invocation itself named the scope, this step IS an AskUserQuestion call - fire the run-start ask above with the counts this grep just produced, and only then continue. Never pick a scope yourself and never default to the current session on a bare invocation - the tool call is the step, the prose form of it gets skipped. Self-check before anything runs: when the resolved scope includes the session this audit is running in, stop, restate the fresh-session rule, and put the resolution through ONE AskUserQuestion - **Exclude current session (recommended)**: drop the current id from the scope and note it for the next fresh-session run; **Hand off to a fresh session**: end the turn with the invocation to paste there - never resolve it silently and never audit the live session's own tail; the prose rule alone does not hold, this check is the gate. Then audit EVERY session in the chosen scope - never just the newest, never a silent subset; each audited session gets its own step-4 bundle. One bound keeps repeated sweeps sane, and the test is the REPORT, not the folder: a session is previously-audited when `<docs-path>/claude-stack-usage-report/<session-id>/report-usage.md` exists AND carries no `FILL IN` section - skip that one, list it as previously-audited, and re-audit only on an explicit ask. The folder alone is not the test: it becomes true at the SKELETON write, long before the report is authored, so a run resumed after an interruption would skip its own unfinished bundles as done.

### 2. GET the analyzer
It ships in the stack's source repo, not in this project. One snapshot, the house way - the release archive first, clone fallback:

```bash
TMP=$(mktemp -d)
curl -fsSL -o "$TMP/stack.tar.gz" https://github.com/envoydev/claude-stack/releases/latest/download/claude-stack.tar.gz
tar -xzf "$TMP/stack.tar.gz" -C "$TMP"
# archive route failed entirely? then:
git clone --depth 1 -b main https://github.com/envoydev/claude-stack "$TMP/repo"
```

Run these as SEPARATE simple commands, not a piped one-liner - the harness's auto-mode classifier blocks the compound verbatim. Then Read `references/run-mechanics.md` now - the batch shape (a loop in a file, never a pipe on the command line), every analyzer flag, and the ledger test live there, and the report's Environment rows carry the receipt `Mechanics: read`. The tool is `scripts/analyze-usage.js` inside the extracted snapshot. Both fetches fail: say so and stop - never rebuild the tool from memory. Record the snapshot revision (the archive's `RELEASE-SOURCE` file, or the clone's HEAD) for the report's Environment section. Remove `$TMP` at the end of the run, on every exit path - success, failure, or abort.

### 3. RUN it
The directory rollup once, to confirm which sessions matter; then per audited session the full report, the `--json` dump and the `--report-md` skeleton (machine-written tables plus the FILL IN judgment sections), with `--docs-root <root>` on every per-session call when `CLAUDE_STACK_DOCS_PATH` names a non-default root - the exact calls are in the mechanics reference.

**Test for the ledgers, never assert their absence.** The test is the reference's one command per session, and its OUTPUT is what the report quotes: `absent` in the report means that command printed `absent`. On a hit, the per-session calls gain `--hook-log <ledger>` (the instrumentation ledger - the who-fired-what identity side the transcript cannot attribute) and `--hook-blocks <file>` (the session's OWN guard-block ledger - the only record of WHICH guard denied a call). No ledger: skip the flag and say so in the report.

### 4. WRITE - one folder per session
Read `references/diagnosis-discipline.md` now, before the first authored row of the first bundle - its checks are this step's gate, not homework: every authored section below is written against them, and the report's Environment rows carry the receipt `Discipline: read`.

Everything for a session lands in `<docs-path>/claude-stack-usage-report/<session-id>/`:

- `report-usage.md` - the filled `--report-md` skeleton: the analyzer's tables stay UNTOUCHED (a number a tool prints cannot be misquoted), and you author only the FILL IN sections, shaped per the section spec below.
- The `--json` dump(s).
- A copy of the session `.jsonl` and its `subagents/` folder when present - the complete raw data, co-located so another agent can analyze it without hunting.
- The session's guard-block ledger, COPIED from `<docs-path>/hook-blocks/<sid>.jsonl` and renamed `hook-blocks-<sid>.jsonl` when it exists - one row per BLOCK, naming the hook that fired. Copied rather than moved: the ledger is the project's own running record of what its gates denied. Absent means no block fired this session - say that rather than leaving the reader to guess.
- The session's instrumentation ledgers, MOVED (not copied) from `<docs-path>/tools-usage/` and renamed `tool-usage-<sid>.jsonl` - the session's own and its dispatched agents'. The move is deliberate: an audited run's ledgers live with its bundle, and the collection folder drains as runs get audited instead of accumulating forever; a session not audited this run keeps its ledger in place.

Raw transcripts carry full conversation content - code, file contents, possibly secrets. Under the default machine-local docs root that stays on this machine; when the project set a COMMITTED docs root, get explicit consent before copying raw transcripts there, and without it copy only the report and the `--json` dumps.

`report-usage.md` = the skeleton plus your judgment. The machine sections (Environment, Tokens, Subagent dispatches, Skills, Generated docs, MCP, Inventory vs use, Tools, Efficiency scorecard, Context spikes, Hook-log join - whichever the run emits) stay as printed; `Inventory vs use` is the complement of the consumption tables - what this install HAS against what the session touched, with the unused names collapsed per layer - so a non-use finding cites that section's own row instead of the stack's full catalog, and its source line says whether the denominator came from this project's `.claude` or from the catalog (a directory run resolves the installed set per session and prints `installed K of M, used N`, so 'never used in this collection' is one command over the collection root); you add the Environment rows only you know, insert ONE authored section - `## Per skill run` - between the machine tables and Waste analysis, and fill the skeleton's FIVE FILL IN sections (Guard blocks, Waste analysis, Protocol check, Efficiency verdict, Verdict). The discipline reference holds the checks each row passes before it is written; the sections themselves:

**## Environment** - append the rows the analyzer cannot know: Claude Code version, OS, project stack(s), analyzer snapshot revision, which session file covers which skill run, the `Mechanics: read` and `Discipline: read` receipts, and a `Session vintage` row - the audited transcript's own date and CLI version, the reference every 'the session broke rule X' claim is checked against. Models and wall-clock arrive machine-written - leave them. A fresh-session claim reads its threshold off the skeleton's own **Models (with window suffix)** row against the **Peak context** row, never a remembered constant or the average (the per-suffix keys and seeded defaults are in the reference).

**## Per skill run** (one subsection per SKILLS entry found) - tokens and tool-call counts cited from the tables, never restated in prose; whether the run PRODUCED anything (the artifact it left and the turn that left it - a run with no Write, no Edit and no answer is ABANDONED); the top 10 most expensive tool RESULTS by ~tokens, each with the `tool_use_id` it was measured from; the context-growth spikes and their causes; skill/plugin attribution, main and subagent split, with foreign-seat stamp bleed reported as bleed; and the dispatch picture, mode-aware - for a single-chat skill every subagent is a finding, for a dispatch-mode skill the per-seat breakdown and its anomalies.

**## Guard blocks** - a required fill, not a section to pass through: the skeleton's *'EITHER no guard fired OR the ledger was never written - say which, do not infer'* line is a QUESTION addressed to you. Answer it from the step-3 ledger test's own output in one of the reference's three shapes, and never leave the skeleton's own prompt as the answer.

**## Waste analysis** - the specific places token use was disproportionate, each with evidence, ranked by tokens wasted. No row is written before it passes the reference's waste checks - a charge that turns out to be a recovery, a mandated load, or a persisted spill's read-back is not waste.

**## Protocol check** - for each skill, did the run follow its own protocol? Judge against that skill's own SKILL.md steps and cite turns, never assume. The check's SHAPE is a table - one row per NUMBERED STEP plus one per hard clause: `step | PASS / VIOLATED / NOT VISIBLE | the turn (timestamp) that settles it` - and its scope is the SESSION, not the skill windows: the reference's three sweeps (every stop, every commit, every user correction) are mandatory before any PASS.

**## Efficiency verdict** - two lines, both mandatory, built from the scorecard rows: the TOKEN VERDICT (delivered / cost / avoidable share as a measured number - cache misses with a cause the stack owns, compaction re-reads, whole-suite runs mid-iteration, build-dir reads, dispatch overhead - never an adjective; a session that spent heavily and delivered is a PASS, say so) and the EFFECTIVENESS line (did the work land, how many corrections it took against the hook's streak threshold, how many green claims had no check behind them, how many stops went unheld). A scorecard row is a measurement, not a finding: the discipline reference names what to open before each row counts, and the avoidable share sums only the rows that survived.

**## Verdict** - one table: skill | worked as intended (y/n) | biggest strength | biggest waste source | one concrete suggestion.

Then append the full-report analyzer outputs verbatim at the end of the doc (they contain only counts, tool names, and paths - no code).

### 5. SUMMARIZE - the project-wide picture

When this run audited more than one session, or bundles from prior runs already sit in `<docs-path>/claude-stack-usage-report/`, write `<docs-path>/claude-stack-usage-report/SUMMARY.md` - replaced whole each run, never an append log:

- The analyzer's directory rollup table verbatim (`node <snapshot>/scripts/analyze-usage.js <projects-dir>`) - the machine-written per-session totals.
- One line per audited session: id, start date, headline verdict, bundle path.
- A short cross-session judgment, cited from the bundles: the ctx/msg trend across sessions, waste patterns that recur in more than one session (a one-off is the session's finding; a repeat is the stack's), and per-skill cost across sessions where the same skill ran several times.
- The scorecard across sessions: one row per practice with the collection's totals and their denominators (cache misses and the tokens they re-cached, compaction re-reads, build-dir reads, scoped against whole-suite runs, checked commits, green claims with no check, correction streaks beside the short-after-long count, long answers, heavy seats) - these are the numbers a hook or rule change is read from after a week, so they are copied from the `--json` dumps, never re-derived - closing with ONE line: does this stack, in this project, waste tokens, and where.

Then `rm -rf "$TMP"`.

## Privacy rule
The report body carries aggregates, tool names, token counts, and file PATHS only - never code or file contents. The raw-data copies exist for re-analysis and follow the committed-root consent rule above.

## Don't game it
Numbers come from the analyzer's output, never estimated from memory - a claim without an analyzer line behind it does not go in the report. A protocol-check verdict cites the transcript turn that proves it. If the ledger was absent, the identity attribution is marked unavailable rather than inferred. Suggest - once, briefly - that a re-run with `.claude/hooks/instrument-tool-usage.js` wired and `CLAUDE_STACK_INSTRUMENT=1` would add the `--hook-log` join next time; do not block on it.

The step-4 discipline is READ this run, never remembered: a bundle whose Environment rows carry no `Discipline: read` receipt was authored without the checks, and hand-written analysis is the failure mode those checks exist to replace - every wrong or mislabeled claim they guard against came from a report written without them. When a check and your recollection of the transcript disagree, re-open the transcript; the check wins.
