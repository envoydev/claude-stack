#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// Three routes into ONE decision: a DELIBERATE orchestration run - a capture, a loop, a solve
// flow - must start in a session that is not already carrying a finished run's history.
//   PreToolUse (Skill)      - the run arrives as a Skill call. Blocks (exit 2).
//   UserPromptSubmit        - the run arrives as a SLASH COMMAND, which emits NO Skill event at
//                             all: measured 4 of 4 runs slash-injected, ZERO Skill tool_use events
//                             in 45 messages, two captures entered at 150k and 164k, both ungated.
//                             This route INJECTS the ask; it never denies, because a
//                             UserPromptSubmit exit 2 ERASES the user's prompt and shows the
//                             reason to the user only - the run would be lost and the model would
//                             never learn why.
//   SessionStart (compact)  - the harness has just auto-compacted, which is PROOF the session
//                             reached the ceiling the gate exists for (~390k measured across three
//                             projects), at a moment a Stop may never come (measured: 23m27s /
//                             277 messages / +178k ctx, zero Stop events; and a conforming
//                             solve-task run emits zero Stops BY DESIGN). Injects, cannot block. The rule existed as
// prose in the generated capabilities rule and lost every time it was tested: measured across 4
// sessions, one of which NAMED the fresh-session need in its own text ('a fresh session is the
// right home for a loop like this') and then ran the loop anyway, to 380k tokens per message.
// Same step run fresh in the next session cost 134k. This is that rule mechanized.
//
// The incoming skill must be one of the orchestration entry points below - everything else passes -
// and then EITHER trigger is enough: the session's context is already past the threshold, or this
// session has already made one deliberate run (see priorOrchestrationRun below, which is what
// reaches the chained case the size trigger structurally cannot).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
const nodePath = require('path');
// The docs root env value. CLAUDE_STACK_DOCS_PATH is the name; CLAUDE_DOCS_PATH is the pre-0.2.43
// spelling, still read so a project whose settings.json has not been migrated yet keeps resolving
// (the installers rename the key in place on the next install/update).
const docsRootEnv = () => process.env.CLAUDE_STACK_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs';
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
        // resolve, NOT join: an ABSOLUTE CLAUDE_STACK_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          tool: payload.tool_name || '',
          reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
        }) + '\n');
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();
const EVENT = payload.hook_event_name || '';
const IS_SKILL_CALL = payload.tool_name === 'Skill';
if (!IS_SKILL_CALL && EVENT !== 'UserPromptSubmit' && EVENT !== 'SessionStart') process.exit(0);

// The trigger is an ABSOLUTE token count per WINDOW TIER, one environment variable each - the
// percentage knob it replaces was inert at its default on both real tiers (200k x 40% fell under
// the floor, 1M x 40% sat over the ceiling), so the clamps decided and the setting lied about what
// it controlled. Three numbers, no arithmetic: say when you want to be asked.
//   CLAUDE_STACK_FRESH_SESSION_200K    - the trigger on a 200k window (default 150,000, measured)
//   CLAUDE_STACK_FRESH_SESSION_1M      - the trigger on a 1M window (default 400,000)
//   CLAUDE_STACK_FRESH_SESSION_DEFAULT - the trigger on anything else (default 180,000)
// `0` on any of them turns that case's offer off. NOTE the 1M default sits ABOVE the harness's own
// auto-compaction (measured preTokens 387,619 / 391,290 / 393,516 / 393,969 / 395,112 / 396,651 /
// 396,954 / 397,171 across three projects), so on that tier the Stop offer is usually unreachable
// by design and the SessionStart `compact` route is what reaches the user - lower the variable to
// be asked before the harness decides. Which WINDOW this session runs in is resolved below.
function freshAt(key, dflt) {
  const n = parseInt(process.env[key], 10);
  return Number.isNaN(n) || n < 0 ? dflt : n;   // garbage takes the default; 0 is a real answer (off)
}
const FRESH_AT_200K = freshAt('CLAUDE_STACK_FRESH_SESSION_200K', 150000);
const FRESH_AT_1M = freshAt('CLAUDE_STACK_FRESH_SESSION_1M', 400000);
// The DEFAULT covers every case that is not one of the two named windows: a window that cannot be
// read at all, and one that is neither 200k nor 1M (a `[500k]` model id, say). It must be REACHABLE
// on the smallest window it could be applied to, which is why it sits under 200,000. At 250,000 it
// sat ABOVE a 200k window entirely, so a session on that tier could never trip it and the gate
// silently did not exist - measured on a session that peaked at 187.2k (93.6% of its window) with
// both Stop hooks running and neither holding. An unproven window is assumed SMALL on purpose: an
// offer made a little early is one dismissible ask, re-armed only after 1.5x growth, while an offer
// that can never fire is no gate at all.
const FRESH_AT_DEFAULT = freshAt('CLAUDE_STACK_FRESH_SESSION_DEFAULT', 180000);
// `0` on ALL THREE is the whole off switch. The retired CLAUDE_STACK_FRESH_SESSION_PCT is not read
// at all any more - a percentage of a window is not what this gate fires on.
const FRESH_OFF = FRESH_AT_200K === 0 && FRESH_AT_1M === 0 && FRESH_AT_DEFAULT === 0;

