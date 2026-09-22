#!/usr/bin/env node
'use strict';
// Generates the marketplace plugin ENTRIES from the computed placement, and the cost table that
// gates them. Nothing here creates a folder: every entry shares the repo root as its `source` and
// lists the skill folders and agent files it ships, which is the shape spike S9 proved
// (docs/plugin-migration-evidence.md). `stack/` stays the one home per piece.
//
//   node scripts/build-marketplace.js --write        regenerate meta/plugin-entries.json
//   node scripts/build-marketplace.js --check        exit 1 when that file is stale
//   node scripts/build-marketplace.js --cost         print the cost table
//   node scripts/build-marketplace.js --cost --out <file>   write it as markdown
//
// The live .claude-plugin/marketplace.json is NOT touched by --write, which only regenerates
// meta/plugin-entries.json; --write-marketplace is the Phase 3 transcription that applies those
// entries to the live file, leaving the generated hooks entry and the marketplace metadata alone.
//
//   node scripts/build-marketplace.js --write-marketplace   apply the entries to the live file
//
// The CORE entry is generated too, from Phase 3 on. It used to ship from `./setup-plugin`, whose
// own .claude-plugin/plugin.json was its manifest; its 21 skills and 8 agents live under stack/,
// outside that folder, and a `../` path out of a plugin root is undocumented (Phase 2 ruling R1
// refused to build on it). At `source: './'` nothing under setup-plugin/ is auto-discovered, so the
// entry carries every path explicitly - the five commands, the router skill, its placed skills and
// agents - plus the layer-table hook INLINE and the superpowers dependency that plugin.json used to
// declare. Dropping either on the way across would be a silent behaviour change.
const fs = require('node:fs');
const path = require('node:path');
const { placement, costOf, costToday, CORE } = require('./plugin-placement.js');

const REPO = path.resolve(__dirname, '..');
const ENTRIES_FILE = path.join(REPO, 'meta/plugin-entries.json');
const MARKETPLACE = path.join(REPO, '.claude-plugin/marketplace.json');
const COST_FILE = path.join(REPO, 'docs/plugin-placement-cost.md');
const GATE_PCT = 10;

function readJson(file, what)
{
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { throw new Error(`${what}: cannot read ${file} - ${err.message}`); }
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(`${what}: ${file} is not valid JSON - ${err.message}`); }
}

function marketplaceVersion(options = {})
{
    const mkt = options.marketplace || readJson(MARKETPLACE, 'marketplace.json');
    return (mkt.metadata && mkt.metadata.version) || '0.0.0';
}

function describe(name, place, stacksOf)
{
    const plug = place.plugins[name];
    const counts = [];
    if (plug.skills.length) counts.push(`${plug.skills.length} skill${plug.skills.length === 1 ? '' : 's'}`);
    if (plug.agents.length) counts.push(`${plug.agents.length} agent${plug.agents.length === 1 ? '' : 's'}`);
    const who = stacksOf.length === 1
        ? `the ${stacksOf[0]} stack`
        : `the ${stacksOf.slice(0, -1).join(', ')} and ${stacksOf[stacksOf.length - 1]} stacks`;
    if (!counts.length) return `Enables ${who}: the shared claude-stack plugins it depends on, nothing of its own.`;
    return `claude-stack ${counts.join(' and ')} used by ${who}.`;
}

// The five guided-walk COMMANDS and the router SKILL, the two things no other entry has. Read from
// setup-plugin's own plugin.json so one list stays the source of the command set, and re-rooted at
// the repo root the entry now ships from.
const SETUP_MANIFEST = path.join(REPO, 'setup-plugin/.claude-plugin/plugin.json');

