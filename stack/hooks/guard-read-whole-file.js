#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash): enforce baseline-navigation.md's hard rule - "Read
// is for code you've ALREADY located, never to find a symbol." Blocks a whole-file Read of a
// large source file so navigation goes through serena (get_symbols_overview -> find_symbol)
// first; on Bash it blocks the same dump routed around the Read tool (a bare `cat file.ts` -
// measured: one session cat-ed the exact file the Read matcher had blocked, unblocked, and a
// 47-file grep loop dumped ~19.8k tokens the guard never saw). It also caps CUMULATIVE ranged
// reads per file per session: 2-3 half-splits that reconstruct the whole file satisfied the
// per-call check in 7 files across one run with zero counter-examples, so past ~60% coverage
// the remainder goes through serena. exit 2 = block (stderr fed back); exit 0 = allow.
const fs = require('fs');
const os = require('os');
const pathMod = require('path');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
const GATED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)$/;
// Same extensions, unanchored - a sweep command names its files inside a glob or a loop body,
// never as the string's own tail, so the anchored form above can never match a command line.
const GATED_EXT_ANY = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)\b/i;
// Small files are cheap to read whole. 200, not 100: measured across four real
// sessions (315 blocks), ~71% of blocks hit 100-200-line files where the forced
// serena detour costs about what the whole-file read would - the guard only pays above 200.
const THRESHOLD = 200;
const lineCountOf = (p) => {
  try { return fs.readFileSync(p, 'utf8').split('\n').length; } catch { return 0; }
};
// Resolve a possibly-relative path the way the session sees it. The hook subprocess's own
// cwd is NOT the Bash tool's persisted cwd (a prior `cd` in another call moves it), so a bare
// relative path must be anchored - same anchor the sibling hooks use (measured: 10 relative
// `cat -n` dumps after a `cd` all resolved ENOENT -> lineCount 0 -> the guard silently passed
// ~20k tokens of whole-file dumps; reproduced: the same payload blocks from the project root).
const anchorDirs = [process.env.CLAUDE_PROJECT_DIR, payload.cwd, process.cwd()].filter(Boolean);
const resolveLineCount = (p) => {
  if (pathMod.isAbsolute(p)) return { lc: lineCountOf(p), resolved: true };
  for (const d of anchorDirs) {
    const abs = pathMod.join(d, p);
    if (fs.existsSync(abs)) return { lc: lineCountOf(abs), resolved: true };
  }
  return { lc: 0, resolved: false };
};
const serenaHint = (p) =>
  `Locate first with serena: get_symbols_overview('${p}') then find_symbol(...),\n` +
  `then Read with offset+limit on the returned range (find_symbol with include_body=true only for a SMALL symbol;\n` +
  `for a large body fetch it without the body first, then Read the range you need).`;

const input = payload.tool_input || {};

