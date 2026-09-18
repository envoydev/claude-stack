#!/usr/bin/env node
// docs.js - the architecture docs engine. Sections are addressed by id, found from code paths, versioned per branch,
// merged back when a branch lands, flagged when their code moved, and linted. Every command is deterministic: the
// model pays only for the text a command prints.
//   where <path...>                 sections covering these paths, the narrowest declared covers first, the last
//                                   slot kept for the section written about the whole area
//   toc <file>                      a doc file's sections (id, heading, size)
//   show <file>#<id>... [--conflict [branch]]
//   files                           the doc files
//   set <file>#<id> [textfile] [--expect <hash>]
//                                   write one section (stdin without a file): in place on mainline, under git
//                                   versioning or without git; into this branch's overlay otherwise. --expect is
//                                   the hash of the text the writer was shown - a mismatch refuses the write and
//                                   hands the current text over, so two agents cannot drop each other's rewrite
//   hash <file>#<id>                that section's current hash, for the --expect above
//   status                          mode, branch, overrides, conflicts, orphans, outgrown count, deleted unmerged branches,
//                                   and any disagreement between the declared mode and the repo
//   stale                           sections whose covered code changed since they were written
//   promote <branch> | --merged     fold a branch's overrides into mainline, section by section, three ways
//   prune [branch]                  drop one branch's overlay, or overlays of branches gone for 30 days
//   lint                            metadata and budget problems (exit 1 when any)
//   seed-ids                        give every section a stable id (idempotent)
//   watch <path...>                 which watch.json entries these changed paths hit
// Two modes, DECLARED at install time by the docs-versioning env key (VERSIONING_KEYS below): 'git' means the docs
// are committed and git versions them per branch, so writes land in place, nothing is ever written under .branches/
// and the promote / prune machinery stands down; 'local' means each feature branch's sections live under
// <docs root>/.branches/<branch>/ until it merges. Absent - every install made before the key existed - falls back
// to reading git, as this engine always did.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const docsRootEnv = () => process.env.CLAUDE_STACK_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs';
const DOCS_ROOT = path.resolve(ROOT, docsRootEnv());
const DOCS = path.join(DOCS_ROOT, 'architecture');
const BLOCK_FILE = path.join(DOCS, 'ORIENTATION.md');
const WATCH_FILE = path.join(DOCS, 'watch.json');
const BRANCHES = path.join(DOCS_ROOT, '.branches');
// A domain is a top-level folder under the docs root holding a watch.json. Convention, not a registry:
// adding one needs no engine change. A dotted folder is never a domain - .branches is state, not docs.
// 'references' and 'history' are reserved and never a domain either: every domain owns a subfolder by
// each name, so a domain sharing that name would make a bare ref's leading segment ambiguous between
// the two.
// Cached like the git-state probes below: parseRef calls this on every bare reference, and the docs root
// does not gain a domain mid-process. resetDomains() below is the escape hatch a fixture needs when it
// adds a domain after the module was already required.
const RESERVED_DOMAIN_NAMES = new Set(['references', 'history']);
let DOMAINS_CACHE;
const domains = () => {
  if (DOMAINS_CACHE) return DOMAINS_CACHE;
  try {
    const found = fs.readdirSync(DOCS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !RESERVED_DOMAIN_NAMES.has(e.name))
      .map((e) => e.name)
      .filter((n) => fs.existsSync(path.join(DOCS_ROOT, n, 'watch.json')));
    // 'architecture' counts even without a watch.json of its own: it was the one docs folder long
    // before watch.json (or domains) existed, so every doc written before domains existed lives there
    // regardless. Grandfathered in this ONE place so docFiles/findFile/parseRef all agree instead of
    // three different answers for one file - Task 10's migration seeds a watch.json into every
    // architecture/ that lacks one, after which this line is the only thing to delete.
    if (!found.includes('architecture') && fs.existsSync(path.join(DOCS_ROOT, 'architecture'))) found.push('architecture');
    return (DOMAINS_CACHE = found.sort());
  } catch { return []; }
};
const domainDir = (name) => path.join(DOCS_ROOT, name);
const resetDomains = () => { DOMAINS_CACHE = undefined; };
const MAINLINE = ['develop', 'main', 'master', 'trunk'];
const MAX_SECTION_CHARS = 6000;
const SHOW_CHARS = 14000;
const BLOCK_BYTES = 4096;
const ID = /<!--\s*id:\s*([\w.-]+)\s*-->/i;
const STAMP = /<!--\s*captured:\s*([0-9a-f]{7,40})(?:\s+with:\s*([^>]*?))?\s*-->/i;
const COVERS = /<!--\s*covers:\s*([^>]*?)\s*-->/i;
const HISTORY = /<!--\s*orient:\s*history\s*-->/i;
const COMMENT = /^\s*<!--.*-->\s*$/;
const STOP = new Set(['test', 'tests', 'common', 'features', 'endpoints', 'endpoint', 'src', 'file', 'class', 'async', 'http', 'json', 'with', 'from', 'this', 'that', 'into', 'over', 'core', 'main', 'code']);
const norm = (t) => String(t).replace(/\r\n/g, '\n').replace(/\n+$/, '');

const git = (args, { raw = false, ...opts } = {}) => {
  try {
    const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts });
    return raw ? out : out.trim(); // porcelain rows start with a status column that may be a space
  } catch { return null; }
};

const safe = (b) => String(b).replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'detached';
// Six git-state probes - branch, hasGit, tracked, isShallow, mainlineRefs, isMainline - are re-derived by every
// caller (autoPromote, refreshBaseMeta, status, lint and loadWatch each ask again). A process runs one CLI command
// or one hook event and nothing here changes underfoot, so the first answer is cached for the rest of the process.
let BRANCH_CACHE;
function branch() {
  if (BRANCH_CACHE === undefined) { const b = git(['rev-parse', '--abbrev-ref', 'HEAD']); BRANCH_CACHE = !b || b === 'HEAD' ? null : b; }
  return BRANCH_CACHE;
}