function coreEntry(options = {})
{
    const place = options.placement || placement(options);
    const plug = place.plugins[CORE];
    const setup = readJson(options.setupManifest || SETUP_MANIFEST, 'setup-plugin/plugin.json');
    const commands = (setup.commands || []).map(c => `./setup-plugin/${String(c).replace(/^\.\//, '')}`);
    if (!commands.length) throw new Error('build-marketplace: setup-plugin/plugin.json lists no commands - the core entry would ship no guided walk');
    const entry = {
        name: CORE,
        source: './',
        description: setup.description,
        version: options.version || marketplaceVersion(options),
        author: options.author || { name: 'envoydev', url: 'https://github.com/envoydev' },
        strict: false,
        category: 'development',
        tags: ['setup', 'installer', 'skills', 'agents', 'mcp', 'bootstrap'],
        commands,
        skills: ['./setup-plugin/skills/claude-stack'].concat(plug.skills.map(s => `./stack/skills/${s}`)),
        agents: plug.agents.map(a => `./stack/agents/${a}.md`),
        // The layer-table guard used to be auto-discovered from setup-plugin/hooks/hooks.json. At
        // the shared root it is not, so it is declared inline - the shape Phase 2 proved for the
        // thirteen stack hooks.
        hooks: {
            PreToolUse: [{
                matcher: 'AskUserQuestion',
                hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/setup-plugin/hooks/guard-layer-table.js', timeout: 10 }],
            }],
        },
    };
    if (Array.isArray(setup.dependencies) && setup.dependencies.length) entry.dependencies = setup.dependencies;
    return entry;
}

function buildEntries(options = {})
{
    const place = options.placement || placement(options);
    const version = options.version || marketplaceVersion(options);
    const author = options.author || { name: 'envoydev', url: 'https://github.com/envoydev' };
    const entries = [coreEntry({ ...options, placement: place, version, author })];
    for (const name of Object.keys(place.plugins).sort())
    {
        if (name === CORE) continue;   // built above, with the commands and hook the others have no equivalent of
        const plug = place.plugins[name];
        const entry = {
            name,
            source: './',
            description: describe(name, place, place.owners[name]),
            version,
            author,
            strict: false,
        };
        if (plug.skills.length) entry.skills = plug.skills.map(s => `./stack/skills/${s}`);
        if (plug.agents.length) entry.agents = plug.agents.map(a => `./stack/agents/${a}.md`);
        const deps = plug.dependencies.filter(d => d !== CORE);
        entry.dependencies = deps.length ? deps : [CORE];
        entries.push(entry);
    }
    return entries;
}

function serialize(entries)
{
    return JSON.stringify({
        generatedBy: 'build-marketplace',
        note: 'Generated by scripts/build-marketplace.js from meta/recommendations.json + meta/stack-graph.json. Do not edit by hand; run `npm run marketplace`.',
        entries,
    }, null, 2) + '\n';
}

// Puts the hooks entry into the live marketplace, in place, leaving every other entry - the
// hand-written core included - exactly where it was. The entry is GENERATED from the installer's
// wiring table, so this is a transcription, never a place to hand-edit a matcher.
function applyHooksPlugin(mkt, entry)
{
    const wanted = entry || hooksPlugin();
    const plugins = Array.isArray(mkt.plugins) ? mkt.plugins : (mkt.plugins = []);
    const at = plugins.findIndex(p => p && p.name === wanted.name);
    if (at >= 0) plugins[at] = wanted; else plugins.push(wanted);
    return mkt;
}

// Applies the generated entries to the live marketplace, the CORE entry included from Phase 3 on.
// Anything the generator does not own - the hooks entry, a hand-written extra - keeps its place.
function applyToMarketplace(mkt, entries)
{
    const kept = (mkt.plugins || []).filter(p => !entries.some(e => e.name === p.name));
    mkt.plugins = kept.concat(entries);
    return mkt;
}

// ---------------------------------------------------------------------------------------------
// The hooks plugin entry. The wiring table has ONE home - the `HOOKS=(...)` array in
// scripts/os/claude-stack.sh, where each row is `file::matcher::args` and a matcher starting with
// `@` names its own event (`@Stop`, `@SessionStart:compact`) instead of PreToolUse. Parsing that
// array rather than retyping it is what keeps the plugin wiring and the settings.json wiring from
// drifting while both routes exist, and the lint fails when the generated entry goes stale.
//
// The hooks are declared INLINE in the marketplace entry, not through a `hooks/hooks.json` at the
// shared root: spike S9 assert (c) measured that a shared root is auto-discovered by every entry
// over it, and the Phase 1 and Phase 2 spikes measured that an inline block gives each entry its
// own hooks, fired once, for all six event types the stack uses.
const INSTALLER_SH = path.join(REPO, 'scripts/os/claude-stack.sh');

