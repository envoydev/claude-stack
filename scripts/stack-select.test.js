'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');
const graph = require('./stack-graph.json');

test('an agent pulls its declared skills and plugins; body mentions only suggest', () => {
    const c = computeClosure(graph, { agents: ['aspnet-solution-designer'] });
    for (const s of ['dotnet', 'dotnet-web-backend', 'dotnet-testing'])
    {
        assert.ok(c.skills.includes(s), `expected skill ${s} pulled by aspnet-solution-designer's frontmatter`);
    }
    assert.match(c.reasons['dotnet'], /aspnet-solution-designer/);
    // aspnet-implementer declares no skills: frontmatter - its body's conditional
    // loads are suggestions, so the closure locks nothing for it (plugins stay hard).
    const impl = computeClosure(graph, { agents: ['aspnet-implementer'] });
    assert.deepStrictEqual(impl.skills, [], 'a body-sourced agent locks no skills');
    assert.ok(graph.agents['aspnet-implementer'].suggests.includes('csharp'), 'the conditional loads live in suggests');
    assert.ok(impl.plugins.includes('ponytail'), 'aspnet-implementer still pulls the ponytail plugin');
});

test('a rule pulls its skills', () => {
    const c = computeClosure(graph, { rules: ['csharp-conventions'] });
    assert.ok(c.skills.includes('csharp'));
    assert.match(c.reasons['csharp'], /csharp-conventions/);
});

test('a kept rule makes its mcp required; the capabilities skill locks none', () => {
    const c = computeClosure(graph, { rules: ['baseline-navigation'] });
    assert.ok(c.mcps.includes('serena'), 'baseline-navigation genuinely depends on serena');
    // The routing-map mentions in project-agent-capabilities are subject matter, not needs -
    // picking it must never lock the whole MCP baseline into an install.
    const cap = computeClosure(graph, { skills: ['project-agent-capabilities'] });
    assert.deepStrictEqual(cap.mcps, [], 'the capabilities skill pulls no MCPs');
});

test('hooks are leaf picks: kept as-is, emitted, and checked against the catalog', () => {
    const c = computeClosure(graph, { hooks: ['guard-catastrophic-rm'] });
    assert.deepStrictEqual(c.hooks, ['guard-catastrophic-rm'], 'a picked hook survives the closure untouched');
    const { emitSelectionFile, findUnknownNames } = require('./stack-select.js');
    assert.ok(emitSelectionFile(c).includes('hook guard-catastrophic-rm'), 'the hook reaches the emitted selection');
    const unknown = findUnknownNames(graph, { hooks: ['guard-catastrophic-rm', 'no-such-hook'] });
    assert.deepStrictEqual(unknown, [{ category: 'hook', name: 'no-such-hook' }], 'an unknown hook is flagged');
});

test('raw.mcps are direct picks the closure keeps and emits', () => {
    const c = computeClosure(graph, { mcps: ['sentry'] });
    assert.ok(c.mcps.includes('sentry'), 'a directly chosen mcp survives the closure');
    assert.strictEqual(c.reasons['sentry'], undefined, 'a direct mcp pick is not a closure add');
    const { emitSelectionFile } = require('./stack-select.js');
    assert.ok(emitSelectionFile(c).includes('mcp sentry'), 'the direct mcp reaches the emitted selection');
});

test('user-chosen items carry no reason; only closure-added ones do', () => {
    const c = computeClosure(graph, { skills: ['csharp'] });
    assert.ok(c.skills.includes('csharp'));
    assert.strictEqual(c.reasons['csharp'], undefined, 'a directly chosen item is not a closure add');
});

test('empty selection yields empty closure', () => {
    const c = computeClosure(graph, {});
    assert.deepStrictEqual(c, { skills: [], agents: [], rules: [], mcps: [], plugins: [], hooks: [], reasons: {} });
});

test('a non-array raw field does not char-split into bogus items', () => {
    const c = computeClosure(graph, { skills: 'csharp' });   // scalar, not an array
    assert.deepStrictEqual(c.skills, [], 'a scalar skills field yields no skills, not per-character entries');
    assert.ok(!c.skills.includes('c') && !c.skills.includes('s'), 'no single-character bogus skills');
});

