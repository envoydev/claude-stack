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
function branch() {
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return !b || b === 'HEAD' ? null : b;
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
  const dirty = (git(['status', '--porcelain', '--untracked-files=all'], { raw: true }) || '').split('\n').filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
  const withList = dirty.filter((f) => covers.length && matches(covers, f)).slice(0, 40)
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
function tracked() {
  return git(['ls-files', '--error-unmatch', DOCS]) !== null;
}
const hasGit = () => git(['rev-parse', '--git-dir']) !== null;
function isMainline(b) {
  if (!b) return false;
  const names = MAINLINE.slice();
  const originHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) names.push(originHead.split('/').pop());
  return names.includes(b);
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

// Task 3 replaces this with the overlay-aware version.
function sections(file) {
  return parse(file, fs.readFileSync(file, 'utf8'));
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

module.exports = {
  ROOT, DOCS_ROOT, DOCS, BLOCK_FILE, WATCH_FILE, BRANCHES,
  git, tracked, hasGit, branch, isMainline, safe, overlayDir, docFiles, relKey, key, findFile, isHistory,
  parse, sections, allSections, where, show, toc, matches, outgrownFiles, stale,
};
if (require.main !== module) return;

const cmd = process.argv[2];
const args = process.argv.slice(3);
const docsLog = (row) => { try { fs.appendFileSync(path.join(ROOT, '.claude', 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); } catch {} };
const commands = {
  toc: () => console.log(toc(args[0])),
  show: () => console.log(args.filter((a) => !a.startsWith('--')).map((a) => show(a)).join('\n\n')),
  where: () => {
    const hits = where(args);
    console.log(hits.length ? hits.map((s) => `${s.id} - ${s.heading} (${s.chars} chars)`).join('\n') : 'no section matches those paths');
  },
  files: () => console.log(docFiles().map((f) => `${key(f)}  ${path.relative(ROOT, f)} (${fs.statSync(f).size} chars, ${sections(f).length} sections${isHistory(f) ? ', history' : ''})`).join('\n')),
  stale: () => {
    const rows = stale();
    console.log(rows.length ? rows.map((r) => `${r.s.id} - ${r.files.length} covered file(s) changed since ${r.s.stamp}: ${r.files.slice(0, 3).join(', ')}`).join('\n') : 'no section has been outgrown');
  },
};
if (commands[cmd]) commands[cmd]();
else {
  console.log('usage: docs.js where <path...> | toc <file> | show <file>#<id>... [--conflict [branch]] | files | set <file>#<id> [textfile] | status | stale | promote <branch>|--merged | prune [branch] | lint | seed-ids | watch <path...>');
  process.exit(cmd ? 1 : 0);
}
