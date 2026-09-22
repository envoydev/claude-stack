'use strict';
// The installers' memory MCP registration, at a chosen level, plus the one-time import of Claude's
// own auto-memory notes and the autoMemoryEnabled switch-off. Stub-CLI pattern shared with
// scripts/mcp-verify.test.js: a `claude` binary that logs every call and does nothing (the real CLI's
// `mcp add` silent-no-op on an existing name), and (new here) a `uvx` binary that answers --version
// directly and otherwise forwards straight to scripts/fixtures/fake-memory-server.js - the memory
// entry's OWN registration always names `uvx ...` (the project-scope verify pass writes that shape
// into .mcp.json directly, independent of whether the stub `claude mcp add` did anything), so this is
// what memory-import.js actually spawns when it reads the entry back. No model download, ever.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slugify } = require('./memory-import.js');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const FAKE_SERVER = path.join(ROOT, 'scripts', 'fixtures', 'fake-memory-server.js');
const MEMORY_SCHEMA = path.join(ROOT, 'scripts', 'fixtures', 'memory-schema.sql');
const RECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
// the hook catalog the installer manifest ships, read from the manifest itself
const ALL_SHIPPED_HOOKS = [...new Set([...fs.readFileSync(SH, 'utf8').matchAll(/^\s*"([a-z0-9-]+)\.js::/gm)].map((m) => m[1]))];

const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';
const TWINS = ['sh', 'ps1'];

// The real (long-name) temp dir: a Windows runner's os.tmpdir() is the 8.3 short form (C:\Users\RUNNER~1),
// while git - and so every project path the installers build - answers with the long one; a path built
// from the short form never matches the same directory spelled by git.
function mkTmp(prefix) { return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix)); }

// The auto-memory folder name for a sandbox's repo: the MAIN checkout root (git-common-dir, '.git'
// stripped - a worktree shares its main repo's folder), slugged by the importer's OWN slugify, so a
// temp path holding '_', '.' or a drive letter's ':' seeds exactly the folder the importer reads.
function gitTopSlug(repo)
{
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const top = path.basename(common) === '.git' ? path.dirname(common) : common;
    return { top, slug: slugify(top) };
}

// A db path is built with ONE separator style. On POSIX a backslash is always the bug (a hard-coded
// Windows separator glued on - the cursor-stack port's bug); on Windows backslashes are native, and
// the bug to catch there is a MIXED path (git's forward-slash output joined with Join-Path).
function assertOneSeparatorStyle(p, msg)
{
    if (process.platform === 'win32') assert.ok(!(p.includes('/') && p.includes('\\')), `${msg}: mixed separators in ${p}`);
    else assert.ok(!p.includes('\\'), `${msg}: a literal backslash leaked into ${p}`);
}

// Windows: the importer starts the registered `uvx` with node's spawn, which - like Claude Code launching
// the server - resolves only a .exe/.com on PATH, never a .cmd (measured on windows-latest: 'spawn uvx
// ENOENT' with a uvx.cmd stub). A real uv install ships uvx.exe, so the stub is a real exe too, compiled
// once per run by the .NET Framework C# compiler every Windows install carries. '--version' answers
// directly; anything else runs the fake-memory-launch.js beside the exe under this node, which inherits
// the stub's stdin/stdout (no STARTF_USESTDHANDLES, so a console child takes its parent's handles).
let uvxStubExe = null;
function windowsUvxStub()
{
    if (uvxStubExe) return uvxStubExe;
    const winDir = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const csc = ['Framework64', 'Framework'].map((f) => path.join(winDir, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')).find((p) => fs.existsSync(p));
    if (!csc) throw new Error(`no .NET Framework csc.exe under ${winDir}\\Microsoft.NET - the uvx.exe stub the memory importer spawns cannot be built`);
    const dir = mkTmp('instmem-uvx-');
    sharedFixtureDirs.push(dir);
    const src = path.join(dir, 'uvx.cs');
    fs.writeFileSync(src, [
        'using System;',
        'using System.Diagnostics;',
        'using System.IO;',
        'static class UvxStub',
        '{',
        '    static int Main(string[] args)',
        '    {',
        '        foreach (string a in args) { if (a == "--version") { Console.WriteLine("uvx 0.0.0 (stub)"); return 0; } }',
        '        string launcher = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fake-memory-launch.js");',
        `        ProcessStartInfo psi = new ProcessStartInfo(@"${process.execPath.replace(/"/g, '""')}", "\\"" + launcher + "\\"");`,
        '        psi.UseShellExecute = false;',
        '        using (Process p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }',
        '    }',
        '}',
        ''].join('\r\n'));
    const exe = path.join(dir, 'uvx.exe');
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, src], { stdio: 'pipe' });
    uvxStubExe = exe;
    return exe;
}

// A sandboxed HOME/account/project, with `claude` and `uvx` stubbed on PATH. Mirrors
// scripts/mcp-verify.test.js's sandbox(); adds the uvx-forwards-to-the-fake-server piece and optional
// pre-seeded .mcp.json / settings.json content for the 'untouched' and 'malformed' cases.
function sandbox(opts = {})
{
    const work = mkTmp('instmem-');
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const home = path.join(work, 'home');
    fs.mkdirSync(home);
    const acct = path.join(work, 'acct');
    fs.mkdirSync(acct);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(work, 'claude-calls.log');
    const plugins = path.join(work, 'plugins.json');
    fs.writeFileSync(plugins, '[]');
    fs.writeFileSync(path.join(bin, 'claude'), [
        '#!/bin/sh',
        'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
        'exit 0',
        ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), [
        '@echo off',
        '>>"%CLAUDE_STUB_LOG%" echo %*',
        'if "%~1"=="plugin" if "%~2"=="list" type "%CLAUDE_STUB_PLUGINS%"',
        'exit /b 0',
        ''].join('\r\n'));
    // uvx stub: `--version` (the prerequisites-check probe) answers directly - the real invocation
    // never returns until stdin closes, so falling through to the fake server there would hang every
    // run. Anything else runs the fake memory server through a launcher; this only ever actually runs
    // when memory-import.js spawns the registered `memory` entry (`claude mcp add` is metadata-only,
    // never spawns the command it registers). The importer passes the registration's env, so the
    // launcher sees the REGISTERED MCP_MEMORY_SQLITE_PATH: it creates that db from the fixture schema
    // when absent (the real server creates its own on first start), and the fake server then writes a
    // live row per store there - the row the importer re-opens the file to confirm.
    const launcher = path.join(bin, 'fake-memory-launch.js');
    fs.writeFileSync(launcher, [
        '\'use strict\';',
        'const fs = require(\'node:fs\');',
        'const path = require(\'node:path\');',
        'const db = process.env.MCP_MEMORY_SQLITE_PATH;',
        'if (db && !fs.existsSync(db))',
        '{',
        '    fs.mkdirSync(path.dirname(db), { recursive: true });',
        '    const { DatabaseSync } = require(\'node:sqlite\');',
        '    const d = new DatabaseSync(db);',
        `    d.exec(fs.readFileSync(${JSON.stringify(MEMORY_SCHEMA)}, 'utf8'));`,
        '    d.close();',
        '}',
        `require(${JSON.stringify(FAKE_SERVER)});`,
        ''].join('\n'));
    fs.writeFileSync(path.join(bin, 'uvx'), [
        '#!/bin/sh',
        'case "$*" in *--version*) echo "uvx 0.0.0 (stub)"; exit 0 ;; esac',
        `exec node "${launcher}"`,
        ''].join('\n'), { mode: 0o755 });
    if (process.platform === 'win32') fs.copyFileSync(windowsUvxStub(), path.join(bin, 'uvx.exe'));
    const npxLog = path.join(work, 'npx-calls.log');
    fs.writeFileSync(path.join(bin, 'npx'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$NPX_STUB_LOG"', 'exit 0', ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'npx.cmd'), ['@echo off', '>>"%NPX_STUB_LOG%" echo %*', 'exit /b 0', ''].join('\r\n'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, opts.selection || 'skill markdown-style\nrule markdown-docs\nrule baseline-memory\nhook memory-session\nmcp memory\n');
    if (opts.mcpServers) fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: opts.mcpServers }, null, 2) + '\n');
    if (opts.mcpJsonRaw !== undefined) fs.writeFileSync(path.join(repo, '.mcp.json'), opts.mcpJsonRaw);
    if (opts.settings || opts.settingsRaw !== undefined) fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    if (opts.settings) fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify(opts.settings, null, 2) + '\n');
    if (opts.settingsRaw !== undefined) fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), opts.settingsRaw);
    const db = path.join(work, 'fake-db.json');
    const callsLog = path.join(work, 'calls.jsonl');
    const env = {
        ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: acct,
        PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: plugins,
        // These cases read the hooks the installer COPIES, which still ship behind the Phase 2
        // switch; the plugin route (the default) is proven in installer-settings.test.js.
        CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false',
        // Likewise the memory REGISTRATION: from Phase 6 the server rides the `memory@claude-stack`
        // plugin and this installer writes no .mcp.json entry at all. The registration shape (the
        // [sqlite] extra, the pins, the db path the level resolved) is still what these cases prove,
        // so they pin the copy route; the plugin route is proven in mcp-verify.test.js and by the
        // CLAUDE_STACK_MEMORY_DB key the settings-env pass writes for the plugin's launcher.
        // The skills switch goes with it: the three LOCKED servers are hard dependencies of the core
        // plugin entry, so while any plugin route is on the core carries them and the installer
        // deliberately registers none of them (registering as well would run each one twice). The
        // full copy route is the only place a memory REGISTRATION exists to assert on. The selection
        // file keeps the copies down to one skill, so this costs nothing.
        CLAUDE_STACK_MCPS_VIA_PLUGIN: 'false',
        CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false',
        NPX_STUB_LOG: npxLog,
        FAKE_MEMORY_DB: db, FAKE_MEMORY_CALLS_LOG: callsLog,
    };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'SCOPE']) delete env[k];
    if (opts.failContent) env.FAKE_MEMORY_FAIL_CONTENT = opts.failContent;
    if (opts.ghostWrite) env.FAKE_MEMORY_SKIP_SQLITE_WRITE = '1';
    return { work, repo, home, acct, sel, env, log, db, callsLog };
}

