'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'setup-plugin');

test('marketplace.json is valid and points at the setup-plugin subdir', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.strictEqual(mp.name, 'claude-stack');
    assert.ok(Array.isArray(mp.plugins) && mp.plugins.length === 1);
    const p = mp.plugins[0];
    assert.strictEqual(p.name, 'claude-stack');
    assert.strictEqual(p.source, './setup-plugin');
    assert.ok(typeof p.description === 'string' && p.description.trim() !== '');
});

test('plugin.json is valid and the command exists', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(pj.name, 'claude-stack');
    assert.ok(typeof pj.version === 'string' && pj.version.trim() !== '');
    assert.ok(typeof pj.description === 'string' && pj.description.trim() !== '');
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'claude-stack.md')), 'the /claude-stack command exists');
});
// Note: the bundled SKILL.md is asserted in Task 3's test additions (it lands there).

test('no tracked plugin file leaks an email address', () => {
    for (const rel of ['.claude-plugin/marketplace.json', 'setup-plugin/.claude-plugin/plugin.json'])
    {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/@claude-stack|@main/g, '')), `${rel} must not contain an email`);
    }
});

const { computeClosure } = require('./stack-select.js');
const graph = require('./stack-graph.json');

const RECS = path.join(PLUGIN_DIR, 'skills', 'setup', 'references', 'recommendations.json');

test('every recommendation name resolves in the dependency graph', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const agentKeys = new Set(Object.keys(graph.agents));
    const ruleKeys = new Set(Object.keys(graph.rules));
    const skillKeys = new Set(Object.keys(graph.skills));
    const seeds = [recs.always, ...Object.values(recs.stacks)];
    for (const seed of seeds)
    {
        for (const a of seed.agents || []) assert.ok(agentKeys.has(a), `recommendation agent '${a}' not in graph`);
        for (const r of seed.rules || []) assert.ok(ruleKeys.has(r), `recommendation rule '${r}' not in graph`);
        for (const s of seed.skills || []) assert.ok(skillKeys.has(s), `recommendation skill '${s}' not in graph`);
        const pluginCatalog = new Set(graph.catalog.plugins);
        for (const p of seed.plugins || []) assert.ok(pluginCatalog.has(p), `recommendation plugin '${p}' not in catalog`);
    }
});

test('the aspnet seed installs the csharp LSP plugin', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const closed = computeClosure(graph, { agents: recs.stacks.aspnet.agents, rules: recs.stacks.aspnet.rules, plugins: recs.stacks.aspnet.plugins });
    assert.ok(closed.plugins.includes('csharp-lsp'), 'aspnet installs csharp-lsp');
});

test('the aspnet seed closes to its .NET vertical', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const seed = recs.stacks['aspnet'];
    assert.ok(seed, 'an aspnet stack recommendation exists');
    const closed = computeClosure(graph, { agents: [...(recs.always.agents || []), ...(seed.agents || [])], rules: [...(recs.always.rules || []), ...(seed.rules || [])] });
    assert.ok(closed.skills.includes('csharp'), 'aspnet closure pulls csharp');
    assert.ok(closed.skills.includes('dotnet-web-backend'), 'aspnet closure pulls the web hub');
});

test('the always block seeds the cross-cutting agents and baseline rules', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    for (const r of ['baseline-interaction', 'baseline-security', 'baseline-git'])
    {
        assert.ok((recs.always.rules || []).includes(r), `always seeds ${r}`);
    }
});

test('a single-stack (aspnet) recommendation does not pull cross-stack skills', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const closed = computeClosure(graph, { agents: [...(recs.always.agents||[]), ...recs.stacks.aspnet.agents], rules: [...(recs.always.rules||[]), ...recs.stacks.aspnet.rules], plugins: recs.stacks.aspnet.plugins });
    // dotnet-wpf is left out of this list on purpose: it still reaches an aspnet
    // closure via the shared dotnet-build-error-resolver / dotnet-test-failure-resolver
    // (both part of aspnet's own seed, mentioning dotnet-wpf for mixed-solution build
    // errors) - a separate, pre-existing edge this always-roster trim does not touch.
    for (const cross of ['angular-security', 'mobile', 'mobile-security'])
    {
        assert.ok(!closed.skills.includes(cross), `aspnet setup must not pull ${cross}`);
    }
    assert.ok(closed.skills.includes('csharp') && closed.skills.includes('dotnet-web-backend'), 'still pulls its own vertical');
});

for (const name of ['setup', 'update', 'configure'])
{
    test(`the ${name} skill exists with valid manual-only frontmatter`, () => {
        const skill = path.join(PLUGIN_DIR, 'skills', name, 'SKILL.md');
        assert.ok(fs.existsSync(skill), 'SKILL.md exists');
        const fm = fs.readFileSync(skill, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        assert.ok(fm, 'has frontmatter');
        assert.match(fm[1], new RegExp(`name:\\s*${name}`), `name is ${name}`);
        assert.match(fm[1], /disable-model-invocation:\s*true/, 'manual-only');
    });
}

test('every plugin skill holds to the shared one-download protocol and the router names them all', () => {
    for (const name of ['update', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', name, 'SKILL.md'), 'utf8');
        assert.match(body, /references\/source-protocol\.md/, `${name} cites the setup skill's source-protocol.md`);
    }
    const router = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'claude-stack.md'), 'utf8');
    for (const name of ['setup', 'update', 'configure'])
    {
        assert.match(router, new RegExp('`' + name + '`'), `/claude-stack routes to ${name}`);
    }
});
