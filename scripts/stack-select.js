#!/usr/bin/env node
// The deterministic brain of the setup skill: expand a raw skills/agents/rules
// selection into a dependency-complete install set (computeClosure), and check
// a curated prerequisite map against a detected environment (evaluatePrereqs).
// Reads the committed stack-graph.json (Component A); emits an installer
// selection file for claude-stack.sh --selection (Component B).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Expand raw = { skills?, agents?, rules?, mcps?, plugins? } into the
// dependency-complete set. Edges (skills never pull skills): rule -> skill/agent,
// agent -> skill/agent (to fixpoint), then every kept skill/agent/rule -> its
// mcps/plugins. raw.mcps/raw.plugins are direct picks kept as-is - that is how a
// user-added MCP or plugin beyond the closure survives a re-run.
function computeClosure(graph, raw)
{
    const skills = new Set(Array.isArray(raw.skills) ? raw.skills : []);
    const agents = new Set(Array.isArray(raw.agents) ? raw.agents : []);
    const rules = new Set(Array.isArray(raw.rules) ? raw.rules : []);
    const reasons = {};
    const note = (name, why) => { if (!reasons[name]) reasons[name] = why; };

    for (const r of rules)
    {
        const node = graph.rules[r];
        if (!node) continue;
        for (const s of node.skills) if (!skills.has(s)) { skills.add(s); note(s, `required by rule ${r}`); }
        for (const a of node.agents) if (!agents.has(a)) { agents.add(a); note(a, `required by rule ${r}`); }
    }

    const queue = [...agents];
    while (queue.length)
    {
        const a = queue.shift();
        const node = graph.agents[a];
        if (!node) continue;
        for (const s of node.skills) if (!skills.has(s)) { skills.add(s); note(s, `required by agent ${a}`); }
        for (const a2 of node.agents) if (!agents.has(a2)) { agents.add(a2); note(a2, `required by agent ${a}`); queue.push(a2); }
    }

    const mcps = new Set(Array.isArray(raw.mcps) ? raw.mcps : []);
    const plugins = new Set(Array.isArray(raw.plugins) ? raw.plugins : []);
    const pull = (node, why) =>
    {
        if (!node) return;
        for (const m of node.mcps) if (!mcps.has(m)) { mcps.add(m); note(m, why); }
        for (const p of node.plugins) if (!plugins.has(p)) { plugins.add(p); note(p, why); }
    };
    for (const s of skills) pull(graph.skills[s], `required by skill ${s}`);
    for (const a of agents) pull(graph.agents[a], `required by agent ${a}`);
    for (const r of rules) pull(graph.rules[r], `required by rule ${r}`);

    const sort = set => [...set].sort();
    return { skills: sort(skills), agents: sort(agents), rules: sort(rules), mcps: sort(mcps), plugins: sort(plugins), reasons };
}

// Phase 1 - always required, a miss is a hard blocker.
const HARD_PREREQS = [
    { bin: 'node', need: 'Node.js', how: 'install Node.js (https://nodejs.org)' },
    { bin: 'git', need: 'git', how: 'install git' },
    { bin: 'claude', need: 'Claude Code CLI', how: 'npm install -g @anthropic-ai/claude-code' },
    { bin: 'uvx', need: 'uv (uvx)', how: 'install uv (https://docs.astral.sh/uv/)' },
];

// Phase 2 - only checked when 'when' matches the closed selection / options.
// severity: 'blocker' (a kept item will not work) or 'warning' (soft/optional).
const SCOPED_PREREQS = [
    { when: { mcp: 'sentry' }, env: 'SENTRY_ACCESS_TOKEN', severity: 'blocker', need: 'Sentry token', how: 'export SENTRY_ACCESS_TOKEN=...' },
    { when: { plugin: 'csharp-lsp' }, bin: 'csharp-ls', severity: 'blocker', need: 'csharp-ls tool', how: 'dotnet tool install -g csharp-ls' },
    { when: { skillPrefix: 'dotnet' }, bin: 'dotnet', severity: 'blocker', need: '.NET SDK', how: 'install the .NET SDK (https://dotnet.microsoft.com)' },
    { when: { skillPrefix: 'csharp' }, bin: 'dotnet', severity: 'blocker', need: '.NET SDK', how: 'install the .NET SDK (https://dotnet.microsoft.com)' },
    { when: { mcp: 'chrome-devtools' }, bin: 'chrome', severity: 'warning', need: 'Chrome / Chromium', how: 'install Google Chrome or Chromium' },
    { when: { mcp: 'appium-mcp' }, bin: 'appium', severity: 'warning', need: 'Appium + native SDKs', how: 'install Appium and the Xcode / Android SDK / Java toolchain' },
    { when: { option: 'context7Local' }, env: 'CONTEXT7_API_KEY', severity: 'warning', need: 'context7 API key', how: 'export CONTEXT7_API_KEY=... (or use --context7 remote)' },
    { when: { option: 'githubCli' }, bin: 'brew', severity: 'warning', need: 'Homebrew', how: 'install Homebrew to auto-install the GitHub CLI (macOS)' },
];