// --- which context WINDOW is this session running in? -------------------------------------
// Measured on a 1M session: the transcript's message.model records `claude-opus-5` with the
// `[1m]` suffix STRIPPED, the PreToolUse payload carries only cwd/session_id/tool_name/
// tool_input/transcript_path, no transcript field names a window or a token limit, and no env
// var carries the model. settings.json's `model` keeps it - and so does the transcript's own
// `cost-state` record (`modelUsage` is keyed `claude-opus-5[1m]`), which the earlier text
// wrongly called the ONLY source; measured on CLI 2.1.258 and 2.1.261. settings.json's
// `model` (e.g. `opus[1m]`). The window is read from ONE place: the settings.json model id's own window suffix - `[1m]`,
// `[200k]`. A property of the id, never a model -> window TABLE, which goes stale on every model
// release. Anything else - no suffix, an unreadable settings file, or a suffix naming some other
// size - is not one of the two named tiers and takes CLAUDE_STACK_FRESH_SESSION_DEFAULT. There is
// no env override: a hand-set window was one more number to keep true.
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
// The SECOND source, and the reason this is no longer settings-only: the transcript's own
// `cost-state` records key `modelUsage` by the FULL model id, suffix intact. Measured across the
// audited corpus - a session whose settings id carried no suffix still proved a 1M window through
// `claude-opus-5[1m]` here, and one session carried `[1m]` and a bare id at once, so the LARGEST
// window any record proves is the one the session could reach. The comment above already called
// this a second source while the code read only the first.
function costStateWindow() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - 512 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let best = null;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"cost-state"')) continue;
      try {
        const o = JSON.parse(line);
        if (o.type !== 'cost-state' || !o.modelUsage) continue;
        for (const id of Object.keys(o.modelUsage)) {
          const w = windowFromModelId(id);
          if (w && (best === null || w > best)) best = w;
        }
      } catch { /* partial first line of the tail window - skip */ }
    }
    return best;
  } catch { return null; }   // no transcript, unreadable, or not JSON - the DEFAULT tier covers it
}
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) _knownWindow = settingsModelWindow() || costStateWindow() || null;
  return _knownWindow;
}
// The trigger this session is judged against. The two named tiers each own a variable; every
// other answer - including 'the window could not be read' - takes the DEFAULT one, so the offer
// always has a number behind it. Guessing a TIER instead was the failure: reading an unknown
// window as 200k offered a 1M account the resume at 150k, and reading it as 1M never offered a
// 200k account anything at all.
function ctxThreshold() {
  const window = knownWindow();
  let at = window === 200000 ? FRESH_AT_200K
    : window === 1000000 ? FRESH_AT_1M
      : FRESH_AT_DEFAULT;
  // A trigger at or above the window it applies to can never be reached, and a gate that cannot
  // fire is the gate not existing. Honour the number that was set up to the point it goes
  // unreachable, then clamp it back inside the window.
  if (at > 0 && window && at >= window) at = Math.floor(window * 0.9);
  return at > 0 ? at : null;   // 0 = this trigger's offer is switched off
}
// The deliberate entry points: each one opens a multi-phase run with its own state file, so a
// fresh session resuming from that file is always cheaper than continuing on carried context.
// The review and per-phase seats are here because they are the same population, measured: one
// session started `project-verify-code` at 364.6k and `security-review` at 383.1k, together 13.7M
// cache-read - 27% of the whole session - for 20.5k of output, and the offer arrived nine minutes
// after that spend. `project-agent-capabilities` is here because the stack's own next-steps card
// tells the user to run it after every update. The four guided plugin commands are here because
// they are multi-phase walks too, and the UserPromptSubmit route is what finally reaches them.
const ORCHESTRATION = /^(project-(quality-loop|architecture-quality-loop|test-coverage-loop|architecture-analyzer|code-style-analyzer|test-coverage-analyzer|solve-task|solve-cross-task|build-from-scratch|stack-usage-analyzer|related-context|version-upgrade|diagnose-failure|solution-design|verify-plan|implementer|verify-code|agent-capabilities)|security-review|claude-stack:(setup|update|configure|validate))$/;
// a plugin-namespaced Skill call arrives as `<plugin>:<skill>`; the four guided commands are
// matched on their FULL name, so a bare `/setup` from some other plugin is not read as one of them
const isOrchestration = (n) => ORCHESTRATION.test(n) || ORCHESTRATION.test(n.replace(/^.*:/, ''));
let skill = '';
if (IS_SKILL_CALL) {
  skill = String((payload.tool_input || {}).skill || (payload.tool_input || {}).name || '');
} else if (EVENT === 'UserPromptSubmit') {
  // A slash turn reaches this event as the expanded prompt: the harness wraps the invocation in a
  // `<command-name>` marker (confirmed twice from live transcripts, matching origin.kind 'human'),
  // and a hand-typed `/name` is the same intent spelled without it.
  const prompt = String(payload.prompt || '');
  const m = prompt.match(/<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/)
    || prompt.match(/(?:^|\s)\/([A-Za-z0-9:_-]+)/);
  skill = m ? m[1] : '';
}
// --- a `disable-model-invocation` skill is the USER's to type, and this is what enforces it ---
// Every project's generated capabilities rule used to stamp 'the harness BLOCKS the Skill call'.
// Measured BOTH WAYS: one CLI build (2.1.229) denied the model's Skill call on a flagged skill
// with a tool_use_error, and in another session it did not - a user typed the command with a
// LEADING SPACE, so no `<command-name>` marker fired, and the model reached the flagged skill through a `Skill` tool call four seconds
// later - body injected, run started. An ASSERTED harness behaviour is the weakest form of a gate,
// and one that varies by build is no gate at all, so the assertion became this gate. Only the MODEL's own Skill call is denied: a slash turn
// arrives as UserPromptSubmit and never reaches here, so the user's own route is untouched. No env
// switch - the verdict is the skill's own frontmatter, not a judgment that can be wrong.
if (IS_SKILL_CALL && skill) {
  const bare = skill.replace(/^.*:/, '');
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    // the flag lives in the frontmatter - read the head, never the body
    const fd = fs.openSync(nodePath.join(root, '.claude', 'skills', bare, 'SKILL.md'), 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = (buf.toString('utf8', 0, n).split(/^---\s*$/m)[1] || '');
    if (/^disable-model-invocation:\s*true\s*$/m.test(head)) {
      process.stderr.write(
        `Blocked: ${skill} is marked disable-model-invocation - it is the USER's to type, never yours\n` +
        `to call. Do not retry it under another spelling and do not spend the turn explaining that you\n` +
        `cannot: name the command, say in ONE line what it does, and hand the turn back so the user\n` +
        `can run /${bare} themselves.`,
      );
      process.exit(2);
    }
  } catch { /* no such skill on disk, or unreadable - not this guard's business */ }
}

