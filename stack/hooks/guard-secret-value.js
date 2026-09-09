#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash), plus a CLI mode: baseline-security.md's rule that a
// credential is read for its PRESENCE, never its value - mechanized. Measured: the rule held only
// as prose, and a session checking whether SENTRY_ACCESS_TOKEN was set printed the whole env block
// with `console.log(JSON.stringify(s.env))` on its first attempt (the value landed in the tool
// result and the transcript; the presence-only phrasing came on the second). The settings.json
// permissions.deny covers the Read TOOL on the ACCOUNT files only - a project settings.json that
// wrongly holds the token, and every shell route (cat, jq, grep, an inline node/python read, an
// `echo $VAR`, a bare `env`), passed every guard in the stack. This gate judges CONTENT, not paths:
// a dump verb on a JSON or dotenv file holding a credential-shaped key with a live value, a print
// of a credential-shaped variable, a whole-environment dump, and a credential-shaped literal typed
// into a command. On the SHELL route the dump, the variable print and the environment dump are
// REWRITTEN on the way out (hookSpecificOutput.updatedInput) rather than blocked - a block cost a
// red denial plus a retried turn and, remote, left the user nothing they could run: the model gets
// the file back with every credential value shown as <set (N chars)> and the rest as written, the
// variable as its presence line, the environment as a masked listing. The Read tool and a literal
// stay blocked. The sanctioned reads are this file's own CLI modes, so a denial and a rewrite
// always name a route that exists wherever the guard does:
//   node guard-secret-value.js --presence <file> [KEY ...]   ->   KEY=set (N chars) | KEY=absent
//   node guard-secret-value.js --redacted <file>            ->   the file, credential values masked
//   node guard-secret-value.js --redacted-env               ->   the environment, the same way
// exit 2 = block (stderr fed back); exit 0 = allow, or a JSON rewrite on stdout.
'use strict';
const fs = require('fs');
const os = require('os');
const pathMod = require('path');
// The docs root env value. CLAUDE_STACK_DOCS_PATH is the name; CLAUDE_DOCS_PATH is the pre-0.2.43
// spelling, still read so a project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => process.env.CLAUDE_STACK_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs';

// Keys whose value is a credential - the SAME string as meta/environment.json `secret_key_pattern`
// (npm run lint fails when the two differ), matched case-insensitively so `apiKey` and `API_KEY`
// judge alike. The hook ships without meta/, hence the copy.
const SECRET_KEY_SOURCE = '(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$';
const SECRET_KEY_RE = new RegExp(SECRET_KEY_SOURCE, 'i');
// The value shapes the stack's credentials take - copied from guard-stop-contract.js; keep identical.
const SECRET_SHAPE = /\b(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// A credential file is small - a settings.json is under 10 KB - so the cap costs this gate nothing
// on the files it exists for. The trade it makes is deliberate and stated: a larger file holding a
// credential passes unscanned, because it is a data dump, which guard-read-whole-file.js is the gate
// for, and scanning megabytes on every Bash call would cost every session for that one shape.
const MAX_BYTES = 512 * 1024;

// A `${VAR}` placeholder or a blank is not a live value - .mcp.json carries `${SENTRY_ACCESS_TOKEN}`
// by design, and an installer seeds `"SENTRY_ACCESS_TOKEN": ""` for the user to fill in.
const isPlaceholder = (v) => typeof v === 'string' && /^\$\{[^}]*\}$/.test(v.trim());
const isLive = (v) => typeof v === 'string' && v.trim() !== '' && !isPlaceholder(v);

// CONTENT tells that a credential-shaped KEY is not holding a credential - the false positives the
// key name alone cannot separate (measured on real projects): an i18n bundle's `"password":
// "Password"`, an MV3 manifest's `"key": "MIIB..."` (a PUBLIC key), a `.env.example`'s
// `API_KEY=your-api-key-here`. A value that repeats its own key, carries whitespace (a label, not a
// token), reads as placeholder vocabulary, or starts with `MII` (DER/base64 public key) is a sample.
// These apply to the FILE judgement only - `--presence` still reports a placeholder as such, since
// there the placeholder IS the answer. Accepted gap: a test fixture holding a fake credential under
// a credential-shaped key (`"apiKey": "test-key-1234"`) has no content tell and still blocks - read
// it through `--presence`, or rename the key.
const TEMPLATE_VALUE = /^(?:your[-_]|<[^>]+>$|changeme|x{3,}$|\.\.\.$|todo|replace|example|dummy|placeholder)/i;
const isSampleValue = (key, v) => {
  const s = String(v).trim();
  return s.toLowerCase() === String(key).toLowerCase() || /\s/.test(s) || TEMPLATE_VALUE.test(s) || s.startsWith('MII');
};
const holdsCredential = (key, v) => isLive(v) && !isSampleValue(key, v);
// A file-SHAPE tell: a basename ending .example / .sample / .template / .dist ships the KEYS, never
// the values - judging it blocks the one file a session legitimately reads to learn what to fill in.
const TEMPLATE_FILE = /\.(?:example|sample|template|dist)$/i;