const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const globList = (s) => String(s).split(/[,\s]+/).map((g) => g.trim()).filter(Boolean);
// glob -> regex: '**' spans directories, '*' stops at one.
const globRe = (g) => new RegExp(`^${g.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);
const matches = (globs, p) => globs.some((g) => globRe(g).test(p));

// The comment lines directly under a heading carry its id, covers and stamp.
function metaUnder(lines, at) {
  const out = [];
  for (let j = at + 1; j < lines.length && j <= at + 8 && COMMENT.test(lines[j]); j++) out.push(lines[j]);
  return out.join('\n');
}
const parseWith = (s) => Object.fromEntries(String(s || '').split(/,\s*/).filter((x) => x.includes('='))
  .map((x) => [x.slice(0, x.lastIndexOf('=')).trim(), x.slice(x.lastIndexOf('=') + 1).trim()]));

const sectionId = (s) => s.id.slice(s.id.indexOf('#') + 1);
const trailingBlanks = (lines) => { let k = 0; while (k < lines.length && lines[lines.length - 1 - k] === '') k++; return k; };

// A section text always starts with its heading and carries its id, so the override can be found again whatever the
// writer left out; the file name of the override is the authority on the id.
function ensureHeadingAndId(text, id, fallbackHeading) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!/^#{2,4}\s+\S/.test(lines[0] || '')) lines.unshift(fallbackHeading);
  let j = 1;
  const meta = [];
  while (j < lines.length && COMMENT.test(lines[j])) meta.push(lines[j++]);
  return [lines[0], `<!-- id: ${id} -->`, ...meta.filter((m) => !ID.test(m)), ...lines.slice(j)];
}

function tokens(p) {
  return [...new Set(String(p).replace(/\.[A-Za-z]+$/, '').split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))];
}

// The project's files, for measuring how much a glob covers: git's view when there is a repo (tracked plus untracked,
// ignored excluded), a walk otherwise.
let FILES = null;
function repoFiles() {
  if (FILES) return FILES;
  const listed = git(['ls-files', '-co', '--exclude-standard']);
  FILES = listed !== null && listed !== '' ? listed.split('\n').filter(Boolean) : allFiles();
  return FILES;
}
const WIDTH = new Map();
const globWidth = (g) => {
  if (!WIDTH.has(g)) { const re = globRe(g); WIDTH.set(g, repoFiles().filter((f) => re.test(f)).length); }
  return WIDTH.get(g);
};
// How narrowly a section describes these paths: the file count of its narrowest glob that matches one of them.
const coverWidth = (covers, paths) => Math.max(1, Math.min(...covers.filter((g) => paths.some((p) => matches([g], p))).map(globWidth)));
// A glob spanning more than this is about an area, not about the file in hand.
const narrowCap = () => Math.max(40, Math.round(repoFiles().length * 0.03));
// ONE order for every list where() builds: the narrowest declared cover, then the section that declares its own
// covers, then the shorter text. A second list ordered any other way (by the order the doc files happen to be
// scanned in, say) would decide the expensive inline slot by accident.
const narrowestFirst = (a, b) => a.width - b.width || Number(b.declared) - Number(a.declared) || a.chars - b.chars;

// What a merge folded into mainline and nobody has caught up with: the ids promoteLocked wrote into its own ledger
// (promoted.jsonl, beside the overlays) within the last FRESH_FOLD_MS. This is an ENGINE fact rather than a session
// one on purpose - the gate and the `where` command must give the same answer, or a model that checks the docs
// before it edits gets a worse answer than one that does not, which is exactly backwards. The window is this
// stack's own receipt window: a working day later the fold is simply what the docs say. A missing or unreadable
// ledger means nothing is fresh, which is the plain ranking.
const FRESH_FOLD_MS = 8 * 3600 * 1000;
function freshlyPromoted(now = Date.now()) {
  let rows;
  try { rows = fs.readFileSync(path.join(BRANCHES, 'promoted.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const out = [];
  for (const line of rows.slice(-100)) { // nobody prunes this ledger: only its tail can be recent
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row && row.at);
    if (!Number.isFinite(at) || now - at > FRESH_FOLD_MS) continue;
    for (const x of Array.isArray(row.results) ? row.results : []) {
      if (x && typeof x.id === 'string' && x.result !== 'conflict') out.push(x.id);
    }
  }
  return [...new Set(out)];
}

// The narrowest declared cover answers first: a section written about src/Features/Notifications/** says more about a
// notifications handler than a smaller one written about src/Features/**. Word matches come next, weighted by how rare
// each word is across the docs, and the broad globs fill what is left. Review history is never offered.
// A section a merge just folded in is NEWS, and news outranks narrowness: the reader has not read it, and it changed
// what mainline says. It answers only where it covers the path, and never takes the last slot.
function where(paths, limit = 3) {
  const news = freshlyPromoted();
  const want = [...new Set(paths.flatMap(tokens))];
  const current = allSections().filter((s) => !s.history);
  const cap = narrowCap();
  const covering = (s) => s.covers.length && paths.some((p) => matches(s.covers, p));
  const ranked = (list) => list.map((s) => ({ ...s, width: coverWidth(s.covers, paths) })).sort(narrowestFirst);
  const fresh = ranked(news.length ? current.filter((s) => news.includes(s.id) && covering(s)) : []).slice(0, Math.max(limit - 1, 0));
  const declared = ranked(current.filter((s) => covering(s) && !fresh.some((f) => f.id === s.id)));
  const narrow = declared.filter((s) => s.width <= cap);
  const broad = declared.filter((s) => s.width > cap);
  const room = limit - fresh.length;
  // A narrow section says what this file IS; a broad one says what every change in its area must satisfy. Narrow
  // neighbours would otherwise fill the answer on their own and no area-wide section could ever be offered - which
  // is how a decision written about a whole feature area went unread. The narrowest still answers first, and the
  // gate still hands THAT one over inline; only the last slot is kept for the best broad section.
  if (narrow.length >= room) {
    const kept = narrow.slice(0, room - 1);
    const pick = room > 1 ? broad.find((b) => kept.filter((k) => k.file === b.file).length < 2) : null;
    return [...fresh, ...(pick ? [...kept, pick] : narrow.slice(0, room))];
  }
  const out = [...fresh, ...narrow];
  const seenFile = new Map();
  for (const s of out) seenFile.set(s.file, (seenFile.get(s.file) || 0) + 1);
  const take = (s) => {
    const n = seenFile.get(s.file) || 0;
    if (n >= 2 || out.some((x) => x.id === s.id)) return; // never send the reader three sections of one file
    seenFile.set(s.file, n + 1);
    out.push(s);
  };
  if (want.length) {
    // A section that declares its code has said what it is about: it may win on words only when that code shares a
    // path word with these paths. Otherwise a new file named after the task ('BulkRestore...') lands on any section
    // whose prose happens to use the word ('a subscription restore').
    const pathWords = new Set(want);
    const eligible = (s) => !s.covers.length || s.covers.some((g) => tokens(g.replace(/\*+/g, '')).some((t) => pathWords.has(t)));
    const lower = current.map((s) => ({ head: ` ${s.heading.toLowerCase()} ${key(s.file)} `, body: s.text.toLowerCase() }));
    const weight = {};
    for (const t of want) {
      const df = lower.filter((s) => s.body.includes(t)).length;
      weight[t] = df ? Math.log(current.length / df) : 0;
    }
    const scored = current.map((s, i) => {
      let score = 0;
      let hits = 0;
      for (const t of want) {
        if (!weight[t]) continue;
        const n = lower[i].body.split(t).length - 1;
        hits += n;
        // Density, not count: a 60k-char review log mentioning a word twelve times is not about it.
        score += (weight[t] * n * 1000) / Math.max(s.chars, 600);
        if (lower[i].head.includes(t)) score += 5 * weight[t];
      }
      return { ...s, score, hits };
    }).filter((s) => s.hits >= 2 && eligible(s)).sort((a, b) => b.score - a.score || a.chars - b.chars);
    for (const s of scored) { if (out.length >= limit) break; take(s); }
  }
  for (const s of broad) { if (out.length >= limit) break; take(s); }
  return out;
}

// The block is paid for by every session, so every claim in it that CAN be checked against the repo is checked:
// the sections it points at, the paths it names, and any count it states about a file it names.
function verifyBlock() {
  const problems = [];
  if (!fs.existsSync(BLOCK_FILE)) return ['no ORIENTATION.md: sessions start with no map'];
  const block = fs.readFileSync(BLOCK_FILE, 'utf8');
  const ids = new Set(allSections().map((s) => s.id));
  for (const ref of [...new Set(block.match(/[\w.-]+#[\w-]+/g) || [])]) {
    if (!ids.has(ref)) problems.push(`points at a section that does not exist: ${ref}`);
  }
  // A path the block names must exist. '<Area>' style placeholders and globs stand for any one segment.
  for (const raw of [...new Set(block.match(/(?:src|tests|contracts|docs|scripts)\/[\w./<>*-]*/g) || [])]) {
    const p = raw.replace(/[.,;:]$/, '');
    const hasHole = /[<*]/.test(p);
    if (!hasHole) {
      if (!fs.existsSync(path.join(ROOT, p))) problems.push(`names a path that does not exist: ${p}`);
      continue;
    }
    const re = globRe(p.replace(/<[^>]*>/g, '*').replace(/\/$/, '/**'));
    const found = allFiles().some((f) => re.test(f) || re.test(`${f.split('/').slice(0, -1).join('/')}/`));
    if (!found) problems.push(`names a path pattern nothing matches: ${p}`);
  }
  // 'N things in <file>' - count the entries of the largest array in that JSON and compare.
  for (const m of block.matchAll(/(\d+)\s+[\w-]+(?:\s+[\w-]+){0,3}\s+in\s+`?([\w./-]+\.json)`?/gi)) {
    const [, claimed, file] = m;
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch { problems.push(`counts entries in a file that cannot be read: ${file}`); continue; }
    // Only the file's own top-level lists count: a doc counts codes, not the parameters inside each code.
    const lists = (Array.isArray(json) ? [json] : Object.values(json)).filter(Array.isArray);
    const arrays = lists.map((l) => l.length);
    const uniques = lists.flatMap((l) => {
      const byKey = {};
      for (const row of l.filter((x) => x && typeof x === 'object')) for (const [k, v] of Object.entries(row)) if (typeof v === 'string') (byKey[k] ||= new Set()).add(v);
      return Object.values(byKey).map((set) => set.size);
    });
    // A count is honest if it matches one list, the lists together, or the distinct values of one - the block does
    // not say which shape it counted, and a false alarm here would train the reader to ignore this check.
    const totals = [...new Set([...arrays, ...uniques, arrays.reduce((a, b) => a + b, 0)])];
    if (!totals.includes(Number(claimed))) problems.push(`claims ${claimed} entries in ${file}, which holds ${totals.sort((a, b) => b - a).join(' / ')}`);
  }
  return problems;
}

function allFiles() {
  const out = [];
  const walk = (dir, rel = '') => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (/^(node_modules|bin|obj|\.git|dist|\.claude)$/.test(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(ROOT);
  return out;
}

// Which covered files moved since the section was captured. Works in both modes: a feature branch outruns its docs
// whether they are committed or not. A file the section was written together with is excused while its content is
// still what the section saw.
const DIFFS = new Map(); // one diff per stamp: most sections of a file share it
function outgrownFiles(section) {
  if (!section.stamp || !section.covers.length) return [];
  if (!DIFFS.has(section.stamp)) DIFFS.set(section.stamp, git(['diff', '--name-only', `${section.stamp}...HEAD`]));
  const changed = DIFFS.get(section.stamp);
  if (changed === null) return [];
  const seen = section.stampWith || {};
  return changed.split('\n').filter(Boolean).filter((f) => matches(section.covers, f)).filter((f) => {
    if (!seen[f]) return true;
    if (seen[f] === '-') return fs.existsSync(path.join(ROOT, f));
    const now = fs.existsSync(path.join(ROOT, f)) ? git(['hash-object', f]) : null;
    return !now || !now.startsWith(seen[f]);
  });
}

// The stamp for a section written now: HEAD, plus the covered files that are changed but not committed yet.
function captureStamp(covers) {
  const head = git(['rev-parse', '--short', 'HEAD']);
  if (!head) return '';
  const withList = porcelainPaths().filter((f) => covers.length && matches(covers, f)).slice(0, 40)
    .map((f) => `${f}=${fs.existsSync(path.join(ROOT, f)) ? (git(['hash-object', f]) || '').slice(0, 12) : '-'}`);
  return `<!-- captured: ${head}${withList.length ? ` with: ${withList.join(', ')}` : ''} -->`;
}

function stale() {
  return allSections().filter((s) => !s.history).map((s) => ({ s, files: outgrownFiles(s) })).filter((x) => x.files.length);
}

const walkFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  .filter((f) => f.endsWith('.md'));

// Splice a section's new text over [start, end) of a file's lines, keeping the blank lines that separated it.
function spliceSection(lines, s, text) {
  const body = String(text).replace(/\n+$/, '').split('\n');
  return [...lines.slice(0, s.start), ...body, ...Array(trailingBlanks(lines.slice(s.start, s.end))).fill(''), ...lines.slice(s.end)];
}

// Three-way merge of three texts through git merge-file; conflicts come back as marked text.
function merge3(ours, base, theirs, name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-merge-'));
  const trim = (t) => `${String(t).replace(/\n+$/, '')}\n`;
  const [a, o, b] = ['mainline', 'base', 'branch'].map((n, i) => { const p = path.join(tmp, n); fs.writeFileSync(p, trim([ours, base, theirs][i])); return p; });
  const r = spawnSync('git', ['merge-file', '-p', '-L', 'mainline', '-L', 'base', '-L', name, a, o, b], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status === null || r.status > 127) return { error: (r.stderr || 'git merge-file failed').trim() };
  return { text: r.stdout, conflicts: r.status };
}

// The RAW git fact: are the doc files committed? Only two callers want it - the mode fallback below, and the
// mismatch report, which exists precisely to say that this fact and the declared mode disagree. Everything that
// DECIDES behaviour asks gitVersioned() instead.
let TRACKED_CACHE;
function tracked() {
  if (TRACKED_CACHE === undefined) TRACKED_CACHE = git(['ls-files', '--error-unmatch', DOCS]) !== null;
  return TRACKED_CACHE;
}
// The env keys that can declare the mode, in precedence order. ONE list, and every message below names the key that
// ACTUALLY answered rather than spelling one - a twin reading a different spelling then diverges on this line alone
// instead of on the header, the two status lines and the two mismatch sentences.
const VERSIONING_KEYS = ['CLAUDE_STACK_DOCS_VERSIONING'];
// How the docs are versioned is an install-time DECISION, not a guess: 'git' = committed docs, git versions them per
// branch (no overlay, ever); 'local' = the overlay model. An absent or unrecognised value falls back to what git
// says, so an install made before the key existed keeps the behaviour it had until someone is asked.
const declaredVersioning = () => {
  for (const key of VERSIONING_KEYS) {
    const v = String(process.env[key] || '').trim().toLowerCase();
    if (v === 'git' || v === 'local') return { mode: v, key };
  }
  return null;
};
// ONE resolver, cached with the other git-state probes: a process runs one CLI command or one hook event, and
// neither the environment nor the index changes underfoot.
let MODE_CACHE;
const docsMode = () => (MODE_CACHE || (MODE_CACHE = (declaredVersioning() || {}).mode || (tracked() ? 'git' : 'local')));
const gitVersioned = () => docsMode() === 'git';
// The declaration and the repo can disagree: docs committed under a 'local' install, or ignored under a 'git' one.
// The SETTING wins - a doc write must never be silently untracked or silently local - so the disagreement is
// REPORTED in these words, by `status` and by the session-start block alike, instead of being resolved the other
// way behind the user. Without a repo, or before the docs exist, there is no fact to disagree with.
function versioningMismatch() {
  const declared = declaredVersioning();
  if (!declared || !hasGit() || !fs.existsSync(DOCS)) return null;
  const where = path.relative(ROOT, DOCS).split(path.sep).join('/');
  if (declared.mode === 'git' && !tracked()) {
    return `Versioning mismatch: ${declared.key} declares 'git', but ${where} is not tracked by git - the setting wins, so doc sections are written in place and nothing versions them until the docs are committed.`;
  }
  if (declared.mode === 'local' && tracked()) {
    return `Versioning mismatch: ${declared.key} declares 'local', but ${where} is tracked by git - the setting wins, so this branch's sections stay in the overlay under ${path.relative(ROOT, BRANCHES).split(path.sep).join('/')}/ until a promote folds them into the committed text.`;
  }
  return null;
}
let HAS_GIT_CACHE;
const hasGit = () => (HAS_GIT_CACHE === undefined ? (HAS_GIT_CACHE = git(['rev-parse', '--git-dir']) !== null) : HAS_GIT_CACHE);
const MAINLINE_CACHE = new Map();
function isMainline(b) {
  if (!b) return false;
  if (MAINLINE_CACHE.has(b)) return MAINLINE_CACHE.get(b);
  const names = MAINLINE.slice();
  const originHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) names.push(originHead.split('/').pop());
  const result = names.includes(b);
  MAINLINE_CACHE.set(b, result);
  return result;
}
// safe() folds 'feature/login' and 'feature-login' onto ONE directory name, so two branches can land on one
// overlay: the second would read the first's decisions as its own, overwrite them, and have them promoted under
// its name. BASE.json records the branch the overlay was written for, and that record decides who owns it - a
// branch that is not the owner reads mainline and is refused every write here.
const overlayOwner = (dir) => { const m = readMetaAt(dir); return m && typeof m.branch === 'string' && m.branch ? m.branch : null; };
const overlayClash = (dir, b) => { const owner = overlayOwner(dir); return Boolean(owner && owner !== b); };
const overlayDir = () => {
  const b = branch();
  if (!b || !hasGit() || gitVersioned() || isMainline(b)) return null;
  const dir = path.join(BRANCHES, safe(b));
  return overlayClash(dir, b) ? null : dir;
};

