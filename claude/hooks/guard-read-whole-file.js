#!/usr/bin/env node
// PreToolUse gate (matcher: Read): enforce CLAUDE.md's hard rule - "Read is for
// code you've ALREADY located, never to find a symbol." Blocks a whole-file Read
// of a large source file so navigation goes through serena (get_symbols_overview
// -> find_symbol) first. exit 2 = block (stderr fed back to the model); exit 0 = allow.
const fs = require('fs');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
const input = payload.tool_input || {};
const path = input.file_path || '';
// Only gate source / markup files we navigate by symbol or read by range:
// the symbol-navigable languages the stack's LSP plugins cover (TS/JS family,
// C#, Go), plus large templates (Angular .html, Razor .razor/.cshtml, WPF
// .xaml) where you should read the range. SQL/SCSS/markdown aren't symbol-nav.
if (!/\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)$/.test(path)) {
  process.exit(0);
}
// A targeted read (the model already located the range) is allowed.
if (input.offset != null || input.limit != null) {
  process.exit(0);
}
// Small files are cheap to read whole.
let lineCount = 0;
try {
  lineCount = fs.readFileSync(path, 'utf8').split('\n').length;
} catch {
  process.exit(0); // missing/unreadable - let Read surface its own error
}
const THRESHOLD = 100;
if (lineCount <= THRESHOLD) {
  process.exit(0);
}
process.stderr.write(
  `Blocked: whole-file Read of ${path} (${lineCount} lines).\n` +
    `Per CLAUDE.md, Read is for code you've ALREADY located - never to find a symbol.\n` +
    `Locate first with serena: get_symbols_overview('${path}') then find_symbol(...),\n` +
    `then Read with offset+limit on the returned range (or find_symbol with include_body=true).\n` +
    `If you genuinely need the whole file, Read it in explicit ranges.`,
);
process.exit(2);
