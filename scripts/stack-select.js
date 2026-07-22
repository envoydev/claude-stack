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

// Expand raw = { skills?, agents?, rules?, mcps?, plugins?, hooks? } into the
// dependency-complete set. Edges (skills never pull skills): rule -> skill/agent,
// agent -> skill/agent (to fixpoint), then every kept skill/agent/rule -> its
// mcps/plugins. raw.mcps/raw.plugins are direct picks kept as-is - that is how a
// user-added MCP or plugin beyond the closure survives a re-run. raw.hooks are
// pure leaf picks: nothing pulls a hook and a hook pulls nothing.
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
    const hooks = new Set(Array.isArray(raw.hooks) ? raw.hooks : []);
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
    return { skills: sort(skills), agents: sort(agents), rules: sort(rules), mcps: sort(mcps), plugins: sort(plugins), hooks: sort(hooks), reasons };
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
    check(raw.hooks, new Set(graph.catalog.hooks || []), 'hook');
    return unknown;
}

function dropUnknownNames(raw, unknown)
{
    const byCat = { skill: new Set(), agent: new Set(), rule: new Set(), mcp: new Set(), plugin: new Set(), hook: new Set() };
    for (const u of unknown) byCat[u.category].add(u.name);
    const drop = (list, cat) => (Array.isArray(list) ? list.filter(n => !byCat[cat].has(n)) : list);
    return { ...raw, skills: drop(raw.skills, 'skill'), agents: drop(raw.agents, 'agent'), rules: drop(raw.rules, 'rule'), mcps: drop(raw.mcps, 'mcp'), plugins: drop(raw.plugins, 'plugin'), hooks: drop(raw.hooks, 'hook') };
}

// Which category a closed-selection name belongs to - for tagging output lines.
function categoryOf(closure, name)
{
    if ((closure.skills || []).includes(name)) return 'skill';
    if ((closure.agents || []).includes(name)) return 'agent';
    if ((closure.rules || []).includes(name)) return 'rule';
    if ((closure.mcps || []).includes(name)) return 'mcp';
    if ((closure.plugins || []).includes(name)) return 'plugin';
    if ((closure.hooks || []).includes(name)) return 'hook';
    return 'item';
}

// The inverse cascade: everything in the remaining selection that (transitively)
// requires <name> - the rules/agents (and, for mcps/plugins, skills) whose own
// closure reaches it. Dropping a locked item honestly means dropping these too;
// the configure flow presents them for a consent-drop instead of a flat refusal.
function findDependents(graph, remaining, category, name)
{
    const reaches = raw => (computeClosure(graph, raw)[category] || []).includes(name);
    const deps = [];
    for (const r of remaining.rules || []) if (reaches({ rules: [r] })) deps.push({ category: 'rule', name: r });
    for (const a of remaining.agents || []) if (reaches({ agents: [a] })) deps.push({ category: 'agent', name: a });
    if (category === 'mcps' || category === 'plugins')
    {
        for (const s of remaining.skills || []) if (reaches({ skills: [s] })) deps.push({ category: 'skill', name: s });
    }

    return deps;
}