// One domain's own files - root, references/, history/ - the shape every domain is read from.
function domainFiles(d) {
  const out = [];
  const add = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md') && f !== 'ORIENTATION.md' && f !== 'BRANCH-DELTA.md') out.push(path.join(dir, f));
  };
  const dir = domainDir(d);
  add(dir);
  add(path.join(dir, 'references'));
  add(path.join(dir, 'history'));
  return out;
}
// Every domain's own files - domains() already grandfathers 'architecture' in, so this needs no
// special case of its own.
function docFiles() {
  const out = [];
  for (const d of domains()) out.push(...domainFiles(d));
  return out.sort();
}
// The domain a file belongs to - its own name, so relKey measures from the right base and a collision
// can name every domain that holds it. Falls back to 'architecture' only if somehow no domain claims the
// file at all, which should not happen now that domains() grandfathers it in.
const fileDomain = (file) => domains().find((d) => !path.relative(domainDir(d), file).startsWith('..')) || 'architecture';
const fileDomainDir = (file) => domainDir(fileDomain(file));
const relKey = (file) => path.relative(fileDomainDir(file), file).replace(/\.md$/, '').split(path.sep).join('/');
const key = (file) => path.basename(file, '.md');
// A file's key, qualified by its own domain - what a 'Known:' hint prints, so two domains holding the
// same basename read as two distinguishable names rather than one repeated twice.
const knownKey = (f) => `${fileDomain(f)}/${relKey(f)}`;
// A collision refuses rather than picks: docFiles() now spans every domain, and two domains can hold a
// same-relKey file (every domain owns a references/ subfolder, and a shared topic name there is
// ordinary) - a silent first-match would write a section into the wrong domain, the same failure
// parseRef exists to prevent.
const findFile = (fileKey) => {
  const files = docFiles();
  const byRel = files.filter((f) => relKey(f) === fileKey);
  const tier = byRel.length ? byRel : files.filter((f) => key(f) === fileKey || path.basename(f) === fileKey);
  if (tier.length > 1) throw new Error(`${fileKey} is in ${tier.map((f) => fileDomain(f)).join(' and ')} - name one, as <domain>/${fileKey}`);
  return tier[0];
};
// A ref is <domain>/<file>#<id>. A leading segment names a domain only when domains() actually has it -
// so a domain's own references/ or history/ subfolder (and a typo of a real domain name) is never
// mistaken for one. Everything else is the BARE <file>#<id> - subfolder path and all - which keeps
// working while exactly one domain holds a file matching it, wherever that domain keeps it (root,
// references/ or history/): every doc, logged row and message written before domains existed uses this
// spelling. Ambiguity is an error naming every candidate; a slash that resolves to no domain at all is an
// error too - a silent pick, or a silent null, would write a section into the wrong domain (or into one
// that was never named).
function parseRef(ref) {
  const s = String(ref);
  const slash = s.indexOf('/');
  const first = slash < 0 ? null : s.slice(0, slash);
  const isDomain = Boolean(first) && domains().includes(first);
  const bare = isDomain ? s.slice(slash + 1) : s;
  const fileKey = bare.split('#')[0];
  if (!fileKey) throw new Error(`not a section ref: ${JSON.stringify(ref)} - want <file>#<id> or <domain>/<file>#<id>`);
  const findIn = (d) => domainFiles(d).find((f) => relKey(f) === fileKey || key(f) === fileKey);
  if (isDomain) {
    const found = findIn(first);
    return { domain: first, file: found ? `${relKey(found)}.md` : `${fileKey}.md`, id: bare };
  }
  const matches = domains().map((d) => ({ d, f: findIn(d) })).filter((m) => m.f);
  if (matches.length > 1) throw new Error(`${bare} is in ${matches.map((m) => m.d).join(' and ')} - name one, as <domain>/${bare}`);
  if (!matches.length && first) throw new Error(`no domain or subfolder resolves ${bare} - name one, as <domain>/${bare}`);
  const [hit] = matches;
  return { domain: hit ? hit.d : null, file: hit ? `${relKey(hit.f)}.md` : `${fileKey}.md`, id: bare };
}
const safeRead = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const isHistory = (file) => relKey(file).startsWith('history/') || HISTORY.test(safeRead(file).slice(0, 600));

