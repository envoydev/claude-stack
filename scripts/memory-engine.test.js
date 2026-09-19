// scripts/memory-engine.test.js - the memory MCP engine (stack/hooks/memory.js): path <-> level
// derivation, registration lookup, related-project names, and the session selection query over a real
// sqlite fixture database (scripts/fixtures/memory-schema.sql). NEVER touches ~/.memory-mcp - every
// database here is built fresh under os.tmpdir() and removed after its test.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const m = require('../stack/hooks/memory.js');

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node (needs >= 22.13, or 22.12 with --experimental-sqlite) - db-backed engine tests skipped';

const SCHEMA = fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8');

// Builds a fixture db from the shipped schema and inserts one row per entry, newest (array index 0)
// getting the highest created_at so plain array order already reads newest-first unless a case
// overrides created_at itself.
function buildDb(dir, rows) {
  const file = path.join(dir, 'memory.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
  rows.forEach((r, i) => {
    insert.run(
      r.hash || `hash-${i}`,
      r.content,
      r.tags || '',
      r.memory_type || 'reference',
      r.created_at != null ? r.created_at : 1_000_000 - i,
      r.deleted_at != null ? r.deleted_at : null,
    );
  });
  db.close();
  return file;
}
const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// --- pathForLevel / levelOfPath -------------------------------------------------------------------

test('each level maps to its database and back', () => {
  const home = '/home/u';
  const projectRoot = '/work/app';
  const cases = [
    ['global', { home, projectRoot }, '/home/u/.memory-mcp/memory.db'],
    ['scoped', { home, space: 'work', projectRoot }, '/home/u/.memory-mcp/memory_work.db'],
    ['scoped', { home, projectRoot }, '/home/u/.memory-mcp/memory_default.db'],
    ['project', { home, projectRoot }, '/work/app/.memory-mcp/memory.db'],
  ];
  for (const [level, opts, want] of cases) {
    assert.strictEqual(m.pathForLevel(level, opts), path.normalize(want), level);
    assert.strictEqual(m.levelOfPath(want, { home, projectRoot }), level, want);
  }
});

test('an unknown level throws, a foreign path has no level', () => {
  const home = '/home/u';
  const projectRoot = '/work/app';
  assert.throws(() => m.pathForLevel('team', { home, projectRoot }), /level/);
  assert.strictEqual(m.levelOfPath('/elsewhere/memory.db', { home, projectRoot }), null);
  // A path merely under the scoped directory but not shaped memory_<space>.db is not scoped either.
  assert.strictEqual(m.levelOfPath('/home/u/.memory-mcp/notes.db', { home, projectRoot }), null);
});

// --- registeredDbPath ------------------------------------------------------------------------------

test('registeredDbPath reads the project .mcp.json memory entry first, expanding ~ and $HOME', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  try {
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: { memory: { type: 'stdio', command: 'uvx', args: [], env: { MCP_MEMORY_SQLITE_PATH: '~/.memory-mcp/memory.db' } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home }), path.join(home, '.memory-mcp', 'memory.db'));

    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: '$HOME/.memory-mcp/memory_work.db' } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home }), path.join(home, '.memory-mcp', 'memory_work.db'));
  } finally { rmDir(root); rmDir(home); }
});

test('registeredDbPath falls back to the account .claude.json, user scope then project scope', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  const config = tmpDir('memory-config-');
  try {
    // No project .mcp.json at all - falls straight to the account file, user-scope entry.
    fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({
      mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: path.join(home, '.memory-mcp', 'memory.db') } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), path.join(home, '.memory-mcp', 'memory.db'));

    // No user-scope entry - falls to projects[<projectRoot>].mcpServers.memory.
    fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({
      projects: { [root]: { mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: path.join(root, '.memory-mcp', 'memory.db') } } } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), path.join(root, '.memory-mcp', 'memory.db'));
  } finally { rmDir(root); rmDir(home); rmDir(config); }
});

test('registeredDbPath never throws: absent files, garbage JSON, no memory entry all read as not registered', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  const config = tmpDir('memory-config-');
  try {
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null); // nothing exists yet
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ not json');
    fs.writeFileSync(path.join(config, '.claude.json'), 'also not json');
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null);
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null);
  } finally { rmDir(root); rmDir(home); rmDir(config); }
});

