'use strict';
// The one-time import: Claude Code's own per-project auto-memory notes -> the shared `memory` MCP.
// Unit tests drive a FAKE stdio MCP server (scripts/fixtures/fake-memory-server.js) registered in a
// temp project's .mcp.json, so every scenario runs the real script end to end without touching a
// real memory database. One integration test at the bottom drives the REAL mcp-memory-service server
// (skipped, with a stated reason, when `uvx` is not installed) - NEVER against ~/.memory-mcp.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'memory-import.js');
const FAKE_SERVER = path.join(ROOT, 'scripts', 'fixtures', 'fake-memory-server.js');
const memoryImport = require('./memory-import.js');

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const hasUvx = spawnSync('uvx', ['--version'], { encoding: 'utf8' }).status === 0;
const skipNoUvx = hasUvx ? false : 'uvx not installed - real mcp-memory-service integration test skipped';

function mkTmp(prefix)
{
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A project dir with a .mcp.json registering `memory` against the fake server, wired to a fresh
// per-sandbox db file and calls log (and, optionally, a content string that gets a genuine failure
// response instead of a store).
function sandbox(opts = {})
{
    const work = mkTmp('memimport-');
    const projectRoot = path.join(work, 'repo');
    fs.mkdirSync(projectRoot);
    const acctDir = path.join(work, 'acct');
    fs.mkdirSync(acctDir);
    const memoryDir = path.join(work, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const db = path.join(work, 'fake-db.json');
    const callsLog = path.join(work, 'calls.jsonl');

    const env = { FAKE_MEMORY_DB: db, FAKE_MEMORY_CALLS_LOG: callsLog };
    if (opts.failContent) env.FAKE_MEMORY_FAIL_CONTENT = opts.failContent;

    if (opts.registerIn !== 'account')
    {
        fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({
            mcpServers: { memory: { type: 'stdio', command: process.execPath, args: [FAKE_SERVER], env } },
        }, null, 2));
    }
    else
    {
        fs.writeFileSync(path.join(acctDir, '.claude.json'), JSON.stringify({
            mcpServers: { memory: { type: 'stdio', command: process.execPath, args: [FAKE_SERVER], env } },
        }, null, 2));
    }
    return { work, projectRoot, acctDir, memoryDir, db, callsLog };
}

function writeNote(dir, filename, { name, description, type, body })
{
    const lines = ['---', `name: ${name}`];
    if (description !== undefined) lines.push(`description: ${description}`);
    lines.push('metadata:', `  type: ${type}`, '---', '', body);
    fs.writeFileSync(path.join(dir, filename), `${lines.join('\n')}\n`);
}

function readCalls(callsLog)
{
    if (!fs.existsSync(callsLog)) return [];
    return fs.readFileSync(callsLog, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function runScript(args, opts = {})
{
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000, ...opts });
}

// Reads every file's content under a directory, sorted by name - a byte-identical snapshot to
// assert the source notes folder was never written to.
function snapshot(dir)
{
    const names = fs.readdirSync(dir).sort();
    return names.map((n) => `${n}\0${fs.readFileSync(path.join(dir, n), 'utf8')}`).join('');
}

test.after(() =>
{
    // best-effort - each sandbox is under os.tmpdir(), nothing here is load-bearing for CI
});

test('mapKind: user/feedback/project/reference/unknown map per the pinned table', () =>
{
    assert.strictEqual(memoryImport.mapKind('user'), 'preference');
    assert.strictEqual(memoryImport.mapKind('feedback'), 'correction');
    assert.strictEqual(memoryImport.mapKind('project'), 'project-fact');
    assert.strictEqual(memoryImport.mapKind('reference'), 'project-fact');
    assert.strictEqual(memoryImport.mapKind('something-else'), 'project-fact');
    assert.strictEqual(memoryImport.mapKind(''), 'project-fact');
    assert.strictEqual(memoryImport.mapKind(undefined), 'project-fact');
});

test('parseNote: reads metadata.type (nested, matching real notes), name and description', () =>
{
    const raw = [
        '---',
        'name: reference-example',
        'description: An example note',
        'metadata:',
        '  type: reference',
        '  modified: 2026-09-19T00:00:00.000Z',
        '---',
        '',
        'Body line one.',
        'Body line two.',
        '',
    ].join('\n');
    const note = memoryImport.parseNote(raw, 'reference-example.md');
    assert.strictEqual(note.name, 'reference-example');
    assert.strictEqual(note.description, 'An example note');
    assert.strictEqual(note.rawType, 'reference');
    assert.strictEqual(note.body, 'Body line one.\nBody line two.');
});

test('parseNote: also reads a top-level type key, and falls back to the filename with no frontmatter', () =>
{
    const withTopLevelType = memoryImport.parseNote('---\nname: n\ntype: user\n---\nbody\n', 'n.md');
    assert.strictEqual(withTopLevelType.rawType, 'user');

    const noFrontmatter = memoryImport.parseNote('just some text\n', 'my-note.md');
    assert.strictEqual(noFrontmatter.name, 'my-note');
    assert.strictEqual(noFrontmatter.description, '');
    assert.strictEqual(noFrontmatter.body, 'just some text');
});

test('buildContent: description first, then body - falls back to whichever is present', () =>
{
    assert.strictEqual(memoryImport.buildContent('desc', 'body'), 'desc\n\nbody');
    assert.strictEqual(memoryImport.buildContent('', 'body'), 'body');
    assert.strictEqual(memoryImport.buildContent('desc', ''), 'desc');
});

test('slugify: replaces every path separator with a dash (matches this machine\'s real project folder names)', () =>
{
    assert.strictEqual(memoryImport.slugify('/Users/mac/Programming/Projects/Personal/claude-stack'),
        '-Users-mac-Programming-Projects-Personal-claude-stack');
});

test('3 notes import with the right memory_type, tags and content; MEMORY.md is skipped; source untouched', () =>
{
    const sb = sandbox();
    writeNote(sb.memoryDir, 'MEMORY.md', { name: 'MEMORY', description: 'index', type: 'project', body: '- an index line' });
    writeNote(sb.memoryDir, 'user-role.md', { name: 'user-role', description: 'The user is a backend engineer', type: 'user', body: 'Prefers terse answers.' });
    writeNote(sb.memoryDir, 'feedback-shorter.md', { name: 'feedback-shorter', description: 'Answers should be shorter', type: 'feedback', body: 'Lead with the verdict.' });
    writeNote(sb.memoryDir, 'reference-tracker.md', { name: 'reference-tracker', description: 'Issue tracker lives at example.test', type: 'reference', body: 'Check it before filing a duplicate.' });

    const before = snapshot(sb.memoryDir);
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    const after = snapshot(sb.memoryDir);

    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: 3 imported, 0 already present, from /);
    assert.strictEqual(after, before, 'the source notes folder must be byte-identical after an import');

    const calls = readCalls(sb.callsLog);
    assert.strictEqual(calls.length, 3, 'MEMORY.md must never be imported');
    assert.ok(!calls.some((c) => c.tags.includes('MEMORY')));

    const projectName = path.basename(sb.projectRoot);
    const byName = Object.fromEntries(calls.map((c) => [c.tags[1], c]));
    assert.strictEqual(byName['user-role'].memory_type, 'preference');
    assert.deepStrictEqual(byName['user-role'].tags, [`project:${projectName}`, 'user-role']);
    assert.strictEqual(byName['user-role'].content, 'The user is a backend engineer\n\nPrefers terse answers.');

    assert.strictEqual(byName['feedback-shorter'].memory_type, 'correction');
    assert.strictEqual(byName['reference-tracker'].memory_type, 'project-fact');

    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('a re-run imports 0 and reports 3 already present (relies on the server\'s own duplicate report)', () =>
{
    const sb = sandbox();
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: 'desc a', type: 'user', body: 'body a' });
    writeNote(sb.memoryDir, 'b.md', { name: 'b', description: 'desc b', type: 'feedback', body: 'body b' });
    writeNote(sb.memoryDir, 'c.md', { name: 'c', description: 'desc c', type: 'project', body: 'body c' });

    const first = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.match(first.stdout, /memory import: 3 imported, 0 already present, from /);

    const second = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.match(second.stdout, /memory import: 0 imported, 3 already present, from /);

    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('missing notes folder -> exit 0, "nothing to import"', () =>
{
    const sb = sandbox();
    fs.rmSync(sb.memoryDir, { recursive: true, force: true }); // never created
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: nothing to import, from /);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('an empty notes folder (no notes beyond MEMORY.md) -> exit 0, "nothing to import"', () =>
{
    const sb = sandbox();
    writeNote(sb.memoryDir, 'MEMORY.md', { name: 'MEMORY', description: 'index', type: 'project', body: '(empty)' });
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: nothing to import, from /);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('unreadable notes folder -> exit 1', { skip: isRoot ? 'running as root - permission checks are bypassed' : false }, () =>
{
    const sb = sandbox();
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: 'd', type: 'user', body: 'b' });
    fs.chmodSync(sb.memoryDir, 0o000);
    try
    {
        const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /memory import:/);
    }
    finally
    {
        fs.chmodSync(sb.memoryDir, 0o700);
        fs.rmSync(sb.work, { recursive: true, force: true });
    }
});

test('no `memory` MCP registered (neither .mcp.json nor the account config) -> exit 1', () =>
{
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2)); // overwrite: no memory entry
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: 'd', type: 'user', body: 'b' });
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /no 'memory' MCP server registered/);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('the memory MCP is read from the account config when the project has no .mcp.json entry', () =>
{
    const sb = sandbox({ registerIn: 'account' });
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: 'd', type: 'user', body: 'b' });
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: 1 imported, 0 already present, from /);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('a server response carrying "Error storing memory" (not a duplicate) -> exit 1', () =>
{
    const failBody = 'this exact content triggers the fake failure';
    const sb = sandbox({ failContent: failBody });
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: '', type: 'user', body: failBody });
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /Error storing memory: simulated failure for test/);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('a spawn error (the registered command does not exist) -> exit 1', () =>
{
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.projectRoot, '.mcp.json'), JSON.stringify({
        mcpServers: { memory: { type: 'stdio', command: path.join(sb.work, 'does-not-exist-binary'), args: [], env: {} } },
    }, null, 2));
    writeNote(sb.memoryDir, 'a.md', { name: 'a', description: 'd', type: 'user', body: 'b' });
    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir, '--memory-dir', sb.memoryDir]);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /memory import:/);
    fs.rmSync(sb.work, { recursive: true, force: true });
});