function parseHookWirings(file)
{
    const src = fs.readFileSync(file || INSTALLER_SH, 'utf8');
    const start = src.indexOf('\nHOOKS=(');
    if (start < 0) throw new Error('build-marketplace: no HOOKS=( array in the installer - the wiring table moved');
    const end = src.indexOf('\n)', start);
    if (end < 0) throw new Error('build-marketplace: the HOOKS=( array is not closed');
    const out = [];
    for (const line of src.slice(start, end).split('\n'))
    {
        const m = line.match(/^\s*"([^"]+)"/);
        if (!m) continue;
        const [file_, rawMatcher, rawArgs] = m[1].split('::');
        const wiring = { file: file_ };
        if (rawMatcher && rawMatcher.startsWith('@'))
        {
            const [event, matcher] = rawMatcher.slice(1).split(':');
            wiring.event = event;
            if (matcher) wiring.matcher = matcher;
        }
        else
        {
            wiring.event = 'PreToolUse';
            if (rawMatcher) wiring.matcher = rawMatcher;
        }
        const args = String(rawArgs || '').trim();
        if (args) wiring.args = args.split(/\s+/);
        out.push(wiring);
    }
    if (!out.length) throw new Error('build-marketplace: the HOOKS=( array parsed to nothing');
    return out;
}

function hooksBlock(wirings)
{
    const block = {};
    for (const w of wirings || parseHookWirings())
    {
        const list = block[w.event] || (block[w.event] = []);
        let group = list.find(b => String(b.matcher) === String(w.matcher));
        if (!group)
        {
            group = w.matcher === undefined ? { hooks: [] } : { matcher: w.matcher, hooks: [] };
            list.push(group);
        }
        const entry = { type: 'command', command: `\${CLAUDE_PLUGIN_ROOT}/stack/hooks/${w.file}`, timeout: 10 };
        if (w.args) entry.args = w.args;
        group.hooks.push(entry);
    }
    return block;
}

function hooksPlugin(options = {})
{
    return {
        name: 'claude-stack-hooks',
        source: './',
        description: 'The thirteen claude-stack hooks, wired inline: the deterministic gates (force-push, catastrophic rm, whole-file reads, credential reads, ungated dispatch and commit, cross-project writes, the stop contract, the answer budget, the fresh-session offer) plus the docs and memory session engines.',
        version: options.version || marketplaceVersion(options),
        author: options.author || { name: 'envoydev', url: 'https://github.com/envoydev' },
        strict: false,
        hooks: hooksBlock(options.wirings),
        dependencies: [CORE],
    };
}

const COMBOS = [
    ['aspnet'], ['web-angular'], ['wpf'], ['winforms'], ['console'], ['windows-service'],
    ['ionic-angular'], ['data'], ['devops'], ['browser-extension'], ['typescript'], ['javascript'],
    ['aspnet', 'web-angular', 'data'], ['aspnet', 'data'], ['web-angular', 'devops'],
];

function costTable(options = {})
{
    const place = options.placement || placement(options);
    const rows = [];
    for (const combo of options.combos || COMBOS)
    {
        const today = costToday(combo, options).chars;
        const planned = costOf(place, combo);
        rows.push({
            combo: combo.join(' + '),
            today,
            planned: planned.chars,
            delta: Math.round((planned.chars - today) / today * 1000) / 10,
            plugins: planned.plugins.length,
            items: planned.skills + planned.agents,
        });
    }
    const head = [
        '| Project stacks | Today (per-item) | Planned (plugins) | Delta | Plugins | Skills + agents |',
        '|---|---:|---:|---:|---:|---:|',
    ];
    const body = rows.map(r => `| ${r.combo} | ${r.today} | ${r.planned} | ${r.delta >= 0 ? '+' : ''}${r.delta}% | ${r.plugins} | ${r.items} |`);
    return { rows, markdown: head.concat(body).join('\n') + '\n' };
}

