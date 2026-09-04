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
//   The same Stop wiring carries the fresh-session offer: on a CLEAN close past the
//   window-scaled trigger, the turn is held once so the user is asked whether to continue here
//   or resume fresh. It fires only after the work is done (never mid-response, which is what the
//   old PreToolUse denial did), and re-arms only when the context has grown 1.5x since the last
//   one - so a long session is asked once per real cost step, not once per question.
// PreToolUse (AskUserQuestion): no longer wired on a new install. The branch stays as a
//   fail-safe for installs that still carry the matcher (a migration unwires it); it exits 0.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

// The trigger scales with the CONTEXT WINDOW, not a flat token count. A fixed 150k is ~75% of a
// 200k window (where it was measured) but only 15% of a 1M-context session, which is why it fired
// on nearly every ask there. The window is provable from what a message actually carried - no
// request can hold more input tokens than the window - so a session that has crossed 200k per
// message is on the 1M tier. Percent is tunable per machine with CLAUDE_STACK_FRESH_SESSION_PCT
// (default 40, the same shape as the harness's own auto-compact percentage); the measured 150k
// stays as the FLOOR so a 200k-window session behaves exactly as it did before.
const _pct = parseInt(process.env.CLAUDE_STACK_FRESH_SESSION_PCT, 10);
// 0 DISABLES the offer outright - a `|| 40` fallback silently turned the off switch back on.
// Anything else is clamped into 5..95; unset or garbage takes the 40 default.
const FRESH_PCT = _pct === 0 ? 0 : Math.min(95, Math.max(5, Number.isNaN(_pct) ? 40 : _pct));
const CTX_FLOOR = 150000;
// How far the context must grow before the fresh-session offer is made again (see below).
const REOFFER_GROWTH = 1.5;
function ctxThreshold(maxCtxSeen) {
  const window = maxCtxSeen > 200000 ? 1000000 : 200000;
  return Math.max(CTX_FLOOR, Math.round((window * FRESH_PCT) / 100));
}
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
  if (!PROSE_ASK_RE.test(tail) && !doneClose && !endsOnQuestion) {
    // The turn closed cleanly - the work is DONE, which is the only moment this offer belongs at.
    // Past the window-scaled trigger, ask once per cost step whether to carry on here or resume
    // fresh; a turn that already made the offer, and a session already asked at this cost step,
    // both pass untouched.
    const usage = (() => { const l = lastAssistantMessage(); return (l && l.message && l.message.usage) || null; })();
    if (!usage || FRESH_PCT === 0) process.exit(0);
    const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
    // Below the floor no window tier can qualify, so return before maxCtxSeen re-reads the same
    // 512KB tail lastAssistantMessage just read - this branch runs on EVERY clean turn close.
    if (ctx <= CTX_FLOOR) process.exit(0);
    if (ctx <= ctxThreshold(maxCtxSeen(ctx))) process.exit(0);
    if (FRESH_RE.test(text)) process.exit(0);
    const since = lastBlockCtx();
    if (since && ctx < since * REOFFER_GROWTH) {
      breadcrumb(`Stop: fresh-session offer skipped, ctx ${ctx} has not grown ${REOFFER_GROWTH}x since ${since}`);
      process.exit(0);
    }
    recordBlockCtx(ctx);
    process.stderr.write(
      `The work in this turn is finished and this session now carries ~${Math.round(ctx / 1000)}k tokens per\n` +
      `message - every further turn re-sends all of it (a resume from a state file costs roughly a\n` +
      `tenth). Before continuing here, put the choice to the user with ONE AskUserQuestion call:\n` +
      `first option 'Resume in a fresh session (Recommended)' with that cost in its description,\n` +
      `plus continuing here. If they pick the resume, answer with a short ack and the paste-ready\n` +
      `resume block only - do not start new work in this chat. Add nothing else to this turn: the\n` +
      `report you just wrote stands.`,
    );
    process.exit(2);
  }
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

// The context at which this session last blocked an ask for carrying no fresh-session option.
// The FIRST block is what makes the choice informed; repeating it on every later ask only
// prints an error the user has already answered (reported from a real session sitting at ~203k
// per message, where every ask opened with the same red block). So the offer is re-required
// only when the context has grown by half again since the last block - 150k -> 225k -> 337k:
// still an escalation, but one that tracks the cost actually growing rather than the ask count.
function lastBlockCtx() {
  try {
    return parseInt(fs.readFileSync(blockStateFile(), 'utf8'), 10) || 0;
  } catch {
    return 0;
  }
}
function recordBlockCtx(ctx) {
  try { fs.writeFileSync(blockStateFile(), String(ctx)); } catch { /* never let state break the gate */ }
}
function blockStateFile() {
  const os = require('os');
  const key = String(payload.transcript_path || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${process.env.CLAUDE_STACK_HOOK_LOG_DIR || os.tmpdir()}/guard-stop-fresh-${key}.blocked`;
}

// The largest per-message context this session has carried, read off the same transcript tail.
// It is what proves the window tier (see ctxThreshold): the CURRENT message can be small while
// the session has already been far past 200k.
function maxCtxSeen(fallback) {
  try {
    const p = payload.transcript_path;
    if (!p) return fallback;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 512 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let max = fallback;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const u = JSON.parse(line).message.usage;
        max = Math.max(max, (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0));
      } catch { /* not an assistant row, or a partial first line */ }
    }
    return max;
  } catch {
    return fallback;
  }
}

// --- PreToolUse on AskUserQuestion: observe only ---------------------------
// This used to DENY an ask that carried no fresh-session option. It enforced the right thing at
// the wrong moment: the denial landed in the middle of a response, so Claude stopped the work it
// was doing to rebuild a question, and the user watched a red block open every turn. The offer is
// not urgent - it is about what to do NEXT - so it moved to the Stop wiring below, which fires
// only once the turn's work is finished. New installs no longer wire this matcher at all -
// meta/migrations.json unwires it from existing ones - and until that lands the branch is a
// cheap no-op rather than a mid-response denial.
if (payload.tool_name === 'AskUserQuestion') {
  process.exit(0);
}

