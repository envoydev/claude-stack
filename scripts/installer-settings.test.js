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
    // The hook route is the switch Phase 2 added: these cases prove the COPY machinery, which still
    // ships behind CLAUDE_STACK_HOOKS_VIA_PLUGIN=false, so the sandbox pins it. The plugin route
    // (the default) has its own cases below, which pass the variable back as 'true'.
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct, PATH: bin + path.delimiter + process.env.PATH, CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false' };
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
// The engines and the shared gate module live in the same folder and are not hooks - the installer's
// own --installed-only scan skips the same three names.
const NOT_HOOKS = new Set(['docs', 'memory', 'hook-prelude', 'fresh-session']);
const hooksOnDisk = (sb) => fs.readdirSync(path.join(sb.repo, '.claude', 'hooks')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).filter(n => !NOT_HOOKS.has(n)).sort();

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
    ['CLAUDE_STACK_DOCS_VERSIONING', 'git'],   // a fresh project whose docs root git does not ignore
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

// The one seed that is not a constant: how the docs are versioned is a DECISION the install writes down, and an absent
// key is seeded by the one rule (docs-versioning-rule.test.js runs all four homes of it) - 'local' only when the docs
// are kept out of git, else 'git' - so an install whose docs stay out of git keeps the overlay it had instead of
// being switched by an update nobody was asked about. A value already in the file is never touched, whatever the repo
// says.
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
        // an update over an install that predates the key seeds it by the rule, never by the catalog constant ('git'):
        // the docs taken back out of git leave a domain nobody tracks, which is 'local'
        const file = path.join(sb.repo, '.claude', 'settings.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        delete data.env.CLAUDE_STACK_DOCS_VERSIONING;
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
        gitIn(sb.repo, 'rm', '-rq', '--cached', '.claude/docs');
        gitIn(sb.repo, 'commit', '-qm', 'docs out of git');
        assert.ok(run(sb, 'update').includes('CLAUDE_STACK_DOCS_VERSIONING seeded (local)'), `${twin}: the update re-seeds by the rule, not the catalog default`);
        // and a value the user chose is left alone, whatever the repo does
        const mine = JSON.parse(fs.readFileSync(file, 'utf8'));
        mine.env.CLAUDE_STACK_DOCS_VERSIONING = 'git';
        fs.writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`);
        assert.ok(!run(sb, 'update').includes('CLAUDE_STACK_DOCS_VERSIONING seeded'), `${twin}: an existing value is never re-seeded`);
        assert.strictEqual(projectEnv(sb).CLAUDE_STACK_DOCS_VERSIONING, 'git', `${twin}: and never clobbered`);
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
}

// Both probes hand `git ls-files` an ABSOLUTE pathspec. `os.path.join` and `Join-Path` emit the PLATFORM
// separator, so under Windows the pathspec would mix separators (`C:/repo\docs/architecture`) and a false negative
// there seeds `local` over committed docs - the silent switch the detected seed exists to prevent, and invisible,
// since the seed line then reads like a normal fresh install. This suite never runs on Windows, so what is pinned
// is the composition itself: the LINE must not depend on the platform, and its output is asserted by running it.
const probeLine = (file, needle) => fs.readFileSync(file, 'utf8').split('\n').find(l => l.includes(needle));

test('sh: the docs-versioning probe composes its pathspec with forward slashes, whatever the platform', () => {
    const line = probeLine(SH, '_dbase =');
    assert.ok(line, 'the sh probe still composes _dbase');
    assert.doesNotMatch(line, /os\.path\.join/, 'os.path.join emits the platform separator under a Windows python');
    const out = execFileSync('python3', ['-c', `_droot = "C:/repo"\n_dparts = ["docs", "generated"]\n${line.trim()}\nprint(_dbase)`], { encoding: 'utf8' }).trim();
    assert.strictEqual(out, 'C:/repo/docs/generated', 'sh: the composed docs root');
    // and the per-domain pathspec built on top of it is joined the same way - the git pathspec is the half that
    // must not carry a platform separator; the watch.json existence check beside it is a local path and may.
    const fold = probeLine(SH, '_committed = any(');
    assert.ok(fold, 'the sh probe still folds every domain into one answer');
    assert.ok(fold.includes('"%s/%s" % (_dbase, _d)'), 'sh: the per-domain pathspec is composed with a forward slash');
});

// A project AT the filesystem root leaves the root an empty string, and an empty cwd= is not a directory: python
// raises FileNotFoundError, which nothing here catches, so the whole settings.json write is abandoned over a
// probe whose answer is optional. The composition is fine ('' + '/docs/architecture' is the right absolute path);
// only the working directory has to survive it.
test('sh: the docs-versioning probe survives a project root at the filesystem root', () => {
    const src = fs.readFileSync(SH, 'utf8').split('\n');
    const at = src.findIndex(l => l.includes('def _dtracked('));
    assert.ok(at > 0, 'the sh probe still shells out to git ls-files');
    const fn = src.slice(at, at + 3).join('\n');   // def + the one call, wrapped inside its parens
    const out = execFileSync('python3', ['-c', `import subprocess\n${fn}\nprint("probed %s" % _dtracked("", "/docs/architecture"))`], { encoding: 'utf8' }).trim();
    assert.strictEqual(out, 'probed False', 'sh: no repo there, and no exception either');
});

test('ps1: the docs-versioning probe composes its pathspec with forward slashes, whatever the platform (pwsh required)', { skip: skipNoPwsh }, () => {
    const line = probeLine(PS1, '$docsBase =');
    assert.ok(line, 'the ps1 probe still composes $docsBase');
    assert.doesNotMatch(line, /Join-Path/, 'Join-Path emits the platform separator on Windows');
    const script = `$root = 'C:/repo'; $data = [pscustomobject]@{ env = [pscustomobject]@{ CLAUDE_STACK_DOCS_PATH = 'docs/generated/' } }; ${line.trim()}; Write-Output $docsBase`;
    const out = execFileSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
    assert.strictEqual(out, 'C:/repo/docs/generated', 'ps1: the composed docs root');
    assert.ok(probeLine(PS1, 'ForEach-Object { "$docsBase/').includes('$($_.Name)'), 'ps1: the per-domain pathspec is composed with a forward slash');
});

test('sh: the docs-versioning seed follows the one rule, not the catalog default, and never clobbers a chosen value', () => assertVersioningSeed(sandbox(), runSh, 'sh'));
test('ps1: the docs-versioning seed follows the one rule, not the catalog default, and never clobbers a chosen value (pwsh required)', { skip: skipNoPwsh }, () => assertVersioningSeed(sandbox(), runPs, 'ps1'));

// Task 14 / whole-branch review finding 2: the seed probed architecture/ alone, so a project documented in
// code-style/ (or decisions/, or related-projects/) had its COMMITTED docs seeded 'local'. A watch.json is what
// makes a folder a domain, which is also the boundary: a committed folder without one casts no vote - beside an
// untracked architecture/, a committed quality/ must not make the docs read as committed.
function assertDomainVersioningSeed(run, twin)
{
    const style = sandbox();
    const bare = sandbox();
    try
    {
        for (const [sb, domain, withWatch] of [[style, 'code-style', true], [bare, 'quality', false]])
        {
            const dir = path.join(sb.repo, '.claude', 'docs', domain);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'DOC.md'), '# Doc\n');
            if (withWatch) fs.writeFileSync(path.join(dir, 'watch.json'), '{}\n');
            gitIn(sb.repo, 'add', '-f', '.claude/docs');
            gitIn(sb.repo, 'commit', '-qm', 'docs');
        }
        fs.mkdirSync(path.join(bare.repo, '.claude', 'docs', 'architecture'), { recursive: true });
        fs.writeFileSync(path.join(bare.repo, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# Map\n');   // untracked
        assert.ok(run(style, 'install').includes('CLAUDE_STACK_DOCS_VERSIONING seeded (git)'), `${twin}: a committed code-style/ domain is committed docs`);
        assert.strictEqual(projectEnv(style).CLAUDE_STACK_DOCS_VERSIONING, 'git', `${twin}: and the value landed`);
        assert.ok(run(bare, 'install').includes('CLAUDE_STACK_DOCS_VERSIONING seeded (local)'), `${twin}: a committed folder with no watch.json is no domain, so the untracked architecture/ decides`);
        assert.strictEqual(projectEnv(bare).CLAUDE_STACK_DOCS_VERSIONING, 'local', `${twin}: and the value landed`);
    }
    finally { for (const sb of [style, bare]) fs.rmSync(sb.work, { recursive: true, force: true }); }
}

test('sh: the docs-versioning seed reads every domain under the docs root, not architecture/ alone', () => assertDomainVersioningSeed(runSh, 'sh'));
test('ps1: the docs-versioning seed reads every domain under the docs root, not architecture/ alone (pwsh required)', { skip: skipNoPwsh }, () => assertDomainVersioningSeed(runPs, 'ps1'));

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
    assert.ok(!text.startsWith('\uFEFF'), `${twin}: the seed was written with a BOM`);
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
// and the hook must be wired on all five events it serves.
function assertDocsHook(sb, run, twin)
{
    fs.writeFileSync(sb.sel, 'skill angular-conventions\nrule markdown-docs\nhook docs-session\n');
    run(sb, 'install');
    const hooks = path.join(sb.repo, '.claude', 'hooks');
    assert.ok(fs.existsSync(path.join(hooks, 'docs-session.js')), `${twin}: the hook lands`);
    assert.strictEqual(fs.readFileSync(path.join(hooks, 'docs.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'docs.js'), 'utf8'), `${twin}: the engine lands beside it, byte-equal`);
    const wiring = JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8')).hooks;
    for (const ev of ['SessionStart', 'SubagentStart', 'SubagentStop', 'PreToolUse', 'Stop'])
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

// --- docs-domain migration: three absent-only moves onto the new layout, for an install that ---
// predates the domain layout. related-context/ is deliberately the shared drop-box for every
// sibling-repo working paper a session produces - the capture owns only the orientation doc, so
// the migration must move exactly that one file and leave every other paper in the folder in place.
const LEGACY_CODE_STYLE = '# Code style\nlegacy content, byte for byte\n';
const LEGACY_ASSESSMENT = '# Assessment\nlegacy content, byte for byte\n';
const LEGACY_RELATED = '# Related\nlegacy content, byte for byte\n';
function seedLegacyDocsLayout(sb, docsPath = '.claude/docs')
{
    const base = path.join(sb.repo, docsPath);
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'PROJECT-CODE-STYLE.md'), LEGACY_CODE_STYLE);
    fs.mkdirSync(path.join(base, 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(base, 'architecture', 'ASSESSMENT.md'), LEGACY_ASSESSMENT);
    fs.mkdirSync(path.join(base, 'related-context', 'frontend-run-recipe'), { recursive: true });
    fs.writeFileSync(path.join(base, 'related-context', 'PROJECT-RELATED-CONTEXT.md'), LEGACY_RELATED);
    // three sibling-repo working papers that are NOT the orientation doc - the negative proof
    fs.writeFileSync(path.join(base, 'related-context', 'backend-change-request.md'), '# CR\n');
    fs.writeFileSync(path.join(base, 'related-context', 'shared-contracts-notes.md'), '# Notes\n');
    fs.writeFileSync(path.join(base, 'related-context', 'frontend-run-recipe', 'RECIPE.md'), '# Recipe\n');
    return base;
}
function assertMigrated(base, twin)
{
    assert.ok(!fs.existsSync(path.join(base, 'PROJECT-CODE-STYLE.md')), `${twin}: old code-style path removed`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'code-style', 'CODE-STYLE.md'), 'utf8'), LEGACY_CODE_STYLE, `${twin}: code-style content byte-identical after the move`);
    assert.ok(!fs.existsSync(path.join(base, 'architecture', 'ASSESSMENT.md')), `${twin}: old assessment path removed`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'quality', 'ASSESSMENT.md'), 'utf8'), LEGACY_ASSESSMENT, `${twin}: assessment content byte-identical after the move`);
    assert.ok(!fs.existsSync(path.join(base, 'related-context', 'PROJECT-RELATED-CONTEXT.md')), `${twin}: old orientation doc removed`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'related-projects', 'RELATED-PROJECTS.md'), 'utf8'), LEGACY_RELATED, `${twin}: related-projects content byte-identical after the move`);
    // the negative proof: every OTHER file in related-context/ is untouched, in place
    assert.strictEqual(fs.readFileSync(path.join(base, 'related-context', 'backend-change-request.md'), 'utf8'), '# CR\n', `${twin}: an unrelated working paper changed`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'related-context', 'shared-contracts-notes.md'), 'utf8'), '# Notes\n', `${twin}: an unrelated working paper changed`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'related-context', 'frontend-run-recipe', 'RECIPE.md'), 'utf8'), '# Recipe\n', `${twin}: a nested working paper changed`);
    assert.deepStrictEqual(fs.readdirSync(path.join(base, 'related-context')).sort(), ['backend-change-request.md', 'frontend-run-recipe', 'shared-contracts-notes.md'], `${twin}: related-context/ holds exactly the three untouched working papers`);
    // Task 16: a moved doc's folder is switched on as a domain - the minimal watch.json, the one the engine reads as
    // declaring nothing - and the two watch-less folders stay watch-less, since a watch.json is what makes a domain.
    for (const d of ['code-style', 'related-projects']) assert.strictEqual(fs.readFileSync(path.join(base, d, 'watch.json'), 'utf8'), '{}\n', `${twin}: ${d}/ switched on with the minimal watch.json`);
    for (const d of ['quality', 'related-context']) assert.ok(!fs.existsSync(path.join(base, d, 'watch.json')), `${twin}: ${d}/ must never become a domain`);
}
function assertDocsMigration(sb, run, twin)
{
    run(sb, 'install');   // an install predating the domain layout - no legacy docs yet
    const base = seedLegacyDocsLayout(sb);   // simulate that older install's captured docs
    const out = run(sb, 'update');
    assert.match(out, /docs migration \(code style\): PROJECT-CODE-STYLE\.md ->/, `${twin}: the rename is reported, not just the move`);
    for (const d of ['code-style', 'related-projects']) assert.match(out, new RegExp(`docs domain: ${d}/ switched on - watch\\.json written`), `${twin}: the switch-on of ${d}/ is reported`);
    assert.doesNotMatch(out, /docs domain: (quality|related-context)\//, `${twin}: the watch-less folders are never switched on`);
    assertMigrated(base, twin);
    // idempotent: a second update changes nothing further and errors on nothing
    const before = {
        cs: fs.readFileSync(path.join(base, 'code-style', 'CODE-STYLE.md'), 'utf8'),
        asmt: fs.readFileSync(path.join(base, 'quality', 'ASSESSMENT.md'), 'utf8'),
        rel: fs.readFileSync(path.join(base, 'related-projects', 'RELATED-PROJECTS.md'), 'utf8'),
    };
    assert.doesNotMatch(run(sb, 'update'), /docs domain:/, `${twin}: a second run switches nothing on again`);
    assertMigrated(base, twin);
    assert.strictEqual(fs.readFileSync(path.join(base, 'code-style', 'CODE-STYLE.md'), 'utf8'), before.cs, `${twin}: a second run left code-style untouched`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'quality', 'ASSESSMENT.md'), 'utf8'), before.asmt, `${twin}: a second run left quality untouched`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'related-projects', 'RELATED-PROJECTS.md'), 'utf8'), before.rel, `${twin}: a second run left related-projects untouched`);
}
test('sh: update migrates the pre-domain doc layout absent-only, byte-identical, and is idempotent', () => {
    const sb = sandbox();
    try { assertDocsMigration(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: update migrates the pre-domain doc layout absent-only, byte-identical, and is idempotent (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertDocsMigration(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// A fresh install has no legacy files at all - the migration must be a quiet no-op, never
// fabricating the new folders or files out of nothing.
function assertFreshInstallNoOp(sb, run, twin)
{
    run(sb, 'install');
    const base = path.join(sb.repo, '.claude', 'docs');
    assert.ok(!fs.existsSync(path.join(base, 'code-style')), `${twin}: no code-style folder invented on a fresh install`);
    assert.ok(!fs.existsSync(path.join(base, 'quality')), `${twin}: no quality folder invented on a fresh install`);
    assert.ok(!fs.existsSync(path.join(base, 'related-projects')), `${twin}: no related-projects folder invented on a fresh install`);
}
test('sh: a fresh install performs no docs migration', () => {
    const sb = sandbox();
    try { assertFreshInstallNoOp(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: a fresh install performs no docs migration (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertFreshInstallNoOp(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// A project already carrying ITS OWN file at the new path (hand-written, or already captured
// under the new layout) must never be clobbered - the old orphan is left exactly as it was rather
// than silently deleted or overwritten.
function assertNeverClobbers(sb, run, twin)
{
    run(sb, 'install');
    const base = seedLegacyDocsLayout(sb);
    const mine = '# Code style\nthe project\'s own, already at the new path\n';
    fs.mkdirSync(path.join(base, 'code-style'), { recursive: true });
    fs.writeFileSync(path.join(base, 'code-style', 'CODE-STYLE.md'), mine);
    const out = run(sb, 'update');
    assert.strictEqual(fs.readFileSync(path.join(base, 'code-style', 'CODE-STYLE.md'), 'utf8'), mine, `${twin}: the file already at the new path was overwritten`);
    assert.strictEqual(fs.readFileSync(path.join(base, 'PROJECT-CODE-STYLE.md'), 'utf8'), LEGACY_CODE_STYLE, `${twin}: the old file was deleted instead of left as the visible orphan`);
    assert.match(out, /already exists.*PROJECT-CODE-STYLE\.md left in place, nothing overwritten/, `${twin}: the collision is reported, not silent`);
}
test('sh: a file already at the new path is never clobbered - the old one is left in place', () => {
    const sb = sandbox();
    try { assertNeverClobbers(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: a file already at the new path is never clobbered - the old one is left in place (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertNeverClobbers(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Missing or malformed settings.json must still resolve the default docs root and migrate there,
// the same fail-soft-to-default behaviour Set-DocsRootStamp / stamp_docs_root_rule already pin.
function assertMigratesOnMalformedSettings(sb, run, twin)
{
    run(sb, 'install');
    fs.writeFileSync(path.join(sb.repo, '.claude', 'settings.json'), '{broken');
    const base = seedLegacyDocsLayout(sb);   // at the default .claude/docs path
    run(sb, 'update');
    assertMigrated(base, twin);
}
test('sh: malformed settings.json still resolves the default docs root and migrates', () => {
    const sb = sandbox();
    try { assertMigratesOnMalformedSettings(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: malformed settings.json still resolves the default docs root and migrates (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertMigratesOnMalformedSettings(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Found by the temp-project matrix: the migration moved three docs onto the domain layout, and the
// installers' own next-steps log - printed on EVERY install and update, to the one reader who has not
// captured anything yet - still sent them to the paths the migration had just emptied. The
// related-context line is the costly one: that folder survives as the plain drop box for sibling-repo
// working papers, so the text pointed the adopter's orientation doc at a folder the engine
// deliberately never reads. The skill descriptions and the HTML inventory were both re-pointed;
// only the two twins' log text and their manifest comments were left behind, which is exactly the
// parity gap the source-of-truth rule exists to catch. Asserted on the OUTPUT, not on the source, so
// it holds however the line is composed.
const RETIRED_DOC_PATHS = ['PROJECT-CODE-STYLE.md', 'PROJECT-RELATED-CONTEXT.md'];
function assertNextStepsNamesTheDomainPaths(sb, run, twin)
{
    for (const action of ['install', 'update'])
    {
        const out = run(sb, action);
        assert.match(out, /related-projects\/RELATED-PROJECTS\.md under the docs root/, `${twin} (${action}): the related-projects capture is named at its domain path`);
        assert.match(out, /code-style\/CODE-STYLE\.md under the docs root/, `${twin} (${action}): the code-style capture is named at its domain path`);
        for (const retired of RETIRED_DOC_PATHS) assert.ok(!out.includes(retired), `${twin} (${action}): the next steps still name the retired path ${retired}`);
        assert.ok(!/related-context\/[A-Z]/.test(out), `${twin} (${action}): the drop box is never named as the home of a captured doc`);
    }
}
test('sh: the next steps name each capture doc at its domain path, never the retired one', () => {
    const sb = sandbox();
    try { assertNextStepsNamesTheDomainPaths(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: the next steps name each capture doc at its domain path, never the retired one (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertNextStepsNamesTheDomainPaths(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Found by the temp-project matrix: a settings.json whose top level is a JSON ARRAY (or a string,
// number or boolean) PARSES. The sh twin refuses that shape outright; the ps1 twin only checked for
// null, so every Add-Member in Set-HookSettings ran against each ELEMENT of the array - the second one
// threw 'member already exists' and, under $ErrorActionPreference 'Stop', aborted the whole run before
// Move-DocsDomains, leaving a half-finished install whose docs were never migrated. Both twins must
// warn, exit 0, leave the file exactly as it was, and still complete every later step.
// '-is [pscustomobject]' cannot make this call: PowerShell wraps a plain value in a PSObject, so it
// answers True for a String, an Int64 and a Boolean (measured, pwsh 7.6.3) - the .NET type is the test.
const NON_OBJECT_SETTINGS = ['[1,2,3]', '"text"', '123', 'true', '[]', 'null'];
// Both streams: each twin reports the refusal on a different one (the sh python writes the diagnosis
// to stderr and logs 'wiring failed' on stdout; Write-Warning is stderr too), and the point of the
// test is that the run SURVIVES, which only an exit status can show.
const runBoth = (sb, twin, action) =>
{
    const r = twin === 'sh'
        ? spawnSync('bash', [SH, action, '--scope', 'project', '--selection', sb.sel, '--source', ROOT], { cwd: sb.repo, encoding: 'utf8', env: sb.env })
        : spawnSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', 'project', '-Selection', sb.sel, '-Source', ROOT], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
function assertNonObjectSettingsIsRefusedNotFatal(twin)
{
    for (const body of NON_OBJECT_SETTINGS)
    {
        const sb = sandbox();
        try
        {
            runBoth(sb, twin, 'install');
            fs.writeFileSync(path.join(sb.repo, '.claude', 'settings.json'), body);
            const base = seedLegacyDocsLayout(sb);
            const r = runBoth(sb, twin, 'update');
            assert.strictEqual(r.status, 0, `${twin}: ${body} aborted the run (status ${r.status})`);
            assert.match(r.out, /settings\.json top level is not an object - left untouched/, `${twin}: ${body} is diagnosed as a non-object`);
            assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8'), body, `${twin}: ${body} - the file was rewritten`);
            // the run carried on: every step after the settings pass still did its work
            assertMigrated(base, `${twin} (${body})`);
        }
        finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
    }
}
test('sh: a settings.json that parses but is not an object is refused without failing the run', () => assertNonObjectSettingsIsRefusedNotFatal('sh'));
test('ps1: a settings.json that parses but is not an object is refused without failing the run (pwsh required)', { skip: skipNoPwsh }, () => assertNonObjectSettingsIsRefusedNotFatal('ps1'));

// Task 16, part 2: the switch-on is keyed on the doc sitting at its NEW path, not on this run having moved it, so an
// install an EARLIER release already migrated - docs in code-style/ and related-projects/, no watch.json in either -
// is switched on too, and the engine then lists both as domains and lints clean. A watch.json already there is the
// project's (or the capture's) and is never touched, whatever it holds - even text that is not JSON.
const DOCS_JS = path.join(ROOT, 'stack', 'hooks', 'docs.js');
const engineIn = (sb, script) => spawnSync(process.execPath, ['-e', script], { cwd: sb.repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: sb.repo, CLAUDE_STACK_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '' } });
function assertSwitchOnWithoutAMove(sb, run, twin)
{
    run(sb, 'install');
    const base = path.join(sb.repo, '.claude', 'docs');
    for (const [rel, text] of [['code-style/CODE-STYLE.md', LEGACY_CODE_STYLE], ['related-projects/RELATED-PROJECTS.md', LEGACY_RELATED],
        ['quality/ASSESSMENT.md', LEGACY_ASSESSMENT], ['related-context/backend-change-request.md', '# CR\n']])
    {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), text);
    }
    const out = run(sb, 'update');
    assert.doesNotMatch(out, /docs migration/, `${twin}: nothing was moved this run`);
    for (const d of ['code-style', 'related-projects']) assert.strictEqual(fs.readFileSync(path.join(base, d, 'watch.json'), 'utf8'), '{}\n', `${twin}: ${d}/ switched on although this run moved nothing`);
    for (const d of ['quality', 'related-context']) assert.ok(!fs.existsSync(path.join(base, d, 'watch.json')), `${twin}: ${d}/ must never become a domain`);
    const domains = engineIn(sb, `process.stdout.write(require(${JSON.stringify(DOCS_JS)}).domains().join(','))`);
    assert.strictEqual(domains.stdout, 'code-style,related-projects', `${twin}: the engine lists exactly the two switched-on domains`);
    const lint = spawnSync(process.execPath, [DOCS_JS, 'lint'], { cwd: sb.repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: sb.repo, CLAUDE_STACK_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '' } });
    assert.strictEqual(lint.status, 0, `${twin}: docs.js lint is clean on the result\n${lint.stdout}`);
    // a watch.json already there is never touched - the capture's real entries, and a file that is not even JSON
    const theirs = { 'code-style': '{ "sourceRoots": ["app"], "watch": [] }\n', 'related-projects': '{ not json' };
    for (const [d, text] of Object.entries(theirs)) fs.writeFileSync(path.join(base, d, 'watch.json'), text);
    assert.doesNotMatch(run(sb, 'update'), /docs domain:/, `${twin}: nothing is switched on over an existing watch.json`);
    for (const [d, text] of Object.entries(theirs)) assert.strictEqual(fs.readFileSync(path.join(base, d, 'watch.json'), 'utf8'), text, `${twin}: ${d}/watch.json byte-identical`);
}
test('sh: update switches on a code-style/ or related-projects/ an earlier run migrated, and never touches a watch.json already there', () => {
    const sb = sandbox();
    try { assertSwitchOnWithoutAMove(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: update switches on a code-style/ or related-projects/ an earlier run migrated, and never touches a watch.json already there (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertSwitchOnWithoutAMove(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// Task 16, part 1: --docs-versioning / -DocsVersioning WRITES the value over an existing one and names the old and the
// new value in one line; a re-run with the same value changes nothing; a run without it never touches the key; and a
// value that is neither 'git' nor 'local' - an empty one included - is refused BEFORE the installer writes anything.
function assertVersioningFlag(twin)
{
    const run = twin === 'sh' ? runSh : runPs;
    const flag = (v) => (twin === 'sh' ? ['--docs-versioning', v] : ['-DocsVersioning', v]);
    const spelled = twin === 'sh' ? '--docs-versioning' : '-DocsVersioning';
    const line = (from, to, same = false) => `settings.json env: CLAUDE_STACK_DOCS_VERSIONING ${from} -> '${to}' (${spelled}${same ? ', unchanged' : ''})`;
    const file = (sb) => path.join(sb.repo, '.claude', 'settings.json');
    const sb = sandbox();
    const bad = sandbox();
    try
    {
        assert.ok(run(sb, 'install').includes('CLAUDE_STACK_DOCS_VERSIONING seeded (git)'), `${twin}: a fresh project is seeded git`);
        const out = run(sb, 'update', flag('local'));
        assert.ok(out.includes(line("'git'", 'local')), `${twin}: the override names the old and the new value\n${out.split('\n').filter((l) => l.includes('VERSIONING')).join('\n')}`);
        assert.strictEqual(projectEnv(sb).CLAUDE_STACK_DOCS_VERSIONING, 'local', `${twin}: and the value landed`);
        const before = fs.readFileSync(file(sb));
        assert.ok(run(sb, 'update', flag('LOCAL')).includes(line("'local'", 'local', true)), `${twin}: the same value again is reported unchanged (read case-insensitively)`);
        assert.ok(fs.readFileSync(file(sb)).equals(before), `${twin}: and settings.json is byte-identical`);
        assert.ok(!run(sb, 'update').includes('settings.json env: CLAUDE_STACK_DOCS_VERSIONING'), `${twin}: without the flag the key is left alone`);
        assert.strictEqual(projectEnv(sb).CLAUDE_STACK_DOCS_VERSIONING, 'local', `${twin}: still the chosen value`);
        const data = JSON.parse(fs.readFileSync(file(sb), 'utf8'));
        delete data.env.CLAUDE_STACK_DOCS_VERSIONING;
        fs.writeFileSync(file(sb), `${JSON.stringify(data, null, 2)}\n`);
        assert.ok(run(sb, 'update', flag('git')).includes(line('absent', 'git')), `${twin}: an absent key is written and reported as absent`);
        // refused before anything is written: the settings file byte-identical, no hook copied, no docs moved
        const snap = fs.readFileSync(file(bad));
        for (const v of ['maybe', ''])
        {
            const args = twin === 'sh'
                ? ['bash', [SH, 'install', '--scope', 'project', '--selection', bad.sel, '--source', ROOT, ...flag(v)]]
                : ['pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', bad.sel, '-Source', ROOT, ...flag(v)]];
            const r = spawnSync(args[0], args[1], { cwd: bad.repo, encoding: 'utf8', env: bad.env });
            assert.notStrictEqual(r.status, 0, `${twin}: '${v}' is refused`);
            assert.match(`${r.stdout}${r.stderr}`, v ? /must be 'git' or 'local'/ : /needs a value|must be 'git' or 'local'/, `${twin}: and the refusal says why`);
            assert.ok(fs.readFileSync(file(bad)).equals(snap), `${twin}: settings.json byte-identical after '${v}'`);
            assert.deepStrictEqual(fs.readdirSync(path.join(bad.repo, '.claude')), ['settings.json'], `${twin}: nothing else was written after '${v}'`);
        }
    }
    finally { for (const x of [sb, bad]) fs.rmSync(x.work, { recursive: true, force: true }); }
}
test('sh: --docs-versioning writes over the existing value, names old and new, and a bad value is refused before any write', () => assertVersioningFlag('sh'));
test('ps1: -DocsVersioning writes over the existing value, names old and new, and a bad value is refused before any write (pwsh required)', { skip: skipNoPwsh }, () => assertVersioningFlag('ps1'));

// A doc an OLDER capture wrote carries no section ids, so once update switches its folder on, `docs.js lint` flags every
// section - measured on a realistic pre-domains CODE-STYLE.md. The installer does not rewrite the project's docs to hide
// that (seed-ids would touch every domain); it SAYS so on the switch-on line, and the engine's own remedy then lints
// clean. The line is composed on a branch no other test reaches, and a slip there aborts the whole sh install under
// `set -e` - measured: `note " ..."` without the `=` passed `bash -n` and would have run as a command.
function assertLegacySectionsHint(sb, run, twin)
{
    run(sb, 'install');
    const base = path.join(sb.repo, '.claude', 'docs');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'PROJECT-CODE-STYLE.md'), 'Captured: main@abc1234, 2026-08-01\n\n# Project code style\n\n## TypeScript\nSingle quotes.\n\n## C#\nFile-scoped namespaces.\n');
    fs.mkdirSync(path.join(base, 'related-projects'), { recursive: true });
    fs.writeFileSync(path.join(base, 'related-projects', 'RELATED-PROJECTS.md'), '# Related\n\n## backend-api\n<!-- id: backend-api -->\nConsumes its REST API.\n');
    const out = run(sb, 'update');
    // '\r?\n': pwsh on Windows ends every line it writes with CRLF; the anchor only proves nothing follows on the line.
    assert.match(out, /docs domain: code-style\/ switched on - .* - its sections predate section ids, so 'docs\.js lint' flags them until 'node \.claude\/hooks\/docs\.js seed-ids'/, `${twin}: the id-less doc is named on its switch-on line`);
    assert.match(out, /docs domain: related-projects\/ switched on - watch\.json written \(\{\}; the capture's next run fills in its entries\)\r?\n/, `${twin}: a doc that already carries ids gets no hint`);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: sb.repo, CLAUDE_STACK_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '' };
    const lint = () => spawnSync(process.execPath, [DOCS_JS, 'lint'], { cwd: sb.repo, encoding: 'utf8', env });
    const red = lint();
    assert.strictEqual(red.status, 1, `${twin}: lint flags the id-less sections`);
    assert.deepStrictEqual(red.stdout.split('\n').filter((l) => l.startsWith('PROBLEM')).map((l) => l.replace(/'.*/, '')), ['PROBLEM section without an id: CODE-STYLE ', 'PROBLEM section without an id: CODE-STYLE '], `${twin}: and nothing else`);
    spawnSync(process.execPath, [DOCS_JS, 'seed-ids'], { cwd: sb.repo, encoding: 'utf8', env });
    assert.strictEqual(lint().status, 0, `${twin}: the named remedy lints clean`);
}
test('sh: a switched-on doc that predates section ids is named on the switch-on line, and seed-ids lints it clean', () => {
    const sb = sandbox();
    try { assertLegacySectionsHint(sb, runSh, 'sh'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
test('ps1: a switched-on doc that predates section ids is named on the switch-on line, and seed-ids lints it clean (pwsh required)', { skip: skipNoPwsh }, () => {
    const sb = sandbox();
    try { assertLegacySectionsHint(sb, runPs, 'ps1'); }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
