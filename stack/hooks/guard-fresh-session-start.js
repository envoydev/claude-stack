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
// It blocks only when BOTH hold: the session's context is already past the threshold, AND the
// incoming skill is one of the orchestration entry points below. Everything else passes.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
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
//   CLAUDE_STACK_FRESH_SESSION_DEFAULT - the trigger on anything else (default 250,000)
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
// read at all, and one that is neither 200k nor 1M (a `[500k]` model id, say). It sits between the
// two triggers, so an unknown window is neither nagged at 150,000 nor left unreachable at 400,000.
const FRESH_AT_DEFAULT = freshAt('CLAUDE_STACK_FRESH_SESSION_DEFAULT', 250000);
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
let _knownWindow;
function knownWindow() {
  if (_knownWindow === undefined) _knownWindow = settingsModelWindow() || null;
  return _knownWindow;
}
// The trigger this session is judged against. The two named tiers each own a variable; every
// other answer - including 'the window could not be read' - takes the DEFAULT one, so the offer
// always has a number behind it. Guessing a TIER instead was the failure: reading an unknown
// window as 200k offered a 1M account the resume at 150k, and reading it as 1M never offered a
// 200k account anything at all.
function ctxThreshold() {
  const window = knownWindow();
  const at = window === 200000 ? FRESH_AT_200K
    : window === 1000000 ? FRESH_AT_1M
      : FRESH_AT_DEFAULT;
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
        'the remaining work is a single short step, say so and just finish it instead of asking.',
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
const usage = lastUsage();
if (!usage) process.exit(0);
const ctx = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
const FRESH_AT = ctxThreshold();   // null = this window's trigger is switched off
if (FRESH_OFF || FRESH_AT === null || ctx <= FRESH_AT) process.exit(0);

// UserPromptSubmit can only ADD context - exit 2 there erases the prompt and tells the user, not
// the model - so the slash route states the same thing as an instruction and lets the model ask.
if (EVENT === 'UserPromptSubmit') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `/${skill} is a deliberate orchestration run and this session already carries ` +
        `~${Math.round(ctx / 1000)}k tokens per message of another run's history - every turn of the new ` +
        `run re-sends all of it (measured: the same step cost 260k/message chained vs 134k fresh). ` +
        `Do NOT start the run yet. Put it to the user as ONE AskUserQuestion: start it in a fresh ` +
        `session (recommended - end this turn with the paste-ready invocation and the state file it ` +
        `resumes from), or run it here anyway with the cost stated.`,
    },
  }));
  process.exit(0);
}

process.stderr.write(
  `Blocked: ${skill} is a deliberate orchestration run and this session already carries\n` +
  `~${Math.round(ctx / 1000)}k tokens per message of another run's history - every turn of the new run\n` +
  `re-sends all of it (measured: the same step cost 260k/message chained vs 134k fresh).\n` +
  `Put it to the user as ONE AskUserQuestion: start it in a fresh session (recommended - end\n` +
  `this turn with the paste-ready invocation and the state file it resumes from), or run it\n` +
  `here anyway with the cost stated. Do not start the run before that answer lands.`,
);
process.exit(2);
