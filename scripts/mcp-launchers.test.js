'use strict';
// The two small programs a plugin MCP entry cannot do without: the memory launcher, which turns the
// install's level choice into a db path, and the sentry headers helper, which decides whether there
// is an auth header at all. Both exist because a plugin entry expands only the SHELL and the ACCOUNT
// settings env - a PROJECT settings key arrives literal (measured, docs/plugin-migration-evidence.md).
//
// Every case runs on a SCRUBBED environment. This machine has a real SENTRY_ACCESS_TOKEN exported,
// and a test that inherited it would put a live credential in its own assertions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LAUNCH = path.join(ROOT, 'stack/mcp/memory-launch.js');
const HEADERS = path.join(ROOT, 'stack/mcp/sentry-headers.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launchers-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Only what node itself needs. No HOME either, unless a case sets one - a leaked HOME would let a
// case read the developer's own account settings and pass for the wrong reason.
const BARE = { PATH: process.env.PATH, NODE_OPTIONS: '' };

function project(name, { settings, local, account } = {})
{
    const dir = path.join(TMP, name);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const acct = path.join(dir, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    const write = (file, env) => fs.writeFileSync(file, JSON.stringify({ env }, null, 2));
    if (settings) write(path.join(dir, '.claude', 'settings.json'), settings);
    if (local) write(path.join(dir, '.claude', 'settings.local.json'), local);
    if (account) write(path.join(acct, 'settings.json'), account);
    return { dir, acct };
}

// The launcher execs uvx, so its resolution is exercised through the module, not by starting it.
function resolveDb(projectDir, env)
{
    const out = execFileSync(process.execPath, ['-e',
        'const m=require(process.argv[1]);process.stdout.write(m.resolveDb(process.argv[2]))',
        LAUNCH, projectDir], { env: { ...BARE, ...env }, encoding: 'utf8' });
    return out.trim();
}

function runHeaders(projectDir, env)
{
    return execFileSync(process.execPath, [HEADERS, projectDir],
        { env: { ...BARE, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// ------------------------------------------------------------------ memory-launch.js

test('memory-launch: the project settings env is the db, because a plugin entry cannot read it', () =>
{
    const { dir } = project('proj-db', { settings: { CLAUDE_STACK_MEMORY_DB: '/tmp/chosen/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/chosen/memory.db'));
});

test('memory-launch: settings.local.json is the per-machine override, read after settings.json', () =>
{
    const { dir } = project('local-db', { local: { CLAUDE_STACK_MEMORY_DB: '/tmp/local/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/local/memory.db'));
    // ... and settings.json WINS when both are present: it is what the install wrote.
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
        JSON.stringify({ env: { CLAUDE_STACK_MEMORY_DB: '/tmp/installed/memory.db' } }));
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.normalize('/tmp/installed/memory.db'));
});

test('memory-launch: the ACCOUNT settings env answers for a global install', () =>
{
    const { dir, acct } = project('acct-db', { account: { CLAUDE_STACK_MEMORY_DB: '/tmp/acct/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct }), path.normalize('/tmp/acct/memory.db'));
});

test('memory-launch: an explicit MCP_MEMORY_SQLITE_PATH wins over every file', () =>
{
    const { dir } = project('env-db', { settings: { CLAUDE_STACK_MEMORY_DB: '/tmp/chosen/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir, MCP_MEMORY_SQLITE_PATH: '/tmp/forced/memory.db' }),
        '/tmp/forced/memory.db');
});

test('memory-launch: no key anywhere falls back to the global default, never to nothing', () =>
{
    const { dir } = project('no-db');
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.join(dir, '.memory-mcp', 'memory.db'));
});

test('memory-launch: a RELATIVE value resolves against the project, the way the docs engine reads it', () =>
{
    const { dir } = project('rel-db', { settings: { CLAUDE_STACK_MEMORY_DB: '.memory-mcp/memory.db' } });
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.join(dir, '.memory-mcp/memory.db'));
});

test('memory-launch: malformed or empty settings are not a failure - the default still answers', () =>
{
    const { dir } = project('bad-db');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
    assert.strictEqual(resolveDb(dir, { HOME: dir }), path.join(dir, '.memory-mcp', 'memory.db'));
});

test('memory-launch: a hand-edited entry with no --package says so instead of launching something else', () =>
{
    let code = 0;
    try { execFileSync(process.execPath, [LAUNCH], { env: BARE, stdio: 'pipe' }); }
    catch (err) { code = err.status; }
    assert.strictEqual(code, 2);
});

// ------------------------------------------------------------------ sentry-headers.js

test('sentry-headers: token mode prints the Sentry-Bearer header, the scheme the API takes', () =>
{
    const { dir, acct } = project('sentry-token', { account: { SENTRY_ACCESS_TOKEN: 'sntryu_TESTVALUE' } });
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer sntryu_TESTVALUE' });
});

test('sentry-headers: oauth mode prints NO header, and the two modes never mix', () =>
{
    const { dir, acct } = project('sentry-oauth', {
        settings: { CLAUDE_STACK_SENTRY_AUTH: 'oauth' },
        account: { SENTRY_ACCESS_TOKEN: 'sntryu_TESTVALUE' },
    });
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct })), {});
});

test('sentry-headers: no token in token mode degrades to no header, never to a broken one', () =>
{
    const { dir, acct } = project('sentry-none');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct })), {});
});

test('sentry-headers: stdout is ONE json object and nothing else - it becomes the request headers', () =>
{
    const { dir, acct } = project('sentry-quiet');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(out, '{}');
    assert.doesNotThrow(() => JSON.parse(out));
});

test('sentry-headers: the SHELL env wins where it survives - the copy route and a run by hand', () =>
{
    const { dir, acct } = project('sentry-shell', { account: { SENTRY_ACCESS_TOKEN: 'from-file' } });
    const out = runHeaders(dir, { HOME: dir, CLAUDE_CONFIG_DIR: acct, SENTRY_ACCESS_TOKEN: 'from-shell' });
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer from-shell' });
});

// The environment this helper ACTUALLY gets on the plugin route. Claude Code removes every variable
// whose name carries TOKEN, SECRET, PASSWORD, KEY or AUTH from a helper a plugin or a project
// `.mcp.json` supplies (https://code.claude.com/docs/en/mcp, 'Which variables a helper can read'),
// and BOTH keys this file reads are such names - so a user who only exported the token gets no
// header, and the account settings.json is the only source that answers. Scrub the env the way the
// docs describe and the file path has to carry the whole job.
const scrub = (env) => Object.fromEntries(Object.entries(env)
    .filter(([k]) => !/TOKEN|SECRET|PASSWORD|KEY|AUTH/i.test(k)));

test('sentry-headers: with the credential variables removed, the ACCOUNT FILE still answers', () =>
{
    const { dir, acct } = project('sentry-scrubbed', { account: { SENTRY_ACCESS_TOKEN: 'from-file' } });
    const out = runHeaders(dir, scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct, SENTRY_ACCESS_TOKEN: 'from-shell' }));
    assert.deepStrictEqual(JSON.parse(out), { Authorization: 'Sentry-Bearer from-file' },
        'the shell export reached a helper that cannot read it, or the file source stopped answering');
});

test('sentry-headers: the oauth PIN survives the scrub too - it is read from a file, not the env', () =>
{
    const { dir, acct } = project('sentry-scrubbed-oauth', {
        settings: { CLAUDE_STACK_SENTRY_AUTH: 'oauth' },
        account: { SENTRY_ACCESS_TOKEN: 'from-file' },
    });
    const env = scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct, CLAUDE_STACK_SENTRY_AUTH: 'token' });
    assert.ok(!('CLAUDE_STACK_SENTRY_AUTH' in env), 'the scrub must drop the mode key - it carries AUTH');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, env)), {},
        'oauth mode pinned in the project settings lost to an env value the runtime removes');
});

test('sentry-headers: CLAUDE_CONFIG_DIR is NOT a credential name, so a space install still finds its account file', () =>
{
    const { dir, acct } = project('sentry-space', { account: { SENTRY_ACCESS_TOKEN: 'space-token' } });
    const env = scrub({ HOME: dir, CLAUDE_CONFIG_DIR: acct });
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, acct, 'the scrub swallowed the config dir - the account file would be unreachable');
    assert.deepStrictEqual(JSON.parse(runHeaders(dir, env)), { Authorization: 'Sentry-Bearer space-token' });
});
