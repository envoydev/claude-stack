'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scopedFor, parse, reachable } = require('./scope-agent-preloads.js');
const { placement, CORE } = require('./plugin-placement.js');

const ROOT = path.join(__dirname, '..');
const rows = scopedFor();
const place = placement();

test('every agent with a preload list is placed, and every cite it makes is reachable', () => {
    assert.ok(rows.length >= 30, `expected the seats to declare preloads, got ${rows.length}`);
    for (const r of rows) assert.strictEqual(r.problem, null, `${r.file}: ${r.problem}`);
});

test('the shipped files are already scoped - the generator has nothing to do', () => {
    const stale = rows.filter(r => r.block !== r.wanted).map(r => r.file);
    assert.deepStrictEqual(stale, [], 'run `npm run scope-preloads` and commit the result');
});

// Spike S11: a scoped cite resolves even when the skill lives in a DIFFERENT plugin, which is the
// majority case here. Spike S6: the BARE form preloads a stale project copy when one is present.
test('a house cite carries its plugin prefix, and it is the plugin that actually holds the skill', () => {
    const home = new Map();
    for (const [plugin, items] of Object.entries(place.plugins)) for (const s of items.skills) home.set(s, plugin);
    let scoped = 0;
    let cross = 0;
    for (const r of rows)
    {
        for (const line of r.wanted.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean))
        {
            if (line === 'skills:') continue;
            if (!line.startsWith('claude-stack')) continue;
            scoped++;
            const [plugin, ...rest] = line.split(':');
            const skill = rest.join(':');
            assert.strictEqual(home.get(skill), plugin, `${r.file}: ${skill} is placed in ${home.get(skill)}, cited as ${plugin}`);
            if (plugin !== r.plugin) cross++;
        }
    }
    assert.ok(scoped > 100, `expected the whole preload surface to be scoped, counted ${scoped}`);
    assert.ok(cross > 0, 'the cross-plugin case S11 proved must actually occur, or this proves nothing');
});

test('a FOREIGN cite is left exactly as it is - this generator owns house skills only', () => {
    const diag = rows.find(r => r.file === 'ci-failure-diagnoser.md');
    assert.ok(diag, 'the diagnoser declares preloads');
    assert.ok(diag.wanted.includes('- superpowers:systematic-debugging'), 'the superpowers cite is untouched');
});

test('reachable() is the closure, so a cite can never name a plugin the project may not enable', () => {
    const wpf = reachable(place, 'claude-stack-wpf');
    assert.ok(wpf.has('claude-stack-wpf') && wpf.has(CORE), 'itself and the core');
    assert.ok(wpf.has('claude-stack-csharp'), 'and what it depends on');
    assert.ok(!wpf.has('claude-stack-angular'), 'never an unrelated stack');
});

test('a flow-style skills: line is reported, never silently guessed at', () => {
    assert.throws(() => parse('---\nname: x\nskills: [a, b]\n---\nbody\n', 'x.md'), /not a YAML list/);
    assert.strictEqual(parse('---\nname: x\n---\nbody\n', 'x.md'), null, 'no list at all is simply nothing to do');
});

test('the graph still stores BARE skill names, or placement and the prefix would define each other', () => {
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta/stack-graph.json'), 'utf8'));
    for (const [agent, node] of Object.entries(graph.agents))
        for (const s of node.skills || [])
            assert.ok(!s.includes(':'), `${agent} carries a scoped name in the graph: ${s}`);
});
