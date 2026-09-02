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
//   The text judged is the payload's `last_assistant_message` (the harness's own copy of the
//   turn's final text); the transcript tail is the fallback for a build that does not send it.
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
const PROSE_ASK_RE = /\b(say the word|say go|just say so|want me to [^.?!\n]{0,80}\?|shall i [^.?!\n]{0,80}\?|should i [^.?!\n]{0,80}\?|your call\b|let me know (when|if|whether)|give me the word|tell me (if|when|whether) you want|paste (this|that|it) and i'?ll|run this to unblock|i'?ll [^.\n]{0,60}(the moment|as soon as|once) (you|it|the)|worth your decision)/i;
// A close with NO question of any shape: the named step is done and a next action sits
// un-taken, stated as fact. Measured in 4 projects - the user answers it with 'are you
// finished?' after 2-22 minutes, so the shape is a stop, not a status line. Both halves must
// hit: something finished, and something still pending on the user or on a running job.
const DONE_RE = /\b(done|complete[d]?|finished|committed|landed|green|all tests pass|ready)\b/i;
const PENDING_RE = /\b(not pushed|nothing pushed|awaiting|waiting (on|for)|still running|pending your|next step|remains?|left to do|yet to|whenever you|when you'?re ready|un-?pushed)\b/i;

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
        if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
        // One logical assistant turn is written as SEVERAL jsonl lines sharing one message.id
        // (a thinking line, then the text line). Taking the last line as the whole message made
        // the hook read an empty-text or tool_use-only fragment and pass silently - measured: 6
        // sessions where an offline replay of this same hook blocks the turn the live run let
        // through, stalls of 15-74 minutes. Merge every line carrying the same id.
        const id = o.message.id;
        if (last && id && last.message.id === id) {
          last.message.content = last.message.content.concat(o.message.content);
          if (o.message.usage) last.message.usage = o.message.usage;
        } else {
          last = { ...o, message: { ...o.message, content: o.message.content.slice() } };
        }
      } catch { /* partial first line of the tail window - skip */ }
    }
    return last;
  } catch (err) {
    breadcrumb(`transcript read failed: ${err && err.message}`);
    return null;
  }
}

// A silent fail-open is indistinguishable from a clean turn, which is how the misses above
// stayed invisible across 74 audited bundles. Every path that declines to judge says so.
function breadcrumb(why) {
  try {
    const dir = process.env.CLAUDE_STACK_HOOK_LOG_DIR || require('os').tmpdir();
    fs.appendFileSync(`${dir}/guard-stop-contract.log`, `${new Date().toISOString()} ${why}\n`);
  } catch { /* never let logging break the gate */ }
}

if (payload.hook_event_name === 'Stop') {
  if (payload.stop_hook_active) process.exit(0); // continuation we caused - never loop
  // The harness sends the turn's final text as `last_assistant_message` (Stop / SubagentStop) and
  // documents the transcript as written ASYNCHRONOUSLY - it can lag the in-memory turn, which is
  // how a live decision stop reads as the previous turn's clean close. The field wins; the
  // transcript tail is the fallback for a build that does not send it.
  let text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  if (!text.trim()) {
    const last = lastAssistantMessage();
    if (!last) { breadcrumb('Stop: no assistant message readable - passing'); process.exit(0); }
    const blocks = last.message.content;
    const hasToolUse = blocks.some((b) => b && b.type === 'tool_use');
    if (hasToolUse) process.exit(0); // the turn ended on a tool call, not prose
    text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
    if (!text.trim()) { breadcrumb('Stop: merged message carries no text - passing'); process.exit(0); }
  }
  const tail = text.slice(-1500); // the offer lives at the end of the turn
  // The phrase list only ever covered the shapes MEASURED in the corpus, so an ordinary
  // decision question ('What's the deploy target?', 'Which one should we go with?') walked
  // straight past it (reproduced). A turn that ends on a question and hands nothing to a tool is
  // the shape the contract is about, whatever words it uses.
  const endsOnQuestion = /\?["')\]]*\s*$/.test(tail.trim())
    || /\b(which|what|who|where|when|how|should|do you|would you|prefer)\b[^?]{0,120}\?\s*$/i.test(tail.trim());
  // ...but a question ABOUT something already settled, or a rhetorical aside mid-report, is not a
  // stop: require the question to be the turn's last word, which the tests above already encode.
  const doneClose = DONE_RE.test(tail) && PENDING_RE.test(tail) && !/\?/.test(tail)
    // A background job the user has no say over is a status line, not a pending decision -
    // blocking it forced an AskUserQuestion over 'tests are still running in CI' (reproduced).
    && !/\b(ci|pipeline|workflow|build|suite|tests?|job|deploy(ment)?)\b[^.\n]{0,40}\b(still )?(running|in progress|queued|pending)\b/i.test(tail);
  if (!PROSE_ASK_RE.test(tail) && !doneClose && !endsOnQuestion) process.exit(0);
  if (doneClose && !PROSE_ASK_RE.test(tail)) {
    process.stderr.write(
      'This turn reports the step done and leaves the next action pending, stated as a fact\n' +
      'rather than asked. Measured across four projects: that close draws a literal "are you\n' +
      'finished?" from the user 2-22 minutes later. Put the pending decision (push or hold,\n' +
      'continue or stop, which deliverable next) through ONE AskUserQuestion call with the\n' +
      'options you already have in mind, recommended one marked. If nothing is actually\n' +
      'pending, say so in one line with no open next action and stop.',
    );
    process.exit(2);
  }
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

// Per-session tally of qualifying fresh-session asks, keyed by the transcript path so it dies
// with the session's own temp dir. Fail-open: a counter that cannot be read never blocks.
function bumpFreshAskCount() {
  try {
    const os = require('os');
    const key = String(payload.transcript_path || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
    const f = `${process.env.CLAUDE_STACK_HOOK_LOG_DIR || os.tmpdir()}/guard-stop-fresh-${key}.count`;
    let n = 0;
    try { n = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch { n = 0; }
    n += 1;
    fs.writeFileSync(f, String(n));
    return n;
  } catch {
    return 1;
  }
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
  if (FRESH_RE.test(optionText)) {
    // Escalation: the offer is stateless by itself, so declining it is free - measured, one
    // session was offered a fresh start at ~180k, ~355k and ~484k per message, continued every
    // time, and ended at 135.1M cache-read for ~50k of tool output. From the second qualifying
    // ask on, the fresh-session option must be the RECOMMENDED one, not a listed alternative.
    const fires = bumpFreshAskCount();
    const recommended = qs
      .flatMap((q) => (q && q.options) || [])
      .some((o) => FRESH_RE.test(`${(o && o.label) || ''} ${(o && o.description) || ''}`) && /recommended/i.test(`${(o && o.label) || ''}`));
    if (fires < 2 || recommended) process.exit(0);
    process.stderr.write(
      `Blocked: this is ask ${fires} past the ~150k trigger in one session and the fresh-session\n` +
      `option is still not the recommended one. The context is ~${Math.round(ctx / 1000)}k per message -\n` +
      `every further turn here re-sends it. Rebuild the ask with the fresh-session resume marked\n` +
      `(Recommended) as the FIRST option, and put the cost in its description so the choice is\n` +
      `informed. If the user picks it, end the turn with the paste-ready resume block only.`,
    );
    process.exit(2);
  }
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
