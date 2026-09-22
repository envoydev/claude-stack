'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { placement, costOf, costToday, GROUP_NAMES, CORE, EXTRAS } = require('./plugin-placement.js');

const p = placement();

test('the core plugin is exactly the always closure - 21 skills, 8 agents', () => {
    const core = p.plugins[CORE];
    assert.ok(core, 'the core plugin must exist');
    assert.strictEqual(core.skills.length, 21);
    assert.strictEqual(core.agents.length, 8);
    for (const s of ['project-agent-capabilities', 'project-solve-cross-task'])
        assert.ok(core.skills.includes(s), `${s} is always-closure, so it belongs to the core`);
    for (const a of ['integration-reviewer', 'security-auditor'])
        assert.ok(core.agents.includes(a), `${a} is always-closure, so it belongs to the core`);
    assert.deepStrictEqual(core.dependencies, [], 'the core depends on nothing');
});

test('an item reached by exactly one stack lands in that stack leaf', () => {
    const leaf = p.plugins['claude-stack-aspnet'];
    assert.ok(leaf, 'the aspnet leaf must exist');
    for (const a of ['aspnet-solution-designer', 'aspnet-implementer', 'aspnet-verifier'])
        assert.ok(leaf.agents.includes(a), `${a} is reached by aspnet alone`);
    assert.ok(leaf.skills.includes('dotnet-web-backend'), 'an aspnet-only skill');
    assert.ok(!leaf.skills.includes('dotnet'), 'a five-stack skill is NOT duplicated into the leaf');
});

test('an item reached by several stacks lands in the plugin named for exactly that set', () => {
    const dotnet = p.plugins['claude-stack-dotnet'];
    assert.ok(dotnet, 'the dotnet group must exist');
    for (const s of ['dotnet', 'csharp-design-patterns', 'dotnet-architecture', 'ilspy-decompile'])
        assert.ok(dotnet.skills.includes(s), `${s} is reached by the five .NET stacks`);
    assert.ok(!dotnet.skills.includes('csharp'), 'csharp is also reached by data, so it is a different set');
    const angular = p.plugins['claude-stack-angular'];
    for (const s of ['angular-security', 'angular-testing', 'angular-conventions'])
        assert.ok(angular.skills.includes(s), `${s} is reached by web-angular and ionic-angular`);
});

test('the four skills data shares with .NET have ONE home, and data pays for nothing else', () => {
    const csharp = p.plugins['claude-stack-csharp'];
    assert.deepStrictEqual(csharp.skills, ['csharp', 'dotnet-migrate', 'dotnet-testing']);
    assert.deepStrictEqual(p.plugins['claude-stack-aspnet-data'].skills, ['dotnet-data-access']);
    for (const s of ['csharp', 'dotnet-migrate', 'dotnet-testing', 'dotnet-data-access'])
    {
        const homes = Object.entries(p.plugins).filter(([, v]) => v.skills.includes(s)).map(([k]) => k);
        assert.strictEqual(homes.length, 1, `${s} must have one home, got ${homes.join(',')}`);
    }
    assert.ok(!costOf(p, ['data']).plugins.includes('claude-stack-dotnet'),
        'a data-only project never pulls the .NET group');
});

test('every skill and agent has exactly one home, and the union is complete', () => {
    const seen = new Map();
    const note = (kind, name, where) =>
    {
        const key = kind + ':' + name;
        assert.ok(!seen.has(key), `${key} is in two homes: ${seen.get(key)} and ${where}`);
        seen.set(key, where);
    };
    for (const [name, plug] of Object.entries(p.plugins))
    {
        for (const s of plug.skills) note('skill', s, name);
        for (const a of plug.agents) note('agent', a, name);
    }
    for (const s of p.extras.skills) note('skill', s, EXTRAS);
    for (const a of p.extras.agents) note('agent', a, EXTRAS);
    assert.strictEqual(seen.size, 79 + 43, 'every one of the 79 skills and 43 agents is placed once');
});

test('the 25 opt-in skills and the one opt-in agent are extras, not a plugin', () => {
    assert.strictEqual(p.extras.skills.length, 25);
    assert.deepStrictEqual(p.extras.agents, ['related-project-analyzer']);
    assert.ok(!(EXTRAS in p.plugins), 'extras is a folder in the core, never a plugin entry');
    for (const s of ['plugin-authoring', 'postgres', 'project-related-context'])
        assert.ok(p.extras.skills.includes(s), `${s} is reached by no stack`);
});

test('no shared plugin depends on a leaf, and every leaf reaches its shared plugins', () => {
    for (const [name, plug] of Object.entries(p.plugins))
        for (const dep of plug.dependencies)
        {
            assert.ok(p.plugins[dep], `${name} depends on ${dep}, which must be a real plugin`);
            assert.ok(p.rank[dep] < p.rank[name], `${name} may not depend on ${dep} (a leaf or a peer)`);
        }
    assert.ok(p.plugins['claude-stack-aspnet'].dependencies.includes('claude-stack-dotnet'));
    assert.ok(p.plugins['claude-stack-aspnet'].dependencies.includes(CORE));
    assert.deepStrictEqual(p.plugins['claude-stack-dotnet'].dependencies, [CORE]);
});

test('every stack has a leaf to enable, even one holding nothing of its own', () => {
    for (const stack of p.stacks)
        assert.ok(p.plugins['claude-stack-' + stack], `${stack} must have a leaf`);
    const ts = p.plugins['claude-stack-typescript'];
    assert.deepStrictEqual([...ts.skills, ...ts.agents], [], 'typescript shares everything it uses');
    assert.ok(ts.dependencies.length > 1, 'so its leaf is dependencies only');
});

test('every shared owner set is NAMED, and no name is stale', () => {
    assert.deepStrictEqual(p.unnamed, [], 'an unnamed owner set is a lint failure, not a generated slug');
    const live = new Set(Object.values(p.owners).filter(o => o.length > 1).map(o => o.sort().join('+')));
    for (const key of Object.keys(GROUP_NAMES))
        assert.ok(live.has(key), `GROUP_NAMES has a stale key: ${key}`);
});

test('an unnamed owner set is reported rather than guessed', () => {
    const q = placement({ groupNames: {} });
    assert.ok(q.unnamed.length > 0, 'the run reports the sets it could not name');
    assert.ok(q.unnamed.includes('aspnet+console+windows-service+winforms+wpf'));
});

test('costOf sums description chars for a combination and never double-counts', () => {
    const one = costOf(p, ['aspnet']);
    assert.strictEqual(one.chars, costOf(p, ['aspnet', 'aspnet']).chars, 'a repeated stack is not paid twice');
    assert.ok(one.plugins.includes(CORE) && one.plugins.includes('claude-stack-aspnet'));
    assert.ok(costOf(p, ['aspnet', 'web-angular', 'data']).chars > one.chars, 'more stacks cost more');
});

test('the plugin split costs a project no more than per-item selection does today', () => {
    for (const stack of p.stacks)
    {
        const today = costToday([stack]).chars;
        const planned = costOf(p, [stack]).chars;
        assert.ok(planned <= today, `${stack}: ${planned} planned vs ${today} today - the split may not cost more`);
    }
    const combo = ['aspnet', 'web-angular', 'data'];
    assert.ok(costOf(p, combo).chars <= costToday(combo).chars, 'nor for a multi-stack project');
});
