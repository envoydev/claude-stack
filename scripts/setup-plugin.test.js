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

test('plugin.json is valid, the four commands are listed, and the router skill exists', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(pj.name, 'claude-stack');
    assert.ok(typeof pj.version === 'string' && pj.version.trim() !== '');
    assert.ok(typeof pj.description === 'string' && pj.description.trim() !== '');
    // Plugin COMMANDS display namespaced-only (/claude-stack:setup); plugin SKILLS display bare -
    // so the workers must be commands and the router a skill named exactly like the plugin
    // (bare /claude-stack, no /claude-stack:claude-stack stutter). Empirically proven layout.
    assert.deepStrictEqual(pj.commands, ['./commands/setup.md', './commands/update.md', './commands/configure.md', './commands/validate.md']);
    for (const name of ['setup', 'update', 'configure', 'validate'])
    {
        assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`)), `the /claude-stack:${name} command exists`);
    }
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'skills', 'claude-stack', 'SKILL.md')), 'the /claude-stack router skill exists');
    assert.ok(!fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'claude-stack.md')), 'no router COMMAND - a command named like the plugin displays as the /claude-stack:claude-stack stutter');
});

test('no tracked plugin file leaks an email address', () => {
    for (const rel of ['.claude-plugin/marketplace.json', 'setup-plugin/.claude-plugin/plugin.json'])
    {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/@claude-stack|@main/g, '')), `${rel} must not contain an email`);
    }
});

const { computeClosure } = require('./stack-select.js');
const graph = require('../meta/stack-graph.json');

const RECS = path.join(ROOT, 'meta', 'recommendations.json');

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
        const mcpCatalog = new Set(graph.catalog.mcps);
        for (const m of seed.mcps || []) assert.ok(mcpCatalog.has(m), `recommendation mcp '${m}' not in catalog`);
        const hookCatalog = new Set(graph.catalog.hooks);
        for (const h of seed.hooks || []) assert.ok(hookCatalog.has(h), `recommendation hook '${h}' not in catalog`);
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
    // the entry-point orchestrator installs everywhere - previously only the four
    // repair-rule stacks pulled it, so a mobile/data/devops-only install shipped without
    // the skill that drives its own trio.
    assert.ok((recs.always.skills || []).includes('project-solve-cross-task'), 'always seeds the orchestrator');
});

test('every C# vertical closure carries the dotnet router its csharp baseline routes through', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    for (const st of ['aspnet', 'wpf', 'console'])
    {
        const closed = computeClosure(graph, recs.stacks[st]);
        assert.ok(closed.skills.includes('dotnet'), `${st} closure pulls the dotnet router`);
        assert.ok(closed.skills.includes('csharp'), `${st} closure pulls csharp`);
    }
});

test('the typescript pseudo-stack seeds the TS rule and LSP plugin for plain TS/Node repos', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const ts = recs.stacks.typescript;
    assert.ok(ts, 'a typescript stack recommendation exists');
    assert.ok((ts.rules || []).includes('typescript-conventions'), 'seeds the conventions rule');
    assert.ok((ts.plugins || []).includes('typescript-lsp'), 'seeds the LSP plugin');
    assert.ok(computeClosure(graph, ts).skills.includes('typescript'), 'the closure pulls the typescript skill via the rule');
});

test('a single-stack (aspnet) recommendation does not pull cross-stack skills', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const closed = computeClosure(graph, { agents: [...(recs.always.agents||[]), ...recs.stacks.aspnet.agents], rules: [...(recs.always.rules||[]), ...recs.stacks.aspnet.rules], plugins: recs.stacks.aspnet.plugins });
    // dotnet-wpf is left out of this list on purpose: it still reaches an aspnet
    // closure via the shared dotnet-build-error-resolver / dotnet-test-failure-resolver
    // (both part of aspnet's own seed, mentioning dotnet-wpf for mixed-solution build
    // errors) - a separate, pre-existing edge this always-roster trim does not touch.
    for (const cross of ['angular-security', 'mobile', 'ionic-security'])
    {
        assert.ok(!closed.skills.includes(cross), `aspnet setup must not pull ${cross}`);
    }
    assert.ok(closed.skills.includes('csharp') && closed.skills.includes('dotnet-web-backend'), 'still pulls its own vertical');
});

for (const name of ['setup', 'update', 'configure', 'validate'])
{
    test(`the ${name} command exists with valid manual-only frontmatter`, () => {
        const cmd = path.join(PLUGIN_DIR, 'commands', `${name}.md`);
        assert.ok(fs.existsSync(cmd), 'command file exists');
        const fm = fs.readFileSync(cmd, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        assert.ok(fm, 'has frontmatter');
        assert.match(fm[1], /description:\s*\S/, 'has a description (shown in the / picker)');
        assert.match(fm[1], /disable-model-invocation:\s*true/, 'manual-only');
    });
}

test('the guided walks hold the layer order, the step banners, and the cascade machinery', () => {
    for (const name of ['setup', 'configure', 'validate'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /rules -> agents -> skills -> hooks -> MCPs -> plugins/, `${name} walks the layers in dependency order`);
        assert.match(body, /\[step \d+\/\d+ - /, `${name} announces every step with the n/total banner`);
    }
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--dropped/, 'configure drives the drop cascade through stack-select --dropped');
    assert.match(configure, /orphan:/, 'configure consumes the orphan: lines');
});

// The install-time twin of validate's judgment gate: a typed add that conflicts with the
// project's stated conventions gets a quote-gated, non-blocking warning at the prereq step.
test('setup and configure carry the brownfield convention-conflict warning gate', () => {
    for (const name of ['setup', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /Convention-conflict warnings/, `${name} has the conflict-warning gate`);
        assert.match(body, /No citable conflict, no\s+warning/, `${name} keeps the citation gate`);
        assert.match(body, /never blocks/, `${name} keeps the warning non-blocking`);
    }
});

test('validate reconciles both ways (--redundant + --missing), walks layers, is project-mode-only', () => {
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8');
    assert.match(body, /--redundant/, 'validate drives the remove side through stack-select --redundant');
    assert.match(body, /--missing/, 'validate drives the add side through stack-select --missing');
    assert.match(body, /\[step \d+\/\d+ - /, 'validate announces every step with the n/total banner');
    assert.match(body, /project mode only/i, 'validate refuses outside a project');
    assert.match(body, /claude-stack\.sh" install/, 'validate installs the accepted adds via the installer');
    // the judgment step: two gates (code-corroborated non-use, verbatim doc conflict), never
    // mixed with signal tiers
    assert.match(body, /JUDGMENT-DROP/, 'the judgment step exists with its labeled verdict');
    assert.match(body, /No gate evidence, no proposal/, 'judgment proposals are gate-evidence-gated');
    assert.match(body, /corroborate non-use in the code/, 'the advisory list is the judgment step\'s first input');
    assert.match(body, /read code and manifests,\s+not conventions/, 'no project docs skips only the doc path, not the corroboration path');
    // the data-driven judgment candidates: overlap/dormant lines + precomputed version conflicts
    assert.match(body, /JUDGMENT-ADD/, 'the corroborated-need gate exists');
    assert.match(body, /--judgment/, 'validate computes the judgment lines through the tool');
    assert.match(body, /`overlap:`/, 'overlap candidates come from the tool output');
    assert.match(body, /`dormant:`/, 'dormant advisories come from the tool output');
});

test('every command holds to the shared one-download protocol and the router skill names them all', () => {
    for (const name of ['setup', 'update', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/references\/source-protocol\.md/, `${name} cites the shared source-protocol.md via the plugin root`);
    }
    const router = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'claude-stack', 'SKILL.md'), 'utf8');
    assert.match(router.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1], /name:\s*claude-stack/, 'router skill named like the plugin -> displays bare /claude-stack');
    for (const name of ['setup', 'update', 'configure'])
    {
        assert.match(router, new RegExp('/claude-stack:' + name), `/claude-stack routes to /claude-stack:${name}`);
    }
});
