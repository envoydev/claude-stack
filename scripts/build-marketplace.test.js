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
        // The core also ships the router skill from setup-plugin/, which is not a stack skill.
        for (const s of e.skills || [])
            assert.ok(s.startsWith('./stack/skills/') || s === './setup-plugin/skills/claude-stack', `skill path: ${s}`);
        for (const a of e.agents || []) assert.ok(/^\.\/stack\/agents\/.+\.md$/.test(a), `agent path: ${a}`);
    }
});

// Phase 3 moved the core off ./setup-plugin, where its own plugin.json was the manifest. At the
// shared root nothing under setup-plugin/ is auto-discovered, so every path it used to get for free
// is listed - and the two that are easy to lose on the way across are the layer-table hook and the
// superpowers dependency.
test('the core entry carries the commands, the router skill, the inline hook and the dependency', () => {
    const core = byName['claude-stack'];
    assert.ok(core, 'the core entry is generated from Phase 3 on');
    assert.strictEqual(core.source, './');
    const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin/.claude-plugin/plugin.json'), 'utf8'));
    assert.strictEqual(core.commands.length, setup.commands.length, 'every guided-walk command ships');
    for (const c of core.commands) assert.ok(fs.existsSync(path.join(__dirname, '..', c)), `command path: ${c}`);
    assert.ok(core.skills.includes('./setup-plugin/skills/claude-stack'), 'the router skill ships');
    assert.ok(core.agents.length > 0, 'the core carries its placed agents');
    const wired = JSON.stringify(core.hooks);
    assert.ok(wired.includes('setup-plugin/hooks/guard-layer-table.js'), 'the layer-table guard is declared inline');
    assert.ok(wired.includes('${CLAUDE_PLUGIN_ROOT}'), 'and resolved through the plugin root');
    assert.deepStrictEqual(core.dependencies, setup.dependencies, 'the dependency plugin.json declared is carried, not dropped');
});

test('an entry lists skill FOLDERS and agent FILES, the two forms spike S9 proved', () => {
    const dotnet = byName['claude-stack-dotnet'];
    assert.ok(dotnet.skills.includes('./stack/skills/dotnet'));
    assert.ok(dotnet.agents.includes('./stack/agents/dotnet-build-error-resolver.md'));
    for (const p of [...dotnet.skills, ...dotnet.agents])
        assert.ok(fs.existsSync(path.join(__dirname, '..', p)), `${p} must exist in the tree`);
});

test('dependencies are written, and the core is one of the generated entries', () => {
    assert.ok(byName['claude-stack'], 'Phase 3 generates the core entry like any other');
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

test('applying to a marketplace rewrites the core and leaves what the generator does not own', () => {
    const before = {
        name: 'claude-stack',
        metadata: { version: '9.9.9' },
        plugins: [
            { name: 'claude-stack', source: './setup-plugin', description: 'the pre-Phase-3 entry', category: 'development' },
            { name: 'claude-stack-hooks', source: './', description: 'generated elsewhere', hooks: { Stop: [] } },
        ],
    };
    const after = applyToMarketplace(JSON.parse(JSON.stringify(before)), entries);
    const core = after.plugins.find(p => p.name === 'claude-stack');
    assert.strictEqual(core.source, './', 'the core is re-sourced to the shared root');
    assert.ok(Array.isArray(core.commands) && core.commands.length, 'and carries its commands now');
    const hooksEntry = after.plugins.find(p => p.name === 'claude-stack-hooks');
    assert.strictEqual(hooksEntry.description, 'generated elsewhere', 'an entry this generator does not own is untouched');
    assert.strictEqual(after.plugins.length, 1 + entries.length, 'the hooks entry plus every generated entry');
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
