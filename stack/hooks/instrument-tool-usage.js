#!/usr/bin/env node
'use strict';

// instrument-tool-usage.js - OPT-IN PreToolUse instrumentation (NOT wired by default).
//
// Why: the orchestrator cannot see which Skill / MCP a dispatched subagent loaded or
// called - only that subagent's aggregate token/tool_use totals. That makes a real run's
// tool / skill / MCP usage un-auditable (an audit or benchmark can only ASSESS it, not
// MEASURE it). This hook logs every tool call - built-ins (Read / Edit / Grep / Bash / Task / ...)
// plus `Skill` and `mcp__*` - as one JSONL line so a run can be tallied exactly. It NEVER blocks
// a call - it observes and exits 0.
//
// The installer FETCHES this file but deliberately does NOT wire it (its HOOKS entry has an
// empty matcher) - a wired '.*' hook costs a node spawn on every tool call, so the wiring is
// opt-in per run. Inert unless STACK_INSTRUMENT is set. To enable for a benchmark / audit run,
// see README.md ('Optional: tool-usage instrumentation'):
//   1. add a PreToolUse hook wired to it in .claude/settings.json with matcher ".*" (all tools; use "Skill|mcp__.*" to scope to skills/MCP only)
//   2. run with STACK_INSTRUMENT=1 (optionally STACK_INSTRUMENT_LOG=<path>)
//
// Output: one JSONL row per matched call at
//   $STACK_INSTRUMENT_LOG  (default: <project>/.claude/tool-usage.<session>.jsonl)
// Coverage note: PreToolUse fires for the session's tool calls; where the running Claude
// Code build propagates PreToolUse into dispatched subagents, their internal Skill / MCP
// calls are captured too - verify coverage against a known run before trusting a tally.

if (!process.env.STACK_INSTRUMENT) process.exit(0); // opt-in: default no-op, zero overhead

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw || '{}');
    const tool = ev.tool_name || '';
    if (!tool) { process.exit(0); }
    const input = ev.tool_input || {};
    const path = require('path');
    const fs = require('fs');
    // Every tool call is logged (built-ins like Read/Edit/Grep/Bash/Task + Skill + mcp__*).
    // `detail` is a lightweight, non-sensitive hint per tool family - NEVER a command body,
    // file contents, or a full payload: the skill slug, the mcp server, a file's basename,
    // a search pattern, or a Bash step's description.
    let detail = null;
    if (tool === 'Skill') detail = input.skill || input.name || null;
    else if (tool.startsWith('mcp__')) detail = tool.split('__')[1] || null;
    else if (input.file_path) detail = path.basename(String(input.file_path));
    else if (input.pattern) detail = String(input.pattern).slice(0, 60);
    else if (tool === 'Bash') detail = input.description ? String(input.description).slice(0, 60) : null;
    const rec = {
      ts: new Date().toISOString(),
      session: ev.session_id || null,
      tool,
      detail,
      cwd: ev.cwd || null,
    };
    const dir = process.env.CLAUDE_PROJECT_DIR || ev.cwd || '.';
    const sid = String(ev.session_id || 'session').slice(0, 12);
    const out =
      process.env.STACK_INSTRUMENT_LOG ||
      path.join(dir, '.claude', `tool-usage.${sid}.jsonl`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  } catch {
    // never break a tool call because instrumentation hiccuped
  }
  process.exit(0);
});