test('default notes folder is derived from the git top-level slug (worktree-aware) when --memory-dir is omitted', () =>
{
    const sb = sandbox();
    execFileSync('git', ['init', '-q', sb.projectRoot]);
    const memoryDir = memoryImport.defaultMemoryDir(sb.projectRoot, sb.acctDir);
    fs.mkdirSync(memoryDir, { recursive: true });
    writeNote(memoryDir, 'a.md', { name: 'a', description: 'd', type: 'user', body: 'b' });

    const res = runScript(['--project-root', sb.projectRoot, '--config-dir', sb.acctDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`memory import: 1 imported, 0 already present, from ${memoryDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    fs.rmSync(sb.work, { recursive: true, force: true });
});

// Integration: the REAL mcp-memory-service 11.13.0 server, empty temp db, sqlite_vec backend.
// MCP_MEMORY_ALLOW_HASH_EMBEDDINGS=1 is required on every launch against a non-empty db (the
// installer's exact registration installs no ML backend - spike-facts.md CONTRADICTS SPEC #1) - the
// decision to add a real ML extra or keep the hash-embedding override is still open elsewhere, so
// this test pins it locally rather than assuming either way.
test('integration: imports notes through the real mcp-memory-service server', { skip: skipNoUvx }, () =>
{
    const work = mkTmp('memimport-real-');
    const projectRoot = path.join(work, 'repo');
    fs.mkdirSync(projectRoot);
    const acctDir = path.join(work, 'acct');
    fs.mkdirSync(acctDir);
    const memoryDir = path.join(work, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const dbDir = path.join(work, 'db');
    fs.mkdirSync(dbDir, { recursive: true });

    fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({
        mcpServers: {
            memory: {
                type: 'stdio',
                command: 'uvx',
                args: ['--with', 'numpy', '--from', 'mcp-memory-service@11.13.0', 'memory', 'server'],
                env: {
                    MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec',
                    MCP_MEMORY_SQLITE_PATH: path.join(dbDir, 'memory.db'),
                    MCP_MEMORY_ALLOW_HASH_EMBEDDINGS: '1',
                },
            },
        },
    }, null, 2));

    writeNote(memoryDir, 'reference-note.md', { name: 'reference-note', description: 'A real-server integration note', type: 'reference', body: 'Body text for the integration test.' });

    const res = spawnSync(process.execPath, [SCRIPT, '--project-root', projectRoot, '--config-dir', acctDir, '--memory-dir', memoryDir],
        { encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(res.status, 0, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /memory import: 1 imported, 0 already present, from /);

    fs.rmSync(work, { recursive: true, force: true });
});