// --- projectName -------------------------------------------------------------------------------

test('projectName is the git top-level basename inside a repo, else the projectRoot basename', () => {
  const outer = tmpDir('memory-name-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const sub = path.join(repo, 'nested', 'dir');
    fs.mkdirSync(sub, { recursive: true });
    assert.strictEqual(m.projectName(sub), 'my-repo');

    const plain = path.join(outer, 'not-a-repo');
    fs.mkdirSync(plain);
    assert.strictEqual(m.projectName(plain), 'not-a-repo');
  } finally { rmDir(outer); }
});

test('projectName inside a real git worktree reads the MAIN repo name, never the worktree folder', () => {
  const outer = tmpDir('memory-name-wt-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], {});
    spawnSync('git', ['-C', repo, 'config', 'user.name', 'test'], {});
    spawnSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'], {});
    // The worktree folder's own name is deliberately unrelated to the repo's, so a bug reading
    // --show-toplevel (the worktree's own top) instead of --git-common-dir's parent (the main repo)
    // cannot pass by accident.
    const worktree = path.join(outer, 'unrelated-worktree-name');
    const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', worktree], { encoding: 'utf8' });
    assert.strictEqual(add.status, 0, add.stderr);
    assert.strictEqual(m.projectName(worktree), 'my-repo');
    const nested = path.join(worktree, 'nested', 'dir');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(m.projectName(nested), 'my-repo');
  } finally { rmDir(outer); }
});

// --- relatedProjects -----------------------------------------------------------------------------

test('relatedProjects reads RELATED-PROJECTS.md headings, else the generated rule, else []', () => {
  const root = tmpDir('memory-related-');
  const docsRoot = path.join(root, '.claude', 'docs');
  try {
    // Neither present.
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), []);

    // The doc, present: one '## <name>' heading per sibling.
    const docDir = path.join(docsRoot, 'related-projects');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'RELATED-PROJECTS.md'), [
      '# Related projects', '',
      '## acme-billing-api', '<!-- id: acme-billing-api -->', '', '```yaml', 'location: ../acme-billing-api', '```', '',
      '## acme-frontend', '<!-- id: acme-frontend -->', '', '```yaml', 'location: ../acme-frontend', '```', '',
    ].join('\n'));
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['acme-billing-api', 'acme-frontend']);

    // The doc wins even when the rule also exists.
    const rulesDir = path.join(root, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'baseline-project-related-context.md'), '---\ndescription: x\n---\n- name: rule-only-sibling\n  location: ../x\n');
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['acme-billing-api', 'acme-frontend']);

    // The doc gone, the rule present - falls back to its 'name:' fields.
    fs.rmSync(docDir, { recursive: true, force: true });
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['rule-only-sibling']);
  } finally { rmDir(root); }
});

// --- selectForSession ------------------------------------------------------------------------------

test('own-project rows come first, newest first, before global preferences and related-project rows', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'own newest', tags: 'project:myapp', memory_type: 'reference', created_at: 500 },
      { content: 'own oldest', tags: 'myapp', memory_type: 'learning', created_at: 100 }, // bare tag form
      { content: 'a global preference', tags: '', memory_type: 'preference_signal', created_at: 400 },
      { content: 'a global correction', tags: '', memory_type: 'user_correction', created_at: 300 },
      { content: 'sibling note', tags: 'project:sibling-a', memory_type: 'reference', created_at: 450 },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', related: ['sibling-a'], capBytes: 100000 });
    const order = text.split('\n').map((l) => l.replace(/^- \[[^\]]+\] /, ''));
    assert.deepStrictEqual(order, ['own newest', 'own oldest', 'a global preference', 'a global correction', 'sibling note']);
    assert.deepStrictEqual(counts, { own: 2, preference: 2, related: 1 });
  } finally { rmDir(dir); }
});

test('tag matching is exact on the comma-split list, never a substring - "app" does not match "app-web"', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'real own note', tags: 'project:app', memory_type: 'reference' },
      { content: 'a different project entirely', tags: 'project:app-web', memory_type: 'reference' },
      { content: 'bare form of a different project', tags: 'app-web', memory_type: 'reference' },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'app', capBytes: 100000 });
    assert.match(text, /real own note/);
    assert.doesNotMatch(text, /a different project entirely/);
    assert.doesNotMatch(text, /bare form of a different project/);
    assert.strictEqual(counts.own, 1);
  } finally { rmDir(dir); }
});

