#!/usr/bin/env node
// docs.js - the architecture docs engine. Sections are addressed by id, found from code paths, versioned per branch,
// merged back when a branch lands, flagged when their code moved, and linted. Every command is deterministic: the
// model pays only for the text a command prints.
//   where <path...>                 sections covering these paths, the narrowest declared covers first
//   toc <file>                      a doc file's sections (id, heading, size)
//   show <file>#<id>... [--conflict [branch]]
//   files                           the doc files
//   set <file>#<id> [textfile]      write one section (stdin without a file): in place on mainline, with committed
//                                   docs or without git; into this branch's overlay otherwise
//   status                          mode, branch, overrides, conflicts, orphans, outgrown count, deleted unmerged branches
//   stale                           sections whose covered code changed since they were written
//   promote <branch> | --merged     fold a branch's overrides into mainline, section by section, three ways
//   prune [branch]                  drop one branch's overlay, or overlays of branches gone for 30 days
//   lint                            metadata and budget problems (exit 1 when any)
//   seed-ids                        give every section a stable id (idempotent)
//   watch <path...>                 which watch.json entries these changed paths hit
// Two modes, decided by git and never by a setting: committed docs are versioned by git per branch, so writes land in
// place; ignored docs keep each feature branch's sections under <docs root>/.branches/<branch>/.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const docsRootEnv = () => process.env.CLAUDE_STACK_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs';
const DOCS_ROOT = path.resolve(ROOT, docsRootEnv());
const DOCS = path.join(DOCS_ROOT, 'architecture');
const BLOCK_FILE = path.join(DOCS, 'ORIENTATION.md');
const WATCH_FILE = path.join(DOCS, 'watch.json');
const BRANCHES = path.join(DOCS_ROOT, '.branches');
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

// The narrowest declared cover answers first: a section written about src/Features/Notifications/** says more about a
// notifications handler than a smaller one written about src/Features/**. Word matches come next, weighted by how rare
// each word is across the docs, and the broad globs fill what is left. Review history is never offered.
function where(paths, limit = 3) {
  const want = [...new Set(paths.flatMap(tokens))];
  const current = allSections().filter((s) => !s.history);
  const cap = narrowCap();
  const declared = current.filter((s) => s.covers.length && paths.some((p) => matches(s.covers, p)))
    .map((s) => ({ ...s, width: coverWidth(s.covers, paths) }))
    .sort((a, b) => a.width - b.width || Number(b.declared) - Number(a.declared) || a.chars - b.chars);
  const narrow = declared.filter((s) => s.width <= cap);
  const broad = declared.filter((s) => s.width > cap);
  if (narrow.length >= limit) return narrow.slice(0, limit);
  const out = narrow.slice();
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

// Committed docs need no overlay: git versions them per branch, merges them and carries them to a clone.
let TRACKED_CACHE;
function tracked() {
  if (TRACKED_CACHE === undefined) TRACKED_CACHE = git(['ls-files', '--error-unmatch', DOCS]) !== null;
  return TRACKED_CACHE;
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
const overlayDir = () => {
  const b = branch();
  return b && hasGit() && !tracked() && !isMainline(b) ? path.join(BRANCHES, safe(b)) : null;
};

function docFiles() {
  const out = [];
  const add = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md') && f !== 'ORIENTATION.md' && f !== 'BRANCH-DELTA.md') out.push(path.join(dir, f));
  };
  add(DOCS);
  add(path.join(DOCS, 'references'));
  add(path.join(DOCS, 'history'));
  return out.sort();
}
const relKey = (file) => path.relative(DOCS, file).replace(/\.md$/, '').split(path.sep).join('/');
const key = (file) => path.basename(file, '.md');
const findFile = (fileKey) => {
  const files = docFiles();
  return files.find((f) => relKey(f) === fileKey) || files.find((f) => key(f) === fileKey || path.basename(f) === fileKey);
};
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
  const sdir = path.join(dir, ...relKey(file).split('/'));
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
  const file = findFile(fileKey);
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

// The files this branch COMMITTED since it left mainline, by their blob at HEAD: the evidence that lets a later
// mainline session tell the branch landed even when it was squashed or rebased. Uncommitted and untracked files stay
// out - a log or scratch file never reaches mainline, and recording one would make the branch look unmerged forever.
const headBlob = (f) => (git(['rev-parse', `HEAD:${f}`]) || '-').slice(0, 12);
function branchFiles(base) {
  const changed = base ? (git(['diff', '--name-only', `${base}..HEAD`]) || '').split('\n').filter(Boolean) : [];
  const out = {};
  for (const f of changed.filter((x) => !x.startsWith(`${docsRel()}/`)).slice(0, 200)) out[f] = headBlob(f);
  return out;
}

function writeBaseMeta(dir, b) {
  const head = git(['rev-parse', 'HEAD']);
  const merged = mainlineRefs().map((ref) => git(['merge-base', 'HEAD', ref])).filter(Boolean)
    .map((mb) => ({ mb, count: Number(git(['rev-list', '--count', `${mb}..HEAD`]) || 0) }));
  const base = merged.length ? merged.reduce((best, x) => (x.count < best.count ? x : best)).mb : head;
  const meta = { branch: b, base, head, files: branchFiles(base), updated: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'BASE.json'), `${JSON.stringify(meta, null, 2)}\n`);
}
function refreshBaseMeta() {
  const dir = overlayDir();
  if (dir && fs.existsSync(dir)) writeBaseMeta(dir, branch());
}
function readMeta(name) {
  try { return JSON.parse(fs.readFileSync(path.join(BRANCHES, name, 'BASE.json'), 'utf8')); } catch { return null; }
}

