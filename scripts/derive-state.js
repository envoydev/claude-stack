#!/usr/bin/env node
'use strict';
// THE ONE DERIVATION - what a selection means for a project, decided once.
//
//   node scripts/derive-state.js --selection <file> [--source <dir>] [--marketplace <name>]
//   node scripts/derive-state.js --floor --plugins <enabled entries, csv> [--settings <file>]
//
// Before this script, four readers answered the same question in their own words: the three guided
// walks described what the install would write, and the seed computed it again in code. That is how
// a route change reaches three of them and not the fourth. Every one of them now runs this and
// REPORTS its output, so a disagreement is a diff of one JSON object rather than an argument
// between two prose paragraphs.
//
// It owns no engine of its own. The closure is `stack-select.js`, the placement is
// `selection-plugins.js`, and this script is the third thing they never covered: what the project
// carries that it did NOT pick, and what can be switched off about it.
//
// Three rules, one per surface, each measured:
//
//   - AGENTS have a real lever. Spike S3: `permissions.deny: ["Agent(<plugin>:<name>)"]` drops the
//     seat from the listing and its description from the bill, -434 tokens for one seat. With 43
//     seats shipped that is the largest trim left. The scoped identifier is the measured address;
//     the docs give the general form as `Agent(AgentName)` ('Agent (subagents)',
//     code.claude.com/docs/en/permissions), which is the spelling for a project-local seat. It is written only for a seat an ENABLED plugin
//     carries: a seat in a plugin this project never enabled is not loaded at all, so denying it is
//     noise now and a trap later - the day that plugin is enabled, the stale entry silently drops a
//     seat the user just asked for.
//   - SKILLS have none. Spike S2: `skillOverrides` moved 0 tokens on a plugin skill under either
//     the bare or the scoped key. So a skill the closure carries and the selection did not pick is
//     REPORTED as undroppable, and there is deliberately no `off` key to mistake for a lever.
//   - HOOKS are switched off by NAME, against the whole shipped catalog, because the hooks plugin
//     carries all thirteen whatever the project picked (`CLAUDE_STACK_HOOKS_OFF`, Phase 2).
const fs = require('node:fs');
const path = require('node:path');

const { pluginsFor, readSelection, parseSelectionText, itemsOf } = require('./selection-plugins.js');
const { placement, descriptionChars, CORE } = require('./plugin-placement.js');
const { loadManifest } = require('./install/manifest.js');
const { hookDisabled } = require('../stack/hooks/hook-prelude.js');
const { pluginRoutes } = require('./install/plugins.js');

const REPO = path.resolve(__dirname, '..');

// The scoped identifier - the address S1's dispatch finding and S3's deny measurement both used.
// `Tool(param:value)` rules exist too, but only for a direct field of the tool's input ('Match by
// input parameter', code.claude.com/docs/en/permissions) - so a plugin named like an Agent field
// (`model`, `isolation`) would be read as one; every stack entry starts `claude-stack`.
const denySpec = (agent, plugin) => `Agent(${plugin}:${agent})`;

// The seat a stack deny names, under ANY stack entry's spelling - null for a user's own entry.
const stackSeat = (spec) => (/^Agent\(claude-stack[a-z0-9-]*:([A-Za-z0-9_-]+)\)$/.exec(String(spec)) || [])[1] || null;

// Which plugin carries each agent - the deny spelling needs the home, not just the name.
function agentHomes(place)
{
    const homes = new Map();
    for (const [plugin, items] of Object.entries(place.plugins))
        for (const agent of items.agents) if (!homes.has(agent)) homes.set(agent, plugin);
    return homes;
}

// The two kinds selection-plugins does not read: they are copied and wired by NAME, so nothing has
// to resolve them to a plugin.
const pickedLines = (text) =>
{
    const picked = { rules: new Set(), hooks: new Set() };
    for (const line of String(text).split('\n'))
    {
        const m = line.trim().match(/^(rule|hook)\s+(\S+)$/);
        if (m) picked[m[1] === 'rule' ? 'rules' : 'hooks'].add(m[2].replace(/\.(md|js)$/, ''));
    }
    return picked;
};

