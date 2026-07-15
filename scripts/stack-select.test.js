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

        const sh = path.join(__dirname, '..', 'claude', 'claude-stack.sh');
        const plan = execFileSync('bash', [sh, 'install', '--scope', 'project', '--selection', selFile, '--print-plan'], { encoding: 'utf8' });
        const planSkills = (plan.match(/^plan skills:(.*)$/m) || [,''])[1].trim().split(/\s+/);
        assert.ok(planSkills.includes('csharp'), 'installer plan reflects the closed selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
