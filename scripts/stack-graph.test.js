'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildStackGraph } = require('./stack-graph.js');

const graph = buildStackGraph();

test('agent skill edges come from the declared skills: frontmatter', () => {
    const a = graph.agents['aspnet-solution-designer'];
    assert.ok(a, 'aspnet-solution-designer must be in the graph');
    assert.strictEqual(a.skillsSource, 'frontmatter');
    for (const s of ['dotnet', 'dotnet-web-backend', 'dotnet-testing', 'project-solution-design'])
    {
        assert.ok(a.skills.includes(s), `expected agent->skill edge to ${s}`);
    }
});

test('rule skill edges resolve from the rule body', () => {
    const r = graph.rules['csharp-conventions'];
    assert.ok(r, 'csharp-conventions must be in the graph');
    assert.ok(r.skills.includes('csharp'), 'csharp-conventions -> csharp');
    assert.deepStrictEqual(r.paths, ['**/*.cs']);
});

test('every edge target exists in a catalog (no dangling references)', () => {
    const skills = new Set(Object.keys(graph.skills));
    const agents = new Set(Object.keys(graph.agents));
    const mcps = new Set(graph.catalog.mcps);
    const plugins = new Set(graph.catalog.plugins);
    for (const [name, node] of Object.entries(graph.agents))
    {
        for (const s of node.skills) assert.ok(skills.has(s), `${name} -> unknown skill ${s}`);
        for (const a of node.agents) assert.ok(agents.has(a), `${name} -> unknown agent ${a}`);
        for (const m of node.mcps) assert.ok(mcps.has(m), `${name} -> unknown mcp ${m}`);
        for (const p of node.plugins) assert.ok(plugins.has(p), `${name} -> unknown plugin ${p}`);
    }
});

test('an agent never lists itself as an agent edge', () => {
    for (const [name, node] of Object.entries(graph.agents))
    {
        assert.ok(!node.agents.includes(name), `${name} lists itself`);
    }
});

const { serialize, readCommitted } = require('./stack-graph.js');

test('the committed stack-graph.json is in sync with a fresh build', () => {
    assert.strictEqual(readCommitted(), serialize(buildStackGraph()),
        'run `node scripts/stack-graph.js --write` and commit the result');
});

test('project-capabilities mcps edge includes all 8 backticked MCPs (fenced code block must not desync the tokenizer)', () => {
    const s = graph.skills['project-capabilities'];
    assert.ok(s, 'project-capabilities must be in the graph');
    for (const m of ['serena', 'context7', 'memory', 'playwright', 'angular-cli', 'sentry', 'chrome-devtools', 'appium-mcp'])
    {
        assert.ok(s.mcps.includes(m), `expected skill->mcp edge to ${m}`);
    }
});

test('ci-failure-diagnoser plugins edge resolves from a namespaced plugin:skill frontmatter entry', () => {
    const a = graph.agents['ci-failure-diagnoser'];
    assert.ok(a, 'ci-failure-diagnoser must be in the graph');
    assert.ok(a.plugins.includes('superpowers'), 'expected agent->plugin edge to superpowers');
});
