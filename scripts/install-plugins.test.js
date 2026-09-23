'use strict';
// THE PLUGIN LAYER OF THE NODE SEED - Phase 7, T3.
//
// The plugins ARE the delivery from Phase 3 onward, so these decisions are the install: which
// entries, at which scope, and what comes back out. The twin sandbox tests in mcp-verify.test.js
// keep proving the shell route, which still ships for one release (R1).
const test = require('node:test');
const assert = require('node:assert');

const P = require('./install/plugins.js');

// A recording CLI: every call is kept, and `fails` names the argv words that make one fail.
function cli(fails = [])
{
    const calls = [];
    const run = (argv) =>
    {
        calls.push(argv.join(' '));
        return !fails.some((f) => argv.join(' ').includes(f));
    };
    run.calls = calls;
    run.matching = (re) => calls.filter((c) => re.test(c));
    return run;
}

const ROUTES = (over = {}) => ({ hooks: true, skills: true, mcps: true, ...over });
const COPY = ROUTES({ hooks: false, skills: false, mcps: false });
const CORE_DEPS = ['superpowers@claude-plugins-official', 'serena@claude-stack'];

// --- the route switches ---------------------------------------------------

test('routes: every route defaults ON, and only the documented `false` turns one off', () =>
{
    assert.deepStrictEqual(P.pluginRoutes({}), { hooks: true, skills: true, mcps: true });
    assert.deepStrictEqual(P.pluginRoutes({ CLAUDE_STACK_MCPS_VIA_PLUGIN: 'false' }), { hooks: true, skills: true, mcps: false });
    assert.strictEqual(P.pluginRoutes({ CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'true' }).hooks, true);
});

test('routes: the core plugin is on while ANY route is - that is what carries its dependencies', () =>
{
    assert.strictEqual(P.corePluginOn(ROUTES({ skills: false, mcps: false })), true);
    assert.strictEqual(P.corePluginOn(COPY), false);
});

// --- reading `claude plugin list --json` ----------------------------------

test('plugin-list: THIS project\'s row wins over the account row, and another project\'s is dropped', () =>
{
    const listing = P.parsePluginList(JSON.stringify({ installed: [
        { id: 'claude-stack@claude-stack', version: '0.9.0', scope: 'user', enabled: true },
        { id: 'claude-stack@claude-stack', version: '1.0.0', scope: 'project', enabled: true, projectPath: '/repo' },
        { id: 'other@x', version: '2.0.0', scope: 'project', enabled: true, projectPath: '/elsewhere' },
    ] }), '/repo');
    assert.deepStrictEqual(listing, [{ name: 'claude-stack', marketplace: 'claude-stack', version: '1.0.0', scope: 'project', enabled: true }]);
});

test('plugin-list: a marketplace filter runs BEFORE the per-name pick - a same-named foreign row never wins', () =>
{
    const json = JSON.stringify({ installed: [
        { id: 'serena@claude-plugins-official', version: '9', scope: 'project', enabled: true, projectPath: '/repo' },
        { id: 'serena@claude-stack', version: '1', scope: 'user', enabled: true },
    ] });
    assert.deepStrictEqual(P.parsePluginList(json, '/repo', { marketplace: 'claude-stack' }).map((r) => r.version), ['1']);
    assert.deepStrictEqual(P.parsePluginList(json, '/repo').map((r) => r.marketplace), ['claude-plugins-official']);
});

test('plugin-list: a missing `enabled` is enabled, and garbage is an EMPTY listing, never a crash', () =>
{
    assert.strictEqual(P.parsePluginList('[{"id":"a@m","version":"1"}]', '/repo')[0].enabled, true);
    assert.strictEqual(P.parsePluginList('{"installed":[{"id":"a@m","enabled":false}]}', '/repo')[0].enabled, false);
    assert.deepStrictEqual(P.parsePluginList('not json', '/repo'), []);
    assert.deepStrictEqual(P.parsePluginList('', '/repo'), []);
    assert.deepStrictEqual(P.parsePluginList('{"installed":[null,7,{"id":""}]}', '/repo'), []);
});

// --- the closure ----------------------------------------------------------