// Sections run from one heading (## to ####) to the next heading at the same or a higher level; a section's OWN text
// stops at its first child heading, trailing blank lines dropped, and that is what the size budget measures.
function parse(file, raw) {
  const lines = raw.split('\n');
  const heads = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (m && m[1].length >= 2) heads.push({ level: m[1].length, heading: m[2].replace(/[`*]/g, ''), line: i });
  });
  const preamble = lines.slice(0, heads.length ? heads[0].line : lines.length).join('\n');
  const fileCovers = globList((COVERS.exec(preamble) || [])[1] || '');
  const history = relKey(file).startsWith('history/') || HISTORY.test(raw.slice(0, 600));
  const fileStamp = STAMP.exec(preamble) || [];
  return heads.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line; break; }
    const ownEnd = i + 1 < heads.length ? Math.min(heads[i + 1].line, end) : end;
    const text = lines.slice(h.line, end).join('\n');
    const meta = metaUnder(lines, h.line);
    const own = globList((COVERS.exec(meta) || [])[1] || '');
    const declaredId = (ID.exec(meta) || [])[1];
    const stamp = STAMP.exec(meta) || fileStamp;
    return {
      id: `${key(file)}#${declaredId || slug(h.heading)}`, file, from: file, heading: h.heading, level: h.level,
      start: h.line, end, ownEnd, text, chars: text.length, ownChars: lines.slice(h.line, ownEnd).join('\n').replace(/\s+$/, '').length,
      covers: own.length ? own : fileCovers, declared: own.length > 0, declaredId: declaredId || '', history,
      stamp: stamp[1] || '', stampWith: parseWith(stamp[2]), overlaid: false,
    };
  });
}

const stripStamp = (t) => norm(t).split('\n').filter((l) => !STAMP.test(l)).join('\n');
// What a section SAYS, with the capture stamp left out: the stamp line is regenerated on every write, so hashing it
// would report a lost update whenever a section was re-saved with the same words. Twelve hex characters - this is a
// concurrency check between two agents of one session, not a signature.
const sectionHash = (text) => crypto.createHash('sha1').update(stripStamp(text)).digest('hex').slice(0, 12);
// The section's FIRST SENTENCE, capped at QUOTE_CHARS: the finish ask quotes it so there is something concrete to
// compare a change against, and a section that grew to 6000 chars must not grow the ask with it.
const QUOTE_CHARS = 200;
function firstSentence(text) {
  const body = norm(text).split('\n').slice(1).find((l) => l.trim() && !COMMENT.test(l)) || '';
  const m = /^(.*?[.!?])(\s|$)/.exec(body.trim());
  const one = (m ? m[1] : body).trim();
  return one.length > QUOTE_CHARS ? `${one.slice(0, QUOTE_CHARS - 3)}...` : one;
}
const stampLineOf = (t) => norm(t).split('\n').find((l) => STAMP.test(l)) || '';
// A merged text carries no stamp (both sides were stripped): the given one goes back after the heading's comments.
function withStamp(text, stamp) {
  const lines = stripStamp(text).split('\n');
  let j = 1;
  while (j < lines.length && COMMENT.test(lines[j])) j++;
  return [...lines.slice(0, j), ...(stamp ? [stamp] : []), ...lines.slice(j)].join('\n');
}

function sectionOverrides(file, dir) {
  if (!dir) return new Map();
  const sdir = path.join(dir, fileDomain(file), ...relKey(file).split('/'));
  if (!fs.existsSync(sdir)) return new Map();
  return new Map(fs.readdirSync(sdir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => [e.name.slice(0, -3), path.join(sdir, e.name)]));
}
const baseText = (dir, file, id) => safeRead(path.join(dir, '.base', ...overlayParts(file, id)));

// What a branch reads for a section it overrides: its own text while mainline still holds the base it started from;
// a three-way merge (stamps aside) once mainline moved; its own text, flagged, when both sides changed the same lines.
function servedText(dir, file, id, mainlineText, overridePath) {
  const mine = fs.readFileSync(overridePath, 'utf8');
  const base = baseText(dir, file, id);
  if (!norm(base) || stripStamp(base) === stripStamp(mainlineText)) return { text: mine, conflict: false };
  const m = merge3(stripStamp(mainlineText), stripStamp(base), stripStamp(mine), 'branch');
  if (m.error || m.conflicts) return { text: mine, conflict: true };
  return { text: withStamp(m.text, stampLineOf(mine)), conflict: false };
}

function withSectionOverrides(file, raw, dir) {
  const over = sectionOverrides(file, dir);
  if (!over.size) return { raw, ranges: [] };
  const secs = parse(file, raw);
  const lines = raw.split('\n');
  const chosen = [];
  const seen = new Set();
  for (const s of secs) {
    const id = sectionId(s);
    if (!over.has(id)) continue;
    seen.add(id);
    if (chosen.some((c) => s.start >= c.s.start && s.end <= c.s.end)) continue;
    chosen.push({ s, id });
  }
  const out = [];
  const ranges = [];
  let at = 0;
  for (const { s, id } of chosen) {
    out.push(...lines.slice(at, s.start));
    const served = servedText(dir, file, id, s.text, over.get(id));
    const body = ensureHeadingAndId(served.text, id, lines[s.start]);
    ranges.push({ start: out.length, end: out.length + body.length, id, path: over.get(id), conflict: served.conflict });
    out.push(...body, ...Array(trailingBlanks(lines.slice(s.start, s.end))).fill(''));
    at = s.end;
  }
  out.push(...lines.slice(at));
  for (const [id, p] of over) {
    if (seen.has(id)) continue;
    const orphan = Boolean(norm(baseText(dir, file, id)));
    const body = ensureHeadingAndId(fs.readFileSync(p, 'utf8'), id, `## ${id}`);
    if (out.length && out[out.length - 1] !== '') out.push('');
    ranges.push({ start: out.length, end: out.length + body.length, id, path: p, orphan, added: !orphan });
    out.push(...body);
  }
  return { raw: out.join('\n'), ranges };
}

function sections(file) {
  const dir = overlayDir();
  const { raw, ranges } = withSectionOverrides(file, fs.readFileSync(file, 'utf8'), dir);
  const secs = parse(file, raw);
  for (const s of secs) {
    const r = ranges.find((x) => s.start >= x.start && s.start < x.end);
    if (r) Object.assign(s, { from: r.path, overlaid: true, overrideOf: r.id, conflict: Boolean(r.conflict), orphan: Boolean(r.orphan), added: Boolean(r.added) });
  }
  return secs;
}

// Both sides of a conflicting section, with git's markers, for reconciling by hand. On a feature branch the overlay is
// the branch's own; on mainline, name the branch whose promote conflicted.
function conflictView(ref, branchName) {
  const [fileKey, id] = String(ref).split('#');
  let file;
  try { file = findFile(fileKey); } catch (e) { return e.message; }
  if (!file || !id) return `name a section: show <file>#<id> --conflict [branch]`;
  const dir = branchName ? path.join(BRANCHES, safe(branchName)) : overlayDir();
  const label = branchName || branch() || 'branch';
  if (!dir) return 'no branch overlay here: on mainline, name the branch - show <file>#<id> --conflict <branch>';
  const over = path.join(dir, ...overlayParts(file, id));
  if (!fs.existsSync(over)) return `${label} has no version of ${key(file)}#${id}`;
  const main = parse(file, fs.readFileSync(file, 'utf8')).find((s) => s.id === `${key(file)}#${id}`);
  const m = merge3(stripStamp(main ? main.text : ''), stripStamp(baseText(dir, file, id)), stripStamp(fs.readFileSync(over, 'utf8')), label);
  if (m.error) return `cannot merge: ${m.error}`;
  return `${key(file)}#${id} - mainline against ${label}${m.conflicts ? '' : ' (no conflict left)'}\nSave the reconciled section with: node .claude/hooks/docs.js set ${key(file)}#${id}\n\n${m.text}`;
}

// A rename row ('R  old -> new') carries both sides: the old path is otherwise never seen again, so a caller
// watching it would miss its disappearance. Every other row still yields its one path.
const porcelainPaths = () => (git(['status', '--porcelain', '--untracked-files=all'], { raw: true }) || '')
  .split('\n').filter(Boolean).flatMap((l) => {
    const rest = l.slice(3);
    return (rest.includes(' -> ') ? rest.split(' -> ') : [rest]).map((p) => p.replace(/^"|"$/g, ''));
  }).slice(0, 2000);
const blobOf = (f) => (fs.existsSync(path.join(ROOT, f)) ? (git(['hash-object', f]) || '').slice(0, 12) : '-');
// One `git hash-object` per file is one PROCESS per file - 800 dirty files measured 4.5s for the snapshot alone,
// and Stop pays changedSince at the END of every turn until a watch entry hits, so past roughly a thousand dirty
// files the wired 10s timeout kills the hook and the end-of-session ask silently never fires. `--stdin-paths`
// hashes the whole list in one process (the same 800 measured at 24ms). A path that is gone never reaches git:
// ONE missing path fails the whole batch.
function blobsOf(files) {
  const out = new Map();
  const live = [];
  for (const f of files) {
    if (out.has(f)) continue;
    const there = fs.existsSync(path.join(ROOT, f));
    out.set(f, there ? '' : '-');
    if (there) live.push(f);
  }
  if (!live.length) return out;
  // `--stdin-paths` reads one path per LINE, so a name holding a newline cannot be batched at all.
  // `stdio` is spelled out: the helper's own 'ignore' on stdin would hand git an immediate EOF and it would hash
  // nothing, silently falling back to one call per file (measured SLOWER than no batching at all).
  const hashed = live.some((f) => /[\n\r]/.test(f)) ? null
    : git(['hash-object', '--stdin-paths'], { raw: true, input: `${live.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'] });
  const rows = hashed === null ? [] : hashed.split('\n').filter(Boolean);
  if (rows.length === live.length) { live.forEach((f, i) => out.set(f, rows[i].slice(0, 12))); return out; }
  // git refuses the WHOLE batch over one path it cannot hash (a directory, an unreadable file). One call per file
  // then: a hiccup costs time rather than reporting every file in the tree as changed.
  for (const f of live) out.set(f, blobOf(f));
  return out;
}
const docsRel = () => path.relative(ROOT, DOCS_ROOT).split(path.sep).join('/');

// Every mainline ref that actually exists here: the local branches, their origin/<name> remote-tracking twins,
// and origin/HEAD's target. A git-flow repo (work on develop, origin/HEAD -> main) has several of these, and
// they can be commits apart - a stale local mainline must never be the nearest candidate just because it is
// local, so a branch cut from the remote-tracking ref is measured against that ref too.
let MAINLINE_REFS_CACHE;
function mainlineRefs() {
  if (MAINLINE_REFS_CACHE) return MAINLINE_REFS_CACHE;
  const refs = MAINLINE.filter((n) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${n}`]) !== null);
  const originHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) refs.push(originHead);
  for (const n of MAINLINE) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${n}`]) !== null) refs.push(`origin/${n}`);
  }
  return (MAINLINE_REFS_CACHE = [...new Set(refs)]);
}

// The files this branch COMMITTED since it left mainline, by their blob at that tip: the evidence that lets a later
// mainline session tell the branch landed even when it was squashed or rebased. Uncommitted and untracked files stay
// out - a log or scratch file never reaches mainline, and recording one would make the branch look unmerged forever.
const blobAt = (ref, f) => (git(['rev-parse', `${ref}:${f}`]) || '-').slice(0, 12);
function branchFiles(base, ref = 'HEAD') {
  const changed = base ? (git(['diff', '--name-only', `${base}..${ref}`]) || '').split('\n').filter(Boolean) : [];
  const out = {};
  for (const f of changed.filter((x) => !x.startsWith(`${docsRel()}/`)).slice(0, 200)) out[f] = blobAt(ref, f);
  return out;
}

// Ancestry cannot change under a single command or hook event, and the same pair is asked about by autoPromote,
// status and prune in turn, so each answer is paid for once.
const ANCESTRY = new Map();
const isAncestor = (sha, ref) => {
  const k = `${sha}..${ref}`;
  if (!ANCESTRY.has(k)) ANCESTRY.set(k, spawnSync('git', ['merge-base', '--is-ancestor', sha, ref], { cwd: ROOT }).status === 0);
  return ANCESTRY.get(k);
};
// Is this a commit the repo actually has? A recorded fork point can name one it does not - pruned, re-cloned,
// hand-edited - and then `head !== base` is true by accident and every measurement from it is fiction.
const COMMITS = new Map();
const isCommit = (sha) => {
  if (!sha) return false;
  if (!COMMITS.has(sha)) COMMITS.set(sha, git(['rev-parse', '--verify', `${sha}^{commit}`]) !== null);
  return COMMITS.get(sha);
};
// Has this commit already reached mainline? Measured against every mainline ref that exists, so the answer does not
// depend on which branch the session happens to sit on.
const inMainline = (sha) => mainlineRefs().some((ref) => isAncestor(sha, ref));
// Every local branch and its tip, in one call: an overlay is looked up here once per process rather than costing a
// rev-parse each, and the live branch set below reads the same answer.
let TIPS_CACHE;
const branchTips = () => (TIPS_CACHE || (TIPS_CACHE = new Map((git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads']) || '')
  .split('\n').filter(Boolean).map((row) => [row.slice(0, row.lastIndexOf(' ')), row.slice(row.lastIndexOf(' ') + 1)]))));
const liveBranches = () => new Set([...branchTips().keys()].map(safe));
// The branch's ref while it still exists. BASE.json is a snapshot, the ref is the branch itself: a snapshot taken
// before the branch's first commit says head === base forever, and only the ref can correct it.
const branchTip = (meta) => (meta && meta.branch ? branchTips().get(meta.branch) || null : null);

// What a branch holds, measured from one ref: its fork point (the nearest mainline merge-base), its tip, and the
// files it committed since. Sound only while the branch has NOT reached mainline - once it has, the merge-base
// collapses onto the tip and the fork point is no longer measurable, which is why the snapshot is kept at all.
function metaFor(b, ref, head = git(['rev-parse', ref])) {
  const merged = mainlineRefs().map((r) => git(['merge-base', ref, r])).filter(Boolean)
    .map((mb) => ({ mb, count: Number(git(['rev-list', '--count', `${mb}..${ref}`]) || 0) }));
  const base = merged.length ? merged.reduce((best, x) => (x.count < best.count ? x : best)).mb : head;
  return { branch: b, base, head, files: branchFiles(base, ref), updated: new Date().toISOString() };
}
// ONE rule decides every write: a snapshot is only ever taken while the branch is still short of mainline. Once its
// tip has reached mainline nothing here is measurable any more - the merge-base has collapsed onto the tip, so a
// rewrite would say 'no commits of its own' about a branch that landed (stranding its sections forever) and 'own
// commits' about one that only caught up (promoting sections still being written). The existing snapshot, taken
// while both were still knowable, is kept whole: base, head and files.
function writeBaseMeta(dir, b, ref = 'HEAD') {
  const head = git(['rev-parse', ref]);
  if (head && inMainline(head) && readMetaAt(dir)) return;
  fs.writeFileSync(path.join(dir, 'BASE.json'), `${JSON.stringify(metaFor(b, ref, head), null, 2)}\n`);
}
// Every live overlay is refreshed here, not just this branch's: a branch is only checked out again when someone works
// on it, so a branch that committed after its sections were written would otherwise carry a snapshot from before
// those commits until it is deleted.
function refreshBaseMeta() {
  const dir = overlayDir();
  if (dir && fs.existsSync(dir)) writeBaseMeta(dir, branch());
  if (!hasGit() || gitVersioned()) return;
  const current = safe(branch() || '');
  for (const name of overlayNames()) {
    if (name === current) continue;
    const meta = readMeta(name);
    const tip = branchTip(meta);
    if (!tip || tip === meta.head || inMainline(tip)) continue;
    writeBaseMeta(path.join(BRANCHES, name), meta.branch, tip);
  }
}
function readMetaAt(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'BASE.json'), 'utf8')); } catch { return null; }
}
const readMeta = (name) => readMetaAt(path.join(BRANCHES, name));

// The domain goes first: two domains can hold the same relKey (every domain owns a references/ folder, and a
// shared topic name there is ordinary), so without it their overrides, bases and conflict markers would land on
// the same path and the second write would silently erase the first.
const overlayParts = (file, id) => [fileDomain(file), ...relKey(file).split('/'), `${id}.md`];

// `expect` is the hash of the text the writer was SHOWN (the finish ask hands it over). Two agents that both rewrite
// one section used to race: the second `set` won silently and the first's text was gone. A mismatch refuses the write
// and hands the current text back, so the second re-applies on top instead of overwriting what it never read. A `set`
// with no hash is unchanged - nothing that exists today has to pass one.
function set(ref, newText, expect) {
  const [fileKey, sec] = String(ref).split('#');
  if (!sec) return { error: 'name one section: set <file>#<id> - whole-file writes are not supported' };
  // parseRef resolves a bare ref exactly as findFile always did (same collision refusal, same domain search)
  // and additionally understands a <domain>/<file> prefix, which findFile alone cannot. A null domain, or a
  // domain whose guessed file parseRef could not actually find, both mean the same thing findFile's missing
  // return meant: no such doc file.
  let parsed;
  try { parsed = parseRef(ref); } catch (e) { return { error: e.message }; }
  const file = parsed.domain ? path.join(domainDir(parsed.domain), parsed.file) : undefined;
  if (!file || !domainFiles(parsed.domain).includes(file)) return { error: `no such doc file: ${fileKey}` };
  if (!/^[\w.-]+$/.test(sec)) return { error: `not a valid section id: ${sec}` };
  if (!String(newText).trim()) return { error: 'empty section text: nothing written' };
  const gitRepo = hasGit();
  const b = branch();
  if (gitRepo && !b && git(['rev-parse', 'HEAD']) !== null) return { error: 'detached HEAD: check out a branch before writing docs' };
  const hit = sections(file).find((s) => s.id === `${key(file)}#${sec}`);
  if (expect && (!hit || sectionHash(hit.text) !== expect)) {
    const now = hit ? hit.text : '';
    const body = now.length > MAX_SECTION_CHARS ? `${now.slice(0, MAX_SECTION_CHARS)}\n... (${now.length - MAX_SECTION_CHARS} more chars: 'docs.js show ${fileKey}#${sec}')` : now;
    return {
      error: [
        `${fileKey}#${sec} changed while you were working - nothing was written. Here it is now:`,
        '', ...(hit ? [body] : ['(it is gone from the docs)']), '',
        hit
          ? `Re-apply only what your change made untrue on top of THAT text, then: docs.js set ${fileKey}#${sec} --expect ${sectionHash(hit.text)}`
          : `Someone removed it while you worked. Write it back with: docs.js set ${fileKey}#${sec}`,
      ].join('\n'),
    };
  }
  const lines = ensureHeadingAndId(newText, sec, `${'#'.repeat(hit ? hit.level : 2)} ${hit ? hit.heading : sec.replace(/-/g, ' ')}`);
  let j = 2;
  const meta = [];
  while (j < lines.length && COMMENT.test(lines[j])) meta.push(lines[j++]);
  const kept = meta.filter((m) => !STAMP.test(m));
  if (hit && hit.declared && !kept.some((m) => COVERS.test(m))) kept.unshift(`<!-- covers: ${hit.covers.join(', ')} -->`);
  const own = globList((COVERS.exec(kept.join('\n')) || [])[1] || '');
  const stampLine = gitRepo ? captureStamp(own.length ? own : (hit ? hit.covers : [])) : '';
  const text = [lines[0], lines[1], ...kept, ...(stampLine ? [stampLine] : []), ...lines.slice(j)].join('\n');
  if (!gitRepo || gitVersioned() || isMainline(b)) return writeInPlace(file, sec, text);
  return writeOverride(file, sec, text, b);
}