function evaluatePrereqs(selection, env, options)
{
    options = options || {};
    const bins = env.bins || {};
    const envs = env.envs || {};
    const skills = new Set(selection.skills || []);
    const mcps = new Set(selection.mcps || []);
    const plugins = new Set(selection.plugins || []);

    const matches = when =>
    {
        if (when.mcp) return mcps.has(when.mcp);
        if (when.plugin) return plugins.has(when.plugin);
        if (when.skillPrefix) return [...skills].some(s => s.startsWith(when.skillPrefix));
        if (when.option) return !!options[when.option];
        return false;
    };

    const blockers = [];
    const warnings = [];
    const seen = new Set();
    const add = (bucket, p) =>
    {
        const key = p.need;
        if (seen.has(key)) return;
        seen.add(key);
        bucket.push({ need: p.need, how: p.how, ...(p.because ? { because: p.because } : {}) });
    };

    for (const p of HARD_PREREQS)
    {
        if (!bins[p.bin]) add(blockers, p);
    }

    for (const p of SCOPED_PREREQS)
    {
        if (!matches(p.when)) continue;
        const present = p.env ? envs[p.env] : bins[p.bin];
        if (present) continue;
        add(p.severity === 'blocker' ? blockers : warnings, p);
    }

    return { blockers, warnings, ok: blockers.length === 0 };
}

// Impure - probe the current machine. bins: is the command on PATH; envs: is
// the variable set and non-empty. Kept thin; the pure evaluator is the tested
// part. Extend the probe lists as the prereq map grows.
function detectEnvironment()
{
    const BINS = ['node', 'npx', 'git', 'claude', 'uvx', 'dotnet', 'csharp-ls', 'chrome', 'appium', 'brew'];
    const ENVS = ['SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY'];
    const bins = {};
    for (const b of BINS)
    {
        try { execFileSync('command', ['-v', b], { stdio: 'ignore', shell: '/bin/bash' }); bins[b] = true; }
        catch { bins[b] = false; }
    }
    const envs = {};
    for (const e of ENVS) envs[e] = typeof process.env[e] === 'string' && process.env[e].trim() !== '';
    return { bins, envs };
}

// Selection names the graph does not know: an item this release retired or renamed
// upstream (or a typo). Reported and EXCLUDED before the closure - an unknown name can
// never install, so passing it through only trades one clear `unknown:` line for a
// per-file failure storm in the installer.
function findUnknownNames(graph, raw)
{
    const unknown = [];
    const check = (names, known, category) =>
    {
        for (const n of Array.isArray(names) ? names : [])
        {
            if (!known.has(n)) unknown.push({ category, name: n });
        }
    };
    check(raw.skills, new Set(Object.keys(graph.skills)), 'skill');
    check(raw.agents, new Set(Object.keys(graph.agents)), 'agent');
    check(raw.rules, new Set(Object.keys(graph.rules)), 'rule');
    check(raw.mcps, new Set(graph.catalog.mcps), 'mcp');
    check(raw.plugins, new Set(graph.catalog.plugins), 'plugin');
    return unknown;
}

function dropUnknownNames(raw, unknown)
{
    const byCat = { skill: new Set(), agent: new Set(), rule: new Set(), mcp: new Set(), plugin: new Set() };
    for (const u of unknown) byCat[u.category].add(u.name);
    const drop = (list, cat) => (Array.isArray(list) ? list.filter(n => !byCat[cat].has(n)) : list);
    return { ...raw, skills: drop(raw.skills, 'skill'), agents: drop(raw.agents, 'agent'), rules: drop(raw.rules, 'rule'), mcps: drop(raw.mcps, 'mcp'), plugins: drop(raw.plugins, 'plugin') };
}

// Which category a closed-selection name belongs to - for tagging output lines.
function categoryOf(closure, name)
{
    if ((closure.skills || []).includes(name)) return 'skill';
    if ((closure.agents || []).includes(name)) return 'agent';
    if ((closure.rules || []).includes(name)) return 'rule';
    if ((closure.mcps || []).includes(name)) return 'mcp';
    if ((closure.plugins || []).includes(name)) return 'plugin';
    return 'item';
}