if (EVENT !== 'SessionStart' && !isOrchestration(skill)) process.exit(0);

// SessionStart carries no run name and nothing measurable - the transcript has just been REPLACED
// by its summary - so the compaction event itself is the evidence, and the offer goes out on it.
if (EVENT === 'SessionStart') {
  if (FRESH_OFF || String(payload.source || '') !== 'compact') process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'This session just AUTO-COMPACTED, which means it reached the harness ceiling (~390k ' +
        'tokens per message measured) and the harness - not the user - decided what to drop. ' +
        'Before continuing, put the choice to the user as ONE AskUserQuestion: resume in a fresh ' +
        'session (recommended - end this turn with the paste-ready invocation and the state file ' +
        'or plan file it resumes from), or continue here on the summary with the cost stated. If ' +
        'the remaining work is a single short step, say so and just finish it instead of asking. ' +
        'Two more things for the moment after a compaction. The summary above is the harness' + String.fromCharCode(39) + 's own ' +
        'and it is in English: keep answering in the language of the user' + String.fromCharCode(39) + 's own prompts (measured: ' +
        'two sessions switched to English right after compacting). And when a plan or state file is ' +
        'live, re-read its HEADER first - it holds the anchors and the next step - before re-orienting ' +
        'from the code (measured: a resume grepped the tree and read a 10k-char source range before ' +
        'opening the plan whose header already named the ranges).',
    },
  }));
  process.exit(0);
}

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
// --- what a resume would actually RECOVER: the session's own cold floor ----------------------
// The trigger is absolute context, and a large share of it can be the INSTALL's own standing
// inventory - system prompt, CLAUDE.md, the always-on rules, every MCP tool schema - which a fresh
// session pays again on its first message. Measured across the nine projects in the audited
// collection that floor runs 87k-134k per message, and one 18-minute single-command run that
// STARTED from `/clear` (first message 103,964) tripped the 150,000 gate at 159,363 after ~55k of
// actual conversation: the ask and its close cost two messages and 320,973 context and moved
// nothing. So the offer also asks what it would BUY - the part of the carry a resume does NOT
// re-pay - and stays quiet while that is under 40% of what a message now costs. This is not a
// percentage of the WINDOW (the retired PCT knob, where the clamps decided and the number lied);
// it is read from this session's own first message, and an unreadable floor answers yes, which is
// the behaviour that shipped before it. On an install whose floor is most of its window the offer
// therefore goes quiet by design - a resume that recovers 16k per message is not worth a turn, and
// the harness's own compaction covers that session.
const MIN_RECOVERABLE_SHARE = 0.4;
function coldFloor() {
  try {
    const p = payload.transcript_path;
    if (!p) return null;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(Math.min(fs.statSync(p).size, 512 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);   // the HEAD of the file - message 1, not the tail
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue;
      try {
        const u = JSON.parse(line).message.usage;
        if (u) return (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
      } catch { /* a partial or shapeless row - keep looking */ }
    }
    return null;
  } catch { return null; }
}
// True when a resume is worth a turn: the carry MINUS this session's own floor is a real share of
// what every message now costs. Anything unreadable - no floor, no context figure - answers yes.
function worthResuming(ctx) {
  const floor = coldFloor();
  if (!ctx || floor === null || floor <= 0) return true;
  return (ctx - floor) >= ctx * MIN_RECOVERABLE_SHARE;
}
// --- a PRIOR deliberate run in this session is its own trigger ----------------------------
// The size trigger alone missed the measured shape: four deliberate flows chained with zero
// `/clear` boundaries, 199.1k average context per message for well under 30k of actual tool
// output, and not one of them was gated - each run STARTED under the threshold and crossed it only
// while running, by which time the history the next run re-sends is already the bill. So a SECOND
// deliberate run carries its own evidence - a previous run's own marker in this session's
// transcript - and the offer fires at ANY context size. The size trigger stays for the single-run
// case. Completion is deliberately NOT required: a prior run still in flight makes the case for a
// fresh session stronger, not weaker. What IS required is a human turn between the two, so a run
// re-entering its own skill mid-flight is never read as a second run.
const CHAIN_TAIL = 8 * 1024 * 1024;   // measured over the audited corpus: p90 transcript 0.7MB, largest 10.6MB
function priorOrchestrationRun() {
  try {
    const p = payload.transcript_path;
    if (!p) return false;
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - CHAIN_TAIL);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    // Two spellings of ONE event, both read from the raw text - a transcript JSON-escapes neither
    // `<` nor `/`: the slash route's `<command-name>` marker, and the model route's `Skill`
    // tool_use input. Prose ABOUT a run matches neither, which is what keeps this cheap and quiet.
    const hits = [];
    for (const re of [
      /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/g,
      /"skill"\s*:\s*"([A-Za-z0-9:_-]+)"/g,
    ]) {
      let m;
      while ((m = re.exec(text)) !== null) if (isOrchestration(m[1])) hits.push({ at: m.index, name: m[1] });
    }
    if (!hits.length) return false;
    hits.sort((a, b) => a.at - b.at);
    // ONE test does both jobs: an earlier run counts only when a HUMAN turn follows it - a `user`
    // record that is not a tool_result. That excludes the call being judged without having to
    // guess whether it is on disk yet (it may be: the assistant row carrying a `Skill` tool_use is
    // written before PreToolUse fires), because nothing human follows it either way - a slash
    // prompt is the last line, and a tool_use is followed only by the result that has not happened.
    // It also keeps the SAME command chained twice, which matching the last hit by NAME did not.
    // It is deliberately loose in one direction: a user interjecting mid-run and the run then
    // entering another orchestration skill reads as a second run. That costs ONE dismissible ask
    // per session, against a measured 199.1k/message for missing the real case.
    // Slice from the END of the hit's own line - a marker lives inside a user record, so reading
    // the remainder of that same line would count the prior run's own prompt as the turn after it.
    const nl = text.indexOf('\n', hits[0].at);
    if (nl === -1) return false;
    for (const line of text.slice(nl + 1).split('\n')) {
      if (line.includes('"type":"user"') && !line.includes('"tool_result"')) return true;
    }
    return false;
  } catch {
    return false;   // unreadable transcript - the size trigger still covers this session
  }
}
// ONE chained offer per session: once the user has answered it, a retry of the same run goes
// through. The size trigger keeps its own re-arm (it escalates with the context it measures);
// this one has no number to grow, so repeating it would only print an answered question again.
function chainedOfferFile() {
  const os = require('os');
  const key = String(payload.transcript_path || payload.session_id || '').replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return `${process.env.CLAUDE_STACK_HOOK_LOG_DIR || os.tmpdir()}/guard-fresh-chained-${key}.offered`;
}