// A promote conflict can otherwise only be resolved by adopting the branch's lines. Writing this section on
// mainline - by any text, including mainline's own unchanged one - is the human's deliberate call: it clears
// every branch's pending conflict marker for this id, discarding that branch's override rather than blending
// it again.
function writeInPlace(file, sec, text) {
  const raw = fs.readFileSync(file, 'utf8');
  const own = parse(file, raw).find((s) => s.id === `${key(file)}#${sec}`);
  const next = own ? spliceSection(raw.split('\n'), own, text).join('\n') : `${norm(raw)}\n\n${norm(text)}\n`;
  fs.writeFileSync(file, next);
  const resolved = [];
  if (hasGit() && !gitVersioned() && isMainline(branch())) {
    const parts = overlayParts(file, sec);
    for (const name of overlayNames()) {
      const bdir = path.join(BRANCHES, name);
      const marker = path.join(bdir, '.conflict', ...parts);
      if (!fs.existsSync(marker)) continue;
      fs.rmSync(path.join(bdir, ...parts), { force: true });
      fs.rmSync(path.join(bdir, '.base', ...parts), { force: true });
      fs.rmSync(marker, { force: true });
      if (overrideFiles(bdir).length === 0) fs.rmSync(bdir, { recursive: true, force: true });
      resolved.push(name);
    }
  }
  return { wrote: path.relative(ROOT, file), inPlace: true, added: !own, resolved };
}