// The configure skill's cascade: given the REMAINING selection (after drops) and
// the DROPPED items, list what the drops pulled in that nothing remaining still
// needs - the orphans the user may want to drop too. One pass covers the whole
// transitive cascade: computeClosure of the dropped set already reaches every
// downstream dependency, and re-closing the remaining set (with the candidates
// taken out of its direct picks) re-adds exactly what is still required.
function findOrphans(graph, remaining, dropped)
{
    const cats = ['skills', 'agents', 'rules', 'mcps', 'plugins', 'hooks'];
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

// Presentation-ready layer table for the guided walks - emitted by the tool so
// alignment never depends on a streaming markdown renderer (long tables re-measure
// per flush segment and shear). The commands paste this verbatim inside a code
// fence. Numbering is the sorted catalog, so it is stable across rounds.
function emitTable(graph, layer, opts)
{
    opts = opts || {};
    const catalog = {
        rules: Object.keys(graph.rules),
        agents: Object.keys(graph.agents),
        skills: Object.keys(graph.skills),
        hooks: graph.catalog.hooks || [],
        mcps: graph.catalog.mcps,
        plugins: graph.catalog.plugins,
    }[layer];
    if (!catalog) return null;

    const raw = opts.raw || {};
    const closure = computeClosure(graph, raw);
    const reasons = closure.reasons;
    const direct = new Set(raw[layer] || []);

    const suggesters = {};   // skills layer only: name -> first kept agent whose body suggests it
    if (layer === 'skills')
    {
        // A suggested skill that is core to ANOTHER stack (in that stack's required closure)
        // is cross-stack noise unless that stack is confirmed - a shared resolver or the
        // universal code-style-analyzer suggests every stack's skills, so dotnet-wpf would
        // otherwise flag `suggested` on an aspnet install. Suppress it to a plain addable row.
        // Ownership is derived, not annotated: run each stack's recommended set through the
        // closure and record the skills it pulls.
        const confirmed = new Set(opts.stacks || []);
        const ownedByUnconfirmed = new Set();
        if (opts.recs)
        {
            const owners = {};
            for (const [st, sel] of Object.entries(opts.recs.stacks || {}))
                for (const s of computeClosure(graph, sel).skills)
                    (owners[s] = owners[s] || new Set()).add(st);
            for (const [s, sts] of Object.entries(owners))
                if (![...sts].some(st => confirmed.has(st))) ownedByUnconfirmed.add(s);
        }
        for (const a of closure.agents)
        {
            for (const s of (graph.agents[a] || {}).suggests || [])
            {
                if (!closure.skills.includes(s) && !suggesters[s] && !ownedByUnconfirmed.has(s)) suggesters[s] = a;
            }
        }
    }

    const seedOf = name =>
    {
        const recs = opts.recs;
        if (!recs) return null;
        if (((recs.always || {})[layer] || []).includes(name)) return 'recommended';
        for (const st of opts.stacks || [])
        {
            if ((((recs.stacks || {})[st] || {})[layer] || []).includes(name)) return `stack:${st}`;
        }

        return null;
    };

    const installed = opts.installed ? new Set(opts.installed[layer] || []) : null;
    const orphanSet = new Set((opts.orphans || []).filter(o => o.category === layer.slice(0, -1)).map(o => o.name));
    const orphanWhy = {};
    for (const o of opts.orphans || []) if (o.category === layer.slice(0, -1)) orphanWhy[o.name] = o.why;

    const rows = [];
    const singular = { rules: 'rule', agents: 'agent', skills: 'skill', hooks: 'hook', mcps: 'mcp', plugins: 'plugin' }[layer];
    catalog.sort().forEach((name, i) =>
    {
        let status, why;
        if (installed)
        {
            status = orphanSet.has(name) ? 'orphaned' : installed.has(name) ? 'yes' : '-';
            why = orphanSet.has(name) ? `was: ${orphanWhy[name]}` : reasons[name] || '-';
        }
        else if (reasons[name]) { status = 'required'; why = reasons[name]; }
        else
        {
            const seed = seedOf(name);
            if (seed) { status = seed; why = '-'; }
            else if (suggesters[name]) { status = 'suggested'; why = `agent ${suggesters[name]}`; }
            else if (direct.has(name)) { status = 'added'; why = '-'; }
            else { status = '-'; why = '-'; }
        }

        rows.push([String(i + 1), name, status, why.replace(/^required by /, '')]);
    });

    const header = ['#', singular, installed ? 'installed' : 'selected', 'required by'];
    const width = c => Math.max(header[c].length, ...rows.map(r => r[c].length));
    const w = [width(0), width(1), width(2), width(3)];
    const line = r => `${r[0].padStart(w[0])} | ${r[1].padEnd(w[1])} | ${r[2].padEnd(w[2])} | ${r[3]}`;
    const rule = `${'-'.repeat(w[0])}-+-${'-'.repeat(w[1])}-+-${'-'.repeat(w[2])}-+-${'-'.repeat(w[3])}`;
    return [line(header), rule, ...rows.map(line)].join('\n') + '\n';
}

function emitSelectionFile(closure)
{
    const lines = [];
    for (const s of closure.skills || []) lines.push(`skill ${s}`);
    for (const a of closure.agents || []) lines.push(`agent ${a}`);
    for (const m of closure.mcps || []) lines.push(`mcp ${m}`);
    for (const p of closure.plugins || []) lines.push(`plugin ${p}`);
    for (const r of closure.rules || []) lines.push(`rule ${r}`);
    for (const h of closure.hooks || []) lines.push(`hook ${h}`);
    return lines.join('\n') + '\n';
}

// The validate command's core: an installed artifact is REDUNDANT when its entire owning
// stack is absent from the detected project. Ownership is derived - run each stack's
// recommended set through the closure and record what it pulls; exclude the always-baseline
// closure up front (never redundant). Shared items (an owner is detected) and non-stack
// deliberate extras (owned by nothing) survive. Returns [{category, name, ownedBy}].
function findStackRedundant(graph, recs, installed, detected)
{
    const detectedSet = new Set(detected || []);
    const LAYERS = ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins'];
    const singular = { rules: 'rule', agents: 'agent', skills: 'skill', hooks: 'hook', mcps: 'mcp', plugins: 'plugin' };

    const always = computeClosure(graph, (recs && recs.always) || {});
    const owners = {};   // layer -> name -> Set<stack>
    for (const l of LAYERS) owners[l] = {};
    for (const [st, sel] of Object.entries((recs && recs.stacks) || {}))
    {
        const c = computeClosure(graph, sel);
        for (const l of LAYERS)
            for (const name of c[l] || [])
                (owners[l][name] = owners[l][name] || new Set()).add(st);
    }

    const out = [];
    for (const l of LAYERS)
    {
        for (const name of (installed && installed[l]) || [])
        {
            if ((always[l] || []).includes(name)) continue;             // always-baseline: never redundant
            const own = owners[l][name];
            if (!own || own.size === 0) continue;                       // deliberate extra: kept
            if ([...own].some(st => detectedSet.has(st))) continue;     // an owner is present: kept
            out.push({ category: singular[l], name, ownedBy: [...own].sort().join(',') });
        }
    }
    return out;
}

// The inverse of findStackRedundant, for the validate walk's ADD side: what a fresh install
// for the DETECTED stacks (plus the always-baseline) would lay down that is NOT installed here.
// `neededBy` names the source(s) - 'baseline' or the detected stack(s) whose closure pulls it.
function findStackMissing(graph, recs, installed, detected)
{
    const LAYERS = ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins'];
    const singular = { rules: 'rule', agents: 'agent', skills: 'skill', hooks: 'hook', mcps: 'mcp', plugins: 'plugin' };
    const sources = { baseline: computeClosure(graph, (recs && recs.always) || {}) };
    for (const st of new Set(detected || [])) sources[st] = computeClosure(graph, ((recs && recs.stacks) || {})[st] || {});

    const out = [];
    for (const l of LAYERS)
    {
        const have = new Set((installed && installed[l]) || []);
        const ideal = new Set();
        for (const c of Object.values(sources)) for (const n of c[l] || []) ideal.add(n);
        for (const name of [...ideal].sort())
        {
            if (have.has(name)) continue;
            const neededBy = Object.keys(sources).filter(k => (sources[k][l] || []).includes(name)).sort().join(',');
            out.push({ category: singular[l], name, neededBy });
        }
    }
    return out;
}

function main(argv)
{
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
    const has = name => argv.includes(name);
    const readJson = (flag, file) =>
    {
        if (!file) return null;
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { console.error(`stack-select: cannot read ${flag} ${file}: ${e.code || e.message}`); process.exit(1); }
    };
    const graphPath = arg('--graph') || path.join(__dirname, 'stack-graph.json');
    let graph;
    try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
    catch (e) { console.error(`stack-select: cannot read graph ${graphPath}: ${e.code || e.message}`); process.exit(1); }

    // --redundant: project-relative audit for the validate command. Uses --installed (the
    // inventory from disk) + --recs + the detected --stacks; needs no --selection.
    if (has('--redundant'))
    {
        const installed = readJson('--installed', arg('--installed'));
        const recs = readJson('--recs', arg('--recs'));
        if (!installed || !recs) { console.error('stack-select: --redundant needs --installed <inventory.json> and --recs <recommendations.json>'); process.exit(2); }
        const detected = (arg('--stacks') || '').split(',').map(s => s.trim()).filter(Boolean);
        for (const r of findStackRedundant(graph, recs, installed, detected))
            console.log(`redundant: ${r.category} ${r.name} - owned by ${r.ownedBy}, not detected`);
        return;
    }

    // --missing: the ADD side of validate - detected-stack + baseline items not installed here.
    if (has('--missing'))
    {
        const installed = readJson('--installed', arg('--installed'));
        const recs = readJson('--recs', arg('--recs'));
        if (!installed || !recs) { console.error('stack-select: --missing needs --installed <inventory.json> and --recs <recommendations.json>'); process.exit(2); }
        const detected = (arg('--stacks') || '').split(',').map(s => s.trim()).filter(Boolean);
        for (const m of findStackMissing(graph, recs, installed, detected))
            console.log(`missing: ${m.category} ${m.name} - needed by ${m.neededBy}, not installed`);
        return;
    }

    const rawFile = arg('--selection');
    if (!rawFile) { console.error('usage: stack-select.js --selection <raw.json> [--graph <path>] [--emit <file>] [--dropped <dropped.json>] [--check] [--context7-local] [--github-cli] | --redundant --installed <inv.json> --recs <recs.json> --stacks <detected>'); process.exit(2); }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(rawFile, 'utf8')); }
    catch (e) { console.error(`stack-select: cannot read selection ${rawFile}: ${e.code || e.message}`); process.exit(1); }
    const unknown = findUnknownNames(graph, raw);
    const unknownOut = argv.includes('--table') ? console.error : console.log;   // keep the table paste-clean
    for (const u of unknown) unknownOut(`unknown: ${u.category} '${u.name}' - not in this release (retired upstream, renamed, or a typo); excluded from the selection`);
    const closure = computeClosure(graph, unknown.length ? dropUnknownNames(raw, unknown) : raw);

    const emit = arg('--emit');
    if (emit) fs.writeFileSync(emit, emitSelectionFile(closure));

    // --table is a pure presentation mode: stdout carries ONLY the table, so the
    // guided walks can paste it verbatim; the required:/orphan: diagnostics are
    // already baked into its columns.
    const tableMode = !!arg('--table');
    if (!tableMode) for (const [name, why] of Object.entries(closure.reasons)) console.log(`required: ${categoryOf(closure, name)} ${name} - ${why}`);

    const droppedFile = arg('--dropped');
    if (droppedFile)
    {
        let dropped;
        try { dropped = JSON.parse(fs.readFileSync(droppedFile, 'utf8')); }
        catch (e) { console.error(`stack-select: cannot read dropped ${droppedFile}: ${e.code || e.message}`); process.exit(1); }
        if (!tableMode) for (const o of findOrphans(graph, raw, dropped)) console.log(`orphan: ${o.category} ${o.name} - ${o.why} (dropped); nothing kept still needs it`);
    }

    const tableLayer = arg('--table');   // rules|agents|skills|hooks|mcps|plugins - print the layer's presentation table
    if (tableLayer)
    {
        const recs = readJson('--recs', arg('--recs'));
        const installed = readJson('--installed', arg('--installed'));
        const droppedForTable = readJson('--dropped', arg('--dropped'));
        const orphans = droppedForTable ? findOrphans(graph, raw, droppedForTable) : [];
        const stacks = (arg('--stacks') || '').split(',').map(s => s.trim()).filter(Boolean);
        const table = emitTable(graph, tableLayer, { raw, recs, stacks, installed, orphans });
        if (table === null) { console.error(`stack-select: unknown table layer '${tableLayer}'`); process.exit(2); }
        process.stdout.write(table);
    }

    const dependentsOf = arg('--dependents');   // '<category>:<name>', singular category, e.g. skill:csharp
    if (dependentsOf)
    {
        const i = dependentsOf.indexOf(':');
        const cat = { skill: 'skills', agent: 'agents', mcp: 'mcps', plugin: 'plugins' }[dependentsOf.slice(0, i)];
        const name = dependentsOf.slice(i + 1);
        if (!cat || !name) { console.error(`stack-select: --dependents wants <skill|agent|mcp|plugin>:<name>, got '${dependentsOf}'`); process.exit(2); }
        for (const d of findDependents(graph, raw, cat, name)) console.log(`dependent: ${d.category} ${d.name} - requires ${dependentsOf.slice(0, i)} ${name}`);
    }

    if (has('--check'))
    {
        const report = evaluatePrereqs(closure, detectEnvironment(), { context7Local: has('--context7-local'), githubCli: has('--github-cli') });
        for (const b of report.blockers) console.log(`BLOCKER: ${b.need} -> ${b.how}`);
        for (const w of report.warnings) console.log(`warning: ${w.need} -> ${w.how}`);
        if (!report.ok) process.exit(1);
    }
}

module.exports = { computeClosure, evaluatePrereqs, detectEnvironment, emitSelectionFile, emitTable, findUnknownNames, dropUnknownNames, findOrphans, findDependents, findStackRedundant, findStackMissing, categoryOf, HARD_PREREQS, SCOPED_PREREQS };

if (require.main === module) main(process.argv.slice(2));
