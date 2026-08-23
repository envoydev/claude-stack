#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Two wirings, one contract: the blocking-ask mandate (baseline-interaction.md) and the
// fresh-session construction check (the flow skills' stop contracts) both failed as prose in
// every audited strengthening - measured across 123 sessions: ~25 sessions ended turns on
// 'say the word' / 'want me to X?' prose (stalls of 13min-37h, one plaintext-credential
// decision dropped at /exit), and the 150k fresh-session option fired in ~0 of 50+ qualifying
// asks (0/11, 0/14, 0/7...) with the clause loaded verbatim. This hook is the mechanization.
//
// Stop wiring: a turn that ends on a decision-shaped question in PROSE (no AskUserQuestion
//   call in the final assistant message) is blocked - the model re-emits it as the tool call.
// PreToolUse (AskUserQuestion) wiring: once the session's context passes the threshold, an
//   option list with no fresh-session/resume entry is malformed per the stop contract - the
//   call is denied with the rebuild instruction.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const CTX_THRESHOLD = 150000; // the stop contracts' own ~150k ctx trigger
const FRESH_RE = /fresh session|new session|\/clear|fresh chat|resume (in|from) a fresh/i;
// Decision-shaped prose endings measured in the corpus. Deliberately narrow: a plain
// clarifying question is not matched - only the offer-and-wait shapes that stalled sessions.
const PROSE_ASK_RE = /\b(say the word|say go|just say so|want me to [^.?!\n]{0,80}\?|shall i [^.?!\n]{0,80}\?|should i [^.?!\n]{0,80}\?|your call\b|let me know (when|if|whether)|give me the word|tell me (if|when|whether) you want)/i;

// --- read the transcript tail (last ~512KB) and pull the last assistant message ---
function lastAssistantMessage() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 512 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    let last = null;
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) last = o;
      } catch { /* partial first line of the tail window - skip */ }
    }
    return last;
  } catch {
    return null;
  }
}

if (payload.hook_event_name === 'Stop') {
  if (payload.stop_hook_active) process.exit(0); // continuation we caused - never loop
  const last = lastAssistantMessage();
  if (!last) process.exit(0);
  const blocks = last.message.content;
  const hasToolUse = blocks.some((b) => b && b.type === 'tool_use');
  if (hasToolUse) process.exit(0); // the turn ended on a tool call, not prose
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  const tail = text.slice(-1500); // the offer lives at the end of the turn
  if (!PROSE_ASK_RE.test(tail)) process.exit(0);
  process.stderr.write(
    'This turn ends on a decision-shaped question in prose. Per baseline-interaction.md a\n' +
    'blocking ask goes through the AskUserQuestion tool - a prose-only question gets skipped\n' +
    'in live runs (measured stalls: 13 minutes to 37 hours; one security decision died at\n' +
    '/exit). Re-emit the pending decision as ONE AskUserQuestion call with concrete options\n' +
    '(recommended one marked). If the session context is already past ~150k tokens per\n' +
    'message, include the fresh-session resume option. If the turn truly holds no decision -\n' +
    'the question was rhetorical or informational - restate the close WITHOUT question\n' +
    'phrasing and stop.',
  );
  process.exit(2);
}

// --- PreToolUse on AskUserQuestion: fresh-session option required past the threshold ---
if (payload.tool_name === 'AskUserQuestion') {
  const last = lastAssistantMessage();
  const usage = last && last.message && last.message.usage;
  if (!usage) process.exit(0);
  const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
  if (ctx <= CTX_THRESHOLD) process.exit(0);
  const qs = (payload.tool_input && payload.tool_input.questions) || [];
  const optionText = qs
    .flatMap((q) => (q && q.options) || [])
    .map((o) => `${(o && o.label) || ''} ${(o && o.description) || ''}`)
    .concat(qs.map((q) => (q && q.question) || ''))
    .join(' ');
  if (FRESH_RE.test(optionText)) process.exit(0);
  process.stderr.write(
    `Blocked: this AskUserQuestion has no fresh-session option while the session context is\n` +
    `~${Math.round(ctx / 1000)}k tokens per message (threshold ~150k). Per the stop contract\n` +
    `the fresh-session resume IS one of the ask's options once the trigger is crossed - the\n` +
    `question is malformed, rebuild it: keep your options and ADD one offering to resume in a\n` +
    `fresh session from the plan/state file (a resume costs roughly a tenth of the carried\n` +
    `context - measured). If the user picks it, end the turn with a short ack plus the\n` +
    `paste-ready resume block - do not start new work in this chat.`,
  );
  process.exit(2);
}

process.exit(0);