function costDocument(table, place)
{
    const shared = Object.entries(place.owners).filter(([, o]) => o.length > 1).sort();
    return [
        '# Plugin placement - the cost table',
        '',
        'Generated by `node scripts/build-marketplace.js --cost --out docs/plugin-placement-cost.md`.',
        'Do not edit by hand. The numbers are DESCRIPTION CHARS: what a project re-sends on every',
        'message of every session, which is the surface the always-on budget measures. `Today` is the',
        'per-item selection a `0.2.x` install writes; `Planned` is the closure of the plugins that',
        `project enables. The gate is +${GATE_PCT}%: over it anywhere, the placement rule adjusts, never the gate.`,
        '',
        table.markdown,
        '## Why the delta is zero',
        '',
        'Placement groups an item by the SET of stacks whose closure reaches it, so a project enables',
        'exactly its own closure and pays for nothing else. Two rejected rules and what they cost:',
        '',
        '| Rule | Worst case measured |',
        '|---|---|',
        '| one `web` family (angular + ts/js) | browser-extension +12.4% - it pays for Angular |',
        '| `data` folded into the .NET family | data-only +18.2% - it pays for the whole .NET base |',
        '',
        '## The shared plugins, and who reaches them',
        '',
        '| Plugin | Reached by | Holds |',
        '|---|---|---|',
        ...shared.map(([name, owners]) =>
        {
            const plug = place.plugins[name];
            const holds = [plug.skills.length ? `${plug.skills.length} skills` : '', plug.agents.length ? `${plug.agents.length} agents` : '']
                .filter(Boolean).join(', ');
            return `| \`${name}\` | ${owners.join(', ')} | ${holds} |`;
        }),
        '',
        `Extras (no stack reaches them, copied per pick): ${place.extras.skills.length} skills + ${place.extras.agents.length} agent.`,
        '',
    ].join('\n');
}

function main(argv)
{
    const arg = (flag, fallback) =>
    {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
    };
    const entriesFile = path.resolve(arg('--entries', ENTRIES_FILE));
    const options = {};
    if (argv.includes('--graph')) options.graph = readJson(path.resolve(arg('--graph')), 'stack-graph');
    if (argv.includes('--recs')) options.recs = readJson(path.resolve(arg('--recs')), 'recommendations');

    const place = placement(options);
    if (place.unnamed.length)
        throw new Error(`unnamed owner set(s): ${place.unnamed.join(' | ')} - add a name to GROUP_NAMES in scripts/plugin-placement.js`);
    const entries = buildEntries({ ...options, placement: place });

    if (argv.includes('--cost'))
    {
        const table = costTable({ ...options, placement: place });
        const over = table.rows.filter(r => r.delta > GATE_PCT);
        const out = argv.includes('--out') ? path.resolve(arg('--out', COST_FILE)) : null;
        if (out) { fs.writeFileSync(out, costDocument(table, place)); console.log(`cost table written: ${path.relative(REPO, out)}`); }
        else console.log(table.markdown);
        if (over.length) { console.error(`over the +${GATE_PCT}% gate: ${over.map(r => `${r.combo} ${r.delta}%`).join(', ')}`); return 1; }
        return 0;
    }

    if (argv.includes('--hooks-entry'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const after = JSON.stringify(applyHooksPlugin(mkt), null, 2) + '\n';
        if (before === after) { console.log('hooks entry current: no change'); return 0; }
        fs.writeFileSync(file, after);
        console.log(`hooks entry written: ${Object.keys(hooksPlugin().hooks).length} event(s) -> ${path.relative(REPO, file)}`);
        return 0;
    }

    const wanted = serialize(entries);
    if (argv.includes('--check'))
    {
        let have = null;
        try { have = fs.readFileSync(entriesFile, 'utf8'); } catch { /* absent counts as stale */ }
        if (have === wanted) { console.log(`plugin entries current: ${entries.length} entries`); return 0; }
        console.error(`plugin entries are STALE: ${path.relative(REPO, entriesFile)} - run \`npm run marketplace\``);
        return 1;
    }
    if (argv.includes('--write-marketplace'))
    {
        const file = path.resolve(arg('--marketplace-file', MARKETPLACE));
        const mkt = readJson(file, 'marketplace.json');
        const before = JSON.stringify(mkt, null, 2) + '\n';
        const after = JSON.stringify(applyToMarketplace(mkt, entries), null, 2) + '\n';
        if (before === after) { console.log(`marketplace current: ${entries.length} entries`); return 0; }
        fs.writeFileSync(file, after);
        console.log(`marketplace written: ${entries.length} entries -> ${path.relative(REPO, file)}`);
        return 0;
    }
    if (argv.includes('--write'))
    {
        fs.writeFileSync(entriesFile, wanted);
        console.log(`plugin entries written: ${entries.length} entries -> ${path.relative(REPO, entriesFile)}`);
        return 0;
    }
    console.error('usage: build-marketplace.js --write | --write-marketplace | --check | --cost [--out <file>] | --hooks-entry');
    return 1;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { buildEntries, coreEntry, serialize, applyToMarketplace, applyHooksPlugin, costTable, costDocument, parseHookWirings, hooksBlock, hooksPlugin, get HOOKS_PLUGIN() { return hooksPlugin(); }, ENTRIES_FILE, GATE_PCT };
