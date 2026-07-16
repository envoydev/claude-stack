'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');
const graph = require('./stack-graph.json');

test('an agent pulls its declared skills and plugins', () => {
    const c = computeClosure(graph, { agents: ['aspnet-implementer'] });
    for (const s of ['csharp', 'dotnet-web-backend', 'dotnet-testing'])
    {
        assert.ok(c.skills.includes(s), `expected skill ${s} pulled by aspnet-implementer`);
    }
    assert.ok(c.plugins.includes('ponytail'), 'aspnet-implementer pulls the ponytail plugin');
    assert.match(c.reasons['csharp'], /aspnet-implementer/);
});

test('a rule pulls its skills', () => {
    const c = computeClosure(graph, { rules: ['csharp-conventions'] });
    assert.ok(c.skills.includes('csharp'));
    assert.match(c.reasons['csharp'], /csharp-conventions/);
});

test('a kept skill makes its mcps required', () => {
    const c = computeClosure(graph, { skills: ['project-capabilities'] });
    for (const m of ['serena', 'context7', 'sentry', 'memory', 'playwright', 'angular-cli', 'chrome-devtools', 'appium-mcp'])
    {
        assert.ok(c.mcps.includes(m), `expected mcp ${m} required by project-capabilities`);
    }
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
    assert.deepStrictEqual(c, { skills: [], agents: [], rules: [], mcps: [], plugins: [], reasons: {} });
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
    fs.writeFileSync(rawFile, JSON.stringify({ agents: ['aspnet-implementer'] }));
    try
    {
        execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--emit', selFile], { encoding: 'utf8' });
        const emitted = fs.readFileSync(selFile, 'utf8');
        // aspnet-implementer pulls csharp (a skill) - the emitted file must list it
        assert.ok(emitted.split('\n').includes('skill csharp'));

        const sh = path.join(__dirname, 'claude-stack.sh');
        const plan = execFileSync('bash', [sh, 'install', '--scope', 'project', '--selection', selFile, '--print-plan'], { encoding: 'utf8' });
        const planSkills = (plan.match(/^plan skills:(.*)$/m) || [,''])[1].trim().split(/\s+/);
        assert.ok(planSkills.includes('csharp'), 'installer plan reflects the closed selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