function seedNote(sb, filename, { name, description, type, body }, configDir = sb.acct)
{
    const { slug } = gitTopSlug(sb.repo);
    const memDir = path.join(configDir, 'projects', slug, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const lines = ['---', `name: ${name}`];
    if (description !== undefined) lines.push(`description: ${description}`);
    lines.push('metadata:', `  type: ${type}`, '---', '', body);
    fs.writeFileSync(path.join(memDir, filename), `${lines.join('\n')}\n`);
}
const seedOneNote = (sb, configDir) => seedNote(sb, 'feedback-test-note.md', { name: 'feedback-test-note', description: 'A test correction', type: 'feedback', body: 'Body text of the note.' }, configDir);

// opts.cwd runs from another directory (a worktree); opts.env swaps the environment (CLAUDE_CONFIG_DIR unset).
function run(twin, sb, action, args = [], scope = 'project', opts = {})
{
    const cwd = opts.cwd || sb.repo;
    const env = opts.env || sb.env;
    if (twin === 'sh')
    {
        return execFileSync('bash', [SH, action, '--scope', scope, '--selection', sb.sel, '--source', ROOT, ...args],
            { cwd, encoding: 'utf8', env });
    }
    return execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', scope, '-Selection', sb.sel, '-Source', ROOT, ...args],
        { cwd, encoding: 'utf8', env });
}

// The update fast path: no selection, the set derived from what is on disk.
function runInstalledOnly(twin, sb, args = [])
{
    if (twin === 'sh')
    {
        return execFileSync('bash', [SH, 'update', '--scope', 'project', '--installed-only', '--source', ROOT, ...args],
            { cwd: sb.repo, encoding: 'utf8', env: sb.env });
    }
    return execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'update', '-Scope', 'project', '-InstalledOnly', '-Source', ROOT, ...args],
        { cwd: sb.repo, encoding: 'utf8', env: sb.env });
}

function runExpectFail(twin, sb, action, args = [])
{
    const bin = twin === 'sh' ? 'bash' : 'pwsh';
    const fullArgs = twin === 'sh'
        ? [SH, action, '--source', ROOT, ...args]
        : ['-NoProfile', '-File', PS1, action, '-Source', ROOT, ...args];
    const res = spawnSync(bin, fullArgs, { cwd: sb.repo, encoding: 'utf8', env: sb.env });
    return res;
}

