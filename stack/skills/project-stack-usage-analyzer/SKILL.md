---
name: project-stack-usage-analyzer
description: "Token/tool usage audit of claude-stack skill runs in THIS project: finds the Claude Code session transcripts, runs the stack's analyze-usage.js over each matching session, and writes a per-session report (tokens by model, tool-call counts, top tool results by size, waste analysis, protocol check, verdict) plus the raw data for a follow-up agent. Manual, /-only. Triggers on 'analyze the stack usage', 'usage report for the skill runs', 'how many tokens did the flow burn'. NOT for live session cost (claude-hud shows that), fixing the findings (route them to the owning skill), or benchmarking model choices."
disable-model-invocation: true
---

# Project Stack Usage Analyzer - token/tool report on stack skill runs

You audit what claude-stack skill runs in this project actually cost: find the session transcripts, run the stack's offline analyzer over them, and write one report per session with the raw data next to it, so a later agent can re-analyze without re-collecting.

**Inputs.** SKILLS - the skill names to hunt in the transcripts. Default: the single-chat trio `project-solution-design`, `project-implementer`, `project-verify-plan`; the user can name any other stack skills instead. Two run modes, opposite expectations: the single-chat trio runs in-session and dispatches NOTHING - its cost is all main-context, so the interesting numbers are tool-result sizes and cache behavior. A dispatch-mode run (`project-solve-cross-task`, an agents build mode, a capture fan-out, a DELEGATED quality loop) is the reverse: subagents are EXPECTED, and the interesting split is main-session vs per-seat cost - the analyzer reads the session's `subagents/` files and emits both.

## The run

### 1. FIND the transcripts
Claude Code writes one JSONL per session under `~/.claude/projects/<encoded-project-path>/` - the folder whose name is this project's absolute path with slashes replaced by dashes. Grep the `*.jsonl` files there for each SKILLS name and list which session file(s) contain which skill run. A `<session-id>/subagents/` folder next to a session file belongs to that session - note it (for the default trio, its existence is already a finding; see the report shape).

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

When the instrumentation hook was wired for the run (`STACK_INSTRUMENT=1` writes a ledger, default `.claude/tool-usage.<session>.jsonl`, or wherever `STACK_INSTRUMENT_LOG` pointed), add `--hook-log <that file>` - it joins the who-fired-what identity side the transcript alone cannot attribute. No ledger: skip the flag and say so in the report.

### 4. WRITE - one folder per session
Everything for a session lands in `<docs-path>/claude-stack-usage-report/<session-id>/`:

- `report-usage.md` - the report, EXACTLY the sections below.
- The `--json` dump(s).
- A copy of the session `.jsonl`, its `subagents/` folder when present, and any hook ledger - the complete raw data, co-located so another agent can analyze it without hunting.

Raw transcripts carry full conversation content - code, file contents, possibly secrets. Under the default machine-local docs root that stays on this machine; when the project set a COMMITTED docs root, get explicit consent before copying raw transcripts there, and without it copy only the report and the `--json` dumps.

`report-usage.md` sections, in order:

**## Environment** - Claude Code version, model(s) used, OS, project stack(s), analyzer snapshot revision, which session file covers which skill run, wall-clock duration per run.

**## Per skill run** (one subsection per SKILLS entry found)
- Tokens: input / output / cache-read / cache-write, split by model if several; grand total.
- Tool calls: count per tool (Read, Edit, Write, Bash, Grep, Glob, serena tools, any MCP).
- Top 10 most expensive tool RESULTS by ~tokens, each as: tool | target (file path or command only, never file contents) | ~tokens.
- Context-growth spikes the analyzer flags, and what caused each.
- Skills/plugins that attributed output (the analyzer's attribution columns) - did the run load anything unexpected, or fail to load something it should have?
- Subagent dispatches, mode-aware. Single-chat skill: should dispatch nothing - any subagent cost is a finding, not a footnote. Dispatch-mode skill: the per-seat breakdown from the analyzer's subagent rows - one line per dispatched agent (seat, model, tokens in/out/cache, tool calls, duration) plus the main-vs-seats share - and flag the anomalies: a seat that idles on a wait, re-dispatches, or costs more than the work it returned.

**## Waste analysis** - the specific places token use was disproportionate, each with evidence: whole-file Reads where a symbol lookup would do, the same file read more than once, oversized Bash/test output pulled into context, overlong prose in reports/summaries. Rank by tokens wasted.

**## Protocol check** - for each skill, did the run follow its own protocol? Judge against that skill's own SKILL.md steps - for the default trio: solution-design oriented from the project docs before designing and produced an ordered minimal plan; verify-plan ran its passes against the plan rather than re-deriving it; implementer stayed inside the task contract, ran build/tests, reported per its shape. Cite turns, never assume.

**## Verdict** - one table: skill | worked as intended (y/n) | biggest strength | biggest waste source | one concrete suggestion.

Then append the full-report analyzer outputs verbatim at the end of the doc (they contain only counts, tool names, and paths - no code), and `rm -rf "$TMP"`.

## Privacy rule
The report body carries aggregates, tool names, token counts, and file PATHS only - never code or file contents. The raw-data copies exist for re-analysis and follow the committed-root consent rule above.

## Don't game it
Numbers come from the analyzer's output, never estimated from memory - a claim without an analyzer line behind it does not go in the report. A protocol-check verdict cites the transcript turn that proves it. If the ledger was absent, the identity attribution is marked unavailable rather than inferred. Suggest - once, briefly - that a re-run with `.claude/hooks/instrument-tool-usage.js` wired and `STACK_INSTRUMENT=1` would add the `--hook-log` join next time; do not block on it.
