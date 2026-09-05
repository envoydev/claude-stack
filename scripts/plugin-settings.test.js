'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { planFor, applyTargets, leaves, atPath, setLeaf } = require('./plugin-settings.js');
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-settings.json'), 'utf8'));

function tmp()
{
    return fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-'));
}

const ENTRY = {
    targets: [
        { file: 'plugins/x/config.json', settings: { display: { a: true, b: true }, top: 1 } },
        { file: 'settings.json', requires_path: 'statusLine', settings: { statusLine: { refreshInterval: 5 } } },
    ],
};

test('leaves flattens to dotted keys; atPath/setLeaf address them', () => {
    assert.deepStrictEqual(leaves({ a: { b: 1 }, c: [1, 2] }), [['a.b', 1], ['c', [1, 2]]]);
    assert.strictEqual(atPath({ a: { b: 2 } }, 'a.b'), 2);
    assert.strictEqual(atPath({ a: {} }, 'a.b.c'), undefined, 'a missing path is undefined, never a throw');
    const doc = {};
    setLeaf(doc, 'a.b.c', true);
    assert.deepStrictEqual(doc, { a: { b: { c: true } } });
});

test('a missing target file is planned as create-and-add; requires_path gates the other', () => {
    const dir = tmp();
    const plan = planFor(ENTRY, dir);
    assert.strictEqual(plan[0].exists, false);
    assert.deepStrictEqual(plan[0].rows.map(r => r.status), ['missing', 'missing', 'missing']);
    // the statusLine block belongs to the plugin's own setup - never invented here
    assert.match(plan[1].skipped, /no `statusLine`/);
    assert.strictEqual(applyTargets(plan, false).written, 1, 'only the un-gated target is written');
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'the gated file is not created');
});

test('apply is ADD-ONLY: a value the user already chose is kept and reported, not overwritten', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'plugins', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins', 'x', 'config.json'), JSON.stringify({ display: { a: false, mine: 'keep' }, other: 1 }));
    applyTargets(planFor(ENTRY, dir), false);

    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'x', 'config.json'), 'utf8'));
    assert.strictEqual(doc.display.a, false, 'the differing value survives an apply');
    assert.strictEqual(doc.display.b, true, 'the missing one is added');
    assert.strictEqual(doc.display.mine, 'keep', 'a key outside the catalog is never touched');
    assert.strictEqual(doc.other, 1);

    // --replace is the explicit opt-in
    applyTargets(planFor(ENTRY, dir), true);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'x', 'config.json'), 'utf8')).display.a, true);
});

test('a gated target with the block present is patched in place', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'hud' }, model: 'opus' }));
    applyTargets(planFor(ENTRY, dir), false);

    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.deepStrictEqual(doc.statusLine, { type: 'command', command: 'hud', refreshInterval: 5 });
    assert.strictEqual(doc.model, 'opus', 'the rest of settings.json is untouched');
});

test('the shipped catalog only recommends keys the plugin actually reads', () => {
    // Not a guess: every row names the version and file its keys were read from, and the guided
    // substep offers exactly these - a key the plugin does not read is a silent no-op.
    const hud = CATALOG.plugins['claude-hud'];
    assert.ok(hud, 'claude-hud has a row');
    assert.match(hud.verified, /claude-hud \d+\.\d+\.\d+/, 'the row names the verified version');
    assert.strictEqual(hud.scope, 'account');
    const files = hud.targets.map(t => t.file);
    assert.deepStrictEqual(files, ['plugins/claude-hud/config.json', 'settings.json']);
    assert.strictEqual(hud.targets[1].requires_path, 'statusLine', 'the settings.json patch is gated');
    for (const t of hud.targets)
    {
        for (const group of Object.keys(t.settings)) assert.ok(t.why[group], `${t.file}: the '${group}' group carries a why`);
    }
});
