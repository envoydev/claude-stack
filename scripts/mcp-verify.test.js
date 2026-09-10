'use strict';
// The update/install MCP verify pass, both twins. The bug it exists for: `claude mcp add` over an
// existing server name prints 'already exists' and exits 0, so a `remove` that did not take (an old
// CLI, a scope mismatch, a shadowing registration) is INDISTINGUISHABLE from a successful rewrite -
// the run reports the mcp refreshed and the stale entry survives forever (measured on a consuming
// project still carrying the pre-0.2.34 stdio sentry registration).
//
// The stub `claude` on PATH is exactly that failure: every CLI call exits 0 and writes nothing. A
// run against it must still leave .mcp.json in the manifest shape, because the verify pass reads the
// file back and repairs the one entry that drifted.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');

// The ps1 twin runs where PowerShell is installed (windows-latest and macos-latest carry pwsh; a
// bare ubuntu does not) - a visible SKIP elsewhere, never a silent gap.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

const SENTRY_URL = 'https://mcp.sentry.dev/mcp/${SENTRY_SLUG}';
const SENTRY_HDR = 'Sentry-Bearer ${SENTRY_ACCESS_TOKEN}';

// The registration the screenshot from a consuming project carried: the pre-0.2.34 stdio sentry,
// Windows-flavoured (cmd /c npx), with the retired SENTRY_HOST env.
const STALE_SENTRY = {
    type: 'stdio',
    command: 'cmd',
    args: ['/c', 'npx', '-y', '@sentry/mcp-server@latest'],
    env: { SENTRY_ACCESS_TOKEN: '${SENTRY_ACCESS_TOKEN}', SENTRY_HOST: '${SENTRY_HOST}' },
};
// A server the project added by hand - never a stack name, so the pass must not touch it.
const HAND_ADDED = { type: 'stdio', command: 'node', args: ['tools/my-server.js'] };

function sandbox(mcpServers)
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpv-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const acct = path.join(work, 'acct');
    fs.mkdirSync(acct);
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(work, 'claude-calls.log');
    const plugins = path.join(work, 'plugins.json');
    fs.writeFileSync(plugins, '[]');
    // Stub CLI: logs every invocation, answers `plugin list --json` from a fixture, exits 0 for
    // everything else - the silent-no-op the real CLI performs on `mcp add` over an existing name.
    // `mcp get` answers from a fixture when one is set (the user-scope route reads shapes through it)
    // and `mcp add` promotes the 'after' fixture over it - a CLI whose add actually works.
    fs.writeFileSync(path.join(bin, 'claude'), [
        '#!/bin/sh',
        'printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
        'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "get" ] && [ -s "$CLAUDE_STUB_MCPGET" ]; then cat "$CLAUDE_STUB_MCPGET"; fi',
        'if [ "$1" = "mcp" ] && [ "$2" = "add" ] && [ -s "$CLAUDE_STUB_MCPGET_NEW" ]; then cat "$CLAUDE_STUB_MCPGET_NEW" > "$CLAUDE_STUB_MCPGET"; fi',
        'exit 0',
        ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), [
        '@echo off',
        '>>"%CLAUDE_STUB_LOG%" echo %*',
        'if "%~1"=="plugin" if "%~2"=="list" type "%CLAUDE_STUB_PLUGINS%"',
        'if "%~1"=="mcp" if "%~2"=="get" if exist "%CLAUDE_STUB_MCPGET%" type "%CLAUDE_STUB_MCPGET%"',
        'if "%~1"=="mcp" if "%~2"=="add" if exist "%CLAUDE_STUB_MCPGET_NEW%" copy /y "%CLAUDE_STUB_MCPGET_NEW%" "%CLAUDE_STUB_MCPGET%" >nul',
        'exit /b 0',
        ''].join('\r\n'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill markdown-docs\nrule markdown-docs\nhook guard-secret-value\nmcp sentry\nmcp serena\n');
    if (mcpServers) fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers }, null, 2) + '\n');
    // The installer writes every key it finds in its launch environment, and this runner may itself
    // sit in a session whose account env carries the real ones - scrub them so no real value lands.
    const env = {
        ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct,
        PATH: bin + path.delimiter + process.env.PATH,
        CLAUDE_STUB_LOG: log, CLAUDE_STUB_PLUGINS: plugins,
        CLAUDE_STUB_MCPGET: path.join(work, 'mcp-get.txt'), CLAUDE_STUB_MCPGET_NEW: path.join(work, 'mcp-get-after.txt'),
    };
    for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY']) delete env[k];
    return { work, repo, acct, sel, env, log, plugins, mcpGet: path.join(work, 'mcp-get.txt'), mcpGetAfter: path.join(work, 'mcp-get-after.txt') };
}