test('closure: the selection carries skill/agent lines only for the skills route, mcp lines only for the MCP route', () =>
{
    const skills = ['a|project-foo'];
    const agents = ['ng-implementer.md::sonnet'];
    const mcps = ['serena|x', 'sentry|@HTTP@'];
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES(), skills, agents, mcps, context7Mode: 'local' }),
        ['skill project-foo', 'agent ng-implementer', 'mcp serena', 'mcp sentry', 'mcp context7-local']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ mcps: false }), skills, agents, mcps }),
        ['skill project-foo', 'agent ng-implementer']);
    assert.deepStrictEqual(P.selectionLines({ routes: ROUTES({ skills: false }), skills, agents, mcps }),
        ['mcp serena', 'mcp sentry']);
});

test('closure: a failure to compute it drops BOTH routes to copy, together and loudly', () =>
{
    // Half a closure would leave the project with neither the plugin's copy of an item nor its own.
    const logs = [];
    const out = P.resolveStackPlugins({
        routes: ROUTES(),
        runSelection: () => { throw new Error('selection-plugins.js is not in this source'); },
        log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out.routes, { hooks: true, skills: false, mcps: false });
    assert.deepStrictEqual(out.entries, []);
    assert.ok(logs.some((m) => /not in this source.*stay on the copy route/.test(m)), logs.join(' | '));
});

test('closure: the entries come back with the extras split into skills and agents', () =>
{
    const out = P.resolveStackPlugins({
        routes: ROUTES(),
        runSelection: () => ({ entries: ['claude-stack@claude-stack', 'web-angular@claude-stack', ''], copy: ['skill project-extra', 'agent lone-analyzer', 'noise'] }),
    });
    assert.deepStrictEqual(out.entries, ['claude-stack@claude-stack', 'web-angular@claude-stack']);
    assert.deepStrictEqual(out.extraSkills, ['project-extra']);
    assert.deepStrictEqual(out.extraAgents, ['lone-analyzer']);
});

test('closure: the full copy route asks for no closure at all', () =>
{
    const out = P.resolveStackPlugins({ routes: COPY, runSelection: () => assert.fail('the copy route computed a closure') });
    assert.deepStrictEqual(out.entries, []);
});

// --- the set, and the core's dependencies ---------------------------------

test('core-deps: the dependencies are installed ONLY when this run enables no stack plugin', () =>
{
    // With a stack entry on, the CLI installs them transitively with the core - installing them
    // again would be a second install of the same thing at a possibly different scope.
    assert.deepStrictEqual(P.coreDepsNeeded(['claude-stack@claude-stack'], CORE_DEPS), []);
    assert.deepStrictEqual(P.coreDepsNeeded([], CORE_DEPS), CORE_DEPS);
});

test('set: the hooks plugin leads the stack entries, and the copy route ships the deps itself', () =>
{
    const third = ['claude-hud@claude-plugins-official'];
    assert.deepStrictEqual(
        P.pluginSet({ routes: ROUTES(), thirdParty: third, hooksPlugin: 'claude-stack-hooks@claude-stack', stackEntries: ['claude-stack@claude-stack'], coreDeps: CORE_DEPS }),
        [...third, 'claude-stack-hooks@claude-stack', 'claude-stack@claude-stack']);
    // Full copy route: no stack entry is enabled, so superpowers would simply be ABSENT unless the
    // run installs it explicitly.
    assert.deepStrictEqual(P.pluginSet({ routes: COPY, thirdParty: third, hooksPlugin: 'h@claude-stack', stackEntries: [], coreDeps: CORE_DEPS }),
        [...third, ...CORE_DEPS]);
});

// --- scope ----------------------------------------------------------------

test('scope: claude-hud is user scope whatever the run says, and the LISTING wins when it can speak', () =>
{
    assert.strictEqual(P.scopeFor('claude-hud@m', 'project', []), 'user');
    assert.strictEqual(P.scopeFor('claude-stack@claude-stack', 'project', []), 'project');
    // `claude plugin update --scope <other>` is a silent no-op, so the plugin's OWN scope wins.
    assert.strictEqual(P.scopeFor('claude-stack@claude-stack', 'project', [{ name: 'claude-stack', version: '1', scope: 'user', enabled: true }]), 'user');
});

test('marketplaces: a third-party source is registered only for a plugin this run installs', () =>
{
    const rows = [{ id: 'claude-hud@claude-hud', marketplace: 'jarrodwatts/claude-hud' }, { id: 'csharp-lsp@claude-plugins-official' }];
    assert.deepStrictEqual(P.extraMarketplaces(rows, ['claude-hud@claude-hud', 'csharp-lsp@claude-plugins-official']), ['jarrodwatts/claude-hud']);
    assert.deepStrictEqual(P.extraMarketplaces(rows, ['csharp-lsp@claude-plugins-official']), []);
    assert.deepStrictEqual(P.extraMarketplaces(undefined, ['claude-hud@claude-hud']), []);
});

// --- install --------------------------------------------------------------

test('install: the official marketplace is registered and refreshed BEFORE the first plugin install', () =>
{
    // Claude Code registers it only on its first INTERACTIVE launch, so an install before that
    // failed every official plugin with 'not found in marketplace'.
    const run = cli();
    P.installPlugins({ plugins: ['superpowers@claude-plugins-official'], scope: 'project', cli: run });
    const first = run.calls.findIndex((c) => /plugin install/.test(c));
    assert.ok(run.calls.slice(0, first).some((c) => c.includes(`marketplace add ${P.OFFICIAL_MARKETPLACE}`)), run.calls.join(' | '));
    assert.ok(run.calls.slice(0, first).some((c) => /marketplace update claude-plugins-official/.test(c)), run.calls.join(' | '));
});

test('install: every install carries -y and its own scope, and a failure is noted without aborting', () =>
{
    const run = cli(['plugin install bad@m']);
    const notes = [];
    P.installPlugins({ plugins: ['bad@m', 'claude-hud@m', 'good@m'], scope: 'project', cli: run, note: (m) => notes.push(m) });
    assert.deepStrictEqual(run.matching(/^plugin install/), [
        'plugin install bad@m --scope project -y',
        'plugin install claude-hud@m --scope user -y',
        'plugin install good@m --scope project -y',
    ]);
    assert.deepStrictEqual(notes, ['plugin bad@m failed']);
});

test('install: a stack plugin that fails while a core dependency is DISABLED prints the enable line, once', () =>
{
    const run = cli(['plugin install']);
    const logs = [];
    const listing = [{ name: 'superpowers', version: '1.0.0', scope: 'user', enabled: false }];
    P.installPlugins({ plugins: ['a@claude-stack', 'b@claude-stack'], scope: 'project', cli: run, listing, coreDeps: CORE_DEPS, log: (m) => logs.push(m), note: () => {} });
    const hints = logs.filter((m) => /is DISABLED and/.test(m));
    assert.strictEqual(hints.length, 1, logs.join(' | '));
    assert.match(hints[0], /claude plugin enable superpowers@claude-plugins-official --scope user/);
});

test('install: a failure with the dependency ENABLED says nothing about it', () =>
{
    const logs = [];
    P.installPlugins({
        plugins: ['a@claude-stack'], scope: 'project', cli: cli(['plugin install']),
        listing: [{ name: 'superpowers', version: '1.0.0', scope: 'user', enabled: true }],
        coreDeps: CORE_DEPS, log: (m) => logs.push(m), note: () => {},
    });
    assert.ok(!logs.some((m) => /is DISABLED/.test(m)), logs.join(' | '));
});

// --- retired --------------------------------------------------------------

test('retired: a retired plugin is uninstalled at ITS OWN scope, and an absent one is nothing to do', () =>
{
    const run = cli();
    const logs = [];
    const listing = [{ name: 'ponytail', version: '0.3.0', scope: 'user', enabled: true }];
    const gone = P.prunedRetired({ listing, retired: ['ponytail', 'never-installed'], scope: 'project', cli: run, log: (m) => logs.push(m) });
    assert.deepStrictEqual(gone, ['ponytail']);
    assert.deepStrictEqual(run.matching(/uninstall/), ['plugin uninstall ponytail --scope user -y']);
    assert.ok(logs.some((m) => /pruned \(retired upstream\) \[user\]: ponytail/.test(m)), logs.join(' | '));
});

// --- update ---------------------------------------------------------------

test('update: an ABSENT plugin is installed and a PARKED one enabled, both before the update call', () =>
{
    // `claude plugin update` is a no-op on a plugin that is not installed and says nothing about one
    // that is disabled - measured: two added plugins still `disabled` after the run.
    const run = cli();
    const before = [
        { name: 'parked', version: '1.0.0', scope: 'project', enabled: false },
        { name: 'live', version: '1.0.0', scope: 'project', enabled: true },
    ];
    P.updatePlugins({ plugins: ['absent@m', 'parked@m', 'live@m'], scope: 'project', before, after: before, cli: run });
    assert.deepStrictEqual(run.calls, [
        'plugin install absent@m --scope project -y',
        'plugin update absent@m --scope project -y',
        'plugin enable parked@m --scope project',
        'plugin update parked@m --scope project -y',
        'plugin update live@m --scope project -y',
    ]);
});

test('update: the version is READ BACK, and each outcome gets its own line', () =>
{
    const before = [
        { name: 'moved', version: '1.0.0', scope: 'user', enabled: true },
        { name: 'still', version: '2.0.0', scope: 'user', enabled: true },
        { name: 'parked', version: '1.0.0', scope: 'user', enabled: false },
    ];
    const after = [
        { name: 'moved', version: '1.1.0', scope: 'user', enabled: true },
        { name: 'still', version: '2.0.0', scope: 'user', enabled: true },
        { name: 'parked', version: '1.0.0', scope: 'user', enabled: false },
    ];
    const report = P.updatePlugins({ plugins: ['moved@m', 'still@m', 'parked@m', 'gone@m'], scope: 'user', before, after, cli: cli() });
    assert.match(report[0], /plugin moved: 1\.0\.0 -> 1\.1\.0/);
    assert.match(report[1], /plugin still: 2\.0\.0 \(already newest\)/);
    assert.match(report[2], /plugin parked: 1\.0\.0 but DISABLED/);
    assert.match(report[3], /plugin gone: NOT installed - the install above did not take/);
});

test('update: the listing is read AFTER the loop, never before it', () =>
{
    // `claude plugin update` reports success whether or not anything moved, so a report built from
    // the pre-loop listing would call every adopted plugin 'NOT installed'.
    let asked = 0;
    const report = P.updatePlugins({
        plugins: ['absent@m'], scope: 'project', before: [], cli: cli(),
        after: () => { asked += 1; return [{ name: 'absent', version: '1.0.0', scope: 'project', enabled: true }]; },
    });
    assert.strictEqual(asked, 1);
    assert.match(report[0], /plugin absent: 1\.0\.0 \(already newest\)/);
});

test('update: a third-party marketplace is registered before an absent plugin from it is installed', () =>
{
    const run = cli();
    P.updatePlugins({ plugins: ['claude-hud@claude-hud'], marketplaces: ['jarrodwatts/claude-hud'], scope: 'project', before: [], after: [], cli: run });
    const add = run.calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = run.calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(add >= 0 && inst > add, run.calls.join(' | '));
});

// --- the seed, end to end, against a recording CLI --------------------------------------------------
// The cases above prove what each function does with what it is HANDED; these prove the seed hands
// it. Measured on the 1.0.0 release check: the seed called installPlugins with no marketplaces, so a
// fresh account failed claude-hud with 'not found in marketplace' while every unit case stayed green.
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const HUD_SELECTION = 'skill markdown-style\nrule markdown-docs\nplugin claude-hud\n';

test('seed install: claude-hud\'s marketplace is registered before claude-hud is installed', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', HUD_SELECTION);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(inst >= 0, `claude-hud was never installed:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});

test('seed install: a run that installs no claude-hud registers no marketplace for it', POSIX_ONLY, () =>
{
    const { calls } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n');
    assert.ok(!calls.some((c) => /marketplace add jarrodwatts\/claude-hud/.test(c)), calls.join('\n'));
});

test('seed update: an absent claude-hud gets its marketplace before the install', POSIX_ONLY, () =>
{
    const { calls } = seedRun('update', HUD_SELECTION);
    const add = calls.indexOf('plugin marketplace add jarrodwatts/claude-hud');
    const inst = calls.findIndex((c) => /^plugin install claude-hud@claude-hud /.test(c));
    assert.ok(inst >= 0, `claude-hud was never installed:\n${calls.join('\n')}`);
    assert.ok(add >= 0 && add < inst, `its marketplace was not registered first:\n${calls.join('\n')}`);
});
