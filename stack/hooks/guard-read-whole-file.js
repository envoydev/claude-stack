#!/usr/bin/env node
// PreToolUse gate (matcher: Read): enforce baseline-navigation.md's hard rule - "Read is for
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
// A read starting mid-file is targeted (the model already located the range).
if ((input.offset ?? 0) > 1) {
  process.exit(0);
}
// Small files are cheap to read whole. 200, not 100: measured across four real
// sessions (315 blocks), ~71% of blocks hit 100-200-line files where the forced
// serena detour (error round trip + overview + body pull) costs about what the
// whole-file read would - the guard only pays above 200 lines.
let lineCount = 0;
try {
  lineCount = fs.readFileSync(path, 'utf8').split('\n').length;
} catch {
  process.exit(0); // missing/unreadable - let Read surface its own error
}
const THRESHOLD = 200;
if (lineCount <= THRESHOLD) {
  process.exit(0);
}
// A head window genuinely smaller than the file is targeted; a limit that spans
// the whole file (limit: 2000 from the top) is a whole-file Read wearing a range.
if (input.limit != null && input.limit < lineCount) {
  process.exit(0);
}
process.stderr.write(
  `Blocked: whole-file Read of ${path} (${lineCount} lines).\n` +
    `Per CLAUDE.md, Read is for code you've ALREADY located - never to find a symbol.\n` +
    `A limit that covers the whole file is still a whole-file Read.\n` +
    `Locate first with serena: get_symbols_overview('${path}') then find_symbol(...),\n` +
    `then Read with offset+limit on the returned range (find_symbol with include_body=true only for a SMALL symbol;\n` +
    `for a large body fetch it without the body first, then Read the range you need).\n` +
    `If you genuinely need the whole file, Read it in explicit ranges.`,
);
process.exit(2);
