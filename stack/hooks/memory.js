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

// The inverse of pathForLevel - null for a path matching none of the three shapes exactly (not a
// substring or prefix match: a foreign path is never mistaken for one of ours).
function levelOfPath(dbPath, { home, projectRoot } = {}) {
  const norm = path.normalize(String(dbPath));
  if (projectRoot && norm === path.join(projectRoot, '.memory-mcp', 'memory.db')) return 'project';
  if (home) {
    const dir = path.join(home, '.memory-mcp');
    if (norm === path.join(dir, 'memory.db')) return 'global';
    if (path.dirname(norm) === dir && /^memory_[^/\\]+\.db$/.test(path.basename(norm))) return 'scoped';
  }
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

// The `memory` entry in the project's own .mcp.json first; else the account's `.claude.json`
// (top-level `mcpServers.memory` for a user-scope install, else `projects[<projectRoot>].mcpServers.memory`
// for a project-scope install the CLI recorded under the account file). Never throws - every read is
// its own try/catch, and a missing or unreadable file is simply "not registered here".
function registeredDbPath(projectRoot, { home = os.homedir(), configDir } = {}) {
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
      const proj = account.projects && account.projects[projectRoot];
      const projScope = memoryEnvPath(proj && proj.mcpServers && proj.mcpServers.memory, home);
      if (projScope) return projScope;
    }
  } catch {}
  return null;
}

// The basename of the git top-level directory when this is a git checkout (worktrees included - a
// worktree's own dir name is not what own-project tags use), else the basename of projectRoot itself.
function projectName(projectRoot) {
  try {
    const top = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return path.basename(top);
  } catch {}
  return path.basename(projectRoot);
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

// The three selection groups, in order, newest first within each, `agent:`-tagged rows dropped
// entirely, a row picked by an earlier group never repeated by a later one:
//   1. own project    - tags hold 'project:<project>' or bare '<project>'
//   2. global prefs    - memory_type preference_signal/user_correction carrying NO 'project:' tag at
//                        all (one tagged to ANOTHER project stays there, never leaks into every session)
//   3. related projects - tags hold 'project:<related>' or bare '<related>' for each related name
// Stops before capBytes; a memory is never cut mid-way, only ever omitted whole. Each printed line
// carries the FRIENDLY label (preference/correction/project fact/lesson), never the service's raw
// subtype spelling.
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
  if (project) take((tags) => matchesProject(tags, project), 'own');
  take((tags, row) => (row.memory_type === PREFERENCE_KIND || row.memory_type === CORRECTION_KIND) && !tags.some((t) => t.startsWith('project:')), 'preference');
  for (const r of related) take((tags) => matchesProject(tags, r), 'related');

  const counts = { own: 0, preference: 0, related: 0 };
  const lines = [];
  let bytes = 0;
  for (const { row, key } of picked) {
    const line = `- [${kindLabel(row.memory_type)}] ${oneLine(row.content)}`;
    const size = Buffer.byteLength(lines.length ? `\n${line}` : line, 'utf8');
    if (bytes + size > capBytes) break;
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