// The dotted path of the first credential-shaped key holding a live string, or null. Depth-capped:
// a settings file is shallow, and the cap keeps a pathological JSON from costing the call.
function secretKeyIn(node, prefix, depth) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(node)) {
    const here = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') { if (SECRET_KEY_RE.test(k) && holdsCredential(k, v)) return here; }
    else { const hit = secretKeyIn(v, here, depth + 1); if (hit) return hit; }
  }
  return null;
}
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2');
// Lines split on CRLF as well as LF: DOTENV_LINE ends in `(.*)$` and `.` never crosses a line
// terminator, so a Windows-authored .env split on `\n` alone matched NO line - a live key passed
// and --presence reported every key absent (reproduced with a CRLF fixture).
const LINES = /\r?\n/;
function secretLineIn(text) {
  for (const line of text.split(LINES)) {
    const m = line.match(DOTENV_LINE);
    if (m && SECRET_KEY_RE.test(m[1]) && holdsCredential(m[1], unquote(m[2]))) return m[1];
  }
  return null;
}
// Judge one file by CONTENT: the key that makes it a credential file, or null. JSON first (a
// settings.json, .mcp.json, appsettings.json), dotenv second; anything else - source code, docs -
// is never a credential file here (source dumps are guard-read-whole-file's concern).
function secretIn(file) {
  let text;
  if (TEMPLATE_FILE.test(pathMod.basename(String(file)))) return null;
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch { return null; }
  try { return secretKeyIn(JSON.parse(text), '', 0); } catch { /* not JSON */ }
  const first = text.split(LINES).find((l) => l.trim() && !l.trim().startsWith('#')) || '';
  return DOTENV_LINE.test(first) ? secretLineIn(text) : null;
}

