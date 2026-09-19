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
const RECS = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
// the hook catalog the installer manifest ships, read from the manifest itself
const ALL_SHIPPED_HOOKS = [...new Set([...fs.readFileSync(SH, 'utf8').matchAll(/^\s*"([a-z0-9-]+)\.js::/gm)].map((m) => m[1]))];

const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';
const TWINS = ['sh', 'ps1'];

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

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
    // run. Anything else forwards straight to the fake memory server; this only ever actually runs
    // when memory-import.js spawns the registered `memory` entry (`claude mcp add` is metadata-only,
    // never spawns the command it registers).
    fs.writeFileSync(path.join(bin, 'uvx'), [
        '#!/bin/sh',
        'case "$*" in *--version*) echo "uvx 0.0.0 (stub)"; exit 0 ;; esac',
        `exec node "${FAKE_SERVER}"`,
        ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'uvx.cmd'), [
        '@echo off',
        'echo %*|findstr /C:"--version" >nul && (echo uvx 0.0.0 ^(stub^)& exit /b 0)',
        `node "${FAKE_SERVER.replace(/\\/g, '\\\\')}"`,
        ''].join('\r\n'));
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
        NPX_STUB_LOG: npxLog,
        FAKE_MEMORY_DB: db, FAKE_MEMORY_CALLS_LOG: callsLog,
    };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'SCOPE']) delete env[k];
    if (opts.failContent) env.FAKE_MEMORY_FAIL_CONTENT = opts.failContent;
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
        const stamp = fs.readFileSync(path.join(sb.repo, '.claude', 'claude-stack.stamp'), 'utf8');
        assert.ok(stamp.includes(`shipped-always-rules: ${RECS.always.rules.join(',')}\n`), `${twin}: the stamp does not record the always rules:\n${stamp}`);
        assert.ok(stamp.includes(`shipped-always-mcps: ${RECS.always.mcps.join(',')}\n`), `${twin}: the stamp does not record the always mcps:\n${stamp}`);
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

    // A drop made through configure is recorded by the stamp (shipped then, absent now) and stays a drop.
    test(`${twin}: update --installed-only respects a stamp-recorded drop of baseline-memory and memory`, { skip }, () =>
    {
        const sb = sandbox();
        preFeatureInstall(sb, { stampExtra: `shipped-always-rules: ${RECS.always.rules.join(',')}\nshipped-always-mcps: ${RECS.always.mcps.join(',')}\n` });
        seedOneNote(sb);
        const out = runInstalledOnly(twin, sb);
        assert.match(out, /installed-only: rule baseline-memory was dropped from this install - leaving it out/, `${twin}: the drop was not reported:\n${out}`);
        assert.match(out, /installed-only: mcp memory was dropped from this install - leaving it out/, `${twin}: the server drop was not reported`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.claude', 'rules', 'baseline-memory.md')), `${twin}: a dropped rule was resurrected`);
        assert.ok(!hasKey(mcpServers(sb), 'memory'), `${twin}: a dropped server was resurrected`);
        assert.doesNotMatch(out, /importing Claude's existing notes/, `${twin}: the import ran with memory dropped`);
        assert.ok(!hasKey(settingsOf(sb), 'autoMemoryEnabled'), `${twin}: Claude's own memory was switched off with the replacement dropped`);
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
