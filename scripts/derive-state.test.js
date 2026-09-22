'use strict';
// THE ONE DERIVATION - Phase 8, T0.
//
// Three commands and the installer used to decide four times what a selection installs: the walk
// described it in prose, the seed computed it again in code, and a route change reached three of
// them and not the fourth. `derive-state.js` is the single answer, and this file is its contract.
//
// The assertions that matter are the AGREEMENT ones: the derivation may not disagree with the two
// engines that already own their half - `stack-select.js` owns the closure, `selection-plugins.js`
// owns the placement. A derivation that computed its own plugin set would be the fifth copy.
//
// The OFF lists are the other half, and they have one rule each that is easy to get subtly wrong:
//   - an agent is denied only when an ENABLED plugin actually carries it. A seat sitting in a
//     plugin this project never enabled is not loaded at all, so denying it is noise in every
//     session's settings file, and it ages badly: the day that plugin IS enabled, the stale deny
//     silently drops a seat the user just asked for.
//   - a hook is off when the release SHIPS it and this selection did not pick it, whole catalog,
//     because the hooks entry carries all thirteen whatever the project picked.
//   - a skill cannot be switched off at all (spike S2: skillOverrides moved 0 tokens on a plugin
//     skill), so a skill the closure carries and the selection did not pick is REPORTED, never
//     silently counted as dropped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deriveState, denySpec } = require('./derive-state.js');
const { pluginsFor, readSelection, itemsOf } = require('./selection-plugins.js');
const { loadManifest } = require('./install/manifest.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function selectionFile(lines)
{
    const p = path.join(TMP, `sel-${seq++}.txt`);
    fs.writeFileSync(p, `${lines.join('\n')}\n`);
    return p;
}

// A real selection, closed by the engine that owns closure - never a hand-typed list, which is how
// a fixture stops describing what an install actually picks.
function realSelection()
{
    const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
    const seed = recs.stacks.aspnet;
    const always = recs.always;
    const raw = {
        skills: [...(always.skills || []), ...(seed.skills || [])],
        agents: [...(always.agents || []), ...(seed.agents || [])],
        rules: [...(always.rules || []), ...(seed.rules || [])],
        mcps: [...(always.mcps || []), ...(seed.mcps || [])],
        hooks: [...(always.hooks || [])],
    };
    const rawFile = path.join(TMP, `raw-${seq++}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(raw));
    const emitted = path.join(TMP, `emit-${seq++}.txt`);
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [
        path.join(ROOT, 'scripts', 'stack-select.js'),
        '--selection', rawFile, '--graph', path.join(ROOT, 'meta', 'stack-graph.json'), '--emit', emitted,
    ], { encoding: 'utf8' });
    return emitted;
}

const derive = (file) => deriveState({ selection: file, sourceDir: ROOT });

test('derive-state: the seven keys, every one of them present', () =>
{
    const got = derive(realSelection());
    for (const key of ['plugins', 'skills', 'agents', 'rules', 'hooks', 'mcps', 'env'])
        assert.ok(Object.hasOwn(got, key), `no ${key} in the derived state`);
});

test('derive-state: the plugin set is selection-plugins, not a second opinion', () =>
{
    const file = realSelection();
    const got = derive(file);
    const want = pluginsFor(readSelection(file)).plugins.map((p) => `${p}@claude-stack`);
    assert.deepStrictEqual(got.plugins, want);
});

test('derive-state: the extras are the items no plugin carries, and they are the copy list', () =>
{
    const file = realSelection();
    const got = derive(file);
    const want = pluginsFor(readSelection(file)).copy;
    assert.deepStrictEqual(got.skills.extras, want.skills);
    assert.deepStrictEqual(got.agents.extras, want.agents);
});

test('derive-state: an agent is denied only when an ENABLED plugin carries it', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    const carried = new Set(itemsOf(got.plugins.map((p) => p.split('@')[0])).agents);

    for (const name of got.agents.off)
    {
        assert.ok(carried.has(name), `${name} is denied but no enabled plugin carries it`);
        assert.ok(!picked.agents.has(name), `${name} is denied and picked`);
    }
    for (const name of carried)
        if (!picked.agents.has(name)) assert.ok(got.agents.off.includes(name), `${name} rides an enabled plugin, was not picked, and is not denied`);
    // ... and `on` is what the project actually gets: picked, and carried or copied.
    assert.deepStrictEqual(got.agents.on, [...picked.agents].sort());
});

test('derive-state: the deny spelling is the SCOPED identifier the spike measured', () =>
{
    // S3: `permissions.deny: ["Agent(<plugin>:<name>)"]` dropped the seat and its description
    // (-434 tokens). The bare name is a different address and was measured doing nothing.
    assert.strictEqual(denySpec('aspnet-verifier', 'claude-stack-aspnet'), 'Agent(claude-stack-aspnet:aspnet-verifier)');
    const got = derive(realSelection());
    for (const spec of got.agents.deny)
        assert.match(spec, /^Agent\(claude-stack[a-z-]*:[a-z0-9-]+\)$/, `${spec} is not the scoped spelling`);
    assert.strictEqual(got.agents.deny.length, got.agents.off.length, 'every denied seat needs its spec, and only those');
});

test('derive-state: the hooks off-list is the whole shipped catalog minus what was picked', () =>
{
    const file = realSelection();
    const got = derive(file);
    const shipped = new Set(loadManifest(ROOT).catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')));
    assert.ok(shipped.size >= 13, `the hooks catalog reads ${shipped.size} rows`);
    for (const name of got.hooks.off) assert.ok(shipped.has(name), `${name} is switched off but the release does not ship it`);
    assert.deepStrictEqual(
        [...shipped].filter((h) => !got.hooks.on.includes(h)).sort(),
        [...got.hooks.off].sort(),
        'on + off must be the whole catalog, or a hook is neither wired nor named',
    );
    assert.strictEqual(got.env.CLAUDE_STACK_HOOKS_OFF, got.hooks.off.join(','));
});

test('derive-state: a skill the closure carries but nobody picked is REPORTED, never dropped', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    const carried = itemsOf(got.plugins.map((p) => p.split('@')[0])).skills;
    assert.deepStrictEqual(got.skills.carried, carried);
    assert.deepStrictEqual(got.skills.undroppable, carried.filter((s) => !picked.skills.has(s)));
    // The whole point of R1: there is no off-list for skills, so nothing may claim one.
    assert.ok(!Object.hasOwn(got.skills, 'off'), 'a skill off-list would be a lever that does not exist');
});

test('derive-state: rules and MCP servers pass through as picked - they are copied and registered by name', () =>
{
    // Both lists are SORTED, and the fixture is written so that file order, reverse order and
    // sorted order are three different sequences - a two-name fixture read the same forwards and
    // backwards and let an unsorted list pass.
    const file = selectionFile([
        'skill csharp', 'agent security-auditor', 'rule csharp-conventions', 'rule baseline-security',
        'mcp serena', 'mcp context7', 'mcp playwright-chrome', 'hook guard-secret-value',
    ]);
    const got = derive(file);
    assert.deepStrictEqual(got.rules.copy, ['baseline-security', 'csharp-conventions']);
    assert.deepStrictEqual(got.mcps, ['context7', 'playwright-chrome', 'serena']);
    assert.deepStrictEqual(got.hooks.on, ['guard-secret-value']);
});

test('derive-state: an empty selection installs the core and denies every seat it carries', () =>
{
    const got = derive(selectionFile(['rule baseline-security']));
    assert.deepStrictEqual(got.plugins, ['claude-stack@claude-stack'], 'the core is always enabled');
    const core = itemsOf(['claude-stack']);
    assert.deepStrictEqual(got.agents.off, core.agents, 'the core seats ride in either way, so each is denied');
    assert.deepStrictEqual(got.agents.on, []);
    assert.deepStrictEqual(got.skills.undroppable, core.skills, 'and its skills are reported, because nothing can drop them');
});

test('derive-state: a selection file that does not exist fails loudly, never as an empty install', () =>
{
    assert.throws(() => derive(path.join(TMP, 'no-such-selection.txt')), /cannot read/);
});

test('derive-state: the CLI prints the same object it returns', () =>
{
    const file = realSelection();
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', file], { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(out), derive(file));
});