// Git Bash / MSYS spell a Windows path in POSIX mount form (`/c/Users/...`), which node on win32
// resolves against the CURRENT drive instead. Translate before resolving; off Windows the spelling
// is a real POSIX path and is never touched.
const MOUNT_RE = /^(?:\/cygdrive)?\/([A-Za-z])(?=\/|$)/;
const nativePath = (p) => (process.platform === 'win32' ? String(p).replace(MOUNT_RE, (m, d) => `${d.toUpperCase()}:\\`) : String(p));
const HOME = os.homedir() || '';
const accountDir = () => process.env.CLAUDE_CONFIG_DIR || pathMod.join(HOME, '.claude');
// The variables a credential path is spelled with (`~`, $HOME, $CLAUDE_PROJECT_DIR,
// $CLAUDE_CONFIG_DIR - also in the `${VAR:-default}` form), PLUS the NAME=value assignments the
// command itself makes: `f=<file>; cat $f` put the path one segment away from the token scan and
// nothing judged it. Values are lists because `for f in <glob>` binds several. Any other `$` is an
// unexpanded variable this guard cannot judge (the cross-project guard's rule) - the token is
// skipped rather than guessed at.
const VARS = new Map([
  ['HOME', [HOME]],
  ['CLAUDE_PROJECT_DIR', [process.env.CLAUDE_PROJECT_DIR || '']],
  ['CLAUDE_CONFIG_DIR', [accountDir()]],
]);
const KNOWN_VARS = () => { const o = {}; for (const [k, v] of VARS) o[k] = v[0]; return o; };
function expandPath(token) {
  const known = KNOWN_VARS();
  let p = String(token).replace(/^["'`]|["'`]$/g, '').replace(/^~(?=\/|$)/, HOME);
  p = p.replace(/\$\{(\w+)(?::-[^}]*)?\}|\$(\w+)/g, (m, a, b) => (known[a || b] != null ? known[a || b] : m));
  // `my\ dir/settings.json` is one token the shell hands over with the space intact.
  return /\$/.test(p) ? null : nativePath(p.replace(/\\ /g, ' '));
}
// A variable bound to several paths (a `for` list) becomes several tokens; a single value is left
// to expandPath. Capped - a fan-out is a convenience, not a search.
function fanOut(token) {
  const out = [];
  const re = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/;
  const walk = (t, depth) => {
    if (out.length >= 20) return;
    const m = t.match(re);
    const vals = m && VARS.get(m[1] || m[2]);
    if (!vals || vals.length < 2 || depth > 2) { out.push(t); return; }
    for (const v of vals) walk(t.slice(0, m.index) + v + t.slice(m.index + m[0].length), depth + 1);
  };
  walk(String(token), 0);
  return out;
}
let payload; // set below; resolveFile reads its cwd
// A `cd` earlier in the command moves the anchor for everything after it (the house pattern is
// guard-cross-project-write.js): `cd .claude && cat settings-secret.json` named no path the scan
// could resolve. The default anchors stay in the list - a cd this guard cannot follow (`cd -`, an
// unexpanded variable) leaves the judgement exactly where it was, never worse.
let cwdAnchor = null;
// The anchors a relative path is tried against. A payload field is attacker-shaped input, not a
// promise: a non-string `cwd` reached pathMod.join and threw ERR_INVALID_ARG_TYPE, and a hook that
// exits 1 fails OPEN - the dump it was judging ran (review finding, reproduced with `"cwd": 5`).
const anchorDirs = () => [...new Set([cwdAnchor, process.env.CLAUDE_PROJECT_DIR, payload && payload.cwd, process.cwd()]
  .filter((d) => typeof d === 'string' && d))]; // deduped - the project dir and the cwd are usually one directory, listed once
// The account dir is an anchor only for a segment that SPELLS it (`os.homedir()`, `expanduser('~')`,
// `$USERPROFILE`) with a bare settings file name - the runtime shape that builds the path at run
// time and hands the scan no path at all.
let homeAnchor = false;
const ACCOUNT_FILE = /^settings(?:\.local)?\.json$/;

// Brace alternatives (`{settings,x}.json`) - one group per pass, no whitespace or quotes inside,
// which keeps a JSON literal out of the expansion. The cap binds the WORKLIST, not just the result:
// the recursive form capped what it pushed but not what it visited, and 26 groups cost 23s against
// the hook's 10s timeout, which fails open (re-review). A pass costs at most 20 strings, and the
// alternatives past the cap are dropped - a 20-way brace is noise, not a path a model types.
const BRACE_GROUP = /\{([^{}\s"']*,[^{}\s"']*)\}/;
function expandBraces(p) {
  let out = [p];
  for (;;) {
    const next = [];
    let expanded = false;
    for (const s of out) {
      const m = s.match(BRACE_GROUP);
      if (!m) { next.push(s); continue; }
      expanded = true;
      for (const alt of m[1].split(',')) {
        if (next.length < 20) next.push(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length));
      }
    }
    out = next;
    if (!expanded) return out;
  }
}
const GLOB_CHARS = /[*?[]/;
const globToRe = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
// `cat .env*` and `cat .claude/*.json` name the file as surely as spelling it out. ONE directory
// listing per glob token - the first anchor that has a match wins, and only the LAST path component
// may glob (a glob in a directory component would need a walk, and this hook runs on every Bash call).
function globPaths(p) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const dirPart = idx >= 0 ? p.slice(0, idx) : '';
  const pat = idx >= 0 ? p.slice(idx + 1) : p;
  if (!GLOB_CHARS.test(pat) || GLOB_CHARS.test(dirPart)) return [];
  let re;
  try { re = globToRe(pat); } catch { return []; }
  const dirs = dirPart === '' ? anchorDirs()
    : pathMod.isAbsolute(dirPart) ? [dirPart] : anchorDirs().map((d) => pathMod.join(d, dirPart));
  for (const d of dirs) {
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    const hits = names.slice(0, 200).filter((n) => re.test(n)).map((n) => pathMod.join(d, n));
    if (hits.length) return hits;
  }
  return [];
}
// One token -> every path it can name: a list variable's values, brace alternatives, glob matches.
function candidatePaths(token) {
  const out = [];
  for (const t of fanOut(token)) {
    const p = expandPath(t);
    if (!p) continue;
    for (const b of expandBraces(p)) {
      if (GLOB_CHARS.test(b)) out.push(...globPaths(b));
      else if (b) out.push(b);
    }
  }
  return out;
}
function statFile(p) {
  const cands = pathMod.isAbsolute(p) ? [p]
    : (homeAnchor && ACCOUNT_FILE.test(p) ? [pathMod.join(accountDir(), p)] : []).concat(anchorDirs().map((d) => pathMod.join(d, p)));
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next anchor */ } }
  return null;
}
function resolveFile(token) {
  for (const p of candidatePaths(token)) { const f = statFile(p); if (f) return f; }
  return null;
}

// ---- the user's own allowance for THIS session -------------------------------------------------
// A block or a redacted view ends in an ask, and the 'show or use it' answer has to be honourable or
// the ask offers a route this guard then denies. A remote user cannot run the copy-ready command in
// their own terminal - the bare denial took the decision away from them. So the answer is a receipt
// this guard reads: <docs-path>/flow/SECRET-READ-ALLOW, one entry per line ('#' comments allowed) -
// a file path (that file may be read or dumped), a variable NAME (that variable may be printed), or
// `*` (everything, this session). Session-scoped the way the dispatch guard's APPROVAL stamp is:
// older than 8h, or written before this session began (the transcript's birthtime where the
// filesystem reports a real one), reads as absent. While any entry is live the credential-literal
// check is relaxed too - the value the user chose to expose may be placed into a file. The default
// stays the redacted view: a model improvising a presence check is still the measured incident.
const MAX_RECEIPT_AGE_MS = 8 * 60 * 60 * 1000;
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return pathMod.resolve(p); } };
function readReceipt(root, transcriptPath) {
  const r = { path: pathMod.resolve(root, docsRootEnv(), 'flow', 'SECRET-READ-ALLOW'), stale: false, all: false, files: new Set(), names: new Set(), live: false };
  try {
    const st = fs.statSync(r.path);
    let sessionStartMs = 0;
    try {
      const t = fs.statSync(String(transcriptPath || ''));
      sessionStartMs = t.birthtimeMs && t.birthtimeMs !== t.ctimeMs ? t.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > MAX_RECEIPT_AGE_MS || (sessionStartMs && st.mtimeMs < sessionStartMs)) {
      r.stale = true;
    } else {
      for (const rawLine of fs.readFileSync(r.path, 'utf8').split(LINES)) {
        const e = rawLine.trim();
        if (!e || e.startsWith('#')) continue;
        if (e === '*') r.all = true;
        else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(e)) r.names.add(e);
        else {
          const p = expandPath(e);
          if (p) r.files.add(realOf(pathMod.isAbsolute(p) ? p : pathMod.join(anchorDirs()[0] || process.cwd(), p)));
        }
      }
    }
  } catch { /* absent or unreadable - no allowance recorded */ }
  r.live = r.all || r.files.size > 0 || r.names.size > 0;
  return r;
}
// The one sentence every denial and every redacted view ends on: the block or the placeholder is the
// default, the user's answer is honoured. It names the RESOLVED receipt path - the docs root may be
// absolute, and a relative spelling of it is one the model would have to re-anchor.
const askLine = (r) =>
  'If the VALUE itself is what the user needs - shown to them, or placed where a blind copy (jq ... > file, cp, sed -i) ' +
  'cannot reach - do not decide for them: end this turn with ONE AskUserQuestion carrying, in this order, ' +
  "'Presence only (Recommended)', 'Show or use the value this session - it enters the transcript permanently', 'Drop it'. " +
  `On the second answer write the receipt ${r.path} with the file path, the variable NAME, or \`*\` (everything, this session) ` +
  'on its own line, then retry; it is honoured for this session only, under 8h' +
  (r.stale ? ' - the receipt there now is stale (older than 8h, or written before this session began), so rewrite it only on a fresh answer' : '') + '.';
