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
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct, PATH: bin + path.delimiter + process.env.PATH };
    return { work, repo, acct, sel, env };
}
const denyOf = (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).permissions.deny;
const runSh = (sb, action) => execFileSync('bash', [SH, action, '--scope', 'project', '--selection', sb.sel, '--source', ROOT], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
const runPs = (sb, action) => execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', 'project', '-Selection', sb.sel, '-Source', ROOT], { cwd: sb.repo, encoding: 'utf8', env: sb.env });

function assertDeny(sb, out, twin)
{
    const deny = denyOf(sb.repo);
    for (const r of RETIRED) assert.ok(!deny.includes(r), `${twin}: retired deny entry still present after install: ${r}`);
    for (const g of GENERIC) assert.ok(deny.includes(g), `${twin}: generic deny entry missing: ${g}`);
    assert.ok(deny.includes(OWN), `${twin}: the project's own deny entry was dropped`);
    assert.strictEqual(new Set(deny).size, deny.length, `${twin}: duplicate deny entries`);
    assert.match(out, /dropped retired deny entry Read\(~\/\.claude\/settings\.json\)/, `${twin}: the removal is reported`);
    assert.ok(!fs.existsSync(path.join(sb.acct, 'settings.json')), `${twin}: the account settings.json was created with nothing to write`);
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
