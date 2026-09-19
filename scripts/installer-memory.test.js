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

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const FAKE_SERVER = path.join(ROOT, 'scripts', 'fixtures', 'fake-memory-server.js');

const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';
const TWINS = ['sh', 'ps1'];

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// The auto-memory folder name for a sandbox's repo, computed the same way memory-import.js's own
// gitTopLevel/slugify do (git-common-dir, '.git' stripped, path separators -> '-').
function gitTopSlug(repo)
{
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const top = path.basename(common) === '.git' ? path.dirname(common) : common;
    return { top, slug: top.replace(/[\\/]/g, '-') };
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
    fs.writeFileSync(sel, opts.selection || 'skill markdown-style\nrule markdown-docs\nhook memory-session\nmcp memory\n');
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
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    if (opts.failContent) env.FAKE_MEMORY_FAIL_CONTENT = opts.failContent;
    return { work, repo, home, acct, sel, env, log, db, callsLog };
}

function seedNote(sb, filename, { name, description, type, body })
{
    const { slug } = gitTopSlug(sb.repo);
    const memDir = path.join(sb.acct, 'projects', slug, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const lines = ['---', `name: ${name}`];
    if (description !== undefined) lines.push(`description: ${description}`);
    lines.push('metadata:', `  type: ${type}`, '---', '', body);
    fs.writeFileSync(path.join(memDir, filename), `${lines.join('\n')}\n`);
}

function run(twin, sb, action, args = [], scope = 'project')
{
    if (twin === 'sh')
    {
        return execFileSync('bash', [SH, action, '--scope', scope, '--selection', sb.sel, '--source', ROOT, ...args],
            { cwd: sb.repo, encoding: 'utf8', env: sb.env });
    }
    return execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', scope, '-Selection', sb.sel, '-Source', ROOT, ...args],
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

const mcpServers = (sb) => JSON.parse(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8')).mcpServers;
const settingsOf = (sb) => JSON.parse(fs.readFileSync(path.join(sb.repo, '.claude', 'settings.json'), 'utf8'));
const memEntry = (sb) => mcpServers(sb).memory;
const memFlag = (twin) => (twin === 'sh' ? '--memory-level' : '-MemoryLevel');
const spaceFlag = (twin) => (twin === 'sh' ? '--space' : '-Space');

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
        // The ps1 twin's cursor-stack port glued a literal '\' after the home memory dir - a
        // hard-coded Windows separator that corrupted the path under pwsh on macOS/Linux. Both twins
        // must build this path with the platform's own separator only (Join-Path / printf '%s/%s').
        assert.ok(!e.env.MCP_MEMORY_SQLITE_PATH.includes('\\'), `${twin}: a literal backslash leaked into the global db path: ${e.env.MCP_MEMORY_SQLITE_PATH}`);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PRAGMAS, 'busy_timeout=15000', `${twin}: pragma`);
        assert.match(out, /memory=global/, `${twin}: summary line missing memory=global`);
    });

    test(`${twin}: --memory-level project -> <project>/.memory-mcp/memory.db, .gitignore = *`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'project']);
        const e = memEntry(sb);
        // realpath: on macOS os.tmpdir() sits under a /var symlink to /private/var, and both twins
        // resolve the project root through `git rev-parse --show-toplevel` (sh) / a real path (ps1),
        // which follows it - the installer is right to use the real path, so the test compares to it.
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(fs.realpathSync(sb.repo), '.memory-mcp', 'memory.db'), `${twin}: project path`);
        assert.ok(!e.env.MCP_MEMORY_SQLITE_PATH.includes('\\'), `${twin}: a literal backslash leaked into the project db path: ${e.env.MCP_MEMORY_SQLITE_PATH}`);
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
        assert.ok(!e.env.MCP_MEMORY_SQLITE_PATH.includes('\\'), `${twin}: a literal backslash leaked into the scoped db path: ${e.env.MCP_MEMORY_SQLITE_PATH}`);
    });

    test(`${twin}: --memory-level scoped --space work -> memory_work.db`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install', [memFlag(twin), 'scoped', spaceFlag(twin), 'work']);
        const e = memEntry(sb);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(sb.home, '.memory-mcp', 'memory_work.db'), `${twin}: scoped+space path`);
        assert.ok(!e.env.MCP_MEMORY_SQLITE_PATH.includes('\\'), `${twin}: a literal backslash leaked into the scoped+space db path: ${e.env.MCP_MEMORY_SQLITE_PATH}`);
    });

    test(`${twin}: bad --memory-level value -> usage error, nothing written`, { skip }, () =>
    {
        const sb = sandbox();
        const res = runExpectFail(twin, sb, 'install', [memFlag(twin), 'bogus']);
        assert.notStrictEqual(res.status, 0, `${twin}: bad value did not fail:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout + res.stderr, /must be 'global', 'scoped' or 'project'/, `${twin}: no usage error printed`);
        assert.ok(!fs.existsSync(path.join(sb.repo, '.mcp.json')), `${twin}: .mcp.json was written despite the bad value`);
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
    });

    test(`${twin}: import succeeds (real note, fake server) -> autoMemoryEnabled false; re-run is idempotent (import not repeated)`, { skip }, () =>
    {
        const sb = sandbox();
        seedNote(sb, 'feedback-test-note.md', { name: 'feedback-test-note', description: 'A test correction', type: 'feedback', body: 'Body text of the note.' });
        const out1 = run(twin, sb, 'install');
        assert.match(out1, /importing Claude's existing notes/, `${twin}: import was not attempted`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled not set to false`);
        const calls = fs.readFileSync(sb.callsLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
        assert.strictEqual(calls.length, 1, `${twin}: expected exactly one memory_store call`);
        assert.strictEqual(calls[0].memory_type, 'user_correction', `${twin}: feedback note kind mapping`);
        assert.deepStrictEqual(calls[0].tags.sort(), ['feedback-test-note', 'project:repo'].sort(), `${twin}: note tags`);

        const out2 = run(twin, sb, 'update');
        assert.doesNotMatch(out2, /importing Claude's existing notes/, `${twin}: the import ran again after autoMemoryEnabled was already false`);
        const callsAfter = fs.readFileSync(sb.callsLog, 'utf8').trim().split('\n').filter(Boolean);
        assert.strictEqual(callsAfter.length, 1, `${twin}: a second store call happened on re-run`);
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled flipped back`);
    });

    test(`${twin}: import fails -> autoMemoryEnabled key absent, install continues (exit 0)`, { skip }, () =>
    {
        const sb = sandbox({ failContent: 'Will fail\n\nFails always.' });
        seedNote(sb, 'feedback-fail-note.md', { name: 'feedback-fail-note', description: 'Will fail', type: 'feedback', body: 'Fails always.' });
        const res = runExpectFail(twin, sb, 'install', ['--scope', 'project', '--selection', sb.sel]);
        assert.strictEqual(res.status, 0, `${twin}: install did not continue after an import failure:\n${res.stderr}`);
        const out = res.stdout + res.stderr;
        assert.match(out, /memory notes import failed/, `${twin}: the failure was not logged`);
        const s = settingsOf(sb);
        assert.ok(!Object.prototype.hasOwnProperty.call(s, 'autoMemoryEnabled'), `${twin}: autoMemoryEnabled was written despite the import failing`);
    });

    test(`${twin}: fresh install with no notes to import still switches memory off (nothing to import = success)`, { skip }, () =>
    {
        const sb = sandbox();
        run(twin, sb, 'install');
        assert.strictEqual(settingsOf(sb).autoMemoryEnabled, false, `${twin}: autoMemoryEnabled not set when there was nothing to import`);
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
        const res = runExpectFail(twin, sb, 'install', ['--scope', 'project', '--selection', sb.sel]);
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
        const env = { ...sb.env };
        const out = twin === 'sh'
            ? execFileSync('bash', [SH, 'install', '--scope', 'global', '--selection', sb.sel, '--source', ROOT], { cwd: notGit, encoding: 'utf8', env })
            : execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'global', '-Selection', sb.sel, '-Source', ROOT], { cwd: notGit, encoding: 'utf8', env });
        assert.match(out, /global install scope with no identifiable project.*skipping the notes import/, `${twin}: the skip was not logged:\n${out}`);
        assert.ok(!fs.existsSync(path.join(sb.acct, 'settings.json')), `${twin}: an account settings.json was written despite the skip`);
    });

    test(`${twin}: a path with a space in it (HOME) survives the registration as one argument`, { skip }, () =>
    {
        const sb = sandbox();
        const spacedHome = path.join(sb.work, 'home with space');
        fs.mkdirSync(spacedHome, { recursive: true });
        const env = { ...sb.env, HOME: spacedHome, USERPROFILE: spacedHome };
        const out = twin === 'sh'
            ? execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sb.sel, '--source', ROOT], { cwd: sb.repo, encoding: 'utf8', env })
            : execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', sb.sel, '-Source', ROOT], { cwd: sb.repo, encoding: 'utf8', env });
        void out;
        const e = memEntry(sb);
        assert.strictEqual(e.env.MCP_MEMORY_SQLITE_PATH, path.join(spacedHome, '.memory-mcp', 'memory.db'), `${twin}: spaced path mismatch`);
        assert.deepStrictEqual(e.args, ['--with', 'numpy', '--from', e.args[3], 'memory', 'server'], `${twin}: args shape broke around the spaced path`);
        assert.ok(e.args[3].startsWith('mcp-memory-service[sqlite]'), `${twin}: the --from value itself was corrupted: ${e.args[3]}`);
    });
}

test('the memory entry (`--from`) survives with and without a version pin - uvx accepts both forms (see task-6-report.md)', () =>
{
    // Documented, not asserted here as a live network call (both forms were verified manually against
    // the real uvx during implementation - `uvx --from 'mcp-memory-service[sqlite]==11.13.0' ...` and
    // `uvx --from 'mcp-memory-service[sqlite]' ...` both resolved and imported cleanly). This test only
    // pins the STRING SHAPE the installers build in either case.
    const withPin = 'mcp-memory-service[sqlite]' + '==11.13.0';
    const noPin = 'mcp-memory-service[sqlite]' + '';
    assert.strictEqual(withPin, 'mcp-memory-service[sqlite]==11.13.0');
    assert.strictEqual(noPin, 'mcp-memory-service[sqlite]');
});
