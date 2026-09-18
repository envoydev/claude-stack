'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');

// The ps1 twin runs where PowerShell is installed (windows-latest and macos-latest carry pwsh;
// a bare ubuntu does not) - a visible SKIP elsewhere, never a silent gap.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

// The four entries the installers wrote into permissions.deny for releases and no longer do: the
// credential guard judges that file by CONTENT on the Read route and the shell route alike, and a
// deny rule is absolute - the SECRET-READ-ALLOW receipt the guard honours cannot lift it, so it
// took the user's own consented read away.
const RETIRED = [
    'Read(~/.claude/settings.json)',
    'Read(~/.claude/settings.local.json)',
    'Read(~/.claude-*/settings.json)',
    'Read(~/.claude-*/settings.local.json)',
];
const GENERIC = ['Read(.env)', 'Read(.env.*)', 'Read(*.pem)', 'Read(*.pfx)', 'Read(*.p12)', 'Read(*.key)'];
const OWN = 'Read(secrets/**)';   // a consuming project's own entry - never touched

// A FULL install of the working tree's installer into a throwaway git repo. --source points at
// this checkout (no clone), the selection carries one skill, one rule and one hook and NO mcps or
// plugins (nothing is registered), a stub `claude` on PATH answers every CLI call with exit 0 so
// the run is hermetic on a machine that has the real one, and HOME / CLAUDE_CONFIG_DIR point
// inside the sandbox so no account file on this machine is read or written.
function sandbox()
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const acct = path.join(work, 'acct');
    fs.mkdirSync(acct);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n');
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill angular-conventions\nrule markdown-docs\nhook guard-secret-value\n');
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: [...RETIRED, OWN] } }, null, 2) + '\n');
    // The installer writes every key it finds in its launch environment, and this test runner may
    // itself run inside a session whose account env carries the real ones - scrub the three names
    // so a run gets only what a test hands it (and no real value ever lands in a sandbox file).
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct, PATH: bin + path.delimiter + process.env.PATH };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    return { work, repo, acct, sel, env };
}
const denyOf = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).permissions.deny;
const runSh = (sb, action, args = [], env = {}) => execFileSync('bash', [SH, action, '--scope', 'project', '--selection', sb.sel, '--source', ROOT, ...args], { cwd: sb.repo, encoding: 'utf8', env: { ...sb.env, ...env } });
const runPs = (sb, action, args = [], env = {}) => execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', 'project', '-Selection', sb.sel, '-Source', ROOT, ...args], { cwd: sb.repo, encoding: 'utf8', env: { ...sb.env, ...env } });

function assertDeny(sb, out, twin)
{
    const deny = denyOf(sb.repo);
    for (const r of RETIRED) assert.ok(!deny.includes(r), `${twin}: retired deny entry still present after install: ${r}`);
    for (const g of GENERIC) assert.ok(deny.includes(g), `${twin}: generic deny entry missing: ${g}`);
    assert.ok(deny.includes(OWN), `${twin}: the project's own deny entry was dropped`);
    assert.strictEqual(new Set(deny).size, deny.length, `${twin}: duplicate deny entries`);
    assert.match(out, /dropped retired deny entry Read\(~\/\.claude\/settings\.json\)/, `${twin}: the removal is reported`);
    assert.ok(!fs.existsSync(path.join(sb.acct, 'settings.json')), `${twin}: the account settings.json was created with nothing to write`);
    assert.match(out, /CONTEXT7_API_KEY=absent in .*export CONTEXT7_API_KEY/, `${twin}: the next steps report the key absent and name the export route`);
}