// `selection` is a FILE; `selectionText` is the same lines already in hand, which is what the
// installer holds on the --installed-only route where nothing was written to disk.
function deriveState({ selection, selectionText, sourceDir = REPO, marketplace = 'claude-stack' } = {})
{
    // readSelection throws with the path in the message when the file is unreadable; an empty
    // install derived from a missing file is the failure mode this refuses to have.
    const picked = selectionText === undefined ? readSelection(selection) : parseSelectionText(selectionText);
    const flat = pickedLines(selectionText === undefined ? fs.readFileSync(selection, 'utf8') : selectionText);

    const place = placement();
    const { plugins, copy } = pluginsFor(picked, { placement: place });
    const enabled = plugins.map((p) => `${p}@${marketplace}`);

    const carried = itemsOf(plugins, { placement: place });
    const homes = agentHomes(place);

    const off = carried.agents.filter((a) => !picked.agents.has(a));
    // The seats an enabled plugin carries AND the selection kept. Their specs exist for one job:
    // clearing a deny a PREVIOUS run wrote, so a seat added back through configure actually comes
    // back. A seat this run copied (an extra) never had a scoped spec to clear.
    const kept = carried.agents.filter((a) => picked.agents.has(a));
    const shipped = [...new Set(loadManifest(sourceDir).catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')))];
    // No hook line at all means every hook, exactly as the installer's copy filter reads it - a
    // selection that never reached the hooks layer answers nothing about hooks.
    const hooksAnswered = flat.hooks.size > 0;
    const hooksOn = hooksAnswered ? shipped.filter((h) => flat.hooks.has(h)) : shipped;
    const hooksOff = hooksAnswered ? shipped.filter((h) => !flat.hooks.has(h)) : [];

    return {
        plugins: enabled,
        skills: {
            picked: [...picked.skills].sort(),
            carried: carried.skills,
            extras: copy.skills,
            // No `off` key, deliberately: R1 of the phase plan. Nothing can drop these.
            undroppable: carried.skills.filter((s) => !picked.skills.has(s)),
        },
        agents: {
            on: [...picked.agents].sort(),
            off,
            deny: off.map((a) => denySpec(a, homes.get(a) || CORE)),
            allow: kept.map((a) => denySpec(a, homes.get(a) || CORE)),
            extras: copy.agents,
        },
        rules: { copy: [...flat.rules].sort() },
        hooks: { on: hooksOn, off: hooksOff, answered: hooksAnswered },
        mcps: [...picked.mcps].sort(),
        env: { CLAUDE_STACK_HOOKS_OFF: hooksOff.join(',') },
    };
}

// The hooks entry and the two MCP families that fan one catalog row out into several plugins.
const HOOKS_ENTRY = 'claude-stack-hooks';
const catalogServer = (name) => String(name)
    .replace(/^playwright-(chrome|msedge|firefox|webkit)$/, 'playwright')
    .replace(/^context7-local$/, 'context7');

// THE INVERSE, for a run that asks nothing (`update --installed-only`): the selection lines the
// project carries NOW on each plugin route. On those routes `.claude/` holds only the extras, so the
// disk read alone found no seat and no hook - and the derivation above then switched every one of
// them off. Each surface is read from the state ITS route writes: the enabled entries' contents
// minus the seats `permissions.deny` names, the hook catalog minus CLAUDE_STACK_HOOKS_OFF, the MCP
// entries folded onto the catalog. Deriving from these lines writes back the state they came from,
// which is how a seat or hook the user switched off survives an update. `plugins` is this stack's
// ENABLED entries only (`install/selection.js` readBack filters the listing); a surface whose route
// is off, or whose entry is absent, reads back nothing and the caller's disk read decides.
function readInstalled({ plugins = [], deny = [], hooksOff, routes = {}, sourceDir = REPO } = {})
{
    const names = [...new Set(plugins.map((p) => String(p).split('@')[0]))];
    const lines = [];
    if (routes.skills)
    {
        const place = placement();
        const carried = itemsOf(names.filter((n) => place.plugins[n]), { placement: place });
        // By SEAT, under any stack entry's spelling: a release that moves a seat to another entry
        // changes its deny spelling, and the seat the user switched off must stay off across it.
        const denied = new Set((Array.isArray(deny) ? deny : []).map(stackSeat).filter(Boolean));
        for (const s of carried.skills) lines.push(`skill ${s}`);
        for (const a of carried.agents) if (!denied.has(a)) lines.push(`agent ${a}`);
    }
    const manifest = loadManifest(sourceDir);
    if (routes.hooks && names.includes(HOOKS_ENTRY))
    {
        // The prelude's own matcher, so the read-back honours exactly the spellings the hooks do.
        const env = { CLAUDE_STACK_HOOKS_OFF: String(hooksOff || '') };
        const shipped = [...new Set(manifest.catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')))];
        for (const h of shipped) if (!hookDisabled(h, env)) lines.push(`hook ${h}`);
    }
    if (routes.mcps)
    {
        const catalog = new Set(manifest.catalogs.mcps.map((row) => row.split('|')[0]));
        for (const server of new Set(names.map(catalogServer))) if (catalog.has(server)) lines.push(`mcp ${server}`);
    }
    return lines;
}

// What of a derived state this run may WRITE. A walk's selection answers both surfaces; a read-back
// answers only what it found evidence of (`answered`), so a failed `claude plugin list` writes
// nothing instead of switching every hook and seat off. The off-lists exist only on the routes
// that load through a plugin: on the copy routes absence from disk is the off-state.
function writable(state, { routes = {}, answered = { hooks: true, agents: true } } = {})
{
    const hooks = Boolean(state && state.hooks.answered && answered.hooks !== false);
    const agents = Boolean(state && answered.agents && routes.skills);
    return {
        hooksOff: hooks && routes.hooks ? state.hooks.off : [],
        hooksAnswered: hooks,
        agentDeny: agents ? state.agents.deny : [],
        agentAllow: agents ? state.agents.allow : [],
        // Carried without a pick only where a plugin carries skills; the copy route copies the picks.
        undroppable: state && routes.skills ? state.skills.undroppable : [],
    };
}

// THE FLOOR the stack's own entries add to every message: the description of each model-invocable
// skill they carry (a `disable-model-invocation` skill's is not in context - 'Control who invokes a
// skill', code.claude.com/docs/en/skills) and of each seat not denied (spike S3: a denied seat
// leaves the Agent listing). Status reports it; before this the seats were not counted at all.
// Read from the FRONTMATTER only: a body line or a code fence showing the key is not the flag.
const manualOnlyText = (text) => /^disable-model-invocation:\s*true\s*$/m.test((/^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text)) || [])[1] || '');
const manualOnly = (skill) =>
{
    try { return manualOnlyText(fs.readFileSync(path.join(REPO, 'stack', 'skills', skill, 'SKILL.md'), 'utf8')); }
    catch { return false; }
};

function floor({ plugins = [], deny = [] } = {})
{
    const place = placement();
    const named = [...new Set(plugins.map((p) => String(p).split('@')[0]).filter(Boolean))];
    const entries = named.filter((n) => place.plugins[n]).sort();
    const carried = itemsOf(entries, { placement: place });
    // The EXACT spelling Claude Code matches - the seat under its home entry. A deny left under an
    // entry the seat has since moved out of hides nothing until the next install rewrites it.
    const homes = agentHomes(place);
    const specs = new Set(Array.isArray(deny) ? deny.map(String) : []);
    const denied = new Set(carried.agents.filter((a) => specs.has(denySpec(a, homes.get(a) || CORE))));
    const skills = carried.skills.filter((s) => !manualOnly(s));
    const seats = carried.agents.filter((a) => !denied.has(a));
    const sum = (kind, names) => names.reduce((n, name) => n + descriptionChars(kind, name), 0);
    // `skipped`: the entries this count does not cover - the hooks entry, whose SessionStart
    // injections are text a script cannot size ahead, and the MCP entries. The caller counts them
    // as any other plugin; a name dropped here without a word is how a floor under-reports.
    const out = {
        entries,
        skipped: named.filter((n) => !place.plugins[n]).sort(),
        skills: { count: skills.length, chars: sum('skill', skills) },
        agents: { count: seats.length, denied: carried.agents.filter((a) => denied.has(a)), chars: sum('agent', seats) },
    };
    out.chars = out.skills.chars + out.agents.chars;
    return out;
}

function main(argv)
{
    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    if (argv.includes('--floor'))
    {
        // Every --settings file counts: deny rules merge across the account, project and local
        // scopes, so a seat switched off in any of them is off. An unreadable file denies nothing.
        const deny = [];
        argv.forEach((a, i) =>
        {
            if (a !== '--settings' || !argv[i + 1]) return;
            let stored = {};
            try { stored = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')); } catch { stored = {}; }
            if (stored && stored.permissions && Array.isArray(stored.permissions.deny)) deny.push(...stored.permissions.deny);
        });
        const plugins = String(arg('--plugins') || '').split(',').map((p) => p.trim()).filter(Boolean);
        console.log(JSON.stringify(floor({ plugins, deny }), null, 2));
        return 0;
    }
    const selection = arg('--selection');
    if (!selection)
    {
        console.error('usage: derive-state.js --selection <file> [--source <dir>] [--marketplace <name>]\n       derive-state.js --floor --plugins <enabled entries, csv> [--settings <settings.json>]...');
        return 1;
    }
    const state = deriveState({
        selection: path.resolve(selection),
        sourceDir: arg('--source') ? path.resolve(arg('--source')) : REPO,
        marketplace: arg('--marketplace') || 'claude-stack',
    });
    // What THIS environment's routes write, by the installer's own rule - so a walk reporting the
    // derivation before the install reports the copy routes as writing no off-state.
    const routes = pluginRoutes(process.env);
    console.log(JSON.stringify({ ...state, routes, written: writable(state, { routes }) }, null, 2));
    return 0;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { deriveState, readInstalled, writable, floor, manualOnlyText, denySpec, stackSeat, agentHomes, REPO };
