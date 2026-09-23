#!/usr/bin/env node
// memory.js - the memory MCP engine: finds a project's memory database and selects what to push into
// a session from it. Copied beside memory-session.js, not itself wired to an event - same split as
// docs.js beside docs-session.js. Also runs as a CLI (the setup/validate/status commands call it,
// since a markdown command cannot call a JS function):
//   level [projectRoot]   which level (global/scoped/project) the registered memory server points at,
//                          and the db path - `<level> <dbPath>`, or `none`. Exit 0 always.
// Levels -> db (FACT-SCHEMA / cross-task-facts.md): global ~/.memory-mcp/memory.db; scoped
// ~/.memory-mcp/memory_<space>.db (no space: memory_default.db); project <project>/.memory-mcp/memory.db.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function pathForLevel(level, { home, space, projectRoot } = {}) {
  if (level === 'global') return path.join(home, '.memory-mcp', 'memory.db');
  if (level === 'scoped') return path.join(home, '.memory-mcp', `memory_${space || 'default'}.db`);
  if (level === 'project') return path.join(projectRoot, '.memory-mcp', 'memory.db');
  throw new Error(`unknown memory level: ${level}`);
}

// dbPath -> { root, file } when it is shaped '<root>/.memory-mcp/<file>', else null. The file itself
// is never required to exist (a fresh registration's db may not be created yet), only its '.memory-mcp'
// parent and root are ever resolved.
function splitMemoryMcpLeaf(dbPath) {
  const norm = path.normalize(String(dbPath));
  const parent = path.dirname(norm);
  if (path.basename(parent) !== '.memory-mcp') return null;
  return { root: path.dirname(parent), file: path.basename(norm) };
}

// A directory's real, symlink-resolved form - macOS routes os.tmpdir() (and some other mounts)
// through a symlink (/var -> /private/var), and git's own rev-parse output (mainCheckoutRoot, below)
// is already real-path-resolved, so comparing a raw, un-resolved projectRoot or dbPath against it
// would never match. The NATIVE realpath first: on Windows it is the only one that answers with the
// OS's canonical spelling - an 8.3 short name expanded (a runner's temp dir is C:\Users\RUNNER~1\...,
// git answers C:/Users/runneradmin/...) and the on-disk case restored; the JS one keeps both as typed.
// A path that does not exist yet (a directory this run has not created) is still resolved, so its
// separators match the other side's. Never throws.
function realpathOrSelf(p) {
  try { return fs.realpathSync.native(p); } catch {}
  try { return fs.realpathSync(p); } catch {}
  return path.resolve(p);
}
// The form two directory spellings are compared in. Windows names are case-insensitive (a drive letter
// can arrive as 'c:' or 'C:', and a path that does not exist yet never reaches the native realpath that
// would restore its case) - folded there, never on posix, where case is part of the name.
const dirKey = (p) => { const r = realpathOrSelf(p); return path.sep === '\\' ? r.toLowerCase() : r; };

// The inverse of pathForLevel - null for a path matching none of the three shapes exactly (not a
// substring or prefix match: a foreign path is never mistaken for one of ours). A 'project' level
// registration is compared against the MAIN checkout root first (the installer writes the db there,
// same as projectName below), the given projectRoot second - inside a worktree that second candidate
// is the worktree's own folder, kept only so an older, worktree-rooted registration still resolves.
function levelOfPath(dbPath, { home, projectRoot } = {}) {
  const leaf = splitMemoryMcpLeaf(dbPath);
  if (!leaf) return null;
  const root = dirKey(leaf.root);
  if (leaf.file === 'memory.db') {
    if (projectRoot) {
      const roots = new Set([mainCheckoutRoot(projectRoot), projectRoot].map(dirKey));
      if (roots.has(root)) return 'project';
    }
    if (home && root === dirKey(home)) return 'global';
  }
  if (home && root === dirKey(home) && /^memory_[^/\\]+\.db$/.test(leaf.file)) return 'scoped';
  return null;
}