// A PRE-FEATURE install, the shape every consuming project has before this release: the six old
// baseline rules plus markdown-docs, one hook, serena + context7 in .mcp.json, NO memory server and NO
// baseline-memory.md, and a stamp whose hook catalog predates memory-session and which carries no
// always-set keys. `stampExtra` appends lines to that stamp.
const PRE_FEATURE_RULES = ['baseline-interaction', 'baseline-quality-gates', 'baseline-security', 'baseline-git', 'baseline-navigation', 'baseline-docs-root', 'markdown-docs'];
function preFeatureInstall(sb, { stampExtra = '' } = {})
{
    const c = (p) => fs.mkdirSync(path.join(sb.repo, p), { recursive: true });
    c('.claude/rules'); c('.claude/hooks'); c('.claude/skills/markdown-style');
    for (const r of PRE_FEATURE_RULES) fs.copyFileSync(path.join(ROOT, 'stack', 'rules', `${r}.md`), path.join(sb.repo, '.claude', 'rules', `${r}.md`));
    fs.copyFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-catastrophic-rm.js'), path.join(sb.repo, '.claude', 'hooks', 'guard-catastrophic-rm.js'));
    fs.copyFileSync(path.join(ROOT, 'stack', 'skills', 'markdown-style', 'SKILL.md'), path.join(sb.repo, '.claude', 'skills', 'markdown-style', 'SKILL.md'));
    fs.writeFileSync(path.join(sb.repo, '.mcp.json'), JSON.stringify({ mcpServers: {
        serena: { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent@0.1.0', 'serena', 'start-mcp-server'] },
        context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
    } }, null, 2) + '\n');
    // every other shipped hook reads as a deliberate drop, so the run adopts only memory-session
    const preHooks = ALL_SHIPPED_HOOKS.filter((h) => h !== 'memory-session');
    fs.writeFileSync(path.join(sb.repo, '.claude', 'claude-stack.stamp'), `sha: aaa\nversion: 0.2.85\nshipped-hooks: ${preHooks.join(',')}\n${stampExtra}`);
}

// The stamp's record of the locked baseline this install ACTUALLY carries: the always rules with a
// file under .claude/rules and the always servers registered in .mcp.json, in the release's order.
const stampOf = (sb) => fs.readFileSync(path.join(sb.repo, '.claude', 'claude-stack.stamp'), 'utf8');
function expectedInstalledAlways(sb)
{
    const servers = fs.existsSync(path.join(sb.repo, '.mcp.json')) ? mcpServers(sb) : {};
    return {
        rules: RECS.always.rules.filter((r) => fs.existsSync(path.join(sb.repo, '.claude', 'rules', `${r}.md`))).join(','),
        mcps: RECS.always.mcps.filter((m) => hasKey(servers, m)).join(','),
    };
}
function assertStampRecordsDisk(twin, sb, when)
{
    const stamp = stampOf(sb);
    const want = expectedInstalledAlways(sb);
    assert.doesNotMatch(stamp, /^shipped-always-/m, `${twin} ${when}: the stamp still records the SHIPPED always list:\n${stamp}`);
    assert.ok(stamp.includes(`installed-always-rules: ${want.rules}\n`), `${twin} ${when}: the stamp's always rules are not what is on disk (${want.rules}):\n${stamp}`);
    assert.ok(stamp.includes(`installed-always-mcps: ${want.mcps}\n`), `${twin} ${when}: the stamp's always servers are not what is registered (${want.mcps}):\n${stamp}`);
}

// Shared fixtures are built once, on first use, and removed when the whole file is done. The hook is
// registered HERE, at module level: a `test.after` called inside a test runs when THAT test ends, and
// the next twin's test then read a deleted fixture.
const sharedFixtureDirs = [];
test.after(() => { for (const d of sharedFixtureDirs) fs.rmSync(d, { recursive: true, force: true }); });

// The STANDALONE route (README: `bash .claude/claude-stack.sh update --installed-only`): the script
// sits in a directory with no meta/ beside it and no --source, so it fetches its own snapshot - here
// the clone fallback from a local repo whose main IS this HEAD (the archive URL does not exist).
let standaloneRepo = null;
function standaloneSource()
{
    if (standaloneRepo) return standaloneRepo;
    const dir = mkTmp('instmem-standalone-src-');
    standaloneRepo = path.join(dir, 'repo');
    execFileSync('git', ['clone', '--no-hardlinks', '--depth', '1', `file://${ROOT}`, standaloneRepo], { stdio: 'ignore' });
    execFileSync('git', ['-C', standaloneRepo, 'switch', '-C', 'main'], { stdio: 'ignore' });
    sharedFixtureDirs.push(dir);
    return standaloneRepo;
}
function runStandaloneInstalledOnly(twin, sb)
{
    const dir = path.join(sb.work, 'standalone', 'os');
    fs.mkdirSync(dir, { recursive: true });
    const env = { ...sb.env, STACK_SKILLS_REPO: `file://${standaloneSource()}` };
    if (twin === 'sh')
    {
        const copy = path.join(dir, 'claude-stack.sh');
        fs.copyFileSync(SH, copy);
        return execFileSync('bash', [copy, 'update', '--scope', 'project', '--installed-only'], { cwd: sb.repo, encoding: 'utf8', env });
    }
    const copy = path.join(dir, 'claude-stack.ps1');
    fs.copyFileSync(PS1, copy);
    return execFileSync('pwsh', ['-NoProfile', '-File', copy, 'update', '-Scope', 'project', '-InstalledOnly'], { cwd: sb.repo, encoding: 'utf8', env });
}

// A REAL pre-feature install: bb5c684 (v0.2.86, the last release before the memory feature) laid down
// by ITS OWN installer from a `git archive` snapshot carrying the RELEASE-SOURCE a release archive has,
// with a no-stack project's plugin-setup selection (the release's `always` set in every category).
const PRE_FEATURE_SHA = 'bb5c684';
const preFeatureReachable = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${PRE_FEATURE_SHA}^{commit}`]).status === 0;
let preFeatureDir = null;
function preFeatureSnapshot()
{
    if (preFeatureDir) return preFeatureDir;
    const dir = mkTmp('instmem-bb5c684-');
    preFeatureDir = path.join(dir, 'src');
    fs.mkdirSync(preFeatureDir);
    const tar = path.join(dir, 'src.tar');
    execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, PRE_FEATURE_SHA]);
    execFileSync('tar', ['-xf', tar, '-C', preFeatureDir]);
    const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', PRE_FEATURE_SHA], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(preFeatureDir, 'RELEASE-SOURCE'), `sha: ${sha}\nref: main\nversion: 0.2.86\nbuilt: 2026-09-18T00:00:00Z\n`);
    sharedFixtureDirs.push(dir);
    return preFeatureDir;
}
function realPreFeatureInstall(twin, sb)
{
    const old = preFeatureSnapshot();
    const always = JSON.parse(fs.readFileSync(path.join(old, 'meta', 'recommendations.json'), 'utf8')).always;
    const cat = { skills: 'skill', agents: 'agent', rules: 'rule', mcps: 'mcp', plugins: 'plugin', hooks: 'hook' };
    const sel = path.join(sb.work, 'sel-bb5c684.txt');
    fs.writeFileSync(sel, Object.entries(always).flatMap(([k, v]) => v.map((n) => `${cat[k]} ${n}`)).join('\n') + '\n');
    if (twin === 'sh')
    {
        return execFileSync('bash', [path.join(old, 'scripts', 'os', 'claude-stack.sh'), 'install', '--scope', 'project', '--selection', sel, '--source', old], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
    }
    return execFileSync('pwsh', ['-NoProfile', '-File', path.join(old, 'scripts', 'os', 'claude-stack.ps1'), 'install', '-Scope', 'project', '-Selection', sel, '-Source', old], { cwd: sb.repo, encoding: 'utf8', env: sb.env });
}

const mcpServers = (sb, dir = sb.repo) => JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers;
const settingsOf = (sb, dir = sb.repo) => JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
const memEntry = (sb, dir) => mcpServers(sb, dir).memory;
const storeCalls = (sb) => (fs.existsSync(sb.callsLog) ? fs.readFileSync(sb.callsLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const memFlag = (twin) => (twin === 'sh' ? '--memory-level' : '-MemoryLevel');
const spaceFlag = (twin) => (twin === 'sh' ? '--space' : '-Space');
const scopeFlag = (twin) => (twin === 'sh' ? '--scope' : '-Scope');
const selFlag = (twin) => (twin === 'sh' ? '--selection' : '-Selection');
const planFlag = (twin) => (twin === 'sh' ? '--print-plan' : '-PrintPlan');
const memoryRegistration = (dbPath) => ({
    type: 'stdio', command: 'uvx',
    args: ['--with', 'numpy', '--from', 'mcp-memory-service[sqlite]', 'memory', 'server'],
    env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec', MCP_MEMORY_SQLITE_PATH: dbPath, MCP_MEMORY_SQLITE_PRAGMAS: 'busy_timeout=15000' },
});

for (const twin of TWINS)
{
    const skip = twin === 'ps1' && skipNoPwsh;

    test(`${twin}: fresh install, no flag -> global path`, { skip }, () =>
    {
        const sb = sandbox();
        const out = run(twin, sb, 'install');
        const e = memEntry(sb);
        assert.strictEqual(e.command, 'uvx', `${twin}: memory command`);
        assert.ok(e.args.includes('--with') && e.args.includes('numpy'), `${twin}: --with numpy missing`);
        assert.ok(e.args.some((a) => a.startsWith('mcp-memory-service[sqlite]')), `${twin}: [sqlite] extra missing: ${e.args}`);
        assert.strictEqual(e.env.MCP_MEMORY_STORAGE_BACKEND, 'sqlite_vec', `${twin}: backend`);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory.db'), `${twin}: global path`);
        assertOneSeparatorStyle(e.env.MCP_MEMORY_SQLITE_PATH, `${twin}: global db path`);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PRAGMAS, 'busy_timeout=15000', `${twin}: pragma`);
        assert.match(out, /memory=global/, `${twin}: summary line missing memory=global`);
    });

    test(`${twin}: --memory-level project -> <project>/.memory-mcp/memory.db, .gitignore = *`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'project']);
        const e = memEntry(sb);
        // realpath: on macOS os.tmpdir() sits under a /var symlink to /private/var, and both twins
        // resolve the project root through git, which follows it - the installer is right to use the
        // real path, so the test compares to it.
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(fs.realpathSync(sb.repo), '.memory-mcp', 'memory.db'), `${twin}: project path`);
        assertOneSeparatorStyle(e.env.MCP_MEMORY_SQLITE_PATH, `${twin}: project db path`);
        const gi = fs.readFileSync(path.join(sb.repo, '.memory-mcp', '.gitignore'), 'utf8');
        assert.strictEqual(gi, '*\n', `${twin}: .memory-mcp/.gitignore content`);
    });

    test(`${twin}: --memory-level project never touches the project's own .gitignore`, { skip }, () =>
    {
        const sb = sandbox();
        fs.writeFileSync(path.join(sb.repo, '.gitignore'), 'node_modules\n');
        run(twin, sb, 'install', [memFlag(twin), 'project']);
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.gitignore'), 'utf8'), 'node_modules\n', `${twin}: project .gitignore was touched`);
    });

    test(`${twin}: --memory-level scoped, no --space -> memory_default.db`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'scoped']);
        const e = memEntry(sb);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory_default.db'), `${twin}: scoped default path`);
        assertOneSeparatorStyle(e.env.MCP_MEMORY_SQLITE_PATH, `${twin}: scoped db path`);
    });

    test(`${twin}: --memory-level scoped --space work -> memory_work.db`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'scoped', spaceFlag(twin), 'work']);
        const e = memEntry(sb);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory_work.db'), `${twin}: scoped+space path`);
        assertOneSeparatorStyle(e.env.MCP_MEMORY_SQLITE_PATH, `${twin}: scoped+space db path`);
    });

    test(`${twin}: bad --memory-level value -> usage error, nothing written`, { skip }, () =>
    {
        const sb = sandbox();
        const res = runExpectFail(twin, sb, 'install', [memFlag(twin), 'bogus']);
        assert.notStrictEqual(res.status, 0, `${twin}: bad value did not fail:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout + res.stderr, /must be 'global', 'scoped' or 'project'/, `${twin}: no usage error printed`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.mcp.json')), `${twin}: .mcp.json was written despite the bad value`);
    });

    // I2: a global install registers ONE server for every project of the account - its db cannot live
    // inside one repo (every other project would share it, and it goes when that repo goes).
    test(`${twin}: --memory-level project with a global scope is a usage error before anything changes`, { skip }, () =>
    {
        const sb = sandbox();
        const res = runExpectFail(twin, sb, 'install', [scopeFlag(twin), 'global', memFlag(twin), 'project', selFlag(twin), sb.sel]);
        assert.notStrictEqual(res.status, 0, `${twin}: project level at global scope was accepted:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout + res.stderr, /project cannot be used with (--scope|-Scope) global/, `${twin}: no usage error printed`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.memory-mcp')), `${twin}: a .memory-mcp folder was created before the refusal`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.claude')), `${twin}: the repo was written before the refusal`);
        assert.ok(!fs.existsSync(sb.log), `${twin}: the claude CLI was called before the refusal`);
    });

    // I2: at user scope the registration that counts is the ACCOUNT's - a repo's .mcp.json (an earlier
    // project install's project-level path) must never become the account-wide path.
    test(`${twin}: an unflagged global run reads only the account file, never the repo's .mcp.json`, { skip }, () =>
    {
        const sb = sandbox();
        const repoDb = path.join(fs.realpathSync(sb.repo), '.memory-mcp', 'memory.db');
        fs.writeFileSync(path.join(sb.repo, '.mcp.json'), JSON.stringify({ mcpServers: { memory: memoryRegistration(repoDb) } }, null, 2) + '\n');
        const out = run(twin, sb, 'update', [], 'global');
        const globalDb = path.join(sb.home, '.memory-mcp', 'memory.db');
        assert.ok(out.includes(`memory=global (${globalDb})`), `${twin}: the repo's project-level path was adopted account-wide:\n${out}`);
        assert.doesNotMatch(out, /keeping the existing registration/, `${twin}: a repo registration was read at user scope`);
    });

    // I1: Claude Code keeps the default account's registrations at ~/.claude.json, not
    // ~/.claude/.claude.json - only a CLAUDE_CONFIG_DIR account keeps it inside its own dir.
    test(`${twin}: CLAUDE_CONFIG_DIR unset - the default account's registration is read from ~/.claude.json`, { skip }, () =>
    {
        const sb = sandbox();
        const env = { ...sb.env };
        delete env.CLAUDE_CONFIG_DIR;
        const scopedDb = path.join(sb.home, '.memory-mcp', 'memory_work.db');
        fs.writeFileSync(path.join(sb.home, '.claude.json'), JSON.stringify({ mcpServers: { memory: memoryRegistration(scopedDb) } }, null, 2) + '\n');
        // the WRONG home for the default account's registrations - never read (a server that cannot
        // start, so an import that read it fails loudly)
        fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(sb.home, '.claude', '.claude.json'), JSON.stringify({ mcpServers: { memory: { ...memoryRegistration(path.join(sb.work, 'wrong.db')), command: 'no-such-memory-server' } } }, null, 2) + '\n');
        seedOneNote(sb, path.join(sb.home, '.claude'));
        const out = run(twin, sb, 'update', [], 'global', { env });
        assert.ok(out.includes(`keeping the existing registration's db path unchanged (scoped): ${scopedDb}`), `${twin}: the ~/.claude.json registration was not kept:\n${out}`);
        assert.ok(out.includes(`memory=scoped (${scopedDb})`), `${twin}: the level silently fell back:\n${out}`);
        assert.ok(!out.includes('wrong.db'), `${twin}: ~/.claude/.claude.json was read for the default account`);
        assert.match(fs.readFileSync(sb.log, 'utf8'), new RegExp(`MCP_MEMORY_SQLITE_PATH=${scopedDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${twin}: the registration was re-pointed`);
        // the import reaches the same ~/.claude.json registration (no --config-dir for the default account)
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the default account's note was not imported through its ~/.claude.json registration:\n${out}`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: this repo was not switched off`);
    });

    // I3: the commands read this exact line - a level change never moves the db, so the user must be
    // told where the old memories stay.
    test(`${twin}: a flag that changes the registered path logs the old and new db in one line`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'project']);
        const oldPath = memEntry(sb).env.MCP_MEMORY_SQLITE_PATH;
        const newPath = path.join(sb.home, '.memory-mcp', 'memory.db');
        const out = run(twin, sb, 'update', [memFlag(twin), 'global']);
        assert.ok(out.includes(`memory: level project -> global: ${newPath} (old memories stay in ${oldPath})`), `${twin}: the level-change line is missing:\n${out}`);
        assert.strictEqual(memEntry(sb).env.MCP_MEMORY_SQLITE_PATH, newPath, `${twin}: the registration was not re-pointed`);
        const again = run(twin, sb, 'update', [memFlag(twin), 'global']);
        assert.doesNotMatch(again, /memory: level /, `${twin}: a flag naming the CURRENT level still logged a change`);
    });

    // M9: --print-plan is a dry run - nothing on disk may change.
    test(`${twin}: --print-plan with --memory-level project writes nothing`, { skip }, () =>
    {
        const sb = sandbox();
        const out = run(twin, sb, 'install', [memFlag(twin), 'project', planFlag(twin)]);
        assert.match(out, /plan mcps:.*memory/, `${twin}: no plan printed`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.memory-mcp')), `${twin}: the dry run created .memory-mcp`);
    });

    // M11: a worktree is deleted with its branch - a project-level db must live under the MAIN
    // checkout, while the switch-off lands where this run's rule and hook landed (the worktree).
    test(`${twin}: --memory-level project from a worktree -> the db lives under the MAIN checkout`, { skip }, () =>
    {
        const sb = sandbox();
        execFileSync('git', ['-C', sb.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
        const wt = path.join(sb.work, 'wt');
        execFileSync('git', ['-C', sb.repo, 'worktree', 'add', '-q', wt]);
        run(twin, sb, 'install', [memFlag(twin), 'project'], 'project', { cwd: wt });
        const e = memEntry(sb, wt);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(fs.realpathSync(sb.repo), '.memory-mcp', 'memory.db'), `${twin}: the db followed the worktree`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.memory-mcp', '.gitignore')), `${twin}: the main checkout's .memory-mcp is not self-ignored`);
        assert.ok(!fs.existsSync(path.join(wt, '.memory-mcp')), `${twin}: a .memory-mcp folder was created in the worktree`);
        assert.strictEqual(settingsOf(sb, wt).autoMemoryEnabled, false, `${twin}: the switch-off did not land where the rule landed`);
    });

    test(`${twin}: memory-session.js + memory.js copied, hook wired on SessionStart with timeout 10`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install');
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'memory-session.js')), `${twin}: memory-session.js not copied`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'memory.js')), `${twin}: memory.js engine not copied`);
        const s = settingsOf(sb);
        const starts = s.hooks.SessionStart || [];
        const entry = starts.flatMap((e) => e.hooks).find((h) => /memory-session\.js/.test(h.command));
        assert.ok(entry, `${twin}: memory-session.js not wired on SessionStart`);
        assert.strictEqual(entry.timeout, 10, `${twin}: hook timeout`);
    });

    test(`${twin}: update with no flag over an existing registration keeps the path unchanged`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'project']);
        const before = memEntry(sb).env.MCP_MEMORY_SQLITE_PATH;
        run(twin, sb, 'update');
        const after = memEntry(sb).env.MCP_MEMORY_SQLITE_PATH;
        assert.strictEqual(after, before, `${twin}: path changed across update with no flag`);
    });

    test(`${twin}: update over an OLD-shape (v0.2.84) registration at a custom path - path byte-identical, extra+pragmas upgraded, no repeated repair`, { skip }, () =>
    {
        const sb = sandbox({
            mcpServers: {
                memory: {
                    type: 'stdio', command: 'uvx',
                    args: ['--with', 'numpy', '--from', 'mcp-memory-service@11.13.0', 'memory', 'server'],
                    env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec', MCP_MEMORY_SQLITE_PATH: '' },
                },
                'hand-added': { type: 'stdio', command: 'node', args: ['tools/my-server.js'] },
            },
        });
        const customDb = path.join(sb.work, 'customdb', 'mymemory.db');
        fs.mkdirSync(path.dirname(customDb), { recursive: true });
        const seeded = mcpServers(sb);
        seeded.memory.env.MCP_MEMORY_SQLITE_PATH = customDb;
        fs.writeFileSync(path.join(sb.repo, '.mcp.json'), JSON.stringify({ mcpServers: seeded }, null, 2) + '\n');

        const out1 = run(twin, sb, 'update');
        const e1 = memEntry(sb);
        assert.strictEqual(e1.env.MCP_MEMORY_SQLITE_PATH, customDb, `${twin}: custom path not kept byte-identical`);
        assert.ok(e1.args.some((a) => a.startsWith('mcp-memory-service[sqlite]')), `${twin}: [sqlite] extra not added on upgrade`);
        assert.strictEqual(e1.env.MCP_MEMORY_SQLITE_PRAGMAS, 'busy_timeout=15000', `${twin}: pragma not added on upgrade`);
        assert.match(out1, /mcp repaired: memory/, `${twin}: the shape upgrade was not reported as a repair`);
        assert.deepStrictEqual(mcpServers(sb)['hand-added'], { type: 'stdio', command: 'node', args: ['tools/my-server.js'] }, `${twin}: hand-added server touched`);
        // A second run must not repair the SAME entry again - proves verify builds its expected shape
        // from the kept path, rather than 'correcting' it back to a default.
        const out2 = run(twin, sb, 'update');
        assert.doesNotMatch(out2, /mcp repaired: memory\b/, `${twin}: memory was repaired a second time (verify flip-flopped on the path)`);
        // ...and a flag moving that custom path elsewhere names both files.
        const out3 = run(twin, sb, 'update', [memFlag(twin), 'scoped']);
        const scopedDb = path.join(sb.home, '.memory-mcp', 'memory_default.db');
        assert.ok(out3.includes(`memory: level custom -> scoped: ${scopedDb} (old memories stay in ${customDb})`), `${twin}: a custom path's move was not logged:\n${out3}`);
    });

    test(`${twin}: import succeeds (real note, fake server) -> autoMemoryEnabled false; re-run is idempotent (import not repeated)`, { skip }, () =>
    {
        const sb = sandbox();
        seedOneNote(sb);
        const out1 = run(twin, sb, 'install');
        assert.match(out1, /importing Claude's existing notes/, `${twin}: import was not attempted`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled not set to false`);
        const calls = storeCalls(sb);
        assert.strictEqual(calls.length, 1, `${twin}: expected exactly one memory_store call`);
        assert.strictEqual(calls[0].memory_type, 'user_correction', `${twin}: feedback note kind mapping`);
        assert.deepStrictEqual(calls[0].tags.sort(), ['feedback-test-note', 'project:repo'].sort(), `${twin}: note tags`);

        const out2 = run(twin, sb, 'update');
        assert.doesNotMatch(out2, /importing Claude's existing notes/, `${twin}: the import ran again after autoMemoryEnabled was already false`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: a second store call happened on re-run`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled flipped back`);
    });

    test(`${twin}: import fails -> autoMemoryEnabled key absent, install continues (exit 0)`, { skip }, () =>
    {
        const sb = sandbox({ failContent: 'Will fail\n\nFails always.' });
        seedNote(sb, 'feedback-fail-note.md', { name: 'feedback-fail-note', description: 'Will fail', type: 'feedback', body: 'Fails always.' });
        const res = runExpectFail(twin, sb, 'install', [scopeFlag(twin), 'project', selFlag(twin), sb.sel]);
        assert.strictEqual(res.status, 0, `${twin}: install did not continue after an import failure:\n${res.stderr}`);
        const out = res.stdout + res.stderr;
        assert.match(out, /memory notes import failed/, `${twin}: the failure was not logged`);
        const s = settingsOf(sb);
        assert.ok(!hasKey(s, 'autoMemoryEnabled'), `${twin}: autoMemoryEnabled was written despite the import failing`);
    });

    // A ghost write: the server acknowledges every store but nothing reaches the db file. The importer
    // re-opens the db after the server exits and finds the note missing - an import failure, so
    // Claude's own memory stays on.
    test(`${twin}: the server acknowledges a store that never reaches the db -> import fails, autoMemoryEnabled NOT written`, { skip }, () =>
    {
        const sb = sandbox({ ghostWrite: true });
        seedOneNote(sb);
        const res = runExpectFail(twin, sb, 'install', [scopeFlag(twin), 'project', selFlag(twin), sb.sel]);
        assert.strictEqual(res.status, 0, `${twin}: install did not continue after the ghost write:\n${res.stderr}`);
        const out = res.stdout + res.stderr;
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the store was never even attempted`);
        assert.match(out, /not found in the db after the/, `${twin}: the missing row was not reported:\n${out}`);
        assert.match(out, /memory notes import failed/, `${twin}: the failure was not logged`);
        assert.ok(!hasKey(settingsOf(sb), 'autoMemoryEnabled'), `${twin}: autoMemoryEnabled was written though the note never persisted`);
    });

    test(`${twin}: fresh install with no notes to import still switches memory off (nothing to import = success)`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install');
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled not set when there was nothing to import`);
    });

    // C2 gate: Claude's own memory goes off only where the replacement is complete - the server AND
    // the rule that tells Claude to save to it. A selection without the rule never switches it off.
    test(`${twin}: the memory server without baseline-memory.md -> no import, Claude's own memory stays on`, { skip }, () =>
    {
        const sb = sandbox({ selection: 'skill markdown-style\nrule markdown-docs\nhook memory-session\nmcp memory\n' });
        seedOneNote(sb);
        const out = run(twin, sb, 'install');
        assert.match(out, /memory: the notes import was skipped - baseline-memory\.md is not part of this install; Claude's own memory stays on/, `${twin}: the skip was not explained:\n${out}`);
        assert.doesNotMatch(out, /importing Claude's existing notes/, `${twin}: the import ran without the rule`);
        assert.ok(!hasKey(settingsOf(sb), 'autoMemoryEnabled'), `${twin}: memory was switched off without the rule`);
        assert.strictEqual(storeCalls(sb).length, 0, `${twin}: notes were stored without the rule`);
    });

    // C2: the update fast path over a PRE-FEATURE install must deliver the rule and the server BEFORE
    // it switches Claude's own memory off - the always-on baseline is adopted like a new hook.
    test(`${twin}: update --installed-only over a pre-feature install delivers baseline-memory + memory at global, imports, then switches off`, { skip }, () =>
    {
        const sb = sandbox();
        preFeatureInstall(sb);
        seedOneNote(sb);
        const out = runInstalledOnly(twin, sb);
        assert.match(out, /installed-only: adopting rule baseline-memory - always shipped by this release and absent here/, `${twin}: the rule was not adopted:\n${out}`);
        assert.match(out, /installed-only: adopting mcp memory - always shipped by this release and absent here/, `${twin}: the server was not adopted`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: baseline-memory.md did not land`);
        assert.strictEqual(memEntry(sb).env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory.db'), `${twin}: not registered at global`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'memory-session.js')), `${twin}: the start hook was not adopted`);
        const ruleAt = out.search(/rule installed -> baseline-memory\.md/);
        const importAt = out.indexOf("importing Claude's existing notes");
        assert.ok(ruleAt >= 0 && importAt > ruleAt, `${twin}: the import ran before the rule landed (rule@${ruleAt}, import@${importAt})`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the note was not imported`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: Claude's own memory was not switched off`);
        assertStampRecordsDisk(twin, sb, 'after the adopting update');
        assert.match(stampOf(sb), /^installed-always-rules: .*\bbaseline-memory\b/m, `${twin}: the adopted rule is missing from the stamp`);
        assert.match(stampOf(sb), /^installed-always-mcps: .*\bmemory\b/m, `${twin}: the adopted server is missing from the stamp`);
    });

    test(`${twin}: update --installed-only --memory-level scoped over a pre-feature install -> the scoped db`, { skip }, () =>
    {
        const sb = sandbox();
        preFeatureInstall(sb);
        seedOneNote(sb);
        const out = runInstalledOnly(twin, sb, [memFlag(twin), 'scoped']);
        assert.strictEqual(memEntry(sb).env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory_default.db'), `${twin}: not registered at the scoped db`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: baseline-memory.md did not land`);
        assert.match(out, /importing Claude's existing notes/, `${twin}: the import did not run`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the note was not imported`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: Claude's own memory was not switched off`);
    });

    // Locked means locked, like serena: an always rule or server absent from disk is adopted whatever
    // the previous stamp says. A stamp that NAMES them (the shipped list a standalone run once wrote
    // without adopting anything) is no drop record.
    test(`${twin}: update --installed-only never reads a locked always item as dropped - a stamp naming baseline-memory and memory still adopts both`, { skip }, () =>
    {
        const sb = sandbox();
        preFeatureInstall(sb, { stampExtra: `shipped-always-rules: ${RECS.always.rules.join(',')}\nshipped-always-mcps: ${RECS.always.mcps.join(',')}\ninstalled-always-rules: ${RECS.always.rules.join(',')}\ninstalled-always-mcps: ${RECS.always.mcps.join(',')}\n` });
        seedOneNote(sb);
        const out = runInstalledOnly(twin, sb);
        assert.doesNotMatch(out, /installed-only: (rule|mcp) \S+ was dropped from this install/, `${twin}: a locked item was read as dropped:\n${out}`);
        assert.match(out, /installed-only: adopting rule baseline-memory - always shipped by this release and absent here/, `${twin}: the rule was not adopted`);
        assert.match(out, /installed-only: adopting mcp memory - always shipped by this release and absent here/, `${twin}: the server was not adopted`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: baseline-memory.md did not land`);
        assert.ok(hasKey(mcpServers(sb), 'memory'), `${twin}: the memory server was not registered`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: Claude's own memory was not switched off`);
        assertStampRecordsDisk(twin, sb, 'after the update');
    });

    // N1: the standalone route finds no recommendations.json, so it adopts nothing - and its stamp must
    // say so (what is on disk, not the shipped list), or the next update reads the locked baseline as
    // dropped and the memory rule and server never arrive.
    test(`${twin}: a standalone update --installed-only stamps only what is on disk, and the next update adopts baseline-memory + memory`, { skip }, () =>
    {
        const sb = sandbox();
        preFeatureInstall(sb);
        seedOneNote(sb);
        const first = runStandaloneInstalledOnly(twin, sb);
        assert.match(first, /stamp: \S*claude-stack\.stamp @ /, `${twin}: the standalone run resolved no source, or wrote no stamp:\n${first}`);
        assertStampRecordsDisk(twin, sb, 'after the standalone update');
        if (!fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')))
        {
            assert.ok(!hasKey(settingsOf(sb), 'autoMemoryEnabled'), `${twin}: Claude's own memory went off without the rule`);
        }
        const second = runInstalledOnly(twin, sb);
        assert.doesNotMatch(second, /installed-only: (rule|mcp) \S+ was dropped from this install/, `${twin}: the second update read a locked item as dropped:\n${second}`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: baseline-memory.md never arrived`);
        assert.ok(hasKey(mcpServers(sb), 'memory'), `${twin}: the memory server never arrived`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the note was not imported`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: Claude's own memory was not switched off`);
        assertStampRecordsDisk(twin, sb, 'after the second update');
    });

    // The same trap for a real user: the stamp a REAL v0.2.86 install writes, then the README's
    // standalone refresh (adopts nothing - no recommendations.json beside the script), then the plugin
    // update route (must adopt, not read the standalone stamp as a drop), then that route again (must
    // change nothing: no adoption repeated, nothing dropped, no second import).
    test(`${twin}: a real bb5c684 install (its own installer), a standalone update, then two checkout updates - baseline-memory + memory arrive once and stay`, { skip: skip || (!preFeatureReachable && `${PRE_FEATURE_SHA} is not in this clone's history`) }, () =>
    {
        const sb = sandbox();
        realPreFeatureInstall(twin, sb);
        const oldStamp = stampOf(sb);
        assert.match(oldStamp, /^version: 0\.2\.86$/m, `${twin}: not the bb5c684 stamp:\n${oldStamp}`);
        assert.match(oldStamp, /^shipped-hooks: /m, `${twin}: the bb5c684 stamp has no hook catalog:\n${oldStamp}`);
        assert.doesNotMatch(oldStamp, /always-(rules|mcps)|memory-session/, `${twin}: the bb5c684 stamp already knows the memory feature:\n${oldStamp}`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')) && !hasKey(mcpServers(sb), 'memory'), `${twin}: the bb5c684 install already carries memory`);
        seedOneNote(sb);

        const standalone = runStandaloneInstalledOnly(twin, sb);
        assert.match(standalone, /stamp: \S*claude-stack\.stamp @ /, `${twin}: the standalone run resolved no source, or wrote no stamp:\n${standalone}`);
        assertStampRecordsDisk(twin, sb, 'after the standalone update');

        const adopt = runInstalledOnly(twin, sb);
        assert.doesNotMatch(adopt, /installed-only: (rule|mcp) \S+ was dropped from this install/, `${twin}: the checkout update read a locked item as dropped:\n${adopt}`);
        assert.match(adopt, /installed-only: adopting rule baseline-memory - always shipped by this release and absent here/, `${twin}: the rule was not adopted`);
        assert.match(adopt, /installed-only: adopting mcp memory - always shipped by this release and absent here/, `${twin}: the server was not adopted`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: baseline-memory.md did not land`);
        assert.ok(hasKey(mcpServers(sb), 'memory'), `${twin}: the memory server was not registered`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'hooks', 'memory-session.js')), `${twin}: the start hook is missing`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the note was not imported`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: Claude's own memory was not switched off`);
        assertStampRecordsDisk(twin, sb, 'after the adopting update');

        const again = runInstalledOnly(twin, sb);
        assert.doesNotMatch(again, /installed-only: (rule|mcp) \S+ was dropped from this install/, `${twin}: the re-run read a locked item as dropped:\n${again}`);
        assert.doesNotMatch(again, /installed-only: adopting (rule|mcp) /, `${twin}: the re-run adopted again - it is not idempotent:\n${again}`);
        assert.ok(fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')) && hasKey(mcpServers(sb), 'memory'), `${twin}: the re-run lost the rule or the server`);
        assert.strictEqual(storeCalls(sb).length, 1, `${twin}: the re-run imported again`);
        assertStampRecordsDisk(twin, sb, 'after the re-run');
    });

    // C3: a global install lands the rule and the start hook in THIS repo only, so it may switch
    // Claude's own memory off only here - the account file would silence every other project too.
    test(`${twin}: global scope from a repo - the switch-off lands in this repo's project settings only, and the card says so`, { skip }, () =>
    {
        const sb = sandbox();
        // the user-scope registration `claude mcp add --scope user` writes (the stub CLI writes nothing)
        fs.writeFileSync(path.join(sb.acct, '.claude.json'), JSON.stringify({ mcpServers: { memory: memoryRegistration(path.join(sb.home, '.memory-mcp', 'memory.db')) } }, null, 2) + '\n');
        seedOneNote(sb);
        const out = run(twin, sb, 'install', [], 'global');
        assert.match(out, /importing Claude's existing notes/, `${twin}: the import did not run:\n${out}`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: this repo's project settings were not switched off`);
        const acctSettings = path.join(sb.acct, 'settings.json');
        if (fs.existsSync(acctSettings)) assert.ok(!hasKey(JSON.parse(fs.readFileSync(acctSettings, 'utf8')), 'autoMemoryEnabled'), `${twin}: the ACCOUNT settings were switched off`);
        assert.match(out, /memory: Claude's own memory is off in this repo only/, `${twin}: the next-steps card does not say where memory went off`);
        // the account stamp records what this run left on disk: the rules in this repo (where every
        // scope's rules land), the servers in the account registration file
        const acctStamp = fs.readFileSync(path.join(sb.acct, 'claude-stack.stamp'), 'utf8');
        const repoRules = RECS.always.rules.filter((r) => fs.existsSync(path.join(sb.repo, '.claude', 'rules', `${r}.md`))).join(',');
        assert.match(repoRules, /baseline-memory/, `${twin}: the rule did not land in this repo`);
        assert.ok(acctStamp.includes(`installed-always-rules: ${repoRules}\n`), `${twin}: the account stamp's always rules are not the ones on disk (${repoRules}):\n${acctStamp}`);
        assert.ok(acctStamp.includes('installed-always-mcps: memory\n'), `${twin}: the account stamp's always servers are not the account registration's:\n${acctStamp}`);
    });

    test(`${twin}: the user's own MCP server, settings key and hook wiring survive a fresh install`, { skip }, () =>
    {
        const sb = sandbox({
            mcpServers: { 'hand-added': { type: 'stdio', command: 'node', args: ['tools/my-server.js'] } },
            settings: { myOwnKey: 'keep-me', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }] } },
        });
        run(twin, sb, 'install');
        assert.deepStrictEqual(mcpServers(sb)['hand-added'], { type: 'stdio', command: 'node', args: ['tools/my-server.js'] }, `${twin}: hand-added mcp server touched`);
        const s = settingsOf(sb);
        assert.strictEqual(s.myOwnKey, 'keep-me', `${twin}: a user settings key was dropped`);
        const preToolUse = s.hooks.PreToolUse || [];
        const mine = preToolUse.flatMap((e) => e.hooks).find((h) => h.command === 'echo mine');
        assert.ok(mine && mine.timeout === 5, `${twin}: the user's own hook entry was altered`);
    });

    test(`${twin}: malformed .mcp.json and settings.json - both left untouched, install continues`, { skip }, () =>
    {
        const sb = sandbox({ mcpJsonRaw: '{not valid json', settingsRaw: '{also bad' });
        const res = runExpectFail(twin, sb, 'install', [scopeFlag(twin), 'project', selFlag(twin), sb.sel]);
        assert.strictEqual(res.status, 0, `${twin}: install did not continue past malformed files:\n${res.stderr}`);
        const out = res.stdout + res.stderr;
        assert.match(out, /not valid JSON/i, `${twin}: no malformed-JSON warning printed`);
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), '{not valid json', `${twin}: .mcp.json was rewritten`);
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8'), '{also bad', `${twin}: settings.json was rewritten`);
    });

    test(`${twin}: global install scope with no identifiable project - the import is skipped, and it says so`, { skip }, () =>
    {
        const sb = sandbox();
        const notGit = path.join(sb.work, 'notgit');
        fs.mkdirSync(notGit, { recursive: true });
        const out = run(twin, sb, 'install', [], 'global', { cwd: notGit });
        assert.match(out, /global install scope with no identifiable project.*skipping the notes import/, `${twin}: the skip was not logged:\n${out}`);
        assert.ok(!fs.existsSync(path.join(sb.acct, 'settings.json')) || !hasKey(JSON.parse(fs.readFileSync(path.join(sb.acct, 'settings.json'), 'utf8')), 'autoMemoryEnabled'), `${twin}: the account settings were switched off despite the skip`);
    });

    test(`${twin}: a path with a space in it (HOME) survives the registration as one argument`, { skip }, () =>
    {
        const sb = sandbox();
        const spacedHome = path.join(sb.work, 'home with space');
        fs.mkdirSync(spacedHome, { recursive: true });
        const env = { ...sb.env, HOME: spacedHome, USERPROFILE: spacedHome };
        run(twin, sb, 'install', [], 'project', { env });
        const e = memEntry(sb);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(spacedHome, '.memory-mcp', 'memory.db'), `${twin}: spaced path mismatch`);
        assert.deepStrictEqual(e.args, ['--with', 'numpy', '--from', e.args[3], 'memory', 'server'], `${twin}: args shape broke around the spaced path`);
        assert.ok(e.args[3].startsWith('mcp-memory-service[sqlite]'), `${twin}: the --from value itself was corrupted: ${e.args[3]}`);
    });
}

// The sh twin's Git Bash branch, pinned on every platform: a `cygpath` on PATH that answers with
// backslashes stands in for Git Bash's. Measured on windows-latest before the fix: the global db was
// registered as '/tmp/instmem-.../home/.memory-mcp/memory.db' (another file to the native server) and
// the project one as 'C:/Users/...', which node read back as 'C:\Users\...' - so every update logged a
// level change from 'custom' and re-pointed the registration. Every db path now takes the one native
// spelling, and an update reads its own registration back at its level.
test('sh: under Git Bash (cygpath on PATH) every db path takes the native spelling, and an update reads its own registration back', { skip: process.platform === 'win32' && 'Windows runs the twin tests above through the real Git Bash' }, () =>
{
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.work, 'bin', 'cygpath'), ['#!/bin/sh', '[ "$1" = "-w" ] || exit 2', 'printf \'%s\\n\' "$2" | tr / \'\\\\\'', ''].join('\n'), { mode: 0o755 });
    const win = (p) => p.replace(/\//g, '\\');
    const globalDb = win(path.join(sb.home, '.memory-mcp', 'memory.db'));
    const projectDb = win(path.join(fs.realpathSync(sb.repo), '.memory-mcp', 'memory.db'));
    const scopedDb = win(path.join(sb.home, '.memory-mcp', 'memory_default.db'));
    const dbOf = () => memEntry(sb).env.MCP_MEMORY_SQLITE_PATH;

    run('sh', sb, 'install');
    assert.strictEqual(dbOf(), globalDb, 'global: not the cygpath spelling');
    const toProject = run('sh', sb, 'update', ['--memory-level', 'project']);
    assert.strictEqual(dbOf(), projectDb, 'project: not the cygpath spelling of the main checkout');
    assert.ok(toProject.includes(`memory: level global -> project: ${projectDb} (old memories stay in ${globalDb})`), `the global registration was not read back as global:\n${toProject}`);
    const kept = run('sh', sb, 'update');
    assert.ok(kept.includes(`keeping the existing registration's db path unchanged (project): ${projectDb}`), `the project registration was not read back as project:\n${kept}`);
    assert.doesNotMatch(kept, /memory: level /, 'an update with no flag re-pointed its own registration');
    assert.strictEqual(dbOf(), projectDb, 'an update with no flag changed the path');
    const toScoped = run('sh', sb, 'update', ['--memory-level', 'scoped']);
    assert.strictEqual(dbOf(), scopedDb, 'scoped: not the cygpath spelling');
    assert.ok(toScoped.includes(`memory: level project -> scoped: ${scopedDb}`), `the level change was not logged:\n${toScoped}`);
    assert.ok(run('sh', sb, 'update').includes(`unchanged (scoped): ${scopedDb}`), 'the scoped registration was not read back as scoped');
});

// The pinned `--from` value: the pin sits INSIDE the extras spec ('[sqlite]==<ver>'), and an offline
// run (no version resolved) drops it to the bare extra. Read from BOTH manifests, not restated here.
test('both twins spell the memory --from value as mcp-memory-service[sqlite] followed by the ==<ver> pin', () =>
{
    const sh = fs.readFileSync(SH, 'utf8');
    const ps = fs.readFileSync(PS1, 'utf8');
    assert.match(sh, /--from mcp-memory-service\[sqlite\]\$\{MEMORY_PIN\} memory server/, 'sh: the --from spec changed shape');
    assert.match(sh, /MEMORY_PIN="\$\{MCP_MEMORY_VER:\+==\$MCP_MEMORY_VER\}"/, 'sh: the pin is not ==<ver>, or not empty when offline');
    assert.match(ps, /--from mcp-memory-service\[sqlite\]' \+ \$MemoryPin \+ ' memory server/, 'ps1: the --from spec changed shape');
    assert.match(ps, /\$MemoryPin = if \(\$McpMemoryVer\)\s+\{ '==' \+ \$McpMemoryVer \}\s+else \{ '' \}/, 'ps1: the pin is not ==<ver>, or not empty when offline');
});
