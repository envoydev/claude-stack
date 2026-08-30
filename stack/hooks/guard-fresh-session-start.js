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
if (payload.tool_name !== 'Skill') process.exit(0);

const CTX_THRESHOLD = 150000; // the stop contracts' own ~150k ctx trigger
// The deliberate entry points: each one opens a multi-phase run with its own state file, so a
// fresh session resuming from that file is always cheaper than continuing on carried context.
const ORCHESTRATION = /^(project-(quality-loop|architecture-quality-loop|test-coverage-loop|architecture-analyzer|code-style-analyzer|test-coverage-analyzer|solve-task|solve-cross-task|build-from-scratch|stack-usage-analyzer|related-context|version-upgrade))$/;
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
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'assistant' && o.message && o.message.usage) usage = o.message.usage;
      } catch { /* partial first line of the tail window - skip */ }
    }
    return usage;
  } catch {
    return null;
  }
}
const usage = lastUsage();
if (!usage) process.exit(0);
const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
if (ctx <= CTX_THRESHOLD) process.exit(0);

process.stderr.write(
  `Blocked: ${skill} is a deliberate orchestration run and this session already carries\n` +
  `~${Math.round(ctx / 1000)}k tokens per message of another run's history - every turn of the new run\n` +
  `re-sends all of it (measured: the same step cost 260k/message chained vs 134k fresh).\n` +
  `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n` +
  `this turn with the paste-ready invocation and the state file it resumes from), or run it\n` +
  `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