// Parent and child overrides never coexist: a section already served from an ancestor's override lands inside
// that ancestor's file instead of a file of its own, and setting a parent absorbs (and drops) any override of
// its own descendants - one override file per nested block, so every reader sees exactly one.
function writeOverride(file, sec, text, b) {
  const dir = path.join(BRANCHES, safe(b));
  const owner = overlayOwner(dir);
  if (owner && owner !== b) return { error: `${path.relative(ROOT, dir)} holds ${owner}'s doc versions, not ${b}'s (both names fold onto one directory) - rename one branch, or promote/prune ${owner} first` };
  const current = sections(file);
  const hit = current.find((s) => s.id === `${key(file)}#${sec}`);
  if (hit && hit.overrideOf && hit.overrideOf !== sec) {
    const ancestor = current.find((s) => sectionId(s) === hit.overrideOf);
    const spliced = spliceSection(ancestor.text.split('\n'), { start: hit.start - ancestor.start, end: hit.end - ancestor.start }, text);
    const target = path.join(dir, ...overlayParts(file, hit.overrideOf));
    const base = path.join(dir, '.base', ...overlayParts(file, hit.overrideOf));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${norm(spliced.join('\n'))}\n`);
    writeBaseMeta(dir, b);
    return { wrote: path.relative(ROOT, target), base: path.relative(ROOT, base), into: hit.overrideOf };
  }
  const mainlineForDrop = parse(file, fs.readFileSync(file, 'utf8'));
  const dropParent = mainlineForDrop.find((s) => s.id === `${key(file)}#${sec}`);
  if (dropParent) {
    for (const [id, opath] of sectionOverrides(file, dir)) {
      if (id === sec) continue;
      const descMain = mainlineForDrop.find((s) => sectionId(s) === id);
      if (descMain && descMain.start > dropParent.start && descMain.end <= dropParent.end) {
        fs.rmSync(opath, { force: true });
        fs.rmSync(path.join(dir, '.base', ...overlayParts(file, id)), { force: true });
      }
    }
  }
  const target = path.join(dir, ...overlayParts(file, sec));
  const base = path.join(dir, '.base', ...overlayParts(file, sec));
  if (!fs.existsSync(base)) {
    const mainline = parse(file, fs.readFileSync(file, 'utf8')).find((s) => s.id === `${key(file)}#${sec}`);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(base, mainline ? mainline.text : '');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${norm(text)}\n`);
  writeBaseMeta(dir, b);
  return { wrote: path.relative(ROOT, target), base: path.relative(ROOT, base) };
}

function allSections() {
  return docFiles().flatMap((f) => sections(f));
}

// One section as the finish ask needs it: the heading a person would say it by, where it lives, its first sentence,
// and the hash a later `set --expect` refuses a stale rewrite against.
function askRef(id) {
  const s = allSections().find((x) => x.id === id);
  if (!s) return null;
  // A section that is a heading and nothing else has no sentence to quote, and a bare '""' in the ask reads like a
  // bug rather than like an empty section.
  return { id, heading: s.heading, file: path.relative(ROOT, s.from).split(path.sep).join('/'), first: firstSentence(s.text) || '(no text yet - this section is a heading only)', hash: sectionHash(s.text) };
}

function toc(fileKey) {
  let file;
  try { file = findFile(fileKey); } catch (e) { return e.message; }
  if (!file) return `no such doc file: ${fileKey}. Known: ${docFiles().map(knownKey).join(', ')}`;
  const secs = sections(file);
  if (!secs.length) return `${key(file)} has no headings (${fs.statSync(file).size} chars)`;
  return secs.map((s) => `${s.id}  ${'  '.repeat(s.level - 2)}${s.heading} (${s.chars} chars)${s.overrideOf ? (s.conflict ? ' [this branch, CONFLICT]' : ' [this branch]') : ''}`).join('\n');
}

function show(ref) {
  const [fileKey, sec] = String(ref).split('#');
  let file;
  try { file = findFile(fileKey); } catch (e) { return e.message; }
  if (!file) return `no such doc file: ${fileKey}. Known: ${docFiles().map(knownKey).join(', ')}`;
  if (!sec) return toc(fileKey);
  const secs = sections(file);
  const hit = secs.find((s) => s.id === `${key(file)}#${sec}`) || secs.find((s) => slug(s.heading).startsWith(sec));
  if (!hit) return `no section ${sec} in ${fileKey}.\n${toc(fileKey)}`;
  const body = hit.chars > SHOW_CHARS ? `${hit.text.slice(0, SHOW_CHARS)}\n... (${hit.chars - SHOW_CHARS} more chars; open ${path.relative(ROOT, hit.from)} for the rest)` : hit.text;
  const where = hit.overrideOf
    ? `${path.relative(ROOT, hit.from)} (this branch's version of ${key(file)}#${hit.overrideOf}${hit.conflict ? ' - CONFLICT: mainline changed the same lines; `docs.js show ' + key(file) + '#' + hit.overrideOf + ' --conflict` shows both' : ''}${hit.orphan ? ' - mainline removed this section' : ''})`
    : `${path.relative(ROOT, hit.from)} line ${hit.start + 1}`;
  const outgrown = outgrownFiles(hit);
  const warn = outgrown.length ? `\nOUTGROWN: ${outgrown.length} file(s) it covers changed since it was written (${outgrown.slice(0, 3).join(', ')}) - the code wins.` : '';
  return `${where}${warn}\n\n${body}`;
}

const overlayNames = () => (fs.existsSync(BRANCHES) ? fs.readdirSync(BRANCHES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
let SHALLOW_CACHE;
const isShallow = () => (SHALLOW_CACHE === undefined ? (SHALLOW_CACHE = git(['rev-parse', '--is-shallow-repository']) === 'true') : SHALLOW_CACHE);
const overrideFiles = (dir) => walkFiles(dir).filter((f) => {
  const parts = path.relative(dir, f).split(path.sep);
  return !parts.includes('.base') && !parts.includes('.conflict');
});

// Direct proof that a branch was merged: a commit in mainline's history names the branch's tip as a parent other
// than its first, so a merge commit brought it in.
const mergedInto = (tip) => (git(['rev-list', '--parents', '--ancestry-path', '--merges', `${tip}..HEAD`]) || '')
  .split('\n').filter(Boolean).some((row) => row.split(' ').slice(2).includes(tip));
// The proof above is not enough on its own. A branch that only caught UP with mainline sits on a mainline commit,
// and that commit becomes somebody's SECOND parent the moment another mainline ref merges the branch it sits on
// (develop released into main, the shape this repo itself uses) - so the merge commit would name a branch that
// committed nothing. A commit on a mainline ref's own first-parent chain is mainline's work, never a branch's.
// Memoised: each walk is O(commits since the fork point), and mergedBranches runs twice in one session start
// (autoPromote, then status), asking about the same few tips each time.
const FIRST_PARENT = new Map();
const onMainlineFirstParent = (sha, base) => {
  const k = `${sha}|${base}`;
  if (!FIRST_PARENT.has(k)) {
    FIRST_PARENT.set(k, mainlineRefs()
      .some((ref) => (git(['rev-list', '--first-parent', `${base}..${ref}`]) || '').split('\n').includes(sha)));
  }
  return FIRST_PARENT.get(k);
};

// A branch landed when its last recorded commit is part of HEAD - provided it had commits of its own - or when every
// file it changed now holds, at HEAD, the content the branch gave it (a squash or a rebase leaves no ancestor), or
// when a merge commit here names its tip.
function mergedBranches() {
  if (!hasGit() || gitVersioned() || isShallow()) return [];
  const here = branch() || '';
  const current = safe(here);
  const out = [];
  for (const name of overlayNames()) {
    // Skip the overlay of the branch checked out here - by OWNER, not by directory name: 'feature/login' and
    // 'feature-login' share a directory, and skipping by name alone would hide the owner's landed work from
    // every session that happens to sit on the other branch.
    if (name === current && !overlayClash(path.join(BRANCHES, name), here)) continue;
    const stored = readMeta(name);
    if (!stored || !stored.head) continue;
    const tip = branchTip(stored);
    // A live branch still short of mainline can be re-measured from its ref, which replaces a snapshot taken before
    // its first commit. Once its tip IS in mainline only the snapshot can still say what the branch's own work was,
    // so there the stored numbers stand and the merge commit carries the proof instead.
    const meta = tip && tip !== stored.head && !inMainline(tip) ? metaFor(stored.branch || name, tip) : stored;
    // Both routes below that reason from the fork point stand down when it is not a commit this repo has: with a
    // base nothing can be measured against, `head !== base` means nothing and the first-parent guard cannot tell
    // mainline's own commits apart. The blob route carries its own evidence and is left alone.
    const baseOk = isCommit(meta.base);
    const ownCommits = baseOk && meta.head !== meta.base;
    const ancestor = ownCommits && isAncestor(meta.head, 'HEAD');
    const files = Object.entries(meta.files || {});
    const landed = !ancestor && files.length > 0 && files.every(([f, blob]) => (blob === '-'
      ? git(['cat-file', '-e', `HEAD:${f}`]) === null
      : (git(['rev-parse', `HEAD:${f}`]) || '').startsWith(blob)));
    // Only a snapshot the ref has outgrown needs this route: when the two agree, the ancestor check above already
    // asked about that same commit. Everything else here keeps a branch that committed nothing of its own out of
    // it: the tip must have left the RECORDED fork point, and it must not be a commit mainline itself made.
    const byMerge = !ancestor && !landed && baseOk && Boolean(tip) && tip !== stored.head && tip !== meta.base
      && isAncestor(tip, 'HEAD') && !onMainlineFirstParent(tip, meta.base) && mergedInto(tip);
    if (ancestor || landed || byMerge) out.push({ name, branch: meta.branch || name, how: ancestor ? 'ancestor' : landed ? 'blobs' : 'merge' });
  }
  return out;
}

// promote is a read-modify-write of the mainline doc file per section, and it deletes the overlay afterwards. Two
// sessions starting on mainline at the same moment (a session start auto-promotes) can each read the file before
// either writes: one promoted section is lost AND both overlays are removed, so that branch's text is gone for
// good. One lock file per docs root, taken with O_EXCL - the loser does nothing and says so rather than racing.
// Only a lock older than LOCK_STALE_MS is broken: a promote of every override of one branch is milliseconds, so a
// minute can only mean a killed process.
const LOCK_STALE_MS = 60000;
function takeLock() {
  const file = path.join(BRANCHES, '.promote.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, { flag: 'wx' });
      return () => { try { fs.rmSync(file, { force: true }); } catch {} };
    } catch (e) {
      if (e.code !== 'EEXIST') return null;
      let ageMs = LOCK_STALE_MS + 1;
      try { ageMs = Date.now() - fs.statSync(file).mtimeMs; } catch {}
      if (ageMs < LOCK_STALE_MS) return null;
      try { fs.rmSync(file, { force: true }); } catch { return null; }
    }
  }
  return null;
}

function promote(name) {
  const dir = path.join(BRANCHES, safe(name));
  if (!fs.existsSync(dir)) return { error: `no doc overrides for ${name}` };
  // Both names fold onto one directory. Promoting by a name that is a live branch of its own, while the overlay
  // records a DIFFERENT branch, would fold one branch's decisions into mainline under the other's name.
  const owner = overlayOwner(dir);
  if (owner && owner !== name && branchTips().has(name)) {
    return { error: `${path.relative(ROOT, dir)} holds ${owner}'s doc versions, not ${name}'s (both names fold onto one directory) - promote ${owner} instead` };
  }
  const release = takeLock();
  if (!release) return { results: [], removed: false, changed: false, locked: true };
  try { return promoteLocked(name, dir); } finally { release(); }
}

function promoteLocked(name, dir) {
  const results = [];
  let freshConflict = false;
  for (const over of overrideFiles(dir)) {
    const rel = path.relative(dir, over).split(path.sep);
    const id = path.basename(rel.pop(), '.md');
    // rel's own leading segment is the domain overlayParts wrote (kept in rel for the .base/.conflict
    // paths below, which mirror overlayParts' own shape); only the mainline file lives outside it.
    const [domain, ...relParts] = rel;
    const mainline = `${path.join(domainDir(domain), ...relParts)}.md`;
    const label = `${path.basename(mainline, '.md')}#${id}`;
    const marker = path.join(dir, '.conflict', ...rel, `${id}.md`);
    // A standing conflict is flagged with a marker holding mainline's text at THIS moment - not to compare
    // against later (any set of the section on mainline resolves it, whatever it says), just for reference.
    // Only a marker that did not already exist counts toward whether this run changed anything.
    const flagConflict = (why, mainlineText) => {
      if (!fs.existsSync(marker)) freshConflict = true;
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, `${stripStamp(mainlineText || '')}\n`);
      results.push({ id: label, result: 'conflict', why, path: over });
    };
    // No marker here: a missing doc file is a conflict `set` can never match (there is no file to write the
    // section into), so a marker for it could only ever be cleared by prune - which drops the whole branch,
    // including any of its other, perfectly fine overrides. It stays a plain, always-reported conflict.
    if (!fs.existsSync(mainline)) { results.push({ id: label, result: 'conflict', why: 'mainline has no such doc file', path: over }); continue; }
    const raw = fs.readFileSync(mainline, 'utf8');
    const hit = parse(mainline, raw).find((s) => s.id === label);
    const base = safeRead(path.join(dir, '.base', ...rel, `${id}.md`));
    const mine = fs.readFileSync(over, 'utf8');
    const covers = (t) => globList((COVERS.exec(norm(t).split('\n').slice(0, 10).join('\n')) || [])[1] || '');
    const restamp = (t) => withStamp(t, captureStamp(covers(t)));
    if (!hit) {
      if (norm(base)) { flagConflict('mainline removed this section', ''); continue; }
      fs.writeFileSync(mainline, `${norm(raw)}\n\n${norm(restamp(mine))}\n`);
      results.push({ id: label, result: 'added', path: over });
      continue;
    }
    // An empty base with mainline HOLDING the id means some other branch's own promote already added it (this
    // override's base was captured before that landed) - the same text is a no-op merge, different text is a
    // second, independent decision for the same id and is never silently taken as the winner.
    if (!norm(base)) {
      if (stripStamp(hit.text) !== stripStamp(mine)) { flagConflict('both added this section', hit.text); continue; }
      fs.writeFileSync(mainline, spliceSection(raw.split('\n'), hit, norm(restamp(mine))).join('\n'));
      results.push({ id: label, result: 'merged', path: over });
      continue;
    }
    const m = merge3(stripStamp(hit.text), stripStamp(base), stripStamp(mine), name);
    if (m.error || m.conflicts) { flagConflict(m.error || 'both sides changed the same lines', hit.text); continue; }
    fs.writeFileSync(mainline, spliceSection(raw.split('\n'), hit, norm(restamp(m.text))).join('\n'));
    results.push({ id: label, result: 'merged', path: over });
  }
  for (const r of results.filter((x) => x.result !== 'conflict')) {
    fs.rmSync(r.path, { force: true });
    fs.rmSync(path.join(dir, '.base', path.relative(dir, r.path)), { force: true });
    fs.rmSync(path.join(dir, '.conflict', path.relative(dir, r.path)), { force: true });
  }
  const removed = overrideFiles(dir).length === 0;
  if (removed) fs.rmSync(dir, { recursive: true, force: true });
  const changed = results.some((x) => x.result !== 'conflict') || freshConflict;
  if (changed) {
    try { fs.appendFileSync(path.join(BRANCHES, 'promoted.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), branch: safe(name), results: results.map(({ id, result }) => ({ id, result })) })}\n`); } catch {}
  }
  return { results: results.map(({ id, result, why }) => ({ id, result, why })), removed, changed };
}

function autoPromote() {
  const b = branch();
  if (!b || !isMainline(b) || gitVersioned()) return [];
  // By the branch the overlay records, never by its directory name: the two differ whenever the name was folded
  // (any slash), and only the recorded one passes promote's own owner check.
  return mergedBranches().map((m) => ({ branch: m.branch, how: m.how, ...promote(m.branch) }));
}

// The overlays no promote will ever pick up by itself, in one pass over the branches (mergedBranches is the
// expensive part and is asked once):
//   deleted   - the branch is gone and nothing proved it merged; only the user knows which it was.
//   onMainline - the branch is alive and its tip already sits in mainline with no proof it landed. A branch that
//     merely caught up looks exactly like one whose sections were written before its first commit and was then
//     fast-forwarded in, so the engine cannot choose - but saying nothing leaves the second kind stranded in
//     silence. A branch still sitting ON its own fork point is not either of those: it has committed nothing, so
//     nothing of it can have landed, and inviting a promote there would publish an unfinished decision.
function unpromotable() {
  if (!hasGit() || gitVersioned()) return { deleted: [], onMainline: [] };
  const live = liveBranches();
  const current = safe(branch() || '');
  const merged = new Set(mergedBranches().map((m) => m.name));
  const rest = overlayNames().filter((n) => n !== current && !merged.has(n));
  // Only a session ON mainline can act on the second list, and only there is HEAD the ref to ask - which is also
  // the question mergedBranches just asked about most of these tips, so the answer is usually already paid for.
  const here = !isMainline(branch()) ? [] : rest.filter((n) => live.has(n))
    .filter((n) => { const m = readMeta(n); const t = branchTip(m); return Boolean(t) && t !== m.base && isAncestor(t, 'HEAD'); });
  return { deleted: rest.filter((n) => !live.has(n)), onMainline: here };
}
const deletedUnmerged = () => unpromotable().deleted;

// The newest mtime of any file under a directory - a fallback clock for an overlay whose BASE.json cannot
// say when it was last touched (missing, unreadable, or written before 'updated' existed).
function newestFileMs(dir) {
  let max = fs.statSync(dir).mtimeMs;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else max = Math.max(max, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return max;
}

function prune(name) {
  if (name) {
    const dir = path.join(BRANCHES, safe(name));
    if (!fs.existsSync(dir)) return [];
    fs.rmSync(dir, { recursive: true, force: true });
    return [safe(name)];
  }
  // The sweep keeps an overlay while mergedBranches() still names it, which is what stops it dropping a decision a
  // promote could still fold in. Under git versioning that list is empty by design, so the guard would be half
  // gone and a merged, never-promoted overlay would be deleted with its text: the whole machinery stands down
  // here too, and `prune <branch>` above stays the way to drop one by name.
  if (!hasGit() || gitVersioned()) return [];
  const live = liveBranches();
  const merged = new Set(mergedBranches().map((m) => m.name));
  const dropped = [];
  for (const n of overlayNames()) {
    if (live.has(n) || merged.has(n)) continue;
    const dir = path.join(BRANCHES, n);
    const meta = readMeta(n);
    const updatedMs = meta && meta.updated ? Date.parse(meta.updated) : NaN;
    const ageMs = Date.now() - (Number.isFinite(updatedMs) ? updatedMs : newestFileMs(dir));
    if (ageMs / 86400000 < 30) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    dropped.push(n);
  }
  return dropped;
}

function status() {
  const b = branch();
  const gitRepo = hasGit();
  const view = overlayDir() ? docFiles().flatMap((f) => sections(f).filter((s) => s.overrideOf)) : [];
  const stuck = unpromotable();
  // Overlays that nothing can reach any more: the install moved to git versioning - the setting was answered, or a
  // previously ignored docs root was committed - and every branch version under .branches/ became unreadable and
  // unpromotable at once.
  const stranded = gitRepo && gitVersioned() ? overlayNames() : [];
  // Which branch the directory this one would use actually belongs to, when it is not this branch (safe() folds
  // 'feature/login' and 'feature-login' together). Non-null means this session reads mainline and writes nothing.
  const clash = b && gitRepo && !gitVersioned() && !isMainline(b) && overlayClash(path.join(BRANCHES, safe(b)), b)
    ? overlayOwner(path.join(BRANCHES, safe(b))) : null;
  const declared = declaredVersioning();
  // The mode NAMES its source: 'declared by <the key that answered>' is a decision someone made at install time,
  // the bare form is this engine reading git because nobody has been asked yet. The two leading words are the
  // contract other readers key on.
  const gitLine = declared ? `git (declared by ${declared.key} - git versions the docs per branch; no branch overlay)`
    : 'git (docs are committed - git versions them per branch)';
  const overlayLine = declared ? `overlay (declared by ${declared.key} - branch versions live in .branches/)`
    : 'overlay (docs are ignored by git - branch versions live in .branches/)';
  return {
    // The third pillar - the end-of-session watch check - compares the tree against a git snapshot, so without a
    // repo it can never fire, and only this line can say so.
    mode: !gitRepo ? 'no git (docs written in place; the end-of-session check cannot see what changed)' : gitVersioned() ? gitLine : overlayLine,
    versioning: gitRepo ? docsMode() : 'none',
    declared: declared ? declared.mode : null,
    declaredBy: declared ? declared.key : null,
    docsTracked: gitRepo && tracked(),
    mismatch: versioningMismatch(),
    branch: b || (gitRepo && git(['rev-parse', 'HEAD']) ? 'detached HEAD' : 'no branch'),
    detached: Boolean(gitRepo && !b && git(['rev-parse', 'HEAD'])),
    mainline: isMainline(b),
    overrides: view.map((s) => s.id),
    conflicts: view.filter((s) => s.conflict).map((s) => s.id),
    orphans: view.filter((s) => s.orphan).map((s) => s.id),
    outgrown: stale().length,
    deletedUnmerged: stuck.deleted,
    liveOnMainline: stuck.onMainline,
    shallow: gitRepo && isShallow(),
    legacyDelta: fs.existsSync(path.join(DOCS, 'BRANCH-DELTA.md')),
    stranded,
    clash,
  };
}

function lint() {
  const problems = [];
  const notes = [];
  for (const f of docFiles()) {
    const raw = fs.readFileSync(f, 'utf8');
    if (/^(<{7}|>{7})( |$)/m.test(raw)) problems.push(`merge conflict markers in ${relKey(f)} - resolve them before any reader trusts this file`);
    const hist = isHistory(f);
    const seen = new Map();
    const secs = parse(f, raw);
    for (const s of secs) {
      if (!s.declaredId) problems.push(`section without an id: ${relKey(f)} '${s.heading}' - run docs.js seed-ids`);
      else if (seen.has(s.declaredId)) problems.push(`duplicate id ${key(f)}#${s.declaredId} (lines ${seen.get(s.declaredId) + 1} and ${s.start + 1})`);
      else seen.set(s.declaredId, s.start);
      if (!hist && s.ownChars > MAX_SECTION_CHARS) problems.push(`oversized section (${s.ownChars} chars, cap ${MAX_SECTION_CHARS}): ${key(f)}#${s.declaredId || slug(s.heading)} - split it`);
    }
    if (!hist && secs.length && !secs.some((s) => s.covers.length)) notes.push(`no section declares covers: ${relKey(f)}`);
  }
  if (fs.existsSync(BLOCK_FILE)) {
    const bytes = fs.statSync(BLOCK_FILE).size;
    if (bytes > BLOCK_BYTES) problems.push(`ORIENTATION.md is ${bytes} bytes, cap ${BLOCK_BYTES} - every session pays for it`);
    for (const p of verifyBlock()) problems.push(`ORIENTATION.md ${p}`);
  } else notes.push('no ORIENTATION.md: sessions start with no map');
  const w = loadWatch();
  problems.push(...w.problems);
  const ids = new Set(allSections().map((s) => s.id));
  for (const e of [...w.watch, ...(w.newModule ? [{ kind: 'newModule', sections: w.newModule.sections }] : [])]) {
    for (const id of e.sections) if (!ids.has(id)) problems.push(`watch.json '${e.kind}' names a section that does not exist: ${id}`);
  }
  if (overlayDir()) {
    const st = status();
    for (const id of st.conflicts) problems.push(`this branch's version of ${id} conflicts with mainline's newer text - docs.js show ${id} --conflict`);
    for (const id of st.orphans) problems.push(`this branch overrides ${id}, which mainline removed`);
  }
  return { problems, notes };
}

function seedIds() {
  let added = 0;
  for (const f of docFiles()) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const used = new Set(parse(f, lines.join('\n')).map((s) => s.declaredId).filter(Boolean));
    const out = [];
    let fenced = false;
    let here = 0;
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      if (/^```/.test(lines[i])) fenced = !fenced;
      if (fenced) continue;
      const m = /^(#{2,4})\s+(.+?)\s*$/.exec(lines[i]);
      if (!m || ID.test(metaUnder(lines, i))) continue;
      const baseId = slug(m[2].replace(/[`*]/g, '')) || 'section';
      let id = baseId;
      for (let n = 2; used.has(id); n++) id = `${baseId}-${n}`;
      used.add(id);
      out.push(`<!-- id: ${id} -->`);
      here++;
    }
    if (here) fs.writeFileSync(f, out.join('\n'));
    added += here;
  }
  return added;
}

const WATCH_ROOTS = ['src', 'tests'];
function loadWatch() {
  const empty = { sourceRoots: WATCH_ROOTS, watch: [], newModule: null };
  if (!fs.existsSync(WATCH_FILE)) return { ...empty, problems: [], missing: true };
  let j;
  try { j = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); } catch (e) { return { ...empty, problems: [`watch.json is not valid JSON: ${e.message}`] }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ...empty, problems: ['watch.json must be an object with sourceRoots, watch and newModule'] };
  const problems = [];
  const strings = (v, what, required) => {
    if (v === undefined) { if (required) problems.push(`watch.json ${what} is missing`); return null; }
    if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || !x)) { problems.push(`watch.json ${what} must be a non-empty list of strings`); return null; }
    return v;
  };
  const sourceRoots = (strings(j.sourceRoots, 'sourceRoots') || WATCH_ROOTS).map((r) => r.replace(/\/+$/, ''));
  const watch = [];
  if (j.watch !== undefined && !Array.isArray(j.watch)) problems.push('watch.json watch must be a list');
  for (const [i, e] of (Array.isArray(j.watch) ? j.watch : []).entries()) {
    const globs = strings(e && e.globs, `watch[${i}].globs`, true);
    const secs = strings(e && e.sections, `watch[${i}].sections`, true);
    if (globs && secs) watch.push({ kind: typeof e.kind === 'string' && e.kind ? e.kind : `watch[${i}]`, globs, sections: secs });
  }
  let newModule = null;
  if (j.newModule !== undefined) {
    const globs = strings(j.newModule && j.newModule.globs, 'newModule.globs', true);
    const secs = strings(j.newModule && j.newModule.sections, 'newModule.sections', true);
    if (globs && secs) newModule = { globs: globs.map((g) => (g.endsWith('/') ? g : `${g}/`)), sections: secs };
  }
  return { sourceRoots, watch, newModule, problems };
}

