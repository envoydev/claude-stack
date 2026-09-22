'use strict';
// Where every skill and agent lives once the stack ships as plugins. Placement is COMPUTED from
// meta/recommendations.json + meta/stack-graph.json, never hand-written, so `stack/` stays the one
// home per piece and a new skill lands in a plugin by the same rule as every other.
//
// The rule, whole:
//   1. Close the ALWAYS selection. Everything in it is the CORE plugin.
//   2. For every other item, compute the SET of stacks whose closure reaches it.
//   3. One plugin per distinct set. A set of one stack is that stack's leaf; a set of several is a
//      shared plugin every one of those stacks depends on.
//   4. An item no stack reaches at all is EXTRAS: a file in the core, copied per pick, never a plugin.
//
// Why owner sets rather than hand-declared families: a family is taste, and taste is measurable here.
// Declaring one `web` family (angular + ts/js) made a browser-extension project pay +12.4% for
// Angular skills it never loads, and folding `data` into the .NET family cost a data-only project
// +18.2% - both past the plan's +10% gate. Grouping by the set that actually reaches an item gives
// every project exactly its own closure, so the delta is 0% by construction and no judgment call is
// left in the rule. The ONE human input is the NAME of each shared set, in GROUP_NAMES below, and a
// set with no name is a lint failure rather than a generated slug.
const fs = require('node:fs');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');

const REPO = path.resolve(__dirname, '..');
const CORE = 'claude-stack';
const EXTRAS = 'extras';

// key = the reaching stacks, sorted and joined by '+'. Adding a stack or moving a skill can create a
// new key; the lint then fails until it is named here, which is the point - a plugin name is the one
// thing a person should read and recognise.
const GROUP_NAMES = {
    'aspnet+data': 'claude-stack-aspnet-data',
    'console+windows-service': 'claude-stack-dotnet-hosting',
    'ionic-angular+web-angular': 'claude-stack-angular',
    'browser-extension+javascript+typescript': 'claude-stack-tsjs',
    'browser-extension+ionic-angular+typescript+web-angular': 'claude-stack-typescript-shared',
    'aspnet+console+windows-service+winforms+wpf': 'claude-stack-dotnet',
    'browser-extension+ionic-angular+javascript+typescript+web-angular': 'claude-stack-javascript-shared',
    'aspnet+console+data+windows-service+winforms+wpf': 'claude-stack-csharp',
};

function readJson(rel)
{
    return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
}

function mergeSelections(...selections)
{
    const out = { skills: [], agents: [], rules: [], mcps: [], plugins: [], hooks: [] };
    for (const sel of selections)
        for (const key of Object.keys(out)) out[key] = out[key].concat(sel[key] || []);
    for (const key of Object.keys(out)) out[key] = [...new Set(out[key])];
    return out;
}

// One description line is what an item costs on every message of every session that carries it.
function descriptionChars(kind, name)
{
    const file = kind === 'skill'
        ? path.join(REPO, 'stack/skills', name, 'SKILL.md')
        : path.join(REPO, 'stack/agents', name + '.md');
    const m = fs.readFileSync(file, 'utf8').match(/^description:\s*(.*)$/m);
    return m ? m[1].length : 0;
}