const usage = lastUsage();
// A session with no readable usage has ctx 0: the size trigger cannot fire, the chained one still can.
const ctx = usage
  ? (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0)
  : 0;
const FRESH_AT = ctxThreshold();   // null = this window's trigger is switched off
// Both triggers are subject to the same question - what a resume would actually recover - so the
// gate and the offer can never sit on different arithmetic in one session.
const overSize = !FRESH_OFF && FRESH_AT !== null && ctx > FRESH_AT && worthResuming(ctx);
const chained = !FRESH_OFF && !overSize && worthResuming(ctx)
  && !fs.existsSync(chainedOfferFile()) && priorOrchestrationRun();
if (!overSize && !chained) process.exit(0);
if (chained) {
  try { fs.writeFileSync(chainedOfferFile(), new Date().toISOString()); } catch { /* never let state break the gate */ }
}

const why = chained
  ? `is a deliberate orchestration run and this session has ALREADY run one - every turn of the\n`
    + `new run re-sends the finished run's whole history (measured: four flows chained with no\n`
    + `/clear boundary drove 199.1k tokens per message for under 30k of actual tool output).`
  : `is a deliberate orchestration run and this session already carries ~${Math.round(ctx / 1000)}k tokens\n`
    + `per message of another run's history - every turn of the new run re-sends all of it\n`
    + `(measured: the same step cost 260k/message chained vs 134k fresh).`;

// UserPromptSubmit can only ADD context - exit 2 there erases the prompt and tells the user, not
// the model - so the slash route states the same thing as an instruction and lets the model ask.
if (EVENT === 'UserPromptSubmit') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `/${skill} ${why.replace(/\n/g, ' ')} ` +
        `Do NOT start the run yet. Put it to the user as ONE AskUserQuestion: start it in a fresh ` +
        `session (recommended - end this turn with the paste-ready invocation and the state file it ` +
        `resumes from), or run it here anyway with the cost stated.`,
    },
  }));
  process.exit(0);
}

process.stderr.write(
  `Blocked: ${skill} ${why}\n`
  + `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n`
  + `this turn with the paste-ready invocation and the state file it resumes from), or run it\n`
  + `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