test('a preference tagged with another project is excluded everywhere - it is that project\'s local preference, not global', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'scoped preference', tags: 'project:otherproject', memory_type: 'preference_signal' },
      { content: 'truly global preference', tags: '', memory_type: 'preference_signal' },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', related: [], capBytes: 100000 });
    assert.doesNotMatch(text, /scoped preference/);
    assert.match(text, /truly global preference/);
    assert.strictEqual(counts.preference, 1);
  } finally { rmDir(dir); }
});

test('agent: tagged rows are never selected, whatever else they carry', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'an own-project row an agent saved', tags: 'project:myapp,agent:some-seat', memory_type: 'reference' },
      { content: 'an agent-saved global preference', tags: 'agent:some-seat', memory_type: 'preference_signal' },
      { content: 'a real own row', tags: 'project:myapp', memory_type: 'reference', created_at: 1 },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', capBytes: 100000 });
    assert.doesNotMatch(text, /an agent-saved/);
    assert.doesNotMatch(text, /an own-project row an agent saved/);
    assert.match(text, /a real own row/);
    assert.strictEqual(counts.own, 1);
    assert.strictEqual(counts.preference, 0);
  } finally { rmDir(dir); }
});

test('each printed line carries the friendly label, never the service\'s raw subtype spelling', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // The service validates memory_type against its OWN built-in vocabulary and silently stores
    // anything else as 'observation' (proven live, Task 3) - so a row can carry that fallback value
    // too, and it must print as itself, never blank or throw.
    const file = buildDb(dir, [
      { content: 'a preference row', tags: 'project:myapp', memory_type: 'preference_signal', created_at: 400 },
      { content: 'a correction row', tags: 'project:myapp', memory_type: 'user_correction', created_at: 300 },
      { content: 'a reference row', tags: 'project:myapp', memory_type: 'reference', created_at: 200 },
      { content: 'a learning row', tags: 'project:myapp', memory_type: 'learning', created_at: 100 },
      { content: 'an unvalidated-kind row', tags: 'project:myapp', memory_type: 'observation', created_at: 50 },
    ]);
    const { text } = m.selectForSession(file, { project: 'myapp', capBytes: 100000 });
    const lines = text.split('\n');
    assert.deepStrictEqual(lines, [
      '- [preference] a preference row',
      '- [correction] a correction row',
      '- [project fact] a reference row',
      '- [lesson] a learning row',
      '- [observation] an unvalidated-kind row',
    ]);
  } finally { rmDir(dir); }
});

test('a soft-deleted row (deleted_at set) is never selected', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'deleted own row', tags: 'project:myapp', memory_type: 'reference', deleted_at: 12345 },
      { content: 'live own row', tags: 'project:myapp', memory_type: 'reference' },
    ]);
    const { text } = m.selectForSession(file, { project: 'myapp', capBytes: 100000 });
    assert.doesNotMatch(text, /deleted own row/);
    assert.match(text, /live own row/);
  } finally { rmDir(dir); }
});

test('the cap stops between memories, never inside one', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // 6 identical-shaped lines, 39 bytes then 40 bytes each (leading \n) once joined - measured directly
    // from the same line format selectForSession emits, so this cap is not a guess: 39 + 40 + 40 = 119
    // (items 0-2) is the last total at or under 120; item 3 would push it to 159.
    const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ content: `${'a'.repeat(20)}-${i}`, tags: 'project:myapp', memory_type: 'reference', created_at: 100 - i }));
    const file = buildDb(dir, rows);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', capBytes: 120 });
    const lines = text.split('\n');
    assert.strictEqual(lines.length, 3, text);
    assert.deepStrictEqual(lines.map((l) => l.match(/-(\d)$/)[1]), ['0', '1', '2']);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 120);
    assert.strictEqual(counts.own, 3);
    // Never a truncated line: every kept line is one of the exact lines that would have been emitted whole.
    for (const l of lines) assert.match(l, /^- \[project fact\] a{20}-\d$/);
  } finally { rmDir(dir); }
});

