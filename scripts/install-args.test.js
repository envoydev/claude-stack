'use strict';
// THE FLAG SURFACE OF THE NODE SEED - Phase 7, T1.
//
// The shell twin's `usage()` block IS the contract, and Phase 7 is a rewrite, never a behaviour
// change: every flag the twins take, the Node seed takes, with the same enum values, the same
// lower-casing, the same refusals, and the same two spellings (`--flag value` and `--flag=value`).
//
// Every refusal below happens BEFORE anything is written. That is the rule the shell states about
// `--docs-versioning` and the one worth keeping everywhere: a typo that reaches settings.json is a
// bad value a later run reads back as a deliberate choice.
const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs } = require('./install/args.js');

const ROOT = path.resolve(__dirname, '..');
const TMP_ENTRY = fs.mkdtempSync(path.join(os.tmpdir(), 'install-entry-'));
test.after(() => fs.rmSync(TMP_ENTRY, { recursive: true, force: true }));

const ok = (argv, env) => parseArgs(argv, env || {});
const fails = (argv, pattern, env) =>
{
    assert.throws(() => parseArgs(argv, env || {}), (err) =>
    {
        assert.match(err.message, pattern, `wrong refusal for ${JSON.stringify(argv)}: ${err.message}`);
        return true;
    }, `${JSON.stringify(argv)} was accepted`);
};

test('install-args: the action is positional and REQUIRED - there is no default install', () =>
{
    assert.strictEqual(ok(['install']).action, 'install');
    assert.strictEqual(ok(['update']).action, 'update');
    fails([], /action/i);
    fails(['provision'], /install.*update|action/i);
});

test('install-args: both spellings of every valued flag mean the same thing', () =>
{
    for (const [flag, value, key] of [
        ['--space', 'work', 'space'],
        ['--scope', 'global', 'scope'],
        ['--context7', 'local', 'context7'],
        ['--sentry-slug', 'acme/api', 'sentrySlug'],
        ['--sentry-auth', 'oauth', 'sentryAuth'],
        ['--docs-versioning', 'local', 'docsVersioning'],
        ['--memory-level', 'scoped', 'memoryLevel'],
        ['--selection', '/tmp/sel.txt', 'selection'],
        ['--source', '/tmp/src', 'source'],
    ])
    {
        const spaced = ok(['install', flag, value])[key];
        const equals = ok(['install', `${flag}=${value}`])[key];
        assert.strictEqual(spaced, equals, `${flag} disagrees between its two spellings`);
        assert.strictEqual(spaced, value, `${flag} did not land in '${key}'`);
    }
});

test('install-args: a valued flag given LAST with no value is refused, not read as empty', () =>
{
    for (const flag of ['--space', '--scope', '--context7', '--sentry-slug', '--sentry-auth',
        '--docs-versioning', '--memory-level', '--selection', '--source'])
        fails(['install', flag], new RegExp(`${flag}.*needs a value`));
});

test('install-args: the boolean flags take no value', () =>
{
    const p = ok(['install', '--github-cli', '--keep-pins', '--installed-only', '--print-plan', '--skills-only']);
    assert.strictEqual(p.githubCli, true);
    assert.strictEqual(p.keepPins, true);
    assert.strictEqual(p.installedOnly, true);
    assert.strictEqual(p.printPlan, true);
    assert.strictEqual(p.skillsOnly, true);
});

test('install-args: an unknown argument is refused and the message NAMES the flags', () =>
{
    fails(['install', '--oops'], /unknown argument '--oops'/);
    fails(['install', '--oops'], /--memory-level/);   // the message lists what IS accepted
});

test('install-args: the enums are lower-cased, so PowerShell casing works on both seeds', () =>
{
    assert.strictEqual(ok(['install', '--scope', 'Global']).scope, 'global');
    assert.strictEqual(ok(['install', '--context7', 'Remote']).context7, 'remote');
    assert.strictEqual(ok(['install', '--sentry-auth', 'OAuth']).sentryAuth, 'oauth');
    assert.strictEqual(ok(['install', '--docs-versioning', 'Git']).docsVersioning, 'git');
    assert.strictEqual(ok(['install', '--memory-level', 'Scoped']).memoryLevel, 'scoped');
});

test('install-args: --space is baked into a PATH, so its characters are checked', () =>
{
    assert.strictEqual(ok(['install', '--space', 'work-2.0_x']).space, 'work-2.0_x');
    fails(['install', '--space', '-lead'], /--space/);
    fails(['install', '--space', 'has space'], /--space/);
    fails(['install', '--space', 'sl/ash'], /--space/);
    // the casing of a space IS significant - it names a directory
    assert.strictEqual(ok(['install', '--space', 'Work']).space, 'Work');
});

test('install-args: every enum refuses a value outside its set', () =>
{
    fails(['install', '--scope', 'repo'], /--scope must be 'project' or 'global'/);
    fails(['install', '--context7', 'hosted'], /--context7 must be 'local' or 'remote'/);
    fails(['install', '--sentry-auth', 'bearer'], /--sentry-auth must be 'token' or 'oauth'/);
    fails(['install', '--docs-versioning', 'svn'], /--docs-versioning must be 'git' or 'local'/);
    fails(['install', '--memory-level', 'account'], /--memory-level must be/);
});