const overlayParts = (file, id) => [...relKey(file).split('/'), `${id}.md`];

function set(ref, newText) {
  const [fileKey, sec] = String(ref).split('#');
  if (!sec) return { error: 'name one section: set <file>#<id> - whole-file writes are not supported' };
  const file = findFile(fileKey);
  if (!file) return { error: `no such doc file: ${fileKey}` };
  if (!/^[\w.-]+$/.test(sec)) return { error: `not a valid section id: ${sec}` };
  if (!String(newText).trim()) return { error: 'empty section text: nothing written' };
  const gitRepo = hasGit();
  const b = branch();
  if (gitRepo && !b && git(['rev-parse', 'HEAD']) !== null) return { error: 'detached HEAD: check out a branch before writing docs' };
  const hit = sections(file).find((s) => s.id === `${key(file)}#${sec}`);
  const lines = ensureHeadingAndId(newText, sec, `${'#'.repeat(hit ? hit.level : 2)} ${hit ? hit.heading : sec.replace(/-/g, ' ')}`);
  let j = 2;
  const meta = [];
  while (j < lines.length && COMMENT.test(lines[j])) meta.push(lines[j++]);
  const kept = meta.filter((m) => !STAMP.test(m));
  if (hit && hit.declared && !kept.some((m) => COVERS.test(m))) kept.unshift(`<!-- covers: ${hit.covers.join(', ')} -->`);
  const own = globList((COVERS.exec(kept.join('\n')) || [])[1] || '');
  const stampLine = gitRepo ? captureStamp(own.length ? own : (hit ? hit.covers : [])) : '';
  const text = [lines[0], lines[1], ...kept, ...(stampLine ? [stampLine] : []), ...lines.slice(j)].join('\n');
  if (!gitRepo || tracked() || isMainline(b)) return writeInPlace(file, sec, text);
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
  if (hasGit() && !tracked() && isMainline(branch())) {
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

function toc(fileKey) {
  const file = findFile(fileKey);
  if (!file) return `no such doc file: ${fileKey}. Known: ${docFiles().map(key).join(', ')}`;
  const secs = sections(file);
  if (!secs.length) return `${key(file)} has no headings (${fs.statSync(file).size} chars)`;
  return secs.map((s) => `${s.id}  ${'  '.repeat(s.level - 2)}${s.heading} (${s.chars} chars)${s.overrideOf ? (s.conflict ? ' [this branch, CONFLICT]' : ' [this branch]') : ''}`).join('\n');
}

function show(ref) {
  const [fileKey, sec] = String(ref).split('#');
  const file = findFile(fileKey);
  if (!file) return `no such doc file: ${fileKey}. Known: ${docFiles().map(key).join(', ')}`;
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

// A branch landed when its last recorded commit is part of HEAD - provided it had commits of its own - or when every
// file it changed now holds, at HEAD, the content the branch gave it (a squash or a rebase leaves no ancestor).
function mergedBranches() {
  if (!hasGit() || tracked() || isShallow()) return [];
  const current = safe(branch() || '');
  const out = [];
  for (const name of overlayNames()) {
    if (name === current) continue;
    const meta = readMeta(name);
    if (!meta || !meta.head) continue;
    const ownCommits = meta.head !== meta.base;
    const ancestor = ownCommits && spawnSync('git', ['merge-base', '--is-ancestor', meta.head, 'HEAD'], { cwd: ROOT }).status === 0;
    const files = Object.entries(meta.files || {});
    const landed = files.length > 0 && files.every(([f, blob]) => (blob === '-'
      ? git(['cat-file', '-e', `HEAD:${f}`]) === null
      : (git(['rev-parse', `HEAD:${f}`]) || '').startsWith(blob)));
    if (ancestor || landed) out.push({ name, branch: meta.branch || name, how: ancestor ? 'ancestor' : 'blobs' });
  }
  return out;
}

function promote(name) {
  const dir = path.join(BRANCHES, safe(name));
  if (!fs.existsSync(dir)) return { error: `no doc overrides for ${name}` };
  const results = [];
  let freshConflict = false;
  for (const over of overrideFiles(dir)) {
    const rel = path.relative(dir, over).split(path.sep);
    const id = path.basename(rel.pop(), '.md');
    const mainline = `${path.join(DOCS, ...rel)}.md`;
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
  if (!b || !isMainline(b) || tracked()) return [];
  return mergedBranches().map((m) => ({ branch: m.branch, how: m.how, ...promote(m.name) }));
}

function deletedUnmerged() {
  if (!hasGit() || tracked()) return [];
  const live = new Set((git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) || '').split('\n').filter(Boolean).map(safe));
  const merged = new Set(mergedBranches().map((m) => m.name));
  return overlayNames().filter((n) => !live.has(n) && !merged.has(n));
}

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
  if (!hasGit()) return [];
  const live = new Set((git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) || '').split('\n').filter(Boolean).map(safe));
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
  return {
    mode: !gitRepo ? 'no git (docs written in place)' : tracked() ? 'git (docs are committed - git versions them per branch)' : 'overlay (docs are ignored by git - branch versions live in .branches/)',
    branch: b || (gitRepo && git(['rev-parse', 'HEAD']) ? 'detached HEAD' : 'no branch'),
    detached: Boolean(gitRepo && !b && git(['rev-parse', 'HEAD'])),
    mainline: isMainline(b),
    overrides: view.map((s) => s.id),
    conflicts: view.filter((s) => s.conflict).map((s) => s.id),
    orphans: view.filter((s) => s.orphan).map((s) => s.id),
    outgrown: stale().length,
    deletedUnmerged: deletedUnmerged(),
    shallow: gitRepo && isShallow(),
    legacyDelta: fs.existsSync(path.join(DOCS, 'BRANCH-DELTA.md')),
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
  const dirty = {};
  for (const f of porcelainPaths()) dirty[f] = blobOf(f);
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
  for (const f of porcelainPaths()) if (before[f] !== blobOf(f)) out.add(f);
  for (const f of Object.keys(before)) if (!out.has(f) && before[f] !== blobOf(f)) out.add(f);
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
  ROOT, DOCS_ROOT, DOCS, BLOCK_FILE, WATCH_FILE, BRANCHES,
  git, tracked, hasGit, branch, isMainline, safe, overlayDir, docFiles, relKey, key, findFile, isHistory,
  parse, sections, allSections, where, show, toc, matches, outgrownFiles, stale,
  set, writeBaseMeta, refreshBaseMeta, readMeta, mainlineRefs, porcelainPaths, blobOf,
  stripStamp, stampLineOf, withStamp, conflictView,
  overlayNames, mergedBranches, promote, autoPromote, deletedUnmerged, prune, status,
  lint, seedIds, loadWatch, watchHits, snapshot, changedSince,
};
if (require.main !== module) return;

const cmd = process.argv[2];
const args = process.argv.slice(3);
const docsLog = (row) => { try { fs.appendFileSync(path.join(ROOT, '.claude', 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); } catch {} };
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
  set: () => {
    const [ref, from] = args;
    let text = '';
    try { text = from ? fs.readFileSync(from, 'utf8') : fs.readFileSync(0, 'utf8'); } catch (e) { console.log(`cannot read the new text: ${e.message}`); process.exit(1); }
    const r = set(ref, text);
    if (r.error) { console.log(r.error); process.exit(1); }
    docsLog({ event: 'doc-set', ref, wrote: r.wrote, inPlace: Boolean(r.inPlace) });
    console.log(r.inPlace ? `wrote ${ref} into ${r.wrote}` : `wrote ${r.wrote} (base kept at ${r.base}) - this branch only`);
    if (r.resolved && r.resolved.length) console.log(`resolved the pending doc conflict with: ${r.resolved.join(', ')}`);
  },
  promote: () => {
    if (args[0] === '--merged') {
      if (isShallow()) { console.log('shallow clone: merged branches cannot be detected - nothing promoted'); return; }
      const rows = autoPromote();
      if (!rows.length) { console.log('nothing merged'); return; }
      for (const p of rows) {
        if (p.changed) docsLog({ event: 'promote', branch: p.branch, how: p.how, results: p.results });
        for (const x of p.results) console.log(`${p.branch} (${p.how}) ${x.id}: ${x.result}${x.why ? ` (${x.why})` : ''}`);
      }
      return;
    }
    const p = promote(args[0]);
    if (p.error) { console.log(p.error); process.exit(1); }
    if (p.changed) docsLog({ event: 'promote', branch: args[0], how: 'manual', results: p.results });
    for (const x of p.results) console.log(`${x.id}: ${x.result}${x.why ? ` (${x.why})` : ''}`);
    process.exit(p.results.some((x) => x.result === 'conflict') ? 1 : 0);
  },
  prune: () => { const d = prune(args[0]); console.log(d.length ? `pruned: ${d.join(', ')}` : 'nothing to prune'); },
  status: () => {
    const s = status();
    console.log([
      `mode: ${s.mode}`,
      `branch: ${s.branch}${s.mainline ? ' (mainline)' : ''}`,
      `overrides: ${s.overrides.length ? s.overrides.join(', ') : 'none'}`,
      ...(s.conflicts.length ? [`conflicts: ${s.conflicts.join(', ')}`] : []),
      ...(s.orphans.length ? [`orphaned (mainline removed the section): ${s.orphans.join(', ')}`] : []),
      `outgrown sections: ${s.outgrown}`,
      ...(s.deletedUnmerged.length ? [`deleted branches never detected as merged: ${s.deletedUnmerged.join(', ')}`] : []),
      ...(s.shallow ? ['shallow clone: merged branches cannot be detected'] : []),
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
  console.log('usage: docs.js where <path...> | toc <file> | show <file>#<id>... [--conflict [branch]] | files | set <file>#<id> [textfile] | status | stale | promote <branch>|--merged | prune [branch] | lint | seed-ids | watch <path...>');
  process.exit(cmd ? 1 : 0);
}
