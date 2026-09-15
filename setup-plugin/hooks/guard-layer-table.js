#!/usr/bin/env node
// PreToolUse (AskUserQuestion): a guided-walk ask must follow the PASTED table it asks about.
// setup / configure / validate render each layer's catalog with `stack-select.js --table <layer>`
// and the command body mandates pasting that output before the selection ask. As prose it failed:
// a real setup run asked the agents question naming rows '3-5, 11-19, 32-34' with no table on
// screen, and the user had to answer 'I do not see any table'. The tool result is collapsed in the
// UI, so only the assistant's own text reaches the user.
// Lives in the PLUGIN, not stack/hooks: a fresh setup has no stack hooks until its install step.
// Decision tables: `stack-select.js --table <layer>` (proof: its `total: N <layer>` footer) and the
// `plugin-settings.js` report without `--apply` (proof: the result's closing line). Fires only when
// the LATEST such call has no proof in the assistant text after it. It keeps denying: the measured skills turn announced 'pasted
// below' three times running with no table, and once in the ask's preview panel, which the user
// never saw. A valve lets the ask through after MAX_DENIALS for the same table call, so a paste
// the transcript never shows cannot loop the walk forever.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unreadable.
const fs = require('fs');

const MARKER = 'claude-stack layer-table gate';
const MAX_DENIALS = 3;

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || payload.tool_name !== 'AskUserQuestion' || !payload.transcript_path) process.exit(0);

let rows;
try {
  const p = payload.transcript_path;
  const size = fs.statSync(p).size;
  const start = Math.max(0, size - 512 * 1024);
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  rows = buf.toString('utf8').split('\n');
} catch {
  process.exit(0);
}

// A trailing-backslash continuation keeps the command on one logical line.
const TABLE_RE = /stack-select\.js\b(?:[^\n]|\\\r?\n)*?--table\s+["']?([a-z]+)/;
const SETTINGS_RE = /plugin-settings\.js\b/;
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('\n') : '');

// Walk backwards: collect assistant text, tool results and our own earlier denials until the latest
// decision-table call.
let texts = '';
let denials = 0;
let table = null;   // { name, proof: RegExp | null, id }
const results = {};
for (let i = rows.length - 1; i >= 0 && !table; i--) {
  let o;
  try { o = JSON.parse(rows[i]); } catch { continue; }
  const content = o && o.message && o.message.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (!b) continue;
    if (o.type === 'assistant' && b.type === 'text') texts += `\n${b.text || ''}`;
    if (o.type === 'user' && b.type === 'tool_result') {
      const r = resultText(b.content);
      if (r.includes(MARKER)) denials += 1;
      results[b.tool_use_id] = r;
    }
    if (o.type === 'assistant' && b.type === 'tool_use') {
      const cmd = String((b.input && b.input.command) || '');
      const m = TABLE_RE.exec(cmd);
      if (m) table = { name: `${m[1]} table`, proof: new RegExp(`total:\\s*\\d+\\s+${m[1]}\\b`) };
      else if (SETTINGS_RE.test(cmd) && !/--apply\b/.test(cmd)) {
        const last = (results[b.id] || '').split('\n').map((l) => l.trim()).filter(Boolean).pop();
        // no result read back (a truncated tail) - nothing to prove against, so nothing to deny; and a
        // run with `nothing to offer` printed no table, which setup skips silently (measured: every
        // later ask was denied three times over a table that never existed)
        const noTable = !last || /nothing to offer/.test(results[b.id] || '');
        table = { name: 'plugin-settings report', proof: noTable ? null : { test: (t) => t.includes(last) } };
      }
    }
  }
}

if (!table || !table.proof || denials >= MAX_DENIALS) process.exit(0);
if (table.proof.test(texts)) process.exit(0);

process.stderr.write(
  `${MARKER}: the ${table.name} ran but its output is not in your message - the tool result is ` +
  `collapsed, so the user sees no table. Table before question: re-send this turn as the step banner, ` +
  `then the tool output byte-for-byte inside a fenced code block, then this same ask. Writing 'pasted below' or 'shown above' ` +
  `is not a paste, and the ask's preview panel does not count. Never summarize the rows into prose.\n`);
process.exit(2);
