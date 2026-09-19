// scripts/memory-session.test.js - the memory SessionStart hook (stack/hooks/memory-session.js), driven
// through stdin payloads against throwaway fixture projects. NEVER touches ~/.memory-mcp or the real
// account .claude.json - every test points CLAUDE_CONFIG_DIR at a fresh empty temp dir so an account
// fallback lookup can never see real data even though this machine's own ~/.claude.json exists.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node (needs >= 22.13, or 22.12 with --experimental-sqlite) - db-backed hook tests skipped';

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'memory-session.js');
const SCHEMA = fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function buildDb(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
  rows.forEach((r, i) => {
    insert.run(r.hash || `hash-${i}`, r.content, r.tags || '', r.memory_type || 'reference', r.created_at != null ? r.created_at : 1_000_000 - i, r.deleted_at != null ? r.deleted_at : null);
  });
  db.close();
}

// A throwaway project: a memory-mcp fixture db at the canonical 'project' level path (so the hook's
// own levelOfPath resolves it to 'project', proving the derivation end to end rather than falling back
// to 'unknown'), registered through .mcp.json exactly the way the installer writes it. An isolated,
// empty CLAUDE_CONFIG_DIR means the account-fallback branch always finds nothing real.
function fixtureProject({ rows = null, relatedNames = null, registered = true } = {}) {
  const root = tmpDir('memory-session-');
  const config = tmpDir('memory-session-config-');
  const dbPath = path.join(root, '.memory-mcp', 'memory.db');
  if (rows) buildDb(dbPath, rows);
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
    mcpServers: registered ? { memory: { type: 'stdio', command: 'uvx', args: ['--from', 'mcp-memory-service', 'memory', 'server'], env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec', MCP_MEMORY_SQLITE_PATH: dbPath } } } : {},
  }));
  if (relatedNames) {
    const docDir = path.join(root, '.claude', 'docs', 'related-projects');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'RELATED-PROJECTS.md'), relatedNames.map((n) => `## ${n}\n<!-- id: ${n} -->\n`).join('\n'));
  }
  const hook = (payload, extra = {}) => spawnSync(process.execPath, [HOOK], {
    cwd: root,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: config, ...extra },
  });
  return { root, dbPath, hook, rm: () => { rmDir(root); rmDir(config); } };
}

test('a session start with a registered, populated database pushes the memory block, headed and ordered', { skip: skipNoSqlite }, () => {
  // Built after the fixture exists, not passed to fixtureProject: the own-project tag has to match the
  // fixture's own directory name (the git-less projectName fallback - basename of projectRoot, since
  // there is no git repo here), which is only known once the temp dir has been created.
  const p = fixtureProject({ relatedNames: ['sibling-a'] });
  try {
    const projectName = path.basename(p.root);
    buildDb(p.dbPath, [
      { content: 'own project note', tags: `project:${projectName}`, memory_type: 'reference', created_at: 300 },
      { content: 'a global preference', tags: '', memory_type: 'preference_signal', created_at: 200 },
      { content: 'a sibling note', tags: 'project:sibling-a', memory_type: 'reference', created_at: 100 },
    ]);
    const r = p.hook({ hook_event_name: 'SessionStart', session_id: 's1', cwd: p.root });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    const text = out.hookSpecificOutput.additionalContext;
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(text, /^Memory \(memory MCP, project\):/);
    const ownIdx = text.indexOf('own project note');
    const prefIdx = text.indexOf('a global preference');
    const sibIdx = text.indexOf('a sibling note');
    assert.ok(ownIdx > -1 && prefIdx > ownIdx && sibIdx > prefIdx, text);
    assert.match(text, /ToolSearch select:mcp__memory__memory_store,mcp__memory__memory_search,mcp__memory__memory_list/);
    // Proof this is the real end-to-end stdout, not a shape assumption.
    console.log('--- memory-session.js real stdout (fixture project) ---\n' + r.stdout + '\n--- end ---');
  } finally { p.rm(); }
});

test('an empty database is silent', { skip: skipNoSqlite }, () => {
  const p = fixtureProject({ rows: [] });
  try {
    const r = p.hook({ hook_event_name: 'SessionStart', session_id: 's2', cwd: p.root });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { p.rm(); }
});

test('no memory server registered for the project is silent', () => {
  const p = fixtureProject({ registered: false });
  try {
    const r = p.hook({ hook_event_name: 'SessionStart', session_id: 's3', cwd: p.root });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { p.rm(); }
});

test('garbage stdin is silent, exit 0', () => {
  const p = fixtureProject();
  try {
    const r = p.hook('{ this is not json at all ]]]', {});
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { p.rm(); }
});

test('a hook_event_name other than SessionStart is silent', () => {
  const p = fixtureProject();
  try {
    const r = p.hook({ hook_event_name: 'Stop', session_id: 's4', cwd: p.root });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  } finally { p.rm(); }
});

test('a 500-row database resolves in well under 1s', { skip: skipNoSqlite }, () => {
  const p = fixtureProject();
  try {
    const projectName = path.basename(p.root);
    const rows = [];
    for (let i = 0; i < 500; i++) rows.push({ content: `row ${i} ${'x'.repeat(60)}`, tags: i % 4 === 0 ? `project:${projectName}` : '', memory_type: i % 4 === 0 ? 'reference' : 'preference_signal', created_at: i });
    buildDb(p.dbPath, rows);
    const started = Date.now();
    const r = p.hook({ hook_event_name: 'SessionStart', session_id: 's5', cwd: p.root });
    const elapsed = Date.now() - started;
    assert.strictEqual(r.status, 0);
    assert.ok(elapsed < 1000, `took ${elapsed}ms`);
    assert.match(r.stdout, /^\{"hookSpecificOutput"/);
  } finally { p.rm(); }
});