test('a cap smaller than the first memory yields nothing, never a partial line', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [{ content: 'a'.repeat(200), tags: 'project:myapp', memory_type: 'reference' }]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', capBytes: 10 });
    assert.strictEqual(text, '');
    assert.deepStrictEqual(counts, { own: 0, preference: 0, related: 0 });
  } finally { rmDir(dir); }
});

test('missing file, locked file and wrong-schema file all return { text: "" } without throwing', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // Missing file.
    assert.deepStrictEqual(m.selectForSession(path.join(dir, 'nope.db'), { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });

    // Wrong schema: a valid sqlite db with no memories table at all.
    const wrongFile = path.join(dir, 'wrong.db');
    const wdb = new DatabaseSync(wrongFile);
    wdb.exec('CREATE TABLE other (id INTEGER)');
    wdb.close();
    assert.deepStrictEqual(m.selectForSession(wrongFile, { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });

    // Locked: a second connection holds an uncommitted EXCLUSIVE transaction, so the read-only open's
    // first query gets SQLITE_BUSY - a real OS/SQLite-level lock, not a simulated error.
    const lockedFile = buildDb(dir, [{ content: 'unreadable while locked', tags: 'project:x', memory_type: 'reference' }]);
    const writer = new DatabaseSync(lockedFile);
    writer.exec('BEGIN EXCLUSIVE');
    writer.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at) VALUES (?, ?, ?, ?, ?)').run('extra', 'x', 'project:x', 'reference', 1);
    try {
      assert.deepStrictEqual(m.selectForSession(lockedFile, { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });
    } finally { writer.exec('ROLLBACK'); writer.close(); }
  } finally { rmDir(dir); }
});

test(
  'a WAL database in a read-only directory recovers through the immutable URI retry',
  { skip: skipNoSqlite || (process.platform === 'win32' ? 'chmod-based read-only directories are not reliable on Windows' : false) },
  () => {
    // Measured live against this exact fixture before writing the implementation: a plain
    // `new DatabaseSync(path, { readOnly: true })` open SUCCEEDS on a WAL database sitting in a
    // directory this process cannot write to, but the first query then throws
    // "attempt to write a readonly database" (SQLITE_READONLY_DIRECTORY, base code 8) - WAL reads need
    // to create a -shm/-wal index even for a reader. `file:<path>?mode=ro&immutable=1` skips that need
    // and the same query succeeds. This is the retry cross-task-facts.md calls out (its own live note:
    // "a read-only open of a WAL db failed where immutable worked") - the failure surfaces at query
    // time here, not at open time, which is why the engine retries around BOTH steps, not just the
    // constructor.
    const outer = tmpDir('memory-wal-');
    const dbDir = path.join(outer, 'db');
    fs.mkdirSync(dbDir);
    const file = path.join(dbDir, 'memory.db');
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    db.exec('PRAGMA journal_mode=WAL');
    db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)').run('h1', 'wal note', 'project:demo', 'reference', 1000, null);
    db.close();
    fs.chmodSync(dbDir, 0o500);
    try {
      const { text, counts } = m.selectForSession(file, { project: 'demo', capBytes: 100000 });
      assert.match(text, /wal note/, 'the immutable-URI retry should have recovered the row');
      assert.strictEqual(counts.own, 1);
    } finally {
      fs.chmodSync(dbDir, 0o700);
      rmDir(outer);
    }
  },
);

test('a 500-row database selects in well under 1s', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const rows = [];
    for (let i = 0; i < 500; i++) {
      const kind = i % 3 === 0 ? 'preference_signal' : i % 3 === 1 ? 'learning' : 'reference';
      const tags = i % 5 === 0 ? 'project:myapp' : i % 5 === 1 ? 'project:sibling-a' : i % 5 === 2 ? 'agent:someone' : '';
      rows.push({ content: `row ${i} ${'x'.repeat(80)}`, tags, memory_type: kind, created_at: i });
    }
    const file = buildDb(dir, rows);
    const started = Date.now();
    const { counts } = m.selectForSession(file, { project: 'myapp', related: ['sibling-a'], capBytes: 100000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `took ${elapsed}ms`);
    assert.ok(counts.own > 0 && counts.related > 0 && counts.preference > 0);
  } finally { rmDir(dir); }
});