// A note the rewritten call prints as its first line, so the model reads what happened and the route
// to the value in the same tool result - nothing is fed back through a denial.
const noteLine = (what, r) => `# credential guard: ${what} A value never enters the chat. ${askLine(r)}`;
// Inside a double-quoted shell string: the three characters bash still reads there, and a backslash
// only where bash would read IT - before one of those, before another backslash, or at the end. A
// Windows path's own backslashes stay as they are: doubling every one named `D:\\a\\...` for
// `D:\a\...` (measured on windows-latest), a path that is not the file's.
const shDouble = (s) => String(s).replace(/\\(?=["$`\\]|$)|["$`]/g, (c) => '\\' + c);
const SECRET_SHAPE_G = new RegExp(SECRET_SHAPE.source, 'g');
// A value is masked when its KEY is credential-shaped and it holds a credential, or when the value
// itself has a known credential SHAPE whatever the key - the one case the key test cannot see.
const maskable = (k, v) => typeof v === 'string' && ((SECRET_KEY_RE.test(k) && holdsCredential(k, v)) || SECRET_SHAPE.test(v));

// ---- CLI mode: the sanctioned presence-only read --------------------------------------------
// `node guard-secret-value.js --presence <file> [KEY ...]` - what the denials and the guided
// commands name. Prints a length or `absent`, never a value; a missing file is reported, not thrown.
if (process.argv[2] === '--presence') {
  const fileArg = String(process.argv[3] || '');
  const keys = process.argv.slice(4);
  const file = nativePath(fileArg.replace(/^~(?=\/|$)/, HOME));
  const out = [];
  let text = null;
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { out.push(`# ${fileArg}: not found`); }
  let entries = {};
  if (text != null) {
    try {
      const j = JSON.parse(text);
      entries = (j && typeof j.env === 'object' && j.env) ? j.env : (j && typeof j === 'object' && !Array.isArray(j) ? j : {});
    } catch {
      for (const line of text.split(LINES)) { const m = line.match(DOTENV_LINE); if (m) entries[m[1]] = unquote(m[2]); }
    }
  }
  const names = keys.length ? keys : Object.keys(entries).filter((k) => typeof entries[k] === 'string');
  for (const k of names) {
    const v = entries[k];
    out.push(isLive(v) ? `${k}=set (${v.length} chars)` : isPlaceholder(v) ? `${k}=absent (placeholder ${v.trim()})` : `${k}=absent`);
  }
  process.stdout.write(out.length ? out.join('\n') + '\n' : '');
  process.exit(0);
}
// `node guard-secret-value.js --redacted <file>` - what a shell dump of a credential file is rewritten
// into: the file with every credential value replaced by `<set (N chars)>` and the rest as written
// (the hook wiring a session inspects in a settings.json, the non-secret keys of a dotenv), led by a
// note saying so and naming the route to the value. JSON is re-emitted from its parse; a dotenv is
// masked line by line, and a credential SHAPE anywhere in the text is masked whatever surrounds it.
if (process.argv[2] === '--redacted') {
  const fileArg = String(process.argv[3] || '');
  const file = nativePath(fileArg.replace(/^~(?=\/|$)/, HOME));
  const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || process.cwd(), null);
  let text = null;
  let out = '';
  try {
    if (fs.statSync(file).size > MAX_BYTES) out = `# ${fileArg}: larger than ${MAX_BYTES} bytes - not a credential file this guard judges; read it in ranges\n`;
    else text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch { out = `# ${fileArg}: not found\n`; }
  if (text != null) {
    let masked = 0;
    const mask = (v) => { masked++; return `<set (${v.length} chars)>`; };
    let body;
    try {
      const walk = (node) => {
        if (typeof node === 'string') return SECRET_SHAPE.test(node) ? mask(node) : node;
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
          const o = {};
          for (const [k, v] of Object.entries(node)) o[k] = maskable(k, v) ? mask(v) : walk(v);
          return o;
        }
        return node;
      };
      body = JSON.stringify(walk(JSON.parse(text)), null, 2) + '\n';
    } catch {
      body = text.split(LINES).map((line) => {
        const m = line.match(DOTENV_LINE);
        if (m && maskable(m[1], unquote(m[2]))) return `${m[1]}=${mask(unquote(m[2]))}`;
        return line.replace(SECRET_SHAPE_G, (s) => mask(s));
      }).join('\n');
    }
    out = noteLine(`redacted view of ${file} - ${masked} credential value(s) shown as <set (N chars)>, everything else as written.`, receipt) + '\n' + body;
  }
  process.stdout.write(out);
  process.exit(0);
}
// `node guard-secret-value.js --redacted-env` - what a whole-environment dump is rewritten into: every
// variable as env prints it, a credential-shaped NAME holding a credential (or any value of a known
// credential shape) as `<set (N chars)>`. Accepted gap, stated: a credential under a name this
// pattern does not match and with no known shape prints as env would print it.
if (process.argv[2] === '--redacted-env') {
  const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || process.cwd(), null);
  const lines = [];
  let masked = 0;
  for (const k of Object.keys(process.env).sort()) {
    const v = String(process.env[k]);
    if (maskable(k, v)) { masked++; lines.push(`${k}=<set (${v.length} chars)>`); } else lines.push(`${k}=${v}`);
  }
  process.stdout.write(noteLine(`the environment with ${masked} credential value(s) shown as <set (N chars)>, everything else as env prints it.`, receipt) + '\n' + lines.join('\n') + '\n');
  process.exit(0);
}