test('sh: install drops the four account-settings deny entries, keeps the rest, and update never re-adds them', () => {
    const sb = sandbox();
    try
    {
        assertDeny(sb, runSh(sb, 'install'), 'sh');
        const out = runSh(sb, 'update');
        assert.deepStrictEqual(denyOf(sb.repo).filter(r => RETIRED.includes(r)), [], 'sh: update re-added a retired entry');
        assert.doesNotMatch(out, /dropped retired deny entry/, 'sh: a second run had nothing to drop');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: install drops the four account-settings deny entries, keeps the rest, and update never re-adds them (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try
    {
        assertDeny(sb, runPs(sb, 'install'), 'ps1');
        const out = runPs(sb, 'update');
        assert.deepStrictEqual(denyOf(sb.repo).filter(r => RETIRED.includes(r)), [], 'ps1: update re-added a retired entry');
        assert.doesNotMatch(out, /dropped retired deny entry/, 'ps1: a second run had nothing to drop');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// --- every key the run is handed lands in the ACCOUNT settings.json, at project scope too -------
// Measured on Claude Code 2.1.266 (and on an earlier release before that): a value in the project's
// .claude/settings.json or settings.local.json env never reaches the .mcp.json URL/header expansion -
// the 'Missing environment variables' warning stays - while the account settings.json clears it. So
// the keys the remote servers read (SENTRY_SLUG in the sentry URL, SENTRY_ACCESS_TOKEN and
// CONTEXT7_API_KEY in headers) have ONE working home, and 'add it there by hand' left a remote
// user with no terminal to do it in. The installer now writes what it is handed: the slug from the
// flag (else the launch environment), the two secrets from the launch environment - overwriting, an
// exported value is as explicit as a flag - logged by LENGTH, never by value, and never clearing a
// value the run was not handed.
const TOKEN = 'sntrys_' + 'a'.repeat(32);   // credential-shaped by construction, fake
const TOKEN2 = 'sntrys_' + 'c'.repeat(40);
const CTX7 = 'ctx7sk-' + 'b'.repeat(28);
const KEY_ENV = { SENTRY_ACCESS_TOKEN: TOKEN, CONTEXT7_API_KEY: CTX7 };
const acctFile = (sb) => path.join(sb.acct, 'settings.json');
const acctEnv = (sb) => JSON.parse(fs.readFileSync(acctFile(sb), 'utf8')).env;
const projectEnv = (sb) => JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).env || {};

function assertKeys(sb, out, twin)
{
    assert.ok(fs.existsSync(acctFile(sb)), `${twin}: the account settings.json was written`);
    const env = acctEnv(sb);
    assert.strictEqual(env.SENTRY_SLUG, 'acme/api', `${twin}: the slug from the flag`);
    assert.strictEqual(env.SENTRY_ACCESS_TOKEN, TOKEN, `${twin}: the token from the launch environment`);
    assert.strictEqual(env.CONTEXT7_API_KEY, CTX7, `${twin}: the context7 key from the launch environment`);
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) assert.ok(!(k in projectEnv(sb)), `${twin}: ${k} landed in the project settings.json, which never reaches the expansion`);
    assert.match(out, /SENTRY_SLUG=acme\/api written to/, `${twin}: the slug is logged in clear - it is a URL segment`);
    assert.match(out, /SENTRY_ACCESS_TOKEN=set \(39 chars\) written to/, `${twin}: a secret is logged by length`);
    assert.match(out, /CONTEXT7_API_KEY=set \(35 chars\) written to/, `${twin}: a secret is logged by length`);
    assert.ok(!out.includes(TOKEN) && !out.includes(CTX7), `${twin}: a value reached the log`);
    assert.match(out, /CONTEXT7_API_KEY=set \(35 chars\) in /, `${twin}: the next steps report the key present in the account file`);
}
function assertSecondRun(sb, out, twin)
{
    const env = acctEnv(sb);
    assert.strictEqual(env.SENTRY_ACCESS_TOKEN, TOKEN2, `${twin}: an exported value is explicit - it overwrites`);
    assert.strictEqual(env.SENTRY_SLUG, 'acme/other', `${twin}: the slug from the launch environment when the flag is absent`);
    assert.strictEqual(env.CONTEXT7_API_KEY, CTX7, `${twin}: a key the run was not handed is never cleared`);
    assert.match(out, /SENTRY_ACCESS_TOKEN=set \(47 chars\) written to/, `${twin}: the overwrite is logged by length`);
    assert.ok(!out.includes(TOKEN2), `${twin}: a value reached the log`);
}

// A hook the release ADDED could never reach an existing install: --installed-only derives the
// selection from the hook FILES on disk, so a newly shipped guard was invisible to every update
// (measured: the v0.2.20 commit gate reached zero of three consuming projects). The stamp now
// records the hook catalog the run SHIPPED, which is what separates 'the user dropped it' from
// 'it did not exist yet' - on disk those two are identical.
const stampOf = (sb) => fs.readFileSync(path.join(sb.repo, '.claude', 'claude-stack.stamp'), 'utf8');
const shippedHooks = (sb) => (/^shipped-hooks: (.*)$/m.exec(stampOf(sb)) || [, ''])[1].split(',').filter(Boolean);
const hooksOnDisk = (sb) => fs.readdirSync(path.join(sb.repo, '.claude', 'hooks')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();

// --installed-only is mutually exclusive with --selection, so this path needs its own runners.
const updateIoSh = (sb) => execFileSync('bash', [SH, 'update', '--scope', 'project', '--source', ROOT, '--installed-only'], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
const updateIoPs = (sb) => execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'update', '-Scope', 'project', '-Source', ROOT, '-InstalledOnly'], { cwd: sb.repo, encoding: 'utf8', env: sb.env });

function assertHookAdoption(sb, run, updateIo, twin)
{
    run(sb, 'install');
    const shipped = shippedHooks(sb);
    assert.ok(shipped.length >= 10, `${twin}: the stamp records the whole shipped hook catalog, not this run's subset`);
    assert.deepStrictEqual(hooksOnDisk(sb), ['guard-secret-value'], `${twin}: the selection installed one hook`);
    assert.ok(!fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'model-windows.json')), `${twin}: no model table without a hook that reads it`);

    // every other hook was shipped at install time and is absent now - a deliberate drop, kept dropped
    const kept = updateIo(sb);
    assert.deepStrictEqual(hooksOnDisk(sb), ['guard-secret-value'], `${twin}: a dropped hook is not resurrected`);
    assert.match(kept, /installed-only: hook guard-answer-length was dropped from this install - leaving it out/, `${twin}: and the decision is reported`);

    // now make one hook look NEW: drop it from the stamp's shipped list, as an install predating it has
    const stampFile = path.join(sb.repo, '.claude', 'claude-stack.stamp');
    fs.writeFileSync(stampFile, stampOf(sb).replace(/^shipped-hooks: .*$/m, (line) => line.split(',').filter(n => !n.endsWith('guard-answer-length')).join(',')));
    const adopted = updateIo(sb);
    assert.match(adopted, /installed-only: adopting hook guard-answer-length - shipped by this release and absent here/, `${twin}: a hook the release added IS adopted`);
    assert.deepStrictEqual(hooksOnDisk(sb), ['guard-answer-length', 'guard-secret-value'], `${twin}: and it lands on disk`);
    const wiring = JSON.stringify(JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).hooks || {});
    assert.ok(wiring.includes('guard-answer-length.js'), `${twin}: the adopted hook is wired, not just copied`);
    assert.ok(!adopted.includes('adopting hook guard-catastrophic-rm'), `${twin}: the other dropped hooks stay dropped in the same run`);
}