// The configure skill's cascade: given the REMAINING selection (after drops) and
// the DROPPED items, list what the drops pulled in that nothing remaining still
// needs - the orphans the user may want to drop too. One pass covers the whole
// transitive cascade: computeClosure of the dropped set already reaches every
// downstream dependency, and re-closing the remaining set (with the candidates
// taken out of its direct picks) re-adds exactly what is still required.
function findOrphans(graph, remaining, dropped)
{
    const cats = ['skills', 'agents', 'rules', 'mcps', 'plugins'];
    const asSet = (obj, cat) => new Set(Array.isArray(obj[cat]) ? obj[cat] : []);
    const dropClosure = computeClosure(graph, dropped);

    const candidates = {};
    for (const c of cats)
    {
        const rem = asSet(remaining, c);
        const drp = asSet(dropped, c);
        candidates[c] = (dropClosure[c] || []).filter(n => rem.has(n) && !drp.has(n));
    }

    const trimmed = {};
    for (const c of cats) trimmed[c] = [...asSet(remaining, c)].filter(n => !candidates[c].includes(n));
    const still = computeClosure(graph, trimmed);

    const orphans = [];
    for (const c of cats)
    {
        const stillSet = new Set(still[c] || []);
        for (const n of candidates[c])
        {
            if (stillSet.has(n)) continue;
            orphans.push({ category: c.slice(0, -1), name: n, why: dropClosure.reasons[n] || 'required only by the dropped items' });
        }
    }
    return orphans;
}

function emitSelectionFile(closure)
{
    const lines = [];
    for (const s of closure.skills || []) lines.push(`skill ${s}`);
    for (const a of closure.agents || []) lines.push(`agent ${a}`);
    for (const m of closure.mcps || []) lines.push(`mcp ${m}`);
    for (const p of closure.plugins || []) lines.push(`plugin ${p}`);
    for (const r of closure.rules || []) lines.push(`rule ${r}`);
    return lines.join('\n') + '\n';
}

function main(argv)
{
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
    const has = name => argv.includes(name);
    const rawFile = arg('--selection');
    if (!rawFile) { console.error('usage: stack-select.js --selection <raw.json> [--graph <path>] [--emit <file>] [--dropped <dropped.json>] [--check] [--context7-local] [--github-cli]'); process.exit(2); }
    const graphPath = arg('--graph') || path.join(__dirname, 'stack-graph.json');
    let graph, raw;
    try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
    catch (e) { console.error(`stack-select: cannot read graph ${graphPath}: ${e.code || e.message}`); process.exit(1); }
    try { raw = JSON.parse(fs.readFileSync(rawFile, 'utf8')); }
    catch (e) { console.error(`stack-select: cannot read selection ${rawFile}: ${e.code || e.message}`); process.exit(1); }
    const unknown = findUnknownNames(graph, raw);
    for (const u of unknown) console.log(`unknown: ${u.category} '${u.name}' - not in this release (retired upstream, renamed, or a typo); excluded from the selection`);
    const closure = computeClosure(graph, unknown.length ? dropUnknownNames(raw, unknown) : raw);

    const emit = arg('--emit');
    if (emit) fs.writeFileSync(emit, emitSelectionFile(closure));

    for (const [name, why] of Object.entries(closure.reasons)) console.log(`required: ${categoryOf(closure, name)} ${name} - ${why}`);

    const droppedFile = arg('--dropped');
    if (droppedFile)
    {
        let dropped;
        try { dropped = JSON.parse(fs.readFileSync(droppedFile, 'utf8')); }
        catch (e) { console.error(`stack-select: cannot read dropped ${droppedFile}: ${e.code || e.message}`); process.exit(1); }
        for (const o of findOrphans(graph, raw, dropped)) console.log(`orphan: ${o.category} ${o.name} - ${o.why} (dropped); nothing kept still needs it`);
    }

    if (has('--check'))
    {
        const report = evaluatePrereqs(closure, detectEnvironment(), { context7Local: has('--context7-local'), githubCli: has('--github-cli') });
        for (const b of report.blockers) console.log(`BLOCKER: ${b.need} -> ${b.how}`);
        for (const w of report.warnings) console.log(`warning: ${w.need} -> ${w.how}`);
        if (!report.ok) process.exit(1);
    }
}

module.exports = { computeClosure, evaluatePrereqs, detectEnvironment, emitSelectionFile, findUnknownNames, dropUnknownNames, findOrphans, categoryOf, HARD_PREREQS, SCOPED_PREREQS };

if (require.main === module) main(process.argv.slice(2));