try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
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

const input = payload.tool_input || {};
const receipt = readReceipt(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), payload.transcript_path);
const receiptLive = receipt.live;
const allowAll = receipt.all;
const allowedNames = receipt.names;
const fileAllowed = (file) => allowAll || receipt.files.has(realOf(file));
const secretInUnlessAllowed = (file) => (fileAllowed(file) ? null : secretIn(file));
// Every denial ends in the ask mandate: the block is the default, the user's answer is honoured.
const askHint = () => '\nIf PRESENCE answers the question, take the presence route and do not ask. ' + askLine(receipt) + '\n';
const block = (msg) => { process.stderr.write(msg + askHint()); process.exit(2); };
// The shell route's verdict: the call is REPLACED (hookSpecificOutput.updatedInput) by one that
// prints the placeholder form, and the tool runs that instead - no denial, no retried turn, and the
// note on its first line carries the route to the value. Not a block, so no ledger row: the ledger
// counts the turns a gate costs, and a rewrite costs none.
const rewrite = (command) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { command } } }));
  process.exit(0);
};
const presenceHint = (file) =>
  `Per baseline-security.md a credential is read for PRESENCE only:\n` +
  `  node "${__filename}" --presence "${file}" [KEY ...]   ->  KEY=set (N chars) | KEY=absent\n` +
  `A shell dump of it - cat "${file}" - is rewritten into the redacted view for free:\n` +
  `  node "${__filename}" --redacted "${file}"   ->  the file, every credential value shown as <set (N chars)>\n` +
  `Never echo the value, never pass it to a tool, never ask for it in the chat - the user sets it in\n` +
  `the file by hand. A credential in a PROJECT settings.json belongs in the ACCOUNT file\n` +
  `(~/.claude/settings.json, or the space's): only that env reaches .mcp.json expansion.\n`;

