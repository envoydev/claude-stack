---
name: project-stack-usage-analyzer
description: "Token/tool usage audit of claude-stack skill runs in THIS project: finds the Claude Code session transcripts, runs the stack's analyze-usage.js over each matching session, and writes a per-session report (tokens by model, tool-call counts, top tool results by size, waste analysis, protocol check, verdict) plus the raw data for a follow-up agent. Manual, /-only. Triggers on 'analyze the stack usage', 'usage report for the skill runs', 'how many tokens did the flow burn'. NOT for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices."
disable-model-invocation: true
---

# Project Stack Usage Analyzer - token/tool report on stack skill runs

You audit what claude-stack skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data next to it, so a later agent can re-analyze without re-collecting.

Run the audit from a FRESH session that names the target session id(s) - never from the tail of the session being audited. The work is offline (a node script plus report writing) and needs none of the audited chat's context; measured, an in-session run at ~620k accumulated context paid six 529-retry re-sends (629k cache-write for 11 messages) for a report a fresh session produces from ~20k.

**Inputs.** SKILLS - the skill names to hunt in the transcripts. Default: DETECT - sweep the transcripts for the stack skills that actually RAN (a `<command-name>` slash block or a Skill-tool call against the installed roster; a name appearing only in injected CLAUDE.md/rules text is a mention, not a run) and audit those, stating the detected list in the report. The user can name specific skills instead to narrow the audit. Two run modes, opposite expectations: a single-chat skill (the `project-solution-design` / `project-implementer` / `project-verify-plan` trio) runs in-session and dispatches NOTHING - its cost is all main-context, so the interesting numbers are tool-result sizes and cache behavior. A dispatch-mode run (`project-solve-cross-task`, an agents build mode, a capture fan-out, a DELEGATED quality loop) is the reverse: subagents are EXPECTED, and the interesting split is main-session vs per-seat cost - the analyzer reads the session's `subagents/` files and emits both.

## The run

### 1. FIND the transcripts
Claude Code writes one JSONL per session under `~/.claude/projects/<encoded-project-path>/` - the folder whose name is this project's absolute path with slashes replaced by dashes. Grep the `*.jsonl` files there for each SKILLS name (on the DETECT default: for the invocation markers of any installed stack skill) and list which session file(s) contain which skill RUN - invocation markers only, never bare mentions. A `<session-id>/subagents/` folder next to a session file belongs to that session - note it (for the default trio, its existence is already a finding; see the report shape).

### 2. GET the analyzer
It ships in the stack's source repo, not in this project. One snapshot, the house way - the release archive first, clone fallback:

```bash
TMP=$(mktemp -d)
curl -fsSL https://github.com/envoydev/claude-stack/releases/latest/download/claude-stack.tar.gz | tar -xz -C "$TMP" \
  || git clone --depth 1 -b main https://github.com/envoydev/claude-stack "$TMP/repo"
```

The tool is `scripts/analyze-usage.js` inside the extracted snapshot. Record the snapshot revision (the archive's `RELEASE-SOURCE` file, or the clone's HEAD) for the report's Environment section. Remove `$TMP` at the end of the run, on every exit path - success, failure, or abort.