// The model -> window table is data the two fresh-session hooks read from their own directory, so it
// must land beside them - and only beside them.
function assertModelTable(sb, run, twin)
{
    fs.writeFileSync(sb.sel, 'skill angular-conventions\nrule markdown-docs\nhook guard-stop-contract\n');
    run(sb, 'install');
    const table = path.join(sb.repo, '.claude', 'hooks', 'model-windows.json');
    assert.ok(fs.existsSync(table), `${twin}: the table lands beside guard-stop-contract.js`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(table, 'utf8')), JSON.parse(fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'model-windows.json'), 'utf8')), `${twin}: byte-equal to the release's copy`);
}

test('sh: the model table is installed beside the fresh-session hooks', () => assertModelTable(sandbox(), runSh, 'sh'));
test('ps1: the model table is installed beside the fresh-session hooks (pwsh required)', { skip: skipNoPwsh }, () => assertModelTable(sandbox(), runPs, 'ps1'));

test('sh: update adopts a hook the release ADDED, and never resurrects one the user dropped', () => {
    assertHookAdoption(sandbox(), runSh, updateIoSh, 'sh');
});

test('ps1: update adopts a hook the release ADDED, and never resurrects one the user dropped (pwsh required)', { skip: skipNoPwsh }, () => {
    assertHookAdoption(sandbox(), runPs, updateIoPs, 'ps1');
});

