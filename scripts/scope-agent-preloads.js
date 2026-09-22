#!/usr/bin/env node
'use strict';
// Rewrites every agent's `skills:` frontmatter to the PLUGIN-SCOPED spelling, computed from the
// same placement the marketplace entries come from.
//
//   node scripts/scope-agent-preloads.js --write    rewrite stack/agents/*.md in place
//   node scripts/scope-agent-preloads.js --check    exit 1 when any line disagrees (the lint path)
//
// Why it is generated and not hand-written. Spike S6 measured that a BARE `skills:` line preloads a
// stale `.claude/skills/` copy when one is present, silently, with no error and no sign in the
// transcript - and every project being migrated has exactly that shape for at least one session.
// Spike S11 then measured that a scoped name resolves even when the skill lives in a DIFFERENT
// plugin, which is 83 of the 112 preload rows here. So the scoped form is required and the prefix
// is whatever the placement says, which is a computation, not a fact to retype 112 times.
//
// A cite that already carries a colon is FOREIGN (`superpowers:systematic-debugging`) and is left
// exactly as it is - this script owns house skills only.
const fs = require('node:fs');
const path = require('node:path');
const { placement, CORE } = require('./plugin-placement.js');

const REPO = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(REPO, 'stack/agents');

// The frontmatter block plus the `skills:` list inside it. A YAML list only - every agent in this
// repo writes it that way, and a flow-style `skills: [a, b]` would be a different shape to parse,
// so it is reported rather than guessed at.
function parse(text, file)
{
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) throw new Error(`${file}: no frontmatter block`);
    const fm = m[1];
    const list = fm.match(/^skills:[ \t]*\n((?:[ \t]*-[ \t]*\S.*\n?)+)/m);
    if (!list)
    {
        if (/^skills:[ \t]*\S/m.test(fm)) throw new Error(`${file}: skills: is not a YAML list - rewrite it as one before running this`);
        return null;
    }
    const names = list[1].split('\n').map(l => l.replace(/^[ \t]*-[ \t]*/, '').trim()).filter(Boolean);
    return { fmStart: m.index + 4, block: list[0], names, at: m.index + 4 + list.index };
}

function homes(place)
{
    const skillHome = new Map();
    const agentHome = new Map();
    for (const [plugin, items] of Object.entries(place.plugins))
    {
        for (const s of items.skills) skillHome.set(s, plugin);
        for (const a of items.agents) agentHome.set(a, plugin);
    }
    return { skillHome, agentHome };
}

// Every plugin an agent's own plugin pulls in, itself included. A scoped cite outside this set
// would name a plugin the project may not have enabled, which is the frontmatter form of the
// house rule against naming a skill that can be absent.
function reachable(place, plugin)
{
    const seen = new Set();
    const walk = (name) =>
    {
        if (!place.plugins[name] || seen.has(name)) return;
        seen.add(name);
        for (const dep of place.plugins[name].dependencies) walk(dep);
    };
    walk(plugin);
    walk(CORE);
    return seen;
}

function scopedFor(options = {})
{
    const place = options.placement || placement(options);
    const { skillHome, agentHome } = homes(place);
    const out = [];
    for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).sort())
    {
        const full = path.join(AGENTS_DIR, file);
        const text = fs.readFileSync(full, 'utf8');
        const parsed = parse(text, file);
        if (!parsed) continue;
        const agent = file.replace(/\.md$/, '');
        const own = agentHome.get(agent);
        if (!own) { out.push({ file, agent, problem: `is in no plugin - the placement does not reach it` }); continue; }
        const within = reachable(place, own);
        const problems = [];
        const wanted = parsed.names.map((name) =>
        {
            if (name.includes(':')) return name;                    // foreign, not ours to scope
            const bare = name;
            const home = skillHome.get(bare);
            if (!home) { problems.push(`${bare} is in no plugin`); return name; }
            if (!within.has(home)) problems.push(`${bare} lives in ${home}, which ${own} does not pull in`);
            return `${home}:${bare}`;
        });
        const block = `skills:\n${wanted.map(n => `  - ${n}\n`).join('')}`;
        out.push({ file, agent, plugin: own, text, at: parsed.at, block: parsed.block, wanted: block, problem: problems.join('; ') || null });
    }
    return out;
}

function main(argv)
{
    const rows = scopedFor();
    const broken = rows.filter(r => r.problem);
    const stale = rows.filter(r => !r.problem && r.block !== r.wanted);
    if (argv.includes('--check'))
    {
        for (const r of broken) console.error(`agent preload: ${r.file} - ${r.problem}`);
        for (const r of stale) console.error(`agent preload: ${r.file} is not scoped to the placement - run \`npm run scope-preloads\``);
        if (broken.length || stale.length) return 1;
        console.log(`agent preloads current: ${rows.length} agent(s) with a skills: list`);
        return 0;
    }
    if (argv.includes('--write'))
    {
        for (const r of broken) console.error(`agent preload: ${r.file} - ${r.problem}`);
        if (broken.length) return 1;
        let changed = 0;
        for (const r of stale)
        {
            fs.writeFileSync(path.join(AGENTS_DIR, r.file), r.text.slice(0, r.at) + r.wanted + r.text.slice(r.at + r.block.length));
            changed++;
        }
        console.log(`agent preloads written: ${changed} of ${rows.length} agent(s) rescoped`);
        return 0;
    }
    console.error('usage: scope-agent-preloads.js --write | --check');
    return 1;
}

if (require.main === module)
{
    try { process.exit(main(process.argv.slice(2))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { scopedFor, parse, reachable };