### 3. RUN it
- `node <snapshot>/scripts/analyze-usage.js <projects-dir>` - one-line rollup, to confirm which sessions matter.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl>` - full report, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --json` - machine dump, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --report-md > report-usage.md` - the report SKELETON: machine-written tables plus the FILL IN judgment sections. Add `--hook-log` here too when the ledger exists (below).

Then look for the instrumentation ledgers - do not wait to be pointed at them: `CLAUDE_STACK_INSTRUMENT=1` writes one per session/agent id under `<docs-path>/tools-usage/<sid>.jsonl` (or wherever `CLAUDE_STACK_INSTRUMENT_LOG` pointed). For each audited session, check that folder for the session's own id and its dispatched agents' ids; on a hit add `--hook-log <ledger>` - it joins the who-fired-what identity side the transcript alone cannot attribute. No ledger: skip the flag and say so in the report.

### 4. WRITE - one folder per session
Everything for a session lands in `<docs-path>/claude-stack-usage-report/<session-id>/`:

- `report-usage.md` - the filled `--report-md` skeleton: the analyzer's tables stay UNTOUCHED (a number a tool prints cannot be misquoted - measured: 5 wrong claims across 4 hand-written reports, each a prose restatement of tool output), and you author only the FILL IN sections, shaped per the section spec below.
- The `--json` dump(s).
- A copy of the session `.jsonl` and its `subagents/` folder when present - the complete raw data, co-located so another agent can analyze it without hunting.
- The session's instrumentation ledgers, MOVED (not copied) from `<docs-path>/tools-usage/` and renamed `tool-usage-<sid>.jsonl` - the session's own and its dispatched agents'. The move is deliberate: an audited run's ledgers live with its bundle, and the collection folder drains as runs get audited instead of accumulating forever; a session not audited this run keeps its ledger in place.

Raw transcripts carry full conversation content - code, file contents, possibly secrets. Under the default machine-local docs root that stays on this machine; when the project set a COMMITTED docs root, get explicit consent before copying raw transcripts there, and without it copy only the report and the `--json` dumps.

`report-usage.md` sections, in order (Environment and the data tables arrive machine-written in the skeleton; you author the judgment content):

**## Environment** - Claude Code version, model(s) used, OS, project stack(s), analyzer snapshot revision, which session file covers which skill run, wall-clock duration per run.

**## Per skill run** (one subsection per SKILLS entry found)
- Tokens: input / output / cache-read / cache-write, split by model if several; grand total.
- Tool calls: count per tool (Read, Edit, Write, Bash, Grep, Glob, serena tools, any MCP).
- Top 10 most expensive tool RESULTS by ~tokens, each as: tool | target (file path or command only, never file contents) | ~tokens - from the analyzer output where it emits per-result rows; where it does not, measure from the transcript directly (paths and sizes only) and say so.
- Context-growth spikes the analyzer flags, and what caused each.
- Skills/plugins that attributed output (the analyzer's attribution columns) - did the run load anything unexpected, or fail to load something it should have? The analyzer prints main and subagent attribution SPLIT, with the seat types carrying each sub stamp: a seat type foreign to the skill (a domain verifier under an installer command) is stamp bleed from an adjacent run - a dispatched seat inherits whatever skill was last active - so report it as bleed and never charge it to the skill (measured: 223 verifier msgs / 31.3M cache-read once landed on a plugin-update command that dispatches nothing).
- Subagent dispatches, mode-aware. Single-chat skill: should dispatch nothing - any subagent cost is a finding, not a footnote. Dispatch-mode skill: the per-seat breakdown from the analyzer's subagent rows - one line per dispatched agent (seat, model, tokens in/out/cache, tool calls, duration) plus the main-vs-seats share - and flag the anomalies: a seat that idles on a wait, re-dispatches, or costs more than the work it returned.

**## Waste analysis** - the specific places token use was disproportionate, each with evidence: whole-file Reads where a symbol lookup would do, the same file read more than once, oversized Bash/test output pulled into context, overlong prose in reports/summaries. Rank by tokens wasted.

**## Protocol check** - for each skill, did the run follow its own protocol? Judge against that skill's own SKILL.md steps - for the default trio: solution-design oriented from the project docs before designing and produced an ordered minimal plan; verify-plan ran its passes against the plan rather than re-deriving it; implementer stayed inside the task contract, ran build/tests, reported per its shape. Cite turns, never assume.

**## Verdict** - one table: skill | worked as intended (y/n) | biggest strength | biggest waste source | one concrete suggestion.

Then append the full-report analyzer outputs verbatim at the end of the doc (they contain only counts, tool names, and paths - no code), and `rm -rf "$TMP"`.

## Privacy rule
The report body carries aggregates, tool names, token counts, and file PATHS only - never code or file contents. The raw-data copies exist for re-analysis and follow the committed-root consent rule above.

## Don't game it
Numbers come from the analyzer's output, never estimated from memory - a claim without an analyzer line behind it does not go in the report. A protocol-check verdict cites the transcript turn that proves it. If the ledger was absent, the identity attribution is marked unavailable rather than inferred. Suggest - once, briefly - that a re-run with `.claude/hooks/instrument-tool-usage.js` wired and `CLAUDE_STACK_INSTRUMENT=1` would add the `--hook-log` join next time; do not block on it.