function watchHits(files, dirs = []) {
  const w = loadWatch();
  const hits = [];
  for (const e of w.watch) {
    const hit = files.filter((f) => matches(e.globs, f));
    if (hit.length) hits.push({ kind: e.kind, files: hit, sections: e.sections });
  }
  if (w.newModule) {
    const hit = dirs.map((d) => `${d.replace(/\/+$/, '')}/`).filter((d) => matches(w.newModule.globs, d));
    if (hit.length) hits.push({ kind: 'new module', files: hit, sections: w.newModule.sections });
  }
  return hits;
}

// The tree as a session found it: HEAD, the blob of every file already dirty or untracked, and every folder that held
// a file. changedSince() compares against it, so a change a script made counts as much as a tool write.
function snapshot() {
  const dirty = Object.fromEntries(blobsOf(porcelainPaths()));
  const dirs = new Set();
  for (const f of (git(['ls-files', '-co', '--exclude-standard']) || '').split('\n').filter(Boolean)) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return { head: git(['rev-parse', 'HEAD']), dirty, dirs: [...dirs].slice(0, 20000) };
}

function changedSince(snap) {
  const out = new Set();
  if (!snap) return { files: [], dirs: [] };
  if (snap.head) for (const f of (git(['diff', '--name-only', `${snap.head}..HEAD`]) || '').split('\n').filter(Boolean)) out.add(f);
  const before = snap.dirty || {};
  const listed = new Set(porcelainPaths());
  // Every path is hashed ONCE: what is dirty now, plus what was dirty at snapshot time and is not listed any more
  // (committed, reverted or deleted) - those still need their blob to say whether the content moved.
  for (const [f, blob] of blobsOf([...listed, ...Object.keys(before).filter((f) => !listed.has(f))])) {
    if (before[f] !== blob) out.add(f);
  }
  const known = new Set(snap.dirs || []);
  const created = new Set();
  for (const f of out) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!known.has(d) && fs.existsSync(path.join(ROOT, d))) created.add(d);
    }
  }
  const docs = `${docsRel()}/`;
  return { files: [...out].filter((f) => !f.startsWith(docs)), dirs: [...created].filter((d) => !`${d}/`.startsWith(docs)) };
}