test('install-args: the defaults are project scope, remote context7, and nothing else decided', () =>
{
    const p = ok(['install']);
    assert.strictEqual(p.scope, 'project');
    assert.strictEqual(p.context7, 'remote');
    // '' means 'not given' - a later rule decides, and that is NOT the same as a default
    assert.strictEqual(p.sentryAuth, '');
    assert.strictEqual(p.docsVersioning, '');
    assert.strictEqual(p.memoryLevel, '');
    assert.deepStrictEqual(p.playwrightBrowsers, []);
});

test('install-args: the flag beats the environment, and the environment beats the default', () =>
{
    assert.strictEqual(ok(['install'], { SCOPE: 'global' }).scope, 'global');
    assert.strictEqual(ok(['install', '--scope', 'project'], { SCOPE: 'global' }).scope, 'project');
    assert.strictEqual(ok(['install'], { SENTRY_SLUG: 'from-env' }).sentrySlug, 'from-env');
    assert.strictEqual(ok(['install', '--sentry-slug', 'from-flag'], { SENTRY_SLUG: 'from-env' }).sentrySlug, 'from-flag');
});

test('install-args: --memory-level project cannot ride a global install', () =>
{
    // A global install registers ONE memory server for every project of the account, so its db
    // cannot live inside one repo: every other project would share that file, and it would go
    // when the repo goes.
    fails(['install', '--memory-level', 'project', '--scope', 'global'], /--memory-level project cannot be used with --scope global/);
    assert.strictEqual(ok(['install', '--memory-level', 'project']).memoryLevel, 'project');
});

test('install-args: the playwright engines come back in ONE canonical order, however they were typed', () =>
{
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'webkit,chrome']).playwrightBrowsers,
        ['chrome', 'webkit'], 'the server list depends on how the flag was typed');
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'MSEdge,Firefox']).playwrightBrowsers,
        ['msedge', 'firefox']);
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'chrome,chrome']).playwrightBrowsers,
        ['chrome'], 'a repeated engine produced two servers');
});

test('install-args: a playwright value naming no engine is a typo, never "no flag"', () =>
{
    fails(['install', '--playwright-browsers', ','], /--playwright-browsers needs at least one/);
    fails(['install', '--playwright-browsers', 'safari'], /--playwright-browsers takes chrome, msedge, firefox, webkit/);
    fails(['install', '--playwright-browsers='], /--playwright-browsers.*needs a value/);
});

test('install-args: --playwright-enabled must be one of the KEPT engines', () =>
{
    assert.strictEqual(ok(['install', '--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'firefox']).playwrightEnabled, 'firefox');
    fails(['install', '--playwright-browsers', 'chrome', '--playwright-enabled', 'webkit'],
        /--playwright-enabled must be one of the kept engines/);
    fails(['install', '--playwright-enabled', 'safari'], /--playwright-enabled takes chrome, msedge, firefox, webkit/);
    // given alone it is legal - the engine is ADDED to the set
    assert.strictEqual(ok(['install', '--playwright-enabled', 'webkit']).playwrightEnabled, 'webkit');
});

// ------------------------------------------------------------------ the entry point

const { main, PENDING_LAYERS } = require('./install/claude-stack.js');

// The entry is driven in-process with captured streams: it has no side effects to sandbox yet, and
// an execFileSync per case would add seconds to a file that runs in milliseconds.
function run(argv, env = {})
{
    let out = '';
    let err = '';
    const code = main(argv, { HOME: '/nonexistent-home', ...env }, { out: (s) => { out += s; }, err: (s) => { err += s; } });
    return { code, out, err };
}

test('install-entry: a bad flag prints the usage and exits 1 - nothing is resolved first', () =>
{
    const r = run(['install', '--scope', 'repo']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /--scope must be 'project' or 'global'/);
    assert.match(r.err, /Usage:/, 'the refusal printed no usage');
    assert.strictEqual(r.out, '', 'a refused run still resolved a source');
});

test('install-entry: --print-plan reports and exits 0, because reporting writes nothing', () =>
{
    const r = run(['install', '--source', ROOT, '--print-plan', '--memory-level', 'scoped']);
    assert.strictEqual(r.code, 0, `--print-plan failed: ${r.err}`);
    assert.match(r.out, /source: .*\(provided\)/);
    assert.match(r.out, /plan: install from provided/);
    assert.match(r.out, /memoryLevel: scoped/);
});

test('install-entry: a REAL run refuses while the layers are missing, and names them', () =>
{
    const r = run(['install', '--source', ROOT]);
    assert.strictEqual(r.code, 2, 'the incomplete seed installed something');
    for (const layer of PENDING_LAYERS)
        assert.ok(r.err.includes(layer), `the refusal did not name the '${layer}' layer`);
    assert.match(r.err, /claude-stack\.sh/, 'the refusal did not point at the route that works');
});

test('install-entry: a --source that is not the stack fails before any layer is reached', () =>
{
    const r = run(['install', '--source', path.join(TMP_ENTRY, 'nope')]);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /not a claude-stack checkout/);
});