// ---- Bash matcher: a whole-file dump via cat/sed is the Read block routed around ----
if (payload.tool_name === 'Bash') {
  const command = String(input.command || '');
  if (!/\bcat\b|\bsed\b/.test(command)) process.exit(0);
  // Per pipeline segment: a bare `cat <gated file>` (or sed -n '1,$p') with no limiting
  // filter after it is a whole-file dump; `cat f | head -40` / grep / wc are targeted.
  // Three shapes dumped whole source trees straight past the single-file check above
  // (measured in 5 sessions, 16-23 .cs files each, ~20k tokens a sweep): a shell loop whose
  // cat argument is the loop VARIABLE, a find -exec whose argument is the literal {}, and a
  // multi-file `cat a.cs b.cs` where only the first argument was ever size-checked. None of
  // them can be size-checked per file, and all three are the sweep this gate exists to stop.
  const sweep = /\bfor\s+\w+\s+in\b[^\n]*\bdo\b[^\n]*\bcat\b/i.test(command)
    ? 'a shell loop over a file list'
    : /\bfind\b[^\n]*-exec\s+cat\b/i.test(command)
      ? 'find -exec cat'
      : /\|\s*xargs\s+(?:-\w+\s+)*cat\b/i.test(command)
        ? 'xargs cat'
        : null;
  if (sweep && GATED_EXT_ANY.test(command)) {
    process.stderr.write(
      `Blocked: whole-file sweep of source files via ${sweep}.\n` +
      `Every file in the sweep is dumped unchecked - the per-file size gate cannot see a loop\n` +
      `variable or a find placeholder. Per baseline-navigation.md, locate what you need first\n` +
      `(serena find_symbol / get_symbols_overview, or grep -n for a pattern), then read only the\n` +
      `ranges that matter. If you genuinely need one whole small file, cat it by name.`,
    );
    process.exit(2);
  }
  for (const seg of command.split(/&&|\|\||;|\n/)) {
    if (/\|\s*(head|tail|sed|grep|rg|wc|awk|cut)\b/.test(seg)) continue;
    const catAll = seg.match(/\bcat\s+((?:(?:-\w+|"[^"]+"|'[^']+'|[^\s;&|<>]+)\s*)+)/);
    const files = catAll
      ? catAll[1].trim().split(/\s+/).filter((t) => !t.startsWith('-')).map((t) => t.replace(/^["']|["']$/g, ''))
      : [];
    const sedM = seg.match(/\bsed\s+-n\s+["']1,\$p["']\s+("[^"]+"|'[^']+'|[^\s;&|<>]+)/);
    if (sedM) files.push(sedM[1].replace(/^["']|["']$/g, ''));
    for (const f of files) {
    if (!GATED_EXT.test(f)) continue;
    const { lc, resolved } = resolveLineCount(f);
    if (!resolved) {
      // A dump-shaped command on a gated file whose size we cannot check fails CLOSED -
      // an unresolvable relative path was exactly how whole-file dumps slipped past this
      // matcher. Re-run with an absolute path (or read the located range via serena).
      process.stderr.write(
        `Blocked: cannot size ${f} (relative path did not resolve against the project root or session cwd).\n` +
        `A whole-file cat/sed of a source file must be size-checked - use an absolute path,\n` +
        `or locate the symbol first:\n` + serenaHint(f),
      );
      process.exit(2);
    }
    if (lc > THRESHOLD) {
      process.stderr.write(
        `Blocked: whole-file dump of ${f} (${lc} lines) via Bash.\n` +
        `Per baseline-navigation.md, a bare cat/sed of a large source file is the same\n` +
        `whole-file read the Read gate blocks - routed through the shell.\n` + serenaHint(f),
      );
      process.exit(2);
    }
    }
  }
  process.exit(0);
}

// ---- Read matcher ----
const path = input.file_path || '';
// Only gate source / markup files we navigate by symbol or read by range:
// the symbol-navigable languages the stack's LSP plugins cover (TS/JS family,
// C#, Go), plus large templates (Angular .html, Razor .razor/.cshtml, WPF
// .xaml) where you should read the range. SQL/SCSS/markdown aren't symbol-nav.
if (!GATED_EXT.test(path)) process.exit(0);
const lineCount = lineCountOf(path);
if (lineCount === 0) process.exit(0); // missing/unreadable - let Read surface its own error
if (lineCount <= THRESHOLD) process.exit(0);

const offset = Math.max(1, input.offset ?? 1);
const wholeShape = (input.offset ?? 0) <= 1 && (input.limit == null || input.limit >= lineCount);
// A head window genuinely smaller than the file is targeted; a limit that spans
// the whole file (limit: 2000 from the top) is a whole-file Read wearing a range.
if (wholeShape) {
  process.stderr.write(
    `Blocked: whole-file Read of ${path} (${lineCount} lines).\n` +
      `Per baseline-navigation.md, Read is for code you've ALREADY located - never to find a symbol.\n` +
      `A limit that covers the whole file is still a whole-file Read - and so is\n` +
      `offset 1 with limit = the file's line count (measured: that exact retry got\n` +
      `blocked twice in a row). Read HALF the file or less per range.\n` + serenaHint(path),
  );
  process.exit(2);
}

// Cumulative cap: merge this range into the per-session interval set for the file; if the
// merged coverage would exceed ~60% of the file, the remainder goes through serena - two
// half-splits reconstructing the file are the whole-file read in two calls (measured).
const CAP = 0.6;
const end = Math.min(lineCount, offset + (input.limit != null ? input.limit : lineCount) - 1);
const stateFile = pathMod.join(os.tmpdir(), `guard-read-${(payload.session_id || 'nosession').replace(/[^\w-]/g, '')}.json`);
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* fresh state */ }
const intervals = (state[path] || []).concat([[offset, end]]).sort((a, b) => a[0] - b[0]);
const merged = [];
for (const iv of intervals) {
  const last = merged[merged.length - 1];
  if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]);
  else merged.push([iv[0], iv[1]]);
}
const covered = merged.reduce((n, [a, b]) => n + (b - a + 1), 0);
if (covered > lineCount * CAP) {
  process.stderr.write(
    `Blocked: ranged Reads of ${path} now cover ${Math.round((100 * covered) / lineCount)}% of its ${lineCount} lines this session -\n` +
      `reconstructing a large file from half-splits is the whole-file read the guard exists to stop\n` +
      `(measured: 2-3-call splits rebuilt 7 blocked files in one run). For the remainder:\n` + serenaHint(path),
  );
  process.exit(2);
}
state[path] = merged;
try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* state is best-effort */ }
process.exit(0);