// The update command's close-out used to ASSERT 'no key renamed, reset or newly seeded' with
// nothing to read back - a rename and a removal each printed a line, a SEED printed nothing. Three
// audited runs stated it anyway and one of them named keys it had never probed.
const SEEDS = [
    ['CLAUDE_STACK_DOCS_PATH', '.claude/docs'],
    ['CLAUDE_STACK_DOCS_VERSIONING', 'local'],
    ['CLAUDE_STACK_INSTRUMENT', '0'],
    ['CLAUDE_STACK_PUSH_GATE', '1'],
    ['CLAUDE_STACK_ROTATE_ASK', '1'],
    ['CLAUDE_STACK_FRESH_SESSION_1M', '400000'],
    ['CLAUDE_STACK_FRESH_SESSION_200K', '150000'],
    ['CLAUDE_STACK_FRESH_SESSION_DEFAULT', '180000'],
    ['CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW', '1000000'],
    ['CLAUDE_STACK_DOCS_BLOCK', '1'],
    ['CLAUDE_STACK_DOCS_GATE', '1'],
    ['CLAUDE_STACK_DOCS_ASK', '1'],
];

function assertSeedLines(sb, out, twin)
{
    for (const [key, value] of SEEDS)
    {
        assert.ok(out.includes(`settings.json env: ${key} seeded (${value})`), `${twin}: the seed of ${key} is reported`);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).env[key], value, `${twin}: ${key} landed`);
    }
}

test('sh: every env key the install seeds is REPORTED, and a second run reports none', () => {
    const sb = sandbox();
    assertSeedLines(sb, runSh(sb, 'install'), 'sh');
    const again = runSh(sb, 'update');
    for (const [key] of SEEDS) assert.ok(!again.includes(`env: ${key} seeded`), `sh: ${key} is not re-reported when it is already set`);
});

test('ps1: every env key the install seeds is REPORTED, and a second run reports none (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    assertSeedLines(sb, runPs(sb, 'install'), 'ps1');
    const again = runPs(sb, 'update');
    for (const [key] of SEEDS) assert.ok(!again.includes(`env: ${key} seeded`), `ps1: ${key} is not re-reported when it is already set`);
});

// The one seed that is not a constant: how the docs are versioned is a DECISION the install writes down, and it is
// seeded from what the repo does TODAY - so an install made before the key existed keeps the behaviour it had
// instead of being switched onto the overlay (or off it) by an update nobody was asked about. A value already in
// the file is never touched, whatever the repo says.
const gitIn = (repo, ...args) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });

function assertVersioningSeed(sb, run, twin)
{
    try
    {
        // a repo that COMMITS its docs is seeded 'git', not the plain default
        fs.mkdirSync(path.join(sb.repo, '.claude', 'docs', 'architecture'), { recursive: true });
        fs.writeFileSync(path.join(sb.repo, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# Map\n');
        gitIn(sb.repo, 'add', '-f', '.claude/docs');
        gitIn(sb.repo, 'commit', '-qm', 'docs');
        const out = run(sb, 'install');
        assert.ok(out.includes('settings.json env: CLAUDE_STACK_DOCS_VERSIONING seeded (git)'), `${twin}: committed docs are seeded git`);
        assert.strictEqual(projectEnv(sb).CLAUDE_STACK_DOCS_VERSIONING, 'git', `${twin}: and the value landed`);
        // an update over an install that predates the key seeds it by the same detection, never by a constant
        const file = path.join(sb.repo, '.claude', 'settings.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        delete data.env.CLAUDE_STACK_DOCS_VERSIONING;
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
        assert.ok(run(sb, 'update').includes('CLAUDE_STACK_DOCS_VERSIONING seeded (git)'), `${twin}: the update re-seeds what the repo does, not the catalog default`);
        // and a value the user chose is left alone, whatever the repo does
        const mine = JSON.parse(fs.readFileSync(file, 'utf8'));
        mine.env.CLAUDE_STACK_DOCS_VERSIONING = 'local';
        fs.writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`);
        assert.ok(!run(sb, 'update').includes('CLAUDE_STACK_DOCS_VERSIONING seeded'), `${twin}: an existing value is never re-seeded`);
        assert.strictEqual(projectEnv(sb).CLAUDE_STACK_DOCS_VERSIONING, 'local', `${twin}: and never clobbered`);
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
}

test('sh: the docs-versioning seed records what the repo does today, and never clobbers a chosen value', () => assertVersioningSeed(sandbox(), runSh, 'sh'));
test('ps1: the docs-versioning seed records what the repo does today, and never clobbers a chosen value (pwsh required)', { skip: skipNoPwsh }, () => assertVersioningSeed(sandbox(), runPs, 'ps1'));

test('sh: the slug, the sentry token and the context7 key the run is handed land in the ACCOUNT settings.json at project scope', () => {
    const sb = sandbox();
    try
    {
        assertKeys(sb, runSh(sb, 'install', ['--sentry-slug', 'acme/api'], KEY_ENV), 'sh');
        assertSecondRun(sb, runSh(sb, 'update', [], { SENTRY_ACCESS_TOKEN: TOKEN2, SENTRY_SLUG: 'acme/other' }), 'sh');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: the slug, the sentry token and the context7 key the run is handed land in the ACCOUNT settings.json at project scope (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try
    {
        assertKeys(sb, runPs(sb, 'install', ['-SentrySlug', 'acme/api'], KEY_ENV), 'ps1');
        assertSecondRun(sb, runPs(sb, 'update', [], { SENTRY_ACCESS_TOKEN: TOKEN2, SENTRY_SLUG: 'acme/other' }), 'ps1');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// --- the CLAUDE.md seed stamps the H1 placeholder with the repo folder name -----------------------
// The template ships `# __PROJECT_NAME__` (the same __TOKEN__ shape the docs-root rule uses), and the
// seed runs once per project - it returns early when either CLAUDE.md location exists - so the
// stamp can never clobber a hand-written title. The sandbox repo folder is `repo`.
function assertSeededTitle(sb, twin)
{
    const seeded = path.join(sb.repo, '.claude', 'CLAUDE.md');
    assert.ok(fs.existsSync(seeded), `${twin}: .claude/CLAUDE.md was not seeded`);
    const text = fs.readFileSync(seeded, 'utf8');
    assert.strictEqual(text.split(/\r?\n/)[0], '# repo', `${twin}: the H1 placeholder was not stamped with the repo folder name`);
    assert.ok(!text.includes('__PROJECT_NAME__'), `${twin}: a __PROJECT_NAME__ token survived the stamp`);
    assert.ok(!text.startsWith('﻿'), `${twin}: the seed was written with a BOM`);
}

test('sh: the CLAUDE.md seed stamps the H1 placeholder with the repo folder name', () => {
    const sb = sandbox();
    try
    {
        runSh(sb, 'install');
        assertSeededTitle(sb, 'sh');
        fs.writeFileSync(path.join(sb.repo, '.claude', 'CLAUDE.md'), '# hand-written\n');
        runSh(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.claude', 'CLAUDE.md'), 'utf8'), '# hand-written\n', 'sh: a second run touched a filled CLAUDE.md');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: the CLAUDE.md seed stamps the H1 placeholder with the repo folder name (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try
    {
        runPs(sb, 'install');
        assertSeededTitle(sb, 'ps1');
        fs.writeFileSync(path.join(sb.repo, '.claude', 'CLAUDE.md'), '# hand-written\n');
        runPs(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.claude', 'CLAUDE.md'), 'utf8'), '# hand-written\n', 'ps1: a second run touched a filled CLAUDE.md');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// docs.js is the engine the docs hook requires from its own directory: it must land beside the hook and only there,
// and the hook must be wired on all four events it serves.
function assertDocsHook(sb, run, twin)
{
    fs.writeFileSync(sb.sel, 'skill angular-conventions\nrule markdown-docs\nhook docs-session\n');
    run(sb, 'install');
    const hooks = path.join(sb.repo, '.claude', 'hooks');
    assert.ok(fs.existsSync(path.join(hooks, 'docs-session.js')), `${twin}: the hook lands`);
    assert.strictEqual(fs.readFileSync(path.join(hooks, 'docs.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'docs.js'), 'utf8'), `${twin}: the engine lands beside it, byte-equal`);
    const wiring = JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).hooks;
    for (const ev of ['SessionStart', 'SubagentStart', 'PreToolUse', 'Stop'])
    {
        const entries = (wiring[ev] || []).filter((e) => JSON.stringify(e).includes('docs-session.js'));
        assert.strictEqual(entries.length, 1, `${twin}: wired once on ${ev}`);
        assert.strictEqual(entries[0].hooks[0].timeout, 10, `${twin}: ${ev} carries the 10s timeout`);
    }
}
function assertNoEngineWithoutHook(sb, run, twin)
{
    fs.writeFileSync(sb.sel, 'skill angular-conventions\nrule markdown-docs\nhook guard-secret-value\n');
    run(sb, 'install');
    assert.ok(!fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'docs.js')), `${twin}: no engine without the hook`);
}

test('sh: the docs engine lands beside the docs hook, wired on four events', () => assertDocsHook(sandbox(), runSh, 'sh'));
test('ps1: the docs engine lands beside the docs hook, wired on four events (pwsh required)', { skip: skipNoPwsh }, () => assertDocsHook(sandbox(), runPs, 'ps1'));
test('sh: no docs engine without the docs hook', () => assertNoEngineWithoutHook(sandbox(), runSh, 'sh'));
test('ps1: no docs engine without the docs hook (pwsh required)', { skip: skipNoPwsh }, () => assertNoEngineWithoutHook(sandbox(), runPs, 'ps1'));

// docs.js is the only .js beside the hooks that is not a hook: an --installed-only update must not read it back as one.
function assertEngineNotAHook(sb, run, updateIo, twin)
{
    fs.writeFileSync(sb.sel, 'skill angular-conventions\nrule markdown-docs\nhook docs-session\n');
    run(sb, 'install');
    const out = updateIo(sb);
    assert.doesNotMatch(out, /hook docs\b(?!-session)/, `${twin}: the engine is never named as a hook`);
    assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'docs.js')), `${twin}: the engine is refreshed beside its hook`);
}
test('sh: --installed-only never reads the docs engine back as a hook', () => assertEngineNotAHook(sandbox(), runSh, updateIoSh, 'sh'));
test('ps1: -InstalledOnly never reads the docs engine back as a hook (pwsh required)', { skip: skipNoPwsh }, () => assertEngineNotAHook(sandbox(), runPs, updateIoPs, 'ps1'));
