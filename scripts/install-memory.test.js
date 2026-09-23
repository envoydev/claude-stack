'use strict';
// THE MEMORY LAYER OF THE NODE SEED - Phase 7, T4.
//
// Switching Claude's own memory off is the only irreversible-feeling thing an install does, so the
// order is the test: import first, switch off second, and never the second without the first.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memory = require('./install/memory.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-memory-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ settings, rules = ['baseline-memory.md'] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    for (const r of rules) fs.writeFileSync(path.join(root, '.claude', 'rules', r), '# rule\n');
    if (settings !== undefined) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
    return root;
}
const settingsOf = (root) => path.join(root, '.claude', 'settings.json');
const GATE = (root, over = {}) => ({
    projectRoot: root, settingsFile: settingsOf(root),
    mcps: ['serena|x', 'memory|y'], rules: ['baseline-memory.md::x'], ...over,
});

// --- the level -> path rule ----------------------------------------------

test('level: the three levels resolve to the three shapes, and back again', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.strictEqual(memory.pathForLevel('global', at), path.join('/home/u', '.memory-mcp', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('scoped', at), path.join('/home/u', '.memory-mcp', 'memory_work.db'));
    assert.strictEqual(memory.pathForLevel('project', at), path.join('/repo', '.memory-mcp', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('scoped', { ...at, space: '' }), path.join('/home/u', '.memory-mcp', 'memory_default.db'));
    for (const level of ['global', 'scoped', 'project'])
        assert.strictEqual(memory.levelOfPath(memory.pathForLevel(level, at), at), level, level);
});

test('level: a foreign path is never mistaken for one of ours', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo' };
    // Matched EXACTLY, never as a prefix or a substring.
    assert.strictEqual(memory.levelOfPath('/home/u/.memory-mcp/other/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('/home/u/.memory-mcp-backup/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('/elsewhere/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('', at), '');
});

// --- reading the switch ---------------------------------------------------

test('state: absent, true, false and malformed are four different answers', () =>
{
    assert.strictEqual(memory.autoMemoryState(settingsOf(project())), 'absent');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{}' }))), 'absent');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{"autoMemoryEnabled":true}' }))), 'true');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{"autoMemoryEnabled":false}' }))), 'false');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{ broken' }))), 'malformed');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '[]' }))), 'malformed');
});

// --- writing it -----------------------------------------------------------

test('switch-off: every other key survives, and the file is written once', () =>
{
    const root = project({ settings: '{\n  "env": { "A": "1" },\n  "hooks": {}\n}\n' });
    const logs = [];
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root), { log: (m) => logs.push(m) }), true);
    const data = JSON.parse(fs.readFileSync(settingsOf(root), 'utf8'));
    assert.deepStrictEqual(data, { env: { A: '1' }, hooks: {}, autoMemoryEnabled: false });
    assert.ok(logs.some((m) => /autoMemoryEnabled set to false/.test(m)), logs.join(' | '));
});

test('switch-off: a malformed settings file REFUSES the write and says so', () =>
{
    const root = project({ settings: '{ not json' });
    const logs = [];
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root), { log: (m) => logs.push(m) }), false);
    assert.strictEqual(fs.readFileSync(settingsOf(root), 'utf8'), '{ not json', 'the user\'s file was overwritten');
    assert.ok(logs.some((m) => /not valid JSON - autoMemoryEnabled left untouched/.test(m)), logs.join(' | '));
});

test('switch-off: an absent settings file is created with just the key', () =>
{
    const root = project();
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root)), true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsOf(root), 'utf8')), { autoMemoryEnabled: false });
});

// --- the gate -------------------------------------------------------------

test('gate: everything present is a go', () =>
{
    assert.strictEqual(memory.importGate(GATE(project())).go, true);
});

test('gate: no project root, no memory server, no rule selected, no rule on disk - four different refusals', () =>
{
    const root = project();
    assert.match(memory.importGate(GATE(root, { projectRoot: '' })).reason, /no identifiable project/);
    assert.match(memory.importGate(GATE(root, { mcps: ['serena|x'] })).reason, /memory MCP is not part of this install/);
    assert.match(memory.importGate(GATE(root, { rules: ['baseline-security.md::x'] })).reason, /baseline-memory\.md is not part of this install/);
    const bare = project({ rules: [] });
    assert.match(memory.importGate(GATE(bare)).reason, /did not land in/);
    // Every one of them ends the same way: Claude's own memory stays on.
    for (const g of [GATE(root, { projectRoot: '' }), GATE(root, { mcps: [] }), GATE(root, { rules: [] })])
        assert.match(memory.importGate(g).reason, /stays on/);
});