// An installed name a new release no longer ships (retired or renamed upstream) must be
// reported and excluded, not silently passed through to per-file installer failures -
// the update/configure skills key their retirement handling on the `unknown:` lines.
const { findUnknownNames, dropUnknownNames } = require('./stack-select.js');

test('unknown selection names are detected per category and dropped', () => {
    const raw = { skills: ['csharp', 'totally-retired-skill'], agents: ['no-such-agent'], rules: [], mcps: ['serena', 'no-such-mcp'], plugins: [] };
    const unknown = findUnknownNames(graph, raw);
    assert.deepStrictEqual(unknown, [
        { category: 'skill', name: 'totally-retired-skill' },
        { category: 'agent', name: 'no-such-agent' },
        { category: 'mcp', name: 'no-such-mcp' },
    ]);
    const filtered = dropUnknownNames(raw, unknown);
    assert.deepStrictEqual(filtered.skills, ['csharp']);
    assert.deepStrictEqual(filtered.agents, []);
    assert.deepStrictEqual(filtered.mcps, ['serena']);
    assert.ok(!computeClosure(graph, filtered).skills.includes('totally-retired-skill'));
});

test('CLI: an unknown name prints an unknown: line and never reaches the emitted selection', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacksel-'));
    const rawFile = path.join(dir, 'raw.json');
    const emitFile = path.join(dir, 'sel.txt');
    fs.writeFileSync(rawFile, JSON.stringify({ skills: ['csharp', 'totally-retired-skill'], agents: [], rules: [], plugins: [] }));
    try
    {
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', path.join(__dirname, 'stack-graph.json'), '--emit', emitFile], { encoding: 'utf8' });
        assert.match(out, /unknown: skill 'totally-retired-skill'/, 'the retirement is named on stdout');
        const emitted = fs.readFileSync(emitFile, 'utf8');
        assert.ok(emitted.includes('skill csharp'), 'known names still emit');
        assert.ok(!emitted.includes('totally-retired-skill'), 'the unknown name is excluded from the emitted selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const { evaluatePrereqs } = require('./stack-select.js');

const fullEnv = { bins: { node: true, npx: true, git: true, claude: true, uvx: true, dotnet: true, 'csharp-ls': true }, envs: { SENTRY_ACCESS_TOKEN: true, CONTEXT7_API_KEY: true } };
const emptyEnv = { bins: {}, envs: {} };

test('phase-1 hard prereqs are blockers when the binary is absent', () => {
    const r = evaluatePrereqs({ skills: [], mcps: [], plugins: [] }, emptyEnv, {});
    const needs = r.blockers.map(b => b.need).join(' ');
    for (const label of ['Node.js', 'git', 'Claude Code CLI', 'uv (uvx)'])
    {
        assert.ok(needs.includes(label), `expected hard blocker ${label}`);
    }
    assert.strictEqual(r.ok, false);
});

test('a selected sentry mcp without its token is a blocker; with it, clean', () => {
    const sel = { skills: [], mcps: ['sentry'], plugins: [] };
    const missing = evaluatePrereqs(sel, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(missing.blockers.some(b => /Sentry/i.test(b.need)), 'sentry token blocker');
    const present = evaluatePrereqs(sel, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: { SENTRY_ACCESS_TOKEN: true } }, {});
    assert.ok(!present.blockers.some(b => /Sentry/i.test(b.need)), 'sentry token satisfied');
});

test('a .NET skill without the dotnet SDK is a blocker', () => {
    const r = evaluatePrereqs({ skills: ['dotnet-web-backend'], mcps: [], plugins: [] }, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(r.blockers.some(b => /\.NET SDK/.test(b.need)), 'dotnet SDK blocker for a dotnet-* skill');
});

test('full env with no risky selection is clean', () => {
    const r = evaluatePrereqs({ skills: ['csharp'], mcps: [], plugins: [] }, fullEnv, {});
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.blockers, []);
});

test('chrome-devtools mcp missing Chrome is a warning, not a blocker', () => {
    const r = evaluatePrereqs({ skills: [], mcps: ['chrome-devtools'], plugins: [] }, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(r.warnings.some(w => /Chrome/i.test(w.need)));
    assert.ok(!r.blockers.some(b => /Chrome/i.test(b.need)));
    assert.strictEqual(r.ok, true, 'a warning alone keeps ok true');
});

test('computeClosure follows an agent->agent chain and terminates on a cycle', () => {
    const g = {
        skills: { s1: { mcps: [], plugins: [] }, s2: { mcps: [], plugins: [] } },
        agents: {
            a1: { skills: ['s1'], skillsSource: 'x', agents: ['a2'], mcps: [], plugins: [] },
            a2: { skills: ['s2'], skillsSource: 'x', agents: ['a1'], mcps: [], plugins: [] }, // cycle back to a1
        },
        rules: {}, catalog: { mcps: [], plugins: [] },
    };
    const c = computeClosure(g, { agents: ['a1'] });
    assert.ok(c.agents.includes('a2'), 'a1 pulls a2');
    assert.ok(c.skills.includes('s1') && c.skills.includes('s2'), 'skills pulled through the agent chain');
    // if this test returns at all, the cycle terminated
});

const { emitSelectionFile } = require('./stack-select.js');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

test('emitSelectionFile produces Component B selection lines', () => {
    const text = emitSelectionFile({ skills: ['csharp'], agents: ['aspnet-implementer'], rules: ['csharp-conventions'], mcps: ['serena'], plugins: ['ponytail'] });
    const lines = text.trim().split('\n');
    assert.ok(lines.includes('skill csharp'));
    assert.ok(lines.includes('agent aspnet-implementer'));
    assert.ok(lines.includes('mcp serena'));
    assert.ok(lines.includes('plugin ponytail'));
    assert.ok(lines.includes('rule csharp-conventions'));
});

test('CLI prints a clean error and exits 1 on a missing selection file', () => {
    const r = require('node:child_process').spawnSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', '/no/such/raw.json'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /cannot read selection/);
    assert.ok(!/at Object\.|at Module\./.test(r.stderr), 'no raw stack trace');
});

// The configure skill's cascade: dropping an item offers what it alone pulled
// in (orphans), while anything a kept item still needs stays locked.
const { findOrphans } = require('./stack-select.js');

// r1 -> a1 -> s1 -> m1; r2 -> s1; s2 is a free-standing direct pick.
const orphanGraph = {
    skills: { s1: { mcps: ['m1'], plugins: [] }, s2: { mcps: [], plugins: [] } },
    agents: { a1: { skills: ['s1'], skillsSource: 'x', agents: [], mcps: [], plugins: [] } },
    rules: {
        r1: { skills: [], agents: ['a1'], mcps: [], plugins: [] },
        r2: { skills: ['s1'], agents: [], mcps: [], plugins: [] },
    },
    catalog: { mcps: ['m1'], plugins: [] },
};
const orphanInstalled = computeClosure(orphanGraph, { rules: ['r1', 'r2'], skills: ['s2'] });

test('a dropped rule orphans only what nothing kept still needs', () => {
    const remaining = { ...orphanInstalled, rules: ['r2'] };
    const orphans = findOrphans(orphanGraph, remaining, { rules: ['r1'] });
    assert.deepStrictEqual(orphans.map(o => `${o.category} ${o.name}`), ['agent a1'], 'a1 was only r1\'s; s1 and m1 stay - r2 still needs them');
    assert.match(orphans[0].why, /required by rule r1/);
});

test('dropping every dependent cascades transitively; direct picks never orphan', () => {
    const remaining = { ...orphanInstalled, rules: [] };
    const names = findOrphans(orphanGraph, remaining, { rules: ['r1', 'r2'] }).map(o => `${o.category} ${o.name}`).sort();
    assert.deepStrictEqual(names, ['agent a1', 'mcp m1', 'skill s1'], 'the whole chain orphans in one pass');
    assert.ok(!names.includes('skill s2'), 'the direct pick s2 is untouched');
});

// The presentation table is emitted by the tool so alignment never depends on a
// markdown renderer - every row must share the exact separator positions.
const { emitTable } = require('./stack-select.js');

test('emitTable emits a perfectly aligned, fully labeled layer table', () => {
    const table = emitTable(orphanGraph, 'skills', { raw: { rules: ['r2'], skills: ['s2'] } });
    const lines = table.trimEnd().split('\n');
    const pos = l => JSON.stringify([...l].flatMap((c, i) => (c === '|' ? [i] : [])));
    for (const l of lines.slice(2)) assert.strictEqual(pos(l), pos(lines[0]), `separators shear on: ${l}`);
    assert.match(lines[0], /# \| skill/, 'header names the layer singular');
    assert.match(table, /1 \| s1 +\| required +\| rule r2/, 's1 is closure-locked with its reason');
    assert.match(table, /2 \| s2 +\| added +\| -/, 's2 is a bare direct pick');
    const cfg = emitTable(orphanGraph, 'skills', { raw: { rules: ['r2'] }, installed: { skills: ['s1'] } });
    assert.match(cfg, /installed/, 'configure mode swaps the column');
    assert.match(cfg, /1 \| s1 +\| yes +\| rule r2/, 'installed + still-required');
    assert.strictEqual(emitTable(orphanGraph, 'nope', {}), null, 'unknown layer returns null');
});

// A suggested skill that is core to ANOTHER stack (in that stack's required closure) must
// not be flagged `suggested` when that stack is unconfirmed - e.g. dotnet-wpf / database-
// conventions / ionic leaking into an aspnet+angular install via a shared resolver or the
// universal code-style-analyzer. General within-stack conditionals (owned by no stack) stay.
const recommendations = require('../setup-plugin/references/recommendations.json');

test('a suggested skill owned only by unconfirmed stacks is not flagged suggested', () => {
    const raw = {
        rules: ['csharp-conventions', 'dotnet-repair-agents', 'typescript-conventions', 'angular-conventions', 'angular-styling-conventions', 'angular-repair-agents'],
        agents: ['aspnet-solution-designer', 'aspnet-implementer', 'aspnet-verifier', 'dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'angular-solution-designer', 'angular-implementer', 'angular-verifier', 'ng-build-error-resolver', 'angular-test-resolver', 'code-style-analyzer'],
    };
    const table = emitTable(graph, 'skills', { raw, recs: recommendations, stacks: ['aspnet', 'angular'] });
    const rowOf = name => table.split('\n').find(l => new RegExp(`\\| ${name} `).test(l)) || '';
    // cross-stack cores are demoted to a plain addable row - present (full catalog) but not suggested
    for (const s of ['dotnet-wpf', 'database-conventions', 'ionic'])
    {
        assert.ok(rowOf(s), `${s} still appears in the full-catalog table`);
        assert.doesNotMatch(rowOf(s), /suggested/, `${s} must not be suggested when its owning stack is unconfirmed`);
    }
    // general conditionals owned by no stack remain legitimate suggestions for this install
    for (const s of ['dotnet-minimal-api', 'dotnet-project-setup'])
    {
        assert.match(rowOf(s), /suggested/, `${s} is a genuine cross-cutting suggestion, not stack-owned`);
    }
});

// The inverse cascade: dropping a locked item honestly means dropping everything
// that still requires it - the configure flow turns a flat refusal into a consent-drop.
const { findDependents } = require('./stack-select.js');

test('findDependents names every kept rule/agent whose closure reaches the item', () => {
    const remaining = { ...orphanInstalled };
    const deps = findDependents(orphanGraph, remaining, 'skills', 's1').map(d => `${d.category} ${d.name}`).sort();
    assert.deepStrictEqual(deps, ['agent a1', 'rule r1', 'rule r2'], 'r2 directly, a1 directly, r1 via a1 - all transitive holders');
    assert.deepStrictEqual(findDependents(orphanGraph, remaining, 'skills', 's2'), [], 'a direct pick nothing needs has no dependents');
    const mcpDeps = findDependents(orphanGraph, remaining, 'mcps', 'm1').map(d => `${d.category} ${d.name}`).sort();
    assert.deepStrictEqual(mcpDeps, ['agent a1', 'rule r1', 'rule r2', 'skill s1'], 'an mcp counts its holding skills too');
});

test('CLI: --dependents prints the consent-drop list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-deps-'));
    try
    {
        const graphFile = path.join(dir, 'graph.json');
        const rawFile = path.join(dir, 'raw.json');
        fs.writeFileSync(graphFile, JSON.stringify(orphanGraph));
        fs.writeFileSync(rawFile, JSON.stringify(orphanInstalled));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', graphFile, '--dependents', 'skill:s1'], { encoding: 'utf8' });
        assert.match(out, /^dependent: rule r2 - requires skill s1$/m);
        assert.match(out, /^dependent: agent a1 - requires skill s1$/m);
        assert.ok(!/dependent: .* s2/.test(out), 's2 has no dependents and appears nowhere');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: required lines carry the category, --dropped prints the orphan lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-orphan-'));
    try
    {
        const graphFile = path.join(dir, 'graph.json');
        const rawFile = path.join(dir, 'raw.json');
        const droppedFile = path.join(dir, 'dropped.json');
        fs.writeFileSync(graphFile, JSON.stringify(orphanGraph));
        fs.writeFileSync(rawFile, JSON.stringify({ ...orphanInstalled, rules: ['r2'] }));
        fs.writeFileSync(droppedFile, JSON.stringify({ rules: ['r1'] }));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', graphFile, '--dropped', droppedFile], { encoding: 'utf8' });
        assert.match(out, /^orphan: agent a1 - required by rule r1 \(dropped\)/m, 'the orphan is named with its category and why');
        assert.ok(!/orphan: (skill s1|mcp m1)/.test(out), 'still-needed items are not offered as orphans');

        const reqRaw = path.join(dir, 'req.json');
        fs.writeFileSync(reqRaw, JSON.stringify({ rules: ['r1'] }));
        const reqOut = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', reqRaw, '--graph', graphFile], { encoding: 'utf8' });
        assert.match(reqOut, /^required: agent a1 - required by rule r1$/m, 'required lines are category-tagged');
        assert.match(reqOut, /^required: skill s1 - required by agent a1$/m);
        assert.match(reqOut, /^required: mcp m1 - required by skill s1$/m);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI closure -> emitted file -> installer --print-plan agrees', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
    const rawFile = path.join(dir, 'raw.json');
    const selFile = path.join(dir, 'selection.txt');
    fs.writeFileSync(rawFile, JSON.stringify({ agents: ['aspnet-solution-designer'] }));
    try
    {
        execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--emit', selFile], { encoding: 'utf8' });
        const emitted = fs.readFileSync(selFile, 'utf8');
        // aspnet-solution-designer's frontmatter pulls dotnet-web-backend - the emitted file must list it
        assert.ok(emitted.split('\n').includes('skill dotnet-web-backend'));

        const sh = path.join(__dirname, 'os', 'claude-stack.sh');
        const plan = execFileSync('bash', [sh, 'install', '--scope', 'project', '--selection', selFile, '--print-plan'], { encoding: 'utf8' });
        const planSkills = (plan.match(/^plan skills:(.*)$/m) || [,''])[1].trim().split(/\s+/);
        assert.ok(planSkills.includes('dotnet-web-backend'), 'installer plan reflects the closed selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The validate command's core: given the detected project stacks and the installed
// inventory, flag every installed artifact whose ENTIRE owning stack is absent. Shared
// items (an owner is present), non-stack deliberate extras, and always-baseline items survive.
const { findStackRedundant, findStackMissing } = require('./stack-select.js');

test('findStackRedundant flags whole-stack-absent installs, keeps shared/extra/baseline', () => {
    const installed = {
        rules: ['baseline-navigation', 'csharp-conventions', 'wpf-conventions'],
        agents: ['code-analyzer', 'aspnet-implementer', 'dotnet-build-error-resolver', 'wpf-implementer', 'wpf-solution-designer'],
        skills: ['csharp', 'dotnet-web-backend', 'dotnet-wpf'],
        mcps: ['serena', 'sentry'],
        plugins: ['csharp-lsp'],
        hooks: ['guard-catastrophic-rm'],
    };
    const redundant = findStackRedundant(graph, recommendations, installed, ['aspnet']);
    const flagged = redundant.map(r => `${r.category} ${r.name}`).sort();
    assert.deepStrictEqual(flagged, [
        'agent wpf-implementer',
        'agent wpf-solution-designer',
        'rule wpf-conventions',
        'skill dotnet-wpf',
    ], 'only wpf-owned installs are redundant when only aspnet is detected');
    const names = new Set(redundant.map(r => r.name));
    assert.ok(!names.has('dotnet-build-error-resolver'), 'a shared aspnet+wpf item survives - aspnet is present');
    assert.ok(!names.has('csharp-conventions'), 'a rule owned by aspnet too survives');
    assert.ok(!names.has('sentry'), 'a non-stack-owned deliberate extra is never redundant');
    assert.ok(!names.has('baseline-navigation'), 'an always-baseline item is never redundant');
    assert.strictEqual(redundant.find(r => r.name === 'wpf-conventions').ownedBy, 'wpf', 'the reason names the owning stack');
});

test('findStackMissing flags the detected stacks + baseline closure that is not installed', () => {
    // a partial aspnet install - some of its vertical and the baseline are absent
    const installed = {
        rules: ['csharp-conventions'],
        agents: ['aspnet-implementer'],
        skills: ['csharp'],
        mcps: ['serena'],
        plugins: [],
        hooks: [],
    };
    const missing = findStackMissing(graph, recommendations, installed, ['aspnet']);
    const names = new Set(missing.map(m => `${m.category} ${m.name}`));
    assert.ok(names.has('plugin csharp-lsp'), 'the aspnet LSP plugin is missing');
    assert.ok(names.has('agent aspnet-verifier'), 'the aspnet vertical is incomplete');
    assert.ok(names.has('skill dotnet-web-backend'), 'the aspnet web hub is missing');
    assert.ok([...names].some(n => n.startsWith('rule baseline-')), 'missing always-baseline rules surface');
    assert.ok(!names.has('agent aspnet-implementer'), 'an installed item is never missing');
    assert.ok(!names.has('skill csharp'), 'an installed skill is never missing');
    assert.ok(![...names].some(n => n.includes('wpf')), 'undetected-stack items are NOT proposed as missing');
    assert.strictEqual(missing.find(m => m.name === 'csharp-lsp').neededBy, 'aspnet', 'the reason names who needs it');
    assert.strictEqual(missing.find(m => m.name === 'baseline-security').neededBy, 'baseline', 'baseline items are attributed to baseline');
});

test('CLI --missing prints per-category missing lines from an installed inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-missing-'));
    try
    {
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: ['aspnet-implementer'], skills: ['csharp'], mcps: [], plugins: [], hooks: [] }));
        const recsPath = path.join(__dirname, '..', 'setup-plugin', 'references', 'recommendations.json');
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--missing', '--installed', invFile, '--recs', recsPath, '--graph', path.join(__dirname, 'stack-graph.json'), '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.match(out, /^missing: plugin csharp-lsp - needed by aspnet, not installed$/m);
        assert.ok(!/missing: agent aspnet-implementer/.test(out), 'an installed agent is not missing');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI --redundant prints per-category redundant lines from an installed inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-redundant-'));
    try
    {
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(invFile, JSON.stringify({ rules: ['wpf-conventions'], agents: ['wpf-implementer'], skills: ['dotnet-wpf', 'csharp'], mcps: [], plugins: [], hooks: [] }));
        const recsPath = path.join(__dirname, '..', 'setup-plugin', 'references', 'recommendations.json');
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--redundant', '--installed', invFile, '--recs', recsPath, '--graph', path.join(__dirname, 'stack-graph.json'), '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.match(out, /^redundant: rule wpf-conventions - owned by wpf, not detected$/m);
        assert.match(out, /^redundant: skill dotnet-wpf - owned by wpf, not detected$/m);
        assert.ok(!/redundant: skill csharp\b/.test(out), 'csharp is aspnet-owned and aspnet is detected - not redundant');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
