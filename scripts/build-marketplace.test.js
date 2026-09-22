'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEntries, applyToMarketplace, costTable } = require('./build-marketplace.js');

const SCRIPT = path.join(__dirname, 'build-marketplace.js');
const run = (args, opts = {}) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });

const entries = buildEntries();
const byName = Object.fromEntries(entries.map(e => [e.name, e]));

test('every entry shares ONE source and lists its own paths', () => {
    for (const e of entries)
    {
        assert.strictEqual(e.source, './', `${e.name} must share the repo root as its source`);
        assert.strictEqual(e.strict, false, `${e.name} carries no plugin.json of its own`);
        assert.ok(e.version && e.author && e.description, `${e.name} needs version, author, description`);
        for (const s of e.skills || []) assert.ok(s.startsWith('./stack/skills/'), `skill path: ${s}`);
        for (const a of e.agents || []) assert.ok(/^\.\/stack\/agents\/.+\.md$/.test(a), `agent path: ${a}`);
    }
});

test('an entry lists skill FOLDERS and agent FILES, the two forms spike S9 proved', () => {
    const dotnet = byName['claude-stack-dotnet'];
    assert.ok(dotnet.skills.includes('./stack/skills/dotnet'));
    assert.ok(dotnet.agents.includes('./stack/agents/dotnet-build-error-resolver.md'));
    for (const p of [...dotnet.skills, ...dotnet.agents])
        assert.ok(fs.existsSync(path.join(__dirname, '..', p)), `${p} must exist in the tree`);
});

test('dependencies are written, and the core is not generated at all', () => {
    assert.strictEqual(byName['claude-stack'], undefined,
        'the core ships from ./setup-plugin until Phase 3 moves it; the generator never rewrites that entry');
    assert.ok(byName['claude-stack-aspnet'].dependencies.includes('claude-stack-dotnet'));
    assert.deepStrictEqual(byName['claude-stack-dotnet'].dependencies, ['claude-stack'],
        'a shared plugin depends on the core only');
});

test('a leaf that holds nothing of its own still ships, as dependencies only', () => {
    const ts = byName['claude-stack-typescript'];
    assert.ok(ts, 'the typescript leaf must exist');
    assert.ok(!ts.skills && !ts.agents, 'nothing of its own');
    assert.ok(ts.dependencies.length > 1);
});

test('--check exits non-zero when the generated file is stale, zero when it is current', () => {
    assert.doesNotThrow(() => run(['--check']), 'the committed meta/plugin-entries.json must be current');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const stale = path.join(tmp, 'plugin-entries.json');
    fs.writeFileSync(stale, JSON.stringify({ generatedBy: 'build-marketplace', entries: [] }, null, 2) + '\n');
    let code = 0;
    try { run(['--check', '--entries', stale]); } catch (err) { code = err.status; }
    assert.strictEqual(code, 1, 'a stale entries file fails the check');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('--write is idempotent - a second run changes nothing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const out = path.join(tmp, 'plugin-entries.json');
    run(['--write', '--entries', out]);
    const first = fs.readFileSync(out, 'utf8');
    run(['--write', '--entries', out]);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), first, 'byte-identical on a re-run');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('applying to a marketplace keeps the hand-written setup-plugin entry and its order', () => {
    const before = {
        name: 'claude-stack',
        metadata: { version: '9.9.9' },
        plugins: [{ name: 'claude-stack', source: './setup-plugin', description: 'hand written', category: 'development' }],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'claude-stack');
    assert.strictEqual(core.source, './setup-plugin', 'the shipped core entry is not re-sourced by the generator');
    assert.strictEqual(core.description, 'hand written', 'nor re-described');
    assert.strictEqual(after.plugins[0].name, 'claude-stack', 'the core stays first');
    assert.ok(after.plugins.length > 1, 'the computed entries are appended');
});

test('malformed input fails loudly rather than emitting a short list', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const bad = path.join(tmp, 'stack-graph.json');
    fs.writeFileSync(bad, '{ not json');
    let code = 0;
    let out = '';
    try { run(['--write', '--graph', bad, '--entries', path.join(tmp, 'e.json')]); }
    catch (err) { code = err.status; out = String(err.stderr || ''); }
    assert.strictEqual(code, 1);
    assert.match(out, /stack-graph|JSON/i, 'the failure names what could not be read');
    assert.ok(!fs.existsSync(path.join(tmp, 'e.json')), 'nothing is written on a failed read');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('the cost table carries today, planned and delta for every stack', () => {
    const table = costTable();
    assert.ok(table.rows.length >= 13, 'every stack plus the multi-stack combinations');
    for (const row of table.rows)
    {
        assert.ok(row.today > 0 && row.planned > 0);
        assert.ok(row.delta <= 10, `${row.combo} is ${row.delta}% over today - the placement rule adjusts, not the gate`);
    }
    assert.ok(table.markdown.includes('| aspnet |'), 'rendered as a markdown table');
});