// The scope defaults to project and a caller passing its own (the global-install tests) replaces it -
// PowerShell rejects a parameter bound twice.
const runSh = (sb, action, args = [], scope = 'project') => execFileSync('bash', [SH, action, '--scope', scope, '--selection', sb.sel, '--source', ROOT, ...args],
    { cwd: sb.repo, encoding: 'utf8', env: sb.env });
const runPs = (sb, action, args = [], scope = 'project') => execFileSync('pwsh', ['-NoProfile', '-File', PS1, action, '-Scope', scope, '-Selection', sb.sel, '-Source', ROOT, ...args],
    { cwd: sb.repo, encoding: 'utf8', env: sb.env });

const servers = (sb) => JSON.parse(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8')).mcpServers;
const calls = (sb) => (fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8') : '');

function assertSentryRepaired(sb, out, twin)
{
    const s = servers(sb);
    assert.deepStrictEqual(s.sentry, { type: 'http', url: SENTRY_URL, headers: { Authorization: SENTRY_HDR } },
        `${twin}: the stale stdio sentry registration was not repaired`);
    assert.deepStrictEqual(s['hand-added'], HAND_ADDED, `${twin}: a hand-added server was rewritten`);
    assert.match(out, /mcp repaired: sentry/, `${twin}: the repair is not reported`);
}

function assertSerenaShape(sb, twin)
{
    const s = servers(sb);
    assert.strictEqual(s.serena.type, 'stdio', `${twin}: serena type`);
    assert.strictEqual(s.serena.command, 'uvx', `${twin}: serena command`);
    assert.deepStrictEqual(s.serena.env, { SERENA_HOME: '.serena/home' }, `${twin}: serena env`);
    // The version pin is resolved from the network and is empty offline - assert the shape, not the pin.
    assert.ok(s.serena.args.includes('--project-from-cwd'), `${twin}: serena args lost --project-from-cwd`);
    assert.ok(s.serena.args.includes('--context') && s.serena.args.includes('claude-code'), `${twin}: serena args lost the context`);
    assert.ok(!s.serena.args.includes('--project'), `${twin}: serena kept the retired --project flag`);
}

test('sh: update repairs a stale MCP registration the CLI silently refused to rewrite', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'update');
        assertSentryRepaired(sb, out, 'sh');
        assert.match(calls(sb), /mcp remove sentry/, 'sh: the CLI route still runs first');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: install repairs it too - install SKIPS a name the CLI reports as already configured', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'install');
        assertSentryRepaired(sb, out, 'sh');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a stdio server drifted off the manifest args is rewritten to the current spec', () =>
{
    const stale = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server', '--project', '${CLAUDE_PROJECT_DIR}'], env: {} };
    const sb = sandbox({ serena: stale, 'hand-added': HAND_ADDED });
    try
    {
        const out = runSh(sb, 'update');
        assertSerenaShape(sb, 'sh');
        assert.match(out, /mcp repaired: serena/, 'sh: the serena repair is not reported');
        assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, 'sh: a hand-added server was rewritten');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a registration already in the manifest shape is left byte-identical and reported as nothing to repair', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        runSh(sb, 'update');
        const first = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runSh(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), first, 'sh: a no-drift run rewrote the file');
        assert.doesNotMatch(out, /mcp repaired:/, 'sh: a no-drift run claimed a repair');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: update runs `plugin update` at the scope the plugin is actually installed at', () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY });
    fs.writeFileSync(sb.sel, fs.readFileSync(sb.sel, 'utf8') + 'plugin superpowers\n');
    // Installed at USER scope while the run is --scope project: today the run passes its own scope
    // and `claude plugin update --scope project` is a no-op, so the plugin stays on its old version.
    fs.writeFileSync(sb.plugins, JSON.stringify([
        { id: 'superpowers@claude-plugins-official', version: '6.2.0', scope: 'user', enabled: true },
    ]));
    try
    {
        const out = runSh(sb, 'update');
        assert.match(calls(sb), /plugin update superpowers@claude-plugins-official --scope user/, 'sh: the plugin was updated at the wrong scope');
        assert.match(out, /plugin superpowers/, 'sh: the plugin version state is not reported');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: update repairs a stale MCP registration the CLI silently refused to rewrite (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        assertSentryRepaired(sb, runPs(sb, 'update'), 'ps1');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: install repairs it too, and a second run rewrites nothing (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        assertSentryRepaired(sb, runPs(sb, 'install'), 'ps1');
        const first = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runPs(sb, 'update');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), first, 'ps1: a no-drift run rewrote the file');
        assert.doesNotMatch(out, /mcp repaired:/, 'ps1: a no-drift run claimed a repair');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: a stdio server drifted off the manifest args is rewritten to the current spec (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const stale = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server', '--project', '${CLAUDE_PROJECT_DIR}'], env: {} };
    const sb = sandbox({ serena: stale, 'hand-added': HAND_ADDED });
    try
    {
        runPs(sb, 'update');
        assertSerenaShape(sb, 'ps1');
        assert.deepStrictEqual(servers(sb)['hand-added'], HAND_ADDED, 'ps1: a hand-added server was rewritten');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('the repaired entries match byte-for-byte what `claude mcp add` itself writes', () =>
{
    // Captured from the real CLI (claude mcp add --transport http ... --header / -e K=V -- cmd args).
    // The verify pass writes these shapes without the CLI, so a drift in the CLI's format shows up here.
    const sb = sandbox({ context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: {} } });
    fs.writeFileSync(sb.sel, 'skill markdown-docs\nrule markdown-docs\nhook guard-secret-value\nmcp context7\n');
    try
    {
        runSh(sb, 'update');
        assert.deepStrictEqual(servers(sb).context7, {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' },
        }, 'sh: the context7 remote registration is not the shape the CLI writes');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1 leaves a project the sh twin already repaired untouched (cross-OS parity)', { skip: skipNoPwsh }, () =>
{
    // A repo shared by a macOS and a Windows developer: whichever twin runs second must agree that
    // the entry is already the manifest shape, or every update flips the file back and forth.
    const sb = sandbox({ sentry: STALE_SENTRY, 'hand-added': HAND_ADDED });
    try
    {
        runSh(sb, 'update');
        const afterSh = fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8');
        const out = runPs(sb, 'update');
        assert.doesNotMatch(out, /mcp repaired:/, 'ps1: rewrote what the sh twin had already repaired');
        assert.strictEqual(fs.readFileSync(path.join(sb.repo, '.mcp.json'), 'utf8'), afterSh, 'ps1: reformatted the file the sh twin wrote');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

// --- user scope (a global install) ------------------------------------------------------------
// There is no .mcp.json to own: the registration lives in the account config, which the installers
// never hand-edit. The shape is read through `claude mcp get` and a mismatch is retried once.
const GET_STALE = [
    'sentry:', '  Scope: User config', '  Type: stdio',
    '  Command: cmd', '  Args: /c npx -y @sentry/mcp-server@latest', '',
].join('\n');
const GET_FIXED = [
    'sentry:', '  Scope: User config', '  Type: http',
    `  URL: ${SENTRY_URL}`, '',
].join('\n');
const userSel = 'skill markdown-docs\nmcp sentry\n';

// install is the route that reaches this branch: it SKIPS the add for a name the CLI already
// reports as configured, so an old-shaped registration survives it untouched until the verify pass.
test('sh: a user-scope registration in the old shape is re-registered through the CLI and confirmed', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);
    fs.writeFileSync(sb.mcpGetAfter, GET_FIXED);
    try
    {
        const out = runSh(sb, 'install', [], 'global');
        assert.match(out, /mcp shape drifted at user scope: sentry/, 'sh: the drift was not detected at user scope');
        assert.match(out, /mcp repaired: sentry \(user scope\)/, 'sh: the retry was not confirmed');
        assert.strictEqual(fs.readFileSync(sb.mcpGet, 'utf8'), GET_FIXED, 'sh: the CLI was not re-run');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('sh: a user-scope registration the retry cannot fix is reported, never silently accepted', () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);   // no 'after' fixture: the CLI keeps reporting the old shape
    try
    {
        const out = runSh(sb, 'update', [], 'global');
        assert.match(out, /could not be brought to the current shape at user scope/, 'sh: an unrepairable registration was not reported');
        assert.match(out, /item\(s\) failed above/, 'sh: it did not count as a run failure');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});

test('ps1: a user-scope registration in the old shape is re-registered through the CLI and confirmed (pwsh required)', { skip: skipNoPwsh }, () =>
{
    const sb = sandbox();
    fs.writeFileSync(sb.sel, userSel);
    fs.writeFileSync(sb.mcpGet, GET_STALE);
    fs.writeFileSync(sb.mcpGetAfter, GET_FIXED);
    try
    {
        const out = runPs(sb, 'install', [], 'global');
        assert.match(out, /mcp shape drifted at user scope: sentry/, 'ps1: the drift was not detected at user scope');
        assert.match(out, /mcp repaired: sentry \(user scope\)/, 'ps1: the retry was not confirmed');
    }
    finally { fs.rmSync(sb.work, { recursive: true, force: true }); }
});
