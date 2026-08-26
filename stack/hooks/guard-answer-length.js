#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// The short-answer contract (baseline-interaction.md: 'at most 3 sentences plus points', 'if the
// user wants deeper detail they will ask') failed as prose the same way every other house mandate
// did: the user re-asked for it as a BRAND NEW rule while both rule copies carried it verbatim,
// and the memory record holds four separate 'you write too much text' / 'shorter and simpler'
// corrections across sessions. Prose guards measured ignored 1/5-1/3 of the time; mechanisms held.
// This hook is the mechanization.
//
// UserPromptSubmit wiring: appends the answer budget to the turn's context, where it lands LAST -
//   immediately before the answer is written, not 30 bullets deep in an always-on rule.
// Stop wiring: an answer whose prose (code blocks, tables and inline spans excluded) runs past the
//   hard cap with no depth request in the user's own message is blocked, and the model re-answers
//   at budget. Deliberately a wall-of-text catch, not a byte-counter: the soft budget lives in the
//   reminder because a Stop block cannot unsay text the user already read - it can only add more.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unparseable.
const fs = require('fs');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const BUDGET = 900; // soft: ~3 sentences plus points, the rule's own shape
const HARD_CAP = 1800; // block: double the budget with no depth request = a wall of text
// An explicit depth request in the user's OWN words lifts the cap for that turn. Deliberately
// narrow: 'explain X' does NOT qualify - the rule caps explanations too ('whether it is work
// output or an explanation'); only an ask for depth, length or a written document does.
const DEPTH_RE = /\b(in detail|detailed|more detail|deep ?dive|in ?depth|elaborate|expand on|walk me through|step[- ]by[- ]step|full (breakdown|analysis|report|list|picture|write[- ]?up)|comprehensive|thorough(ly)?|verbose|long(er)? (answer|version|form)|everything (you|about)|write (me )?(a|the) (plan|report|doc|document|spec|summary)|don'?t (be )?(short|brief))\b/i;
// The same ask in the user's other languages. Kept as its own pattern because JS \b is ASCII-only -
// a word boundary around a Cyrillic stem never matches, so these are matched as bare substrings
// (stems only: 'детальн' covers детально / детальніше / детальный).
const DEPTH_RE_CYR = /(детальн|докладн|подробн|розгорнут|развернут|покроков|пошагов|крок за кроком|шаг за шагом|розпиши|распиши|розбір|разбор|напиши план|повністю|полностью|поясни глибше|глибше|глубже)/i;

// --- transcript tail (last ~512KB): the final assistant message and the user's last real turn ---
function tailLines() {
  const p = payload.transcript_path;
  if (!p) return [];
  const size = fs.statSync(p).size;
  const start = Math.max(0, size - 512 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8').split('\n');
}

function lastMessages() {
  let assistant = null;
  let user = null;
  for (const line of tailLines()) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // partial first line of the tail window
    }
    if (!o || !o.message) continue;
    if (o.type === 'assistant' && Array.isArray(o.message.content)) assistant = o;
    if (o.type === 'user') {
      const c = o.message.content;
      // A tool_result arrives as a user message - only a real typed turn counts.
      const typed = typeof c === 'string'
        ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      if (typed.trim()) user = typed;
    }
  }
  return { assistant, user };
}

// Prose only: code blocks, tables, inline spans and link targets are the parts a short answer is
// allowed to be long in - they carry the payload, not the talking.
function proseOf(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

if (payload.hook_event_name === 'UserPromptSubmit') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        `Answer budget (baseline-interaction.md, house rule): at most 3 sentences plus bullet ` +
        `points, ~${BUDGET} characters of prose. Lead with the result and stop - no preamble, no ` +
        `restating the request, no listing what you considered, no caveat paragraph. Code, ` +
        `tables and command output are exempt and do not count. Write more ONLY if THIS message ` +
        `asked for depth, in ANY language (in detail / walk me through / write a plan; детально, ` +
        `покроково, розпиши); 'explain' by itself does ` +
        `not - explanations are capped too, and short means plainer words, never compressed jargon.`,
    },
  }));
  process.exit(0);
}

if (payload.hook_event_name === 'Stop') {
  if (payload.stop_hook_active) process.exit(0); // continuation we caused - one block per turn
  let last;
  let user;
  try {
    ({ assistant: last, user } = lastMessages());
  } catch {
    process.exit(0);
  }
  if (!last) process.exit(0);
  const blocks = last.message.content;
  if (blocks.some((b) => b && b.type === 'tool_use')) process.exit(0); // ended on a tool call
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  const body = proseOf(text);
  if (body.length <= HARD_CAP) process.exit(0);
  if (user && (DEPTH_RE.test(user) || DEPTH_RE_CYR.test(user))) process.exit(0); // depth asked this turn

  process.stderr.write(
    `This answer is ${body.length} characters of prose - the house budget is ~${BUDGET} (about 3\n` +
    `sentences plus points) and the hard cap is ${HARD_CAP}. Code, tables and command output were\n` +
    `already excluded from that count, and nothing in the user's message asked for depth, so this\n` +
    `is the wall-of-text failure baseline-interaction.md exists to prevent (measured: repeated\n` +
    `'you write too much text' / 'shorter and simpler' corrections with the rule loaded verbatim).\n` +
    `Re-answer now at budget: the result first, then only what the user must act on. Cut preamble,\n` +
    `the recap of what they asked, the options you rejected, the caveats they did not ask for, and\n` +
    `every sentence about your own process. Do NOT apologize, do NOT explain the trim, and do NOT\n` +
    `append the short version to the long one - write the short answer alone. If the detail is\n` +
    `genuinely needed, say one line offering it instead of delivering it.`,
  );
  process.exit(2);
}

process.exit(0);