test('gate: a missing tool is named, and already-off is never re-run', () =>
{
    const root = project();
    assert.match(memory.importGate(GATE(root, { tools: { node: true, uvx: false } })).reason, /uvx not found/);
    const off = project({ settings: '{"autoMemoryEnabled":false}' });
    const gate = memory.importGate(GATE(off));
    assert.strictEqual(gate.go, false);
    assert.strictEqual(gate.already, true);
    assert.strictEqual(gate.reason, undefined, 'an already-off install logged a refusal');
});

// --- the order ------------------------------------------------------------

test('order: a FAILED import leaves Claude\'s own memory ON', () =>
{
    // Never retried into a false success, and the old MEMORY.md is never deleted either way.
    const root = project({ settings: '{}' });
    const importer = path.join(TMP, 'importer.js');
    fs.writeFileSync(importer, '');
    const logs = [];
    const out = memory.importNotes({
        gate: { go: true }, importer, runImport: () => false,
        settingsFile: settingsOf(root), log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out, { switchedOff: false, imported: false });
    assert.strictEqual(memory.autoMemoryState(settingsOf(root)), 'absent');
    assert.ok(logs.some((m) => /import failed - Claude's own memory stays ON/.test(m)), logs.join(' | '));
});

test('order: the switch-off happens only AFTER the import succeeds', () =>
{
    const root = project({ settings: '{}' });
    const importer = path.join(TMP, 'importer2.js');
    fs.writeFileSync(importer, '');
    const seen = [];
    const out = memory.importNotes({
        gate: { go: true }, importer,
        runImport: () => { seen.push(`state-at-import:${memory.autoMemoryState(settingsOf(root))}`); return true; },
        settingsFile: settingsOf(root),
    });
    assert.deepStrictEqual(seen, ['state-at-import:absent'], 'the switch-off ran before the import');
    assert.strictEqual(out.switchedOff, true);
    assert.strictEqual(memory.autoMemoryState(settingsOf(root)), 'false');
});

test('order: a refused gate never runs the importer', () =>
{
    const root = project();
    const out = memory.importNotes({
        gate: { go: false, reason: 'memory: skipped' }, importer: 'x',
        runImport: () => assert.fail('the importer ran behind a closed gate'),
        settingsFile: settingsOf(root),
    });
    assert.strictEqual(out.imported, false);
});

test('order: an importer missing from the snapshot is reported, and nothing is switched off', () =>
{
    const root = project({ settings: '{}' });
    const logs = [];
    const out = memory.importNotes({
        gate: { go: true }, importer: path.join(TMP, 'no-such-importer.js'),
        runImport: () => assert.fail('an absent importer was run'),
        settingsFile: settingsOf(root), log: (m) => logs.push(m),
    });
    assert.strictEqual(out.switchedOff, false);
    assert.ok(logs.some((m) => /not found in the source snapshot/.test(m)), logs.join(' | '));
});

// --- the level resolution -------------------------------------------------

test('level: the flag wins, an existing registration is kept BYTE-FOR-BYTE, else global', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.deepStrictEqual(memory.resolveLevel({ flag: 'scoped', ...at }),
        { level: 'scoped', dbPath: path.join('/home/u', '.memory-mcp', 'memory_work.db'), from: 'flag' });
    // A level change never copies or deletes a database, so an absent flag must not re-point one.
    const kept = memory.resolveLevel({ registeredPath: '/somewhere/else/memory.db', ...at });
    assert.strictEqual(kept.dbPath, '/somewhere/else/memory.db');
    assert.strictEqual(kept.level, 'custom', 'a foreign path was labelled as one of our three levels');
    assert.deepStrictEqual(memory.resolveLevel(at),
        { level: 'global', dbPath: path.join('/home/u', '.memory-mcp', 'memory.db'), from: 'default' });
});

test('level: a registration already at one of the three shapes keeps that NAME, not custom', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo' };
    const got = memory.resolveLevel({ registeredPath: path.join('/repo', '.memory-mcp', 'memory.db'), ...at });
    assert.strictEqual(got.level, 'project');
    assert.strictEqual(got.from, 'registration');
});
