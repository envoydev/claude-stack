#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse (Skill): a DELIBERATE orchestration skill - a capture, a loop, a solve flow - must
// start in a session that is not already carrying a finished run's history. The rule existed as
// prose in the generated capabilities rule and lost every time it was tested: measured across 4
// sessions, one of which NAMED the fresh-session need in its own text ('a fresh session is the
// right home for a loop like this') and then ran the loop anyway, to 380k tokens per message.
// Same step run fresh in the next session cost 134k. This is that rule mechanized.
//
// It blocks only when BOTH hold: the session's context is already past the threshold, AND the
// incoming skill is one of the orchestration entry points below. Everything else passes.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge

// --- block telemetry (shared by every guard hook; keep the copies identical) ------------
// A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
// FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
// the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
// nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
// scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
// telemetry never changes the verdict and never throws.
(() => {
  let last = '';
  const w = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 2) {
      try {
        const fs = require('fs');
        const path = require('path');
        const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
        const dir = path.join(root, process.env.CLAUDE_DOCS_PATH || '.claude/docs', 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          tool: payload.tool_name || '',
          reason: last.split('\n')[0].slice(0, 200),
        }) + '\n');
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();
if (payload.tool_name !== 'Skill') process.exit(0);

// The trigger scales with the CONTEXT WINDOW, not a flat token count. A fixed 150k is ~75% of a
// 200k window (where it was measured) but only 15% of a 1M-context session, which is why it fired
// on nearly every ask there. Percent is tunable per machine with CLAUDE_STACK_FRESH_SESSION_PCT
// (default 40, the same shape as the harness's own auto-compact percentage), seeded into the scope
// settings.json `env` beside CLAUDE_STACK_CONTEXT_WINDOW; where the WINDOW comes from is below.
const _pct = parseInt(process.env.CLAUDE_STACK_FRESH_SESSION_PCT, 10);
// 0 DISABLES the gate outright - a `|| 40` fallback silently turned the off switch back on.
const FRESH_PCT = _pct === 0 ? 0 : Math.min(95, Math.max(5, Number.isNaN(_pct) ? 40 : _pct));
const CTX_FLOOR = 150000;

// --- which context WINDOW is this session running in? -------------------------------------
// Measured on a 1M session: the transcript's message.model records `claude-opus-5` with the
// `[1m]` suffix STRIPPED, the PreToolUse payload carries only cwd/session_id/tool_name/
// tool_input/transcript_path, no transcript field names a window or a token limit, and no env
// var carries the model. The ONE readable source that keeps the suffix is settings.json's
// `model` (e.g. `opus[1m]`). So, first layer that resolves wins:
//   1. CLAUDE_STACK_CONTEXT_WINDOW - the user's own statement, so it outranks every guess. It
//      goes in the scope settings.json `env` block, where the installer seeds it (empty = auto).
//      Ranking it BELOW the model id would make it dead on every machine whose settings names a
//      plain model, since that layer would already have answered 200k.
//   2. the settings.json model id's own window suffix - `[1m]`, `[200k]`. A property of the id,
//      never a model -> window TABLE: a table goes stale on every model release, and a wrong
//      guess on an unknown id is worse than falling through to what the session proves.
//   3. what this session has already carried - no request can hold more input tokens than the
//      window, so a message past 200k proves the 1M tier. Latched once proven (below).
// Nothing resolves: 200k, which is exactly the behaviour before this existed.
const _win = parseInt(process.env.CLAUDE_STACK_CONTEXT_WINDOW, 10);
const WINDOW_OVERRIDE = Number.isNaN(_win) ? null : Math.max(100000, _win);
function windowFromModelId(id) {
  const m = /\[(\d+)\s*([km])\]/i.exec(String(id || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10) * (m[2].toLowerCase() === 'm' ? 1000000 : 1000);
  return n >= 100000 ? n : null;   // a suffix that is not a window size proves nothing
}
function settingsModelWindow() {
  try {
    const path = require('path');
    const os = require('os');
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude');
    for (const f of [
      path.join(root, '.claude', 'settings.local.json'),
      path.join(root, '.claude', 'settings.json'),
      path.join(account, 'settings.json'),
    ]) {
      try {
        const w = windowFromModelId(JSON.parse(fs.readFileSync(f, 'utf8')).model);
        if (w) return w;
      } catch { /* absent, unreadable, or not JSON - try the next file */ }
    }
  } catch { /* no home and no cwd - fall through to the next layer */ }
  return null;
}
// The proven tier is LATCHED per session: the max-context scan reads a 512KB transcript TAIL, so
// a long session's early 200k crossing scrolls out of it and the tier would regress from 400k
// back to 150k mid-session. One file per transcript, beside the stop hook's own state.
function tierFile() {
  const os = require('os');
  const key = String(payload.transcript_path || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${process.env.CLAUDE_STACK_HOOK_LOG_DIR || os.tmpdir()}/guard-ctx-window-${key}.tier`;
}
function latchedWindow() {
  if (!payload.transcript_path) return null;
  try {
    const n = parseInt(fs.readFileSync(tierFile(), 'utf8'), 10);
    return Number.isNaN(n) ? null : n;
  } catch { return null; }
}
function latchWindow(w) {
  if (!payload.transcript_path) return;
  try { fs.writeFileSync(tierFile(), String(w)); } catch { /* best effort - the latch is a cache */ }
}
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) _knownWindow = WINDOW_OVERRIDE || settingsModelWindow() || latchedWindow() || null;
  return _knownWindow;
}
function ctxThreshold(maxCtxSeen) {
  let window = knownWindow();
  if (!window) {
    window = maxCtxSeen > 200000 ? 1000000 : 200000;
    if (window > 200000) latchWindow(window);
  }
  const pct = Math.round((window * FRESH_PCT) / 100);
  // The floor is the MEASURED 200k-tier behaviour, kept so those sessions are unchanged; a window
  // known to be larger is never clamped back down to it (on 1M the percentage IS the setting).
  return window > 200000 ? pct : Math.max(CTX_FLOOR, pct);
}
// The deliberate entry points: each one opens a multi-phase run with its own state file, so a
// fresh session resuming from that file is always cheaper than continuing on carried context.
const ORCHESTRATION = /^(project-(quality-loop|architecture-quality-loop|test-coverage-loop|architecture-analyzer|code-style-analyzer|test-coverage-analyzer|solve-task|solve-cross-task|build-from-scratch|stack-usage-analyzer|related-context|version-upgrade|diagnose-failure))$/;
const skill = String((payload.tool_input || {}).skill || (payload.tool_input || {}).name || '');
if (!ORCHESTRATION.test(skill.replace(/^.*:/, ''))) process.exit(0);

// Context comes from the last assistant message's usage, same source the stop contract uses.
function lastUsage() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 512 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let usage = null;
    let maxCtx = 0;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'assistant' && o.message && o.message.usage) {
          usage = o.message.usage;
          const u = o.message.usage;
          maxCtx = Math.max(maxCtx, (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0));
        }
      } catch { /* partial first line of the tail window - skip */ }
    }
    return usage ? { ...usage, _maxCtx: maxCtx } : null;
  } catch {
    return null;
  }
}
const usage = lastUsage();
if (!usage) process.exit(0);
const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
if (FRESH_PCT === 0 || ctx <= ctxThreshold(usage._maxCtx || ctx)) process.exit(0);

process.stderr.write(
  `Blocked: ${skill} is a deliberate orchestration run and this session already carries\n` +
  `~${Math.round(ctx / 1000)}k tokens per message of another run's history - every turn of the new run\n` +
  `re-sends all of it (measured: the same step cost 260k/message chained vs 134k fresh).\n` +
  `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n` +
  `this turn with the paste-ready invocation and the state file it resumes from), or run it\n` +
  `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