// '~' and '$HOME' / '${HOME}' are the only expansions a registration's env value carries - the
// installer writes '@HOME_MEMORY_DIR@' resolved already, but a hand-edited or older registration may
// still spell it either way.
function expandHome(p, home) {
  if (typeof p !== 'string' || !p) return p;
  let out = p;
  if (out === '~' || out.startsWith(`~${path.sep}`) || out.startsWith('~/')) out = path.join(home, out.slice(1));
  return out.replace(/\$\{HOME\}/g, home).replace(/\$HOME\b/g, home);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function memoryEnvPath(entry, home) {
  const p = entry && entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
  return typeof p === 'string' && p ? path.normalize(expandHome(p, home)) : null;
}

// The settings.json `env` key the PLUGIN route writes first, then the registration route's own
// files. From 1.0.0 the memory server arrives through a plugin and there is no `.mcp.json` entry to
// read: the install writes its resolved db path to CLAUDE_STACK_MEMORY_DB in the project's
// settings.json (the account file for a global install), which is exactly what the plugin's
// launcher reads at start-up - so this resolver and the running server agree by construction.
// The registration lookups below stay for the copy route and for every install made before 1.0.0.
// Never throws - every read is its own try/catch, and a missing or unreadable file is simply
// "not registered here".
function settingsEnvDbPath(projectRoot, home, configDir) {
  const files = [
    path.join(projectRoot, '.claude', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json'),
    path.join(configDir || process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json'),
  ];
  for (const file of files) {
    try {
      const data = readJson(file);
      const value = data && data.env && data.env.CLAUDE_STACK_MEMORY_DB;
      if (typeof value !== 'string' || !value) continue;
      // Same resolution the plugin's own launcher uses (stack/mcp/memory-launch.js): a relative
      // value is the project's, never the reader's cwd, or the two would disagree about the db.
      const expanded = expandHome(value, home);
      return path.normalize(path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded));
    } catch {}
  }
  return null;
}

function registeredDbPath(projectRoot, { home = os.homedir(), configDir } = {}) {
  try {
    const fromEnv = settingsEnvDbPath(projectRoot, home, configDir);
    if (fromEnv) return fromEnv;
  } catch {}
  try {
    const mcp = readJson(path.join(projectRoot, '.mcp.json'));
    const found = memoryEnvPath(mcp && mcp.mcpServers && mcp.mcpServers.memory, home);
    if (found) return found;
  } catch {}
  try {
    const dir = configDir || process.env.CLAUDE_CONFIG_DIR || home;
    const account = readJson(path.join(dir, '.claude.json'));
    if (account) {
      const userScope = memoryEnvPath(account.mcpServers && account.mcpServers.memory, home);
      if (userScope) return userScope;
      // Keyed by the path as the CLI spelled it, which on Windows is '/'-separated - the ps1 twin of this
      // lookup reads both spellings, and so does this one.
      const projects = account.projects || {};
      const proj = projects[projectRoot] || projects[projectRoot.split(path.sep).join('/')];
      const projScope = memoryEnvPath(proj && proj.mcpServers && proj.mcpServers.memory, home);
      if (projScope) return projScope;
    }
  } catch {}
  return null;
}

// The MAIN repo directory, not the checkout's own - inside a git worktree, `--show-toplevel` answers
// with the WORKTREE's own folder (measured: 'branch-aware-docs', not 'claude-stack'), which would tag
// every memory a worktree session saves with the wrong project, hide every memory the main checkout
// already holds, and (levelOfPath, below) read the installer's own project-level db path as 'unknown'.
// `--git-common-dir` is shared by every worktree of one repo and always ends in '.git' for a normal or
// worktree checkout, so its parent is the main repo's own directory in both cases. A bare repo (or any
// layout where the common dir does not end in '.git') falls back to `--show-toplevel`, then to
// projectRoot itself.
function mainCheckoutRoot(projectRoot) {
  try {
    const common = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common && path.basename(common) === '.git') return path.dirname(common);
  } catch {}
  try {
    const top = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return top;
  } catch {}
  return projectRoot;
}

// Commas are the tag delimiter (FACT-SCHEMA / cross-task-facts.md), so a comma left in the name would
// split into two tags on save and match neither on read - stripped here, once, so every caller (this
// hook and the CLI alike) gets an already-safe name, matching the importer's own `.replace(/,/g, '')`
// (cross-task-facts.md: 'both should').
function projectName(projectRoot) {
  return path.basename(mainCheckoutRoot(projectRoot)).replace(/,/g, '');
}

const headingName = (line) => { const m = /^##\s+(.+?)\s*$/.exec(line); return m ? m[1].trim() : null; };
const ruleFieldName = (line) => { const m = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line); return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : null; };
const linesOf = (text, pick) => String(text).split(/\r?\n/).map(pick).filter(Boolean);

// Names from the related-projects domain (shape: stack/skills/project-related-context/references/artifact-shapes.md):
// `<docsRoot>/related-projects/RELATED-PROJECTS.md` first - one '## <name>' heading per sibling - else
// the generated awareness rule `.claude/rules/baseline-project-related-context.md` (a 'name:' field per
// sibling entry). Neither PRESENT (not neither non-empty) -> []; the doc wins whenever it exists at all,
// so an emptied doc is read as "no siblings", never silently backed by a stale rule copy.
function relatedProjects(projectRoot, docsRoot) {
  const docFile = path.join(docsRoot, 'related-projects', 'RELATED-PROJECTS.md');
  if (fs.existsSync(docFile)) {
    try { return linesOf(fs.readFileSync(docFile, 'utf8'), headingName); } catch { return []; }
  }
  const ruleFile = path.join(projectRoot, '.claude', 'rules', 'baseline-project-related-context.md');
  if (fs.existsSync(ruleFile)) {
    try { return linesOf(fs.readFileSync(ruleFile, 'utf8'), ruleFieldName); } catch { return []; }
  }
  return [];
}

// node:sqlite exists unflagged only on Node >= 22.13 and still prints an ExperimentalWarning once
// required. An added no-op 'warning' listener does NOT silence the default stderr print (verified);
// clearing the listener list does (verified on this machine, both with and without the listener
// present) - safe here because a hook is its own fresh process, never a host sharing this process with
// unrelated 'warning' listeners this would otherwise clobber.
let SQLITE_MOD;
let SQLITE_TRIED = false;
function nodeSqlite() {
  if (!SQLITE_TRIED) {
    SQLITE_TRIED = true;
    try {
      process.removeAllListeners('warning');
      SQLITE_MOD = require('node:sqlite');
    } catch { SQLITE_MOD = null; }
  }
  return SQLITE_MOD;
}

// Base SQLite result code, stripping the extended-error high byte (e.g. SQLITE_READONLY_DIRECTORY,
// 1544, is READONLY 8 with the directory-specific reason in the high byte - `& 0xff` recovers 8).
const SQLITE_CANTOPEN = 14;
const SQLITE_READONLY = 8;
const baseErrCode = (err) => (err && typeof err.errcode === 'number' ? err.errcode & 0xff : 0);
// CANTOPEN (a missing file) and READONLY (measured live: a WAL database in a directory this process
// cannot write to opens fine read-only, but the first query then fails "attempt to write a readonly
// database" - WAL reads need to create a -shm/-wal index even for a reader) are the two codes the
// immutable URI can recover from; nothing else is worth a second attempt (a locked file is BUSY, a
// non-database file is NOTADB, a schema mismatch is a plain "no such table" - none of those are fixed
// by opening the same bytes a second way).
const retryable = (err) => { const b = baseErrCode(err); return b === SQLITE_CANTOPEN || b === SQLITE_READONLY; };

const MEMORY_QUERY = 'SELECT id, content, tags, memory_type, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC';

// Opens read-only and reads every live row, retrying once via the immutable URI on the two codes above.
// Returns null on any failure (node:sqlite unavailable, missing/locked/wrong-schema file) - never throws.
function readMemoryRows(dbPath) {
  const sqlite = nodeSqlite();
  if (!sqlite) return null;
  const { DatabaseSync } = sqlite;
  const targets = [dbPath, `file:${dbPath}?mode=ro&immutable=1`];
  for (let i = 0; i < targets.length; i++) {
    let db;
    try {
      db = new DatabaseSync(targets[i], { readOnly: true });
    } catch (err) {
      if (i === 0 && retryable(err)) continue;
      return null;
    }
    try {
      return db.prepare(MEMORY_QUERY).all();
    } catch (err) {
      if (i === 0 && retryable(err)) continue;
      return null;
    } finally {
      try { db.close(); } catch {}
    }
  }
  return null;
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const splitTags = (tags) => String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
const isAgentTagged = (tags) => tags.some((t) => t.startsWith('agent:'));
const matchesProject = (tags, name) => tags.includes(`project:${name}`) || tags.includes(name);

// The service validates memory_type against its OWN built-in vocabulary and silently stores anything
// else as 'observation' (proven live) - so these four are the only kinds a preference/correction group
// can ever match, and every OTHER value (typically 'observation') is printed as itself, never blank.
const PREFERENCE_KIND = 'preference_signal';
const CORRECTION_KIND = 'user_correction';
const KIND_LABELS = { preference_signal: 'preference', user_correction: 'correction', reference: 'project fact', learning: 'lesson' };
const kindLabel = (memoryType) => KIND_LABELS[memoryType] || memoryType || 'unknown';

const LINE_CONTENT_CAP = 400;
const truncate = (s, max) => (s.length > max ? `${s.slice(0, max)}...` : s);
const isPrefOrCorrection = (row) => row.memory_type === PREFERENCE_KIND || row.memory_type === CORRECTION_KIND;

// The three selection groups, in order, newest first within each (the SQL query already orders every
// row newest-first, and each group below is a single pass over that same order, so 'newest first'
// holds within a group without a separate sort), `agent:`-tagged rows dropped entirely, a row picked
// by an earlier group never repeated by a later one:
//   1. preferences and corrections - memory_type preference_signal/user_correction, tagged to THIS
//      project ('project:<project>' or bare '<project>') OR carrying no 'project:' tag at all (one
//      tagged to ANOTHER project stays there, never leaks into every session). This group comes first
//      so a correction is never crowded out by a pile of recent project facts (I4).
//   2. this project's other memories - tags hold 'project:<project>' or bare '<project>', whatever is
//      left after group 1 already took the project's own preferences/corrections
//   3. related projects - tags hold 'project:<related>' or bare '<related>' for each related name
// A row that does not fit the remaining budget is skipped (`continue`), never treated as the end of
// selection - one oversized row no longer blanks everything that would have fit after it. Each line's
// content is cut to LINE_CONTENT_CAP chars with '...' before it is measured, so one huge memory can
// never eat the whole cap by itself either. The 4096-byte cap (capBytes) still bounds the whole block.
// Each printed line carries the FRIENDLY label (preference/correction/project fact/lesson), never the
// service's raw subtype spelling.
function selectForSession(dbPath, { project = '', related = [], capBytes = 4096 } = {}) {
  const empty = { text: '', counts: { own: 0, preference: 0, related: 0 } };
  const rows = readMemoryRows(dbPath);
  if (!rows) return empty;

  const tagged = rows.map((row) => ({ row, tags: splitTags(row.tags) })).filter((r) => !isAgentTagged(r.tags));
  const seen = new Set();
  const picked = [];
  const take = (predicate, key) => {
    for (const { row, tags } of tagged) {
      if (seen.has(row.id) || !predicate(tags, row)) continue;
      seen.add(row.id);
      picked.push({ row, key });
    }
  };
  take((tags, row) => isPrefOrCorrection(row) && ((project && matchesProject(tags, project)) || !tags.some((t) => t.startsWith('project:'))), 'preference');
  if (project) take((tags) => matchesProject(tags, project), 'own');
  for (const r of related) take((tags) => matchesProject(tags, r), 'related');

  const counts = { own: 0, preference: 0, related: 0 };
  const lines = [];
  let bytes = 0;
  for (const { row, key } of picked) {
    const line = `- [${kindLabel(row.memory_type)}] ${truncate(oneLine(row.content), LINE_CONTENT_CAP)}`;
    const size = Buffer.byteLength(lines.length ? `\n${line}` : line, 'utf8');
    if (bytes + size > capBytes) continue;
    lines.push(line);
    bytes += size;
    counts[key]++;
  }
  return { text: lines.join('\n'), counts };
}

module.exports = { pathForLevel, levelOfPath, registeredDbPath, projectName, relatedProjects, selectForSession };

if (require.main === module) {
  const [, , cmd, ...args] = process.argv;
  try {
    if (cmd === 'level') {
      const projectRoot = path.resolve(args[0] || process.cwd());
      const home = os.homedir();
      const dbPath = registeredDbPath(projectRoot, { home });
      console.log(dbPath ? `${levelOfPath(dbPath, { home, projectRoot }) || 'unknown'} ${dbPath}` : 'none');
    } else {
      console.log(`unknown command: ${cmd || '(none)'}`);
    }
  } catch { console.log('none'); }
  process.exit(0);
}