function placement(options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    const recs = options.recs || readJson('meta/recommendations.json');
    const names = options.groupNames || GROUP_NAMES;
    const stacks = Object.keys(recs.stacks);

    const core = computeClosure(graph, recs.always);
    const coreSkills = new Set(core.skills);
    const coreAgents = new Set(core.agents);

    // Which stacks reach each non-core item, through the FULL closure - a skill an agent pulls in is
    // reached by that agent's stack even though no manifest lists it.
    const reach = new Map();
    const touch = (key, stack) =>
    {
        if (!reach.has(key)) reach.set(key, new Set());
        reach.get(key).add(stack);
    };
    for (const stack of stacks)
    {
        const closed = computeClosure(graph, mergeSelections(recs.always, recs.stacks[stack]));
        for (const s of closed.skills) if (!coreSkills.has(s)) touch('skill:' + s, stack);
        for (const a of closed.agents) if (!coreAgents.has(a)) touch('agent:' + a, stack);
    }

    const plugins = {};
    const rank = {};
    const owners = {};
    const unnamed = [];
    const ensure = (name, ownerSet) =>
    {
        if (!plugins[name])
        {
            plugins[name] = { skills: [], agents: [], dependencies: [] };
            owners[name] = ownerSet;
            // A plugin holding more stacks sits lower, so a dependency always points DOWN and no
            // shared plugin can ever depend on a leaf.
            rank[name] = ownerSet.length === 0 ? 0 : stacks.length + 1 - ownerSet.length;
        }
        return plugins[name];
    };
    ensure(CORE, []);
    plugins[CORE].skills.push(...core.skills);
    plugins[CORE].agents.push(...core.agents);

    const leafName = (stack) => `claude-stack-${stack}`;
    const groupName = (key, list) =>
    {
        if (list.length === 1) return leafName(list[0]);
        if (!names[key]) { unnamed.push(key); return null; }
        return names[key];
    };

    const groups = new Map();
    for (const [item, set] of reach)
    {
        const list = [...set].sort();
        const key = list.join('+');
        if (!groups.has(key)) groups.set(key, { list, items: [] });
        groups.get(key).items.push(item);
    }

    for (const [key, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    {
        const name = groupName(key, group.list);
        if (!name) continue;
        const plug = ensure(name, group.list);
        for (const item of group.items)
        {
            const kind = item.slice(0, item.indexOf(':'));
            const bare = item.slice(item.indexOf(':') + 1);
            plug[kind === 'skill' ? 'skills' : 'agents'].push(bare);
        }
    }

    // Everything no stack reaches: files under the core's extras/, copied per pick. Not a plugin.
    const extras = { skills: [], agents: [] };
    for (const name of Object.keys(graph.skills))
        if (!coreSkills.has(name) && !reach.has('skill:' + name)) extras.skills.push(name);
    for (const name of Object.keys(graph.agents))
        if (!coreAgents.has(name) && !reach.has('agent:' + name)) extras.agents.push(name);

    // Every stack gets a leaf, even an empty one: the leaf is what a project enables, and it carries
    // the dependencies on the shared plugins that stack reaches into.
    for (const stack of stacks) ensure(leafName(stack), [stack]);
    for (const stack of stacks)
    {
        const leaf = plugins[leafName(stack)];
        for (const [name, ownerSet] of Object.entries(owners))
            if (ownerSet.length > 1 && ownerSet.includes(stack)) leaf.dependencies.push(name);
        leaf.dependencies.push(CORE);
    }
    for (const [name, ownerSet] of Object.entries(owners))
        if (ownerSet.length > 1) plugins[name].dependencies.push(CORE);

    for (const plug of Object.values(plugins))
    {
        plug.skills.sort();
        plug.agents.sort();
        plug.dependencies = [...new Set(plug.dependencies)].sort();
    }
    extras.skills.sort();
    extras.agents.sort();
    return { plugins, extras, rank, owners, unnamed: [...new Set(unnamed)].sort(), stacks };
}

// What a project pays: the description chars of every skill and agent in the plugins that
// combination of stacks enables, each counted once.
function costOf(place, stacks)
{
    const wanted = new Set([CORE]);
    const add = (name) =>
    {
        if (!place.plugins[name] || wanted.has(name)) return;
        wanted.add(name);
        for (const dep of place.plugins[name].dependencies) add(dep);
    };
    for (const stack of [...new Set(stacks)]) add(`claude-stack-${stack}`);
    const skills = new Set();
    const agents = new Set();
    for (const name of wanted)
    {
        for (const s of place.plugins[name].skills) skills.add(s);
        for (const a of place.plugins[name].agents) agents.add(a);
    }
    let chars = 0;
    for (const s of skills) chars += descriptionChars('skill', s);
    for (const a of agents) chars += descriptionChars('agent', a);
    return { chars, plugins: [...wanted].sort(), skills: skills.size, agents: agents.size };
}

// What the same project pays TODAY: per-item selection, no plugin anywhere.
function costToday(stacks, options = {})
{
    const graph = options.graph || readJson('meta/stack-graph.json');
    const recs = options.recs || readJson('meta/recommendations.json');
    const closed = computeClosure(graph, mergeSelections(recs.always, ...[...new Set(stacks)].map(s => recs.stacks[s] || {})));
    let chars = 0;
    for (const s of closed.skills) chars += descriptionChars('skill', s);
    for (const a of closed.agents) chars += descriptionChars('agent', a);
    return { chars, skills: closed.skills.length, agents: closed.agents.length };
}

module.exports = { placement, costOf, costToday, descriptionChars, mergeSelections, readJson, GROUP_NAMES, CORE, EXTRAS };