module.exports = {
  ROOT, DOCS_ROOT, DOCS, BLOCK_FILE, WATCH_FILE, BRANCHES, domains, domainDir, resetDomains,
  git, tracked, VERSIONING_KEYS, docsMode, gitVersioned, versioningMismatch, hasGit, branch, isMainline, safe, overlayDir, docFiles, relKey, key, findFile, parseRef, isHistory,
  parse, sections, allSections, where, show, toc, matches, outgrownFiles, stale,
  set, writeBaseMeta, refreshBaseMeta, readMeta, mainlineRefs, porcelainPaths, blobOf, blobsOf, overlayOwner,
  stripStamp, stampLineOf, withStamp, conflictView,
  overlayNames, mergedBranches, promote, autoPromote, deletedUnmerged, prune, status,
  lint, seedIds, loadWatch, watchHits, snapshot, changedSince,
  sectionHash, firstSentence, askRef,
};
if (require.main !== module) return;

const cmd = process.argv[2];
const args = process.argv.slice(3);
// Under the docs root, beside hook-blocks/ and tools-usage/: every other ledger in this stack lives there, and
// under .claude/ a project that commits that folder accumulated this one in git.
const docsLog = (row) => { try { fs.mkdirSync(DOCS_ROOT, { recursive: true }); fs.appendFileSync(path.join(DOCS_ROOT, 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); } catch {} };
const commands = {
  toc: () => console.log(toc(args[0])),
  show: () => {
    const at = args.indexOf('--conflict');
    if (at >= 0) { console.log(conflictView(args[0], args[at + 1])); return; }
    console.log(args.filter((a) => !a.startsWith('--')).map((a) => show(a)).join('\n\n'));
  },
  where: () => {
    const hits = where(args);
    console.log(hits.length ? hits.map((s) => `${s.id} - ${s.heading} (${s.chars} chars)`).join('\n') : 'no section matches those paths');
  },
  files: () => console.log(docFiles().map((f) => `${key(f)}  ${path.relative(ROOT, f)} (${fs.statSync(f).size} chars, ${sections(f).length} sections${isHistory(f) ? ', history' : ''})`).join('\n')),
  stale: () => {
    const rows = stale();
    console.log(rows.length ? rows.map((r) => `${r.s.id} - ${r.files.length} covered file(s) changed since ${r.s.stamp}: ${r.files.slice(0, 3).join(', ')}`).join('\n') : 'no section has been outgrown');
  },
  hash: () => {
    const r = askRef(args[0]);
    if (!r) { console.log(`no such section: ${args[0]}`); process.exit(1); }
    console.log(r.hash);
  },
  set: () => {
    const at = args.indexOf('--expect');
    // A flag that silently does nothing is worse than no flag: this is the one path where a stale write lands while
    // the writer believes it is guarded, so a lost hash refuses rather than degrading to an unguarded write.
    if (at >= 0 && !args[at + 1]) { console.log(`--expect needs a hash: 'docs.js hash ${args[0] || '<file>#<id>'}' prints the current one`); process.exit(1); }
    const expect = at >= 0 ? args[at + 1] : '';
    const [ref, from] = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args;
    let text = '';
    try { text = from ? fs.readFileSync(from, 'utf8') : fs.readFileSync(0, 'utf8'); } catch (e) { console.log(`cannot read the new text: ${e.message}`); process.exit(1); }
    const r = set(ref, text, expect);
    if (r.error) { console.log(r.error); process.exit(1); }
    docsLog({ event: 'doc-set', ref, wrote: r.wrote, inPlace: Boolean(r.inPlace) });
    console.log(r.inPlace ? `wrote ${ref} into ${r.wrote}` : `wrote ${r.wrote} (base kept at ${r.base}) - this branch only`);
    if (r.resolved && r.resolved.length) console.log(`resolved the pending doc conflict with: ${r.resolved.join(', ')}`);
  },
  promote: () => {
    if (args[0] === '--merged') {
      // Not 'nothing merged', which would claim a look that never happened: in git mode the branch's doc changes
      // arrive with its code, and .branches/ is not read at all.
      if (hasGit() && gitVersioned()) { console.log('git versioning: git carries the docs with the branch, so there is nothing to promote'); return; }
      if (isShallow()) { console.log('shallow clone: merged branches cannot be detected - nothing promoted'); return; }
      const rows = autoPromote();
      if (!rows.length) { console.log('nothing merged'); return; }
      if (rows.every((p) => p.locked)) { console.log('another promote is running: nothing promoted'); return; }
      for (const p of rows) {
        if (p.changed) docsLog({ event: 'promote', branch: p.branch, how: p.how, results: p.results });
        for (const x of p.results) console.log(`${p.branch} (${p.how}) ${x.id}: ${x.result}${x.why ? ` (${x.why})` : ''}`);
      }
      return;
    }
    const p = promote(args[0]);
    if (p.error) { console.log(p.error); process.exit(1); }
    if (p.locked) { console.log('another promote is running: nothing promoted'); return; }
    if (p.changed) docsLog({ event: 'promote', branch: args[0], how: 'manual', results: p.results });
    for (const x of p.results) console.log(`${x.id}: ${x.result}${x.why ? ` (${x.why})` : ''}`);
    process.exit(p.results.some((x) => x.result === 'conflict') ? 1 : 0);
  },
  prune: () => {
    if (!args[0] && hasGit() && gitVersioned()) { console.log("git versioning: git carries the docs with the branch, so nothing is swept - 'prune <branch>' still drops one overlay by name"); return; }
    const d = prune(args[0]);
    console.log(d.length ? `pruned: ${d.join(', ')}` : 'nothing to prune');
  },
  status: () => {
    const s = status();
    console.log([
      `mode: ${s.mode}`,
      ...(s.mismatch ? [s.mismatch] : []),
      `branch: ${s.branch}${s.mainline ? ' (mainline)' : ''}`,
      `overrides: ${s.overrides.length ? s.overrides.join(', ') : 'none'}`,
      ...(s.conflicts.length ? [`conflicts: ${s.conflicts.join(', ')}`] : []),
      ...(s.orphans.length ? [`orphaned (mainline removed the section): ${s.orphans.join(', ')}`] : []),
      `outgrown sections: ${s.outgrown}`,
      ...(s.deletedUnmerged.length ? [`deleted branches never detected as merged: ${s.deletedUnmerged.join(', ')}`] : []),
      ...(s.liveOnMainline && s.liveOnMainline.length ? [`branches sitting on mainline with no proof they merged: ${s.liveOnMainline.join(', ')} - if one landed, 'promote <branch>' folds it in; one that only caught up needs nothing`] : []),
      ...(s.shallow ? ['shallow clone: merged branches cannot be detected'] : []),
      ...(s.stranded.length ? [`stranded branch versions: ${s.stranded.join(', ')} - this install versions the docs with git, so nothing reads or promotes .branches/ any more; re-apply what is still wanted with 'set', then 'prune <branch>'`] : []),
      ...(s.clash ? [`.branches/${safe(s.branch)} belongs to ${s.clash}, whose name folds onto the same directory - this branch reads mainline and cannot write a branch version; rename one branch, or promote/prune ${s.clash} first`] : []),
      ...(s.legacyDelta ? ['BRANCH-DELTA.md from an older capture: nothing reads it any more - a capture on that branch folds its decisions into sections; it is never deleted for you'] : []),
    ].join('\n'));
  },
  lint: () => {
    const { problems, notes } = lint();
    for (const p of problems) console.log(`PROBLEM ${p}`);
    for (const n of notes) console.log(`note    ${n}`);
    console.log(`${problems.length} problems, ${notes.length} notes`);
    process.exit(problems.length ? 1 : 0);
  },
  'seed-ids': () => console.log(`${seedIds()} ids added`),
  watch: () => {
    const w = loadWatch();
    if (w.missing) { console.log('no watch.json - run the architecture capture to write one'); return; }
    const at = args.indexOf('--dir');
    const dirs = at >= 0 ? args.slice(at + 1) : [];
    const files = at >= 0 ? args.slice(0, at) : args;
    const hits = watchHits(files, dirs);
    console.log(hits.length ? hits.map((h) => `${h.kind}: ${h.files.join(', ')} -> ${h.sections.join(', ')}`).join('\n') : 'nothing hit');
  },
};
if (commands[cmd]) commands[cmd]();
else {
  console.log('usage: docs.js where <path...> | toc <file> | show <file>#<id>... [--conflict [branch]] | files | set <file>#<id> [textfile] [--expect <hash>] | hash <file>#<id> | status | stale | promote <branch>|--merged | prune [branch] | lint | seed-ids | watch <path...>');
  process.exit(cmd ? 1 : 0);
}