// The verbs that print a file, and the runtimes whose inline reads do the same with a different
// spelling. `grep` is a dump verb: `grep -n SENTRY settings.json` prints the value's whole line.
// The second half of the list is the review's: `tac`, `base64`, `xxd` and friends print the same
// bytes in a different order or encoding, and a dump verb only matters when its file token holds a
// live credential, so the false-positive cost of a long list is nil. `cp` and `dd` are NOT here -
// `cp .env .env.bak` is a legitimate backup, and it prints nothing.
const DUMP_VERB = /\b(?:cat|head|tail|sed|less|more|awk|jq|bat|strings|grep|rg|egrep|fgrep|tac|nl|pr|od|xxd|hexdump|base64|paste|fold|column|sort|uniq|cut|tee)\b/;
const RUNTIME = /\b(?:node|python3?|perl|ruby|deno|bun|pwsh|powershell)\b/;
// A heredoc body is DATA, not shell: a plan that merely DESCRIBES `cat ~/.claude/settings.json` is
// inert text (reproduced against the sibling guards). Blank the payload spans, keeping the character
// count so any index into the command still holds - EXCEPT when the heredoc feeds a runtime or a
// shell (`python3 - <<'EOF'`, `bash <<'EOF'`), where the body is the command and blanking it hid
// the dump completely (review finding). Those bodies come back in `code` to be judged as code.
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm;
const CODE_HEREDOC = new RegExp(`(?:${RUNTIME.source}|\\b(?:bash|sh|zsh|dash)\\b)`);
function stripHeredocsOf(c, code) {
  return c.replace(HEREDOC_RE, (m, q, tag, offset) => {
    const head = c.slice(c.lastIndexOf('\n', offset) + 1, offset);
    if (code && CODE_HEREDOC.test(head)) {
      code.push({ body: m.replace(/^[^\n]*\n?/, '').replace(/\n[^\n]*$/, ''), runtime: RUNTIME.test(head) });
    }
    return m.replace(/[^\n]/g, ' ');
  });
}
// `#` starts a comment only at the start of a word outside quotes - `${#VAR}` is a length. Judging
// the comment text let `cat <secret> # wc` borrow an exemption from a word the shell never runs.
function stripComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { out += text[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { out += ch + text[++i]; continue; }
    if (ch === '"' || ch === '\'') { quote = ch; out += ch; continue; }
    if (ch === '#' && (out === '' || /[\s;|&(]$/.test(out))) { while (i + 1 < text.length && text[i + 1] !== '\n') i++; continue; }
    out += ch;
  }
  return quote ? text : out; // an unbalanced quote: judge the raw text rather than guess where it ends
}
// A stage that REDUCES its input to presence - a count, a length, a key list, names without values.
// Scoped to the stage's own command word: `\bwc\b` matched inside `grep -v wc`, and `jq keys`
// matched `jq 'keys, .'`, which prints the whole document beside the keys (review findings).
const PREFIX_WORDS = /^\s*(?:(?:sudo|command|nice|time|exec|builtin|nohup|\w+=\S*)\s+)*/;
function jqReduces(stage) {
  let filter = null;
  for (const t of shellTokens(stage).slice(1)) { if (t.startsWith('-')) continue; filter = t.replace(/^(['"])([\s\S]*)\1$/, '$2'); break; }
  if (filter == null || filter.includes(',')) return false; // `,` prints both sides
  // `keys[]` is the same name list one per line - the `-r` idiom for reading names.
  return /^(?:keys(?:_unsorted)?(?:\[\])?|length|type|has\([^)]*\))$/.test(filter.split('|').pop().trim());
}
function isReducer(stage) {
  const s = stage.replace(PREFIX_WORDS, '');
  if (/^wc\b/.test(s)) return true;
  if (/^(?:grep|rg|egrep|fgrep)\s+(?:-\w*[clLq]\b|--count\b|--files-with-matches\b|--quiet\b)/.test(s)) return true;
  if (/^cut\s+(?:-d\s*['"]?=['"]?|--delimiter[= ]['"]?=['"]?)\s+-f\s*1(?![\d,\-])/.test(s)) return true; // -f1 is the NAME; -f2 and -f1- carry the value
  if (/^awk\s+-F\s*['"]?=/.test(s) && /\$1\b/.test(s) && !/\$(?:0|[2-9])/.test(s)) return true;
  if (/^sed\s+['"]?s\/=\.\*\/\//.test(s)) return true;
  if (/^jq\b/.test(s)) return jqReduces(s);
  return false;
}
// A redirect into a FILE never reaches the context - but `/dev/stdout`, `/dev/stderr` and `/dev/tty`
// ARE the context, and a `tee` stage writing to one prints everything upstream of the reducer.
// Only STDOUT's redirect (`>` or `1>`) excuses a segment: a `2>/dev/null` moves stderr and leaves
// the dump on stdout - the `\d?` that accepted it let `cat <file> 2>/dev/null` pass (re-review).
const TERMINAL_DEV = /^\/dev\/(?:std(?:out|err)|tty|fd\/[12])$/;
const REDIRECT_RE = /(?:^|\s)1?>>?\s*([^&\s>|]+)/g;
const redirectsToFile = (seg) => [...seg.matchAll(REDIRECT_RE)].some((m) => !TERMINAL_DEV.test(m[1]));
const teesToTerminal = (stage) => /^tee\b[^|]*?(\/dev\/(?:std(?:out|err)|tty|fd\/[12]))\b/.test(stage.replace(PREFIX_WORDS, ''));

// Split `text` at the separators `sepAt` reports (their length at position i, 0 for none),
// honouring quotes: an escaped char outside quotes and inside double quotes is skipped, single
// quotes take no escapes (bash semantics). FAIL SAFE: a quote left open at the end (a typo, a
// truncated input, a `\` before a closing quote) would otherwise swallow the rest into one piece,
// where any exemption substring could excuse a real dump (review finding) - so an unbalanced scan
// falls back to the quote-blind `blind` split, which judges every operator-separated piece.
function splitOutsideQuotes(text, sepAt, blind) {
  const parts = [];
  let cur = '';
  let quote = null; // the quote character we are inside, or null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[++i]; continue; } // an escaped char inside double quotes
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[++i]; continue; } // an escaped char outside quotes
    if (ch === '"' || ch === '\'') { quote = ch; cur += ch; continue; }
    const n = sepAt(text, i);
    if (n) { parts.push(cur); cur = ''; i += n - 1; continue; }
    cur += ch;
  }
  parts.push(cur);
  return quote ? blind(text) : parts;
}
// Segments split on `&&`, `||`, `;` and newline OUTSIDE quotes: a runtime's inline code carries
// `;` inside its quoted argument (`python3 -c "import json;print(...)"`), and a naive split
// separated the runtime word from the segment holding the file path, so neither half matched.
const splitSegments = (cmd) => splitOutsideQuotes(cmd,
  (t, i) => ((t[i] === '\n' || t[i] === ';') ? 1 : ((t[i] === '&' || t[i] === '|') && t[i + 1] === t[i]) ? 2 : 0),
  (t) => t.split(/&&|\|\||;|\n/));
// A segment is a PIPELINE: its stages split on a single `|` (`||` never reaches here - splitSegments
// consumed it), and a print verb's arguments end at its own stage.
const splitPipes = (seg) => splitOutsideQuotes(seg, (t, i) => (t[i] === '|' ? 1 : 0), (t) => t.split('|'));
// Words split on whitespace OUTSIDE quotes: a naive `\s+` split cut `cat "<project>/my dir/x.json"`
// into three tokens, none of them a path, and CLAUDE.md supports a project path with a space - so
// that was an environment condition, not a chosen bypass.
const shellTokens = (s) => splitOutsideQuotes(s, (t, i) => (/\s/.test(t[i]) ? 1 : 0), (t) => t.split(/\s+/)).filter(Boolean);

// A runtime reads the environment in its own spelling - the same leak as `echo $SECRET`, which the
// file-path scan never looked for (review finding: every shape below passed). A NAMED read is
// judged by the name; a whole-environment object beside a print is the env dump.
const ENV_NAMED = [
  /process\.env(?:\.|\[\s*['"])(\w+)/g,
  /os\.environ(?:\.get\()?\s*\[?\s*['"](\w+)/g,
  /\bENV\[\s*['"](\w+)/g,
  /\$ENV\{\s*['"]?(\w+)/g,
];
const ENV_BARE = /process\.env(?![.[\w])|os\.environ(?![.[\w(])|%ENV\b|\bENV\.(?:to_h|each)\b/;
// Names without values is the presence read, in a runtime as much as in a shell pipeline.
const ENV_REDUCED = /Object\.keys\(\s*process\.env\s*\)|os\.environ\.keys\(\s*\)|\bENV\.keys\b/g;
const RUNTIME_PRINT = /console\.log|JSON\.stringify|\bprint\s*\(|\bputs\b|(?:^|\s)-p(?=\s|$)|--print\b/;

// ---- Bash matcher ----
if (payload.tool_name === 'Bash') {
  const raw = String(input.command || '');
  // A credential-shaped literal typed into a command is already in the transcript as the call's own
  // input; blocking still keeps it out of a file, a header and a remote, and names the rule. Judged
  // on the RAW text: a heredoc that writes the value into a file is the same leak. The denial names
  // the shape only - the value is never repeated.
  if (!receiptLive && SECRET_SHAPE.test(raw)) {
    block('Blocked: the command carries a credential-shaped literal (a token / key / JWT).\n' +
      'Per baseline-security.md a secret never passes through a tool call or the chat: the user puts it\n' +
      'in the file by hand, or runs a copy-ready command in their own terminal (getpass, not an argument).\n');
  }
  const code = [];
  const command = stripHeredocsOf(raw, code);
  judgeShell(command, false);
  // The heredoc bodies that ARE commands: a runtime body is judged as inline code, a shell body as
  // the shell it is.
  for (const h of code) judgeShell(h.body, h.runtime);
  process.exit(0);
}

// A print of a credential-shaped variable becomes that variable's presence line - the idiom the
// denial used to prescribe, run for the model instead of fed back to it - led by the note.
function blockVariable(name) {
  if (allowAll || allowedNames.has(name)) return; // the user's own allowance for this session
  const note = noteLine(`\`${name}\` is a credential-shaped variable - shown as presence, not printed.`, receipt);
  rewrite(`echo "${shDouble(note)}"; [ -n "$${name}" ] && echo "${name}=set (\${#${name}} chars)" || echo "${name}=absent"`);
}
// A declaration, not a const: judgeShell runs from the Bash branch ABOVE these lines, so an arrow
// bound here would still be in its temporal dead zone and the gate would throw instead of judging.
// A whole-environment dump becomes the masked listing.
function blockEnvDump() {
  if (allowAll) return; // only `*` covers every variable at once
  rewrite(`node "${shDouble(__filename)}" --redacted-env`);
}

function judgeShell(text, forceRuntime) {
  cwdAnchor = null;
  for (const seg of splitSegments(stripComments(text))) {
    // A `NAME=value` assignment, or a `for NAME in <list>`, binds the path the NEXT segment dumps.
    const asg = seg.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;|&]*)/);
    if (asg) VARS.set(asg[1], [asg[2].replace(/^(["'])([\s\S]*)\1$/, '$2')]);
    const loop = seg.match(/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^\n;]+)/);
    if (loop) VARS.set(loop[1], shellTokens(loop[2]).filter((t) => t !== 'do').slice(0, 20));
    const cd = seg.match(/^\s*(?:cd|pushd)\s+("[^"]*"|'[^']*'|[^\s;|&]+)/);
    if (cd) {
      const d = expandPath(cd[1]);
      if (d && d !== '-') cwdAnchor = pathMod.isAbsolute(d) ? d : pathMod.join(cwdAnchor || anchorDirs()[0] || '.', d);
    }

    const stages = splitPipes(seg);
    // A tee to a terminal device prints the file whatever the pipeline does next, so neither the
    // redirect skip nor the presence exemption applies to a segment carrying one.
    if (!stages.some(teesToTerminal)) {
      if (redirectsToFile(seg)) continue; // output into a file never reaches the context
      if (stages.some(isReducer)) continue;
    }
    if (/\bsed\s+(?:-\w*i|--in-place)\b/.test(seg)) continue; // an edit, not a dump

    for (const stage of stages) {
      // The sanctioned read is exempt by name - it is this file - and only in its OWN stage: the
      // exemption used to cover the whole segment, so `--presence <file> | cat <file>` passed.
      if (/guard-secret-value\.js["']?\s+--(?:presence|redacted(?:-env)?)\b/.test(stage)) continue;

      // Printing a credential-shaped VARIABLE: echo / printf with $NAME or ${NAME...}, printenv NAME.
      // `${#NAME}` is a length - the presence idiom - and `[ -n "$NAME" ]` is a test, so only the
      // arguments of a PRINT verb are judged - and only within the verb's own pipeline STAGE: a
      // variable in a later `grep -v "$X"` stage is not printed, and a `curl -d "$TOKEN"` stage is a
      // use, not a print (the value never enters the transcript). EVERY print verb in the stage is
      // judged, not just the first - the arguments of `echo` swallowed `$(printenv NAME)` whole.
      const verbs = [...stage.matchAll(/(?:^|[\s(])(echo|printf|printenv)\b/g)];
      for (let i = 0; i < verbs.length; i++) {
        const args = stage.slice(verbs[i].index + verbs[i][0].length, i + 1 < verbs.length ? verbs[i + 1].index : stage.length);
        const names = [...args.matchAll(/\$\{?(?!#)([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
        if (verbs[i][1] === 'printenv') {
          names.push(...shellTokens(args).map((w) => w.replace(/[^A-Za-z0-9_]/g, '')).filter((w) => /^[A-Za-z_]\w*$/.test(w)));
        }
        const hit = names.find((n) => SECRET_KEY_RE.test(n));
        if (hit) blockVariable(hit);
      }
      // `declare -p NAME` / `typeset -p NAME` print one variable's value, like printenv NAME.
      const dp = stage.replace(PREFIX_WORDS, '').match(/^(?:declare|typeset)\s+-p\s+([^\n|]+)/);
      if (dp) { const hit = shellTokens(dp[1]).find((n) => SECRET_KEY_RE.test(n)); if (hit) blockVariable(hit); }

      // A whole-environment dump prints every exported credential. `env` as a command PREFIX
      // (`env FOO=bar cmd`) runs a command; only a bare dump verb (or one piped onward) dumps - and a
      // prefix word of its own (`sudo env`, `command printenv`, `FOO=bar env`) changes nothing. The
      // shell's OWN listings (`set`, `export`, `declare -p`) print the same values and passed every
      // probe until the review; their argument-carrying forms (`set -e`, `export FOO=x`) do not match.
      if (/^(?:env|printenv|export\s+-p|export|declare\s+-p|typeset\s+-p|set)\s*(?:\||$)/.test(stage.replace(PREFIX_WORDS, ''))) blockEnvDump();

      // A runtime reading the environment - `node -e "console.log(process.env.SENTRY_ACCESS_TOKEN)"`
      // is `echo $SENTRY_ACCESS_TOKEN` with more syntax. The denial names the VARIABLE, never a value.
      const isRuntime = forceRuntime || RUNTIME.test(stage);
      if (isRuntime) {
        for (const re of ENV_NAMED) for (const m of stage.matchAll(re)) if (SECRET_KEY_RE.test(m[1])) blockVariable(m[1]);
        if (ENV_BARE.test(stage.replace(ENV_REDUCED, ' keys ')) && RUNTIME_PRINT.test(stage)) blockEnvDump();
      }

      // A dump verb or a runtime read on a file that HOLDS a credential - judged by content, not path.
      homeAnchor = isRuntime && /homedir|expanduser|USERPROFILE|HOME/.test(stage);
      const candidates = [];
      if (DUMP_VERB.test(stage) || isRuntime) for (const tok of shellTokens(stage)) if (!tok.startsWith('-') && /[\/.~$]/.test(tok)) candidates.push(tok);
      // A runtime spells the path inside its own code - single, double or backtick quoted.
      if (isRuntime) for (const m of stage.matchAll(/(["'`])([^"'`\n]{2,300})\1/g)) candidates.push(m[2]);
      // `< file` feeds the file to whatever the stage runs, `while read` and `done < file` included -
      // the same read as `cat file`, which is why `cat < file` already blocked.
      for (const m of stage.matchAll(/(?:^|[^<])<\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g)) candidates.push(m[1]);
      for (const tok of candidates) {
        for (const p of candidatePaths(tok)) {
          const file = statFile(p);
          if (!file) continue;
          const key = secretInUnlessAllowed(file);
          if (!key) continue;
          // The FIRST credential file wins and the whole call becomes its redacted view - the rest of
          // a compound command is dropped rather than spliced, so the rewritten call is always one the
          // model can read back whole; the note names the file, so a dropped tail is re-run knowingly.
          rewrite(`node "${shDouble(__filename)}" --redacted "${shDouble(file)}"`);
        }
      }
    }
  }
}

// ---- Read matcher ----
// The settings.json permissions.deny already stops a Read of the ACCOUNT files by path; this is the
// content-judged complement for everything the path list cannot name - a project settings.json
// holding a misplaced token, a dotenv, an appsettings.json.
if (payload.tool_name === 'Read') {
  const file = resolveFile(String(input.file_path || ''));
  const key = file && secretInUnlessAllowed(file);
  if (key) block(`Blocked: Read of ${file}, which holds a credential under \`${key}\`.\n` + presenceHint(file));
}
process.exit(0);
