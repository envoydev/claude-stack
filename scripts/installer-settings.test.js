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
