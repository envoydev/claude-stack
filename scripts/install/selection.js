'use strict';
// THE SELECTION - which of the six manifest lists this run actually installs.
//
// Two ways in, and they meet in the same filter:
//
//   - `--selection <file>`: one `category name` per line, from a guided walk. The filter INTERSECTS
//     with the manifest, so a name the manifest does not carry can never be installed - which is
//     what makes a user-authored skill or rule safe by construction.
//   - `--installed-only`: derive that file from what the target already carries, then refresh
//     exactly that. The update fast path.
//
// Three rules that are each a bug that shipped:
//
//   - A SELECTION WITH NO `hook` LINES INSTALLS EVERY HOOK. Hooks joined the walk later, so a file
//     written before that layer must keep its install-everything behaviour. `--installed-only`
//     answers this by emptying the hook list itself when the disk carries none.
//   - A HOOK THIS RELEASE ADDED REACHES AN EXISTING INSTALL ONLY HERE, so hooks are all-or-nothing
//     on the derived path: an install that HAS hooks gets every shipped one. The exception is a
//     DELIBERATE DROP - a hook named in the previous stamp and absent now was removed through
//     configure and stays removed.
//   - THE ALWAYS-ON BASELINE IS ADOPTED THE SAME WAY, with NO drop exception: the always set is
//     locked, so an always item absent from disk is adopted whatever the stamp says. A stamp naming
//     the shipped list once read as a drop of everything, and the memory rule never arrived.
const fs = require('node:fs');
const path = require('node:path');

// A generated, project-owned file is not a stack item: the captures rewrite those.
const RULE_EXCLUDE = /^(baseline-project-.*|project-code-style)$/;
// docs.js / memory.js are ENGINES and hook-prelude.js the shared gate module - none is a hook.
const HOOK_EXCLUDE = /^(inject-code-style|docs|memory|hook-prelude)$/;
const PW_ENGINE = /^playwright-(chrome|msedge|firefox|webkit)$/;

const nameOfSkill = (entry) => String(entry).split('|').pop();
const nameOfMcp = (entry) => String(entry).split('|')[0];
const nameOfPlugin = (entry) => String(entry).split('@')[0];
const nameOfFile = (entry) => String(entry).split('::')[0].replace(/\.(md|js)$/, '');

const CATEGORY = {
    skills: { line: 'skill', name: nameOfSkill },
    plugins: { line: 'plugin', name: nameOfPlugin },
    mcps: { line: 'mcp', name: nameOfMcp },
    agents: { line: 'agent', name: nameOfFile },
    rules: { line: 'rule', name: nameOfFile },
    hooks: { line: 'hook', name: nameOfFile },
};

// '#' comments and blank lines ignored, exactly as the shell's grep -qxF sees them.
function parseSelection(text)
{
    const picked = new Set();
    for (const raw of String(text).split('\n'))
    {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        picked.add(line);
    }
    return picked;
}

// Keep only the entries the selection names. HOOKS are the special case: no `hook` line at all
// means the file predates the hooks layer, and every hook stays.
function applySelection(lists, picked)
{
    const hasHooks = [...picked].some((l) => l.startsWith('hook '));
    const out = {};
    for (const [key, { line, name }] of Object.entries(CATEGORY))
    {
        const entries = lists[key] || [];
        if (key === 'hooks' && !hasHooks) { out.hooks = [...entries]; continue; }
        out[key] = entries.filter((entry) => picked.has(`${line} ${name(entry)}`));
    }
    return out;
}

// The dry run. One hook wired on two tools is ONE hook in the plan.
function renderPlan(lists)
{
    const seen = new Set();
    const hooks = (lists.hooks || []).map(nameOfFile).filter((n) => !seen.has(n) && seen.add(n));
    return [
        `plan skills: ${(lists.skills || []).map(nameOfSkill).join(' ')}`,
        `plan plugins: ${(lists.plugins || []).map(nameOfPlugin).join(' ')}`,
        `plan mcps: ${(lists.mcps || []).map(nameOfMcp).join(' ')}`,
        `plan agents: ${(lists.agents || []).map(nameOfFile).join(' ')}`,
        `plan rules: ${(lists.rules || []).map(nameOfFile).join(' ')}`,
        `plan hooks: ${hooks.join(' ')}`,
    ].map((l) => l.replace(/: $/, ':'));
}

const listDir = (dir, test) =>
{
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(test).map((d) => d.name); }
    catch { return []; }
};

// What the TARGET carries, read off disk. Generated project-owned files and the engine modules are
// excluded; a playwright engine server collapses back to the one manifest entry it expands from.
function deriveFromDisk({ claudeDir, mcpServers = [], plugins = [], knownPlugins = [] })
{
    const lines = [];
    for (const name of listDir(path.join(claudeDir, 'skills'), (d) => d.isDirectory()))
        if (fs.existsSync(path.join(claudeDir, 'skills', name, 'SKILL.md'))) lines.push(`skill ${name}`);
    for (const f of listDir(path.join(claudeDir, 'agents'), (d) => d.isFile() && d.name.endsWith('.md')))
        lines.push(`agent ${f.replace(/\.md$/, '')}`);
    for (const f of listDir(path.join(claudeDir, 'rules'), (d) => d.isFile() && d.name.endsWith('.md')))
    {
        const name = f.replace(/\.md$/, '');
        if (!RULE_EXCLUDE.test(name)) lines.push(`rule ${name}`);
    }
    for (const f of listDir(path.join(claudeDir, 'hooks'), (d) => d.isFile() && d.name.endsWith('.js')))
    {
        const name = f.replace(/\.js$/, '');
        if (!HOOK_EXCLUDE.test(name)) lines.push(`hook ${name}`);
    }
    const seenMcp = new Set();
    for (const server of mcpServers)
    {
        const name = String(server).replace(PW_ENGINE, 'playwright');
        if (!seenMcp.has(name)) { seenMcp.add(name); lines.push(`mcp ${name}`); }
    }
    // Plugins are machine-level, so they come from the CLI listing rather than a project directory -
    // without this the fast path filtered PLUGINS to empty and `update` ran on nothing.
    const known = new Set(knownPlugins.map(nameOfPlugin));
    const seenPlugin = new Set();
    for (const p of plugins)
    {
        const name = nameOfPlugin(p);
        if (known.has(name) && !seenPlugin.has(name)) { seenPlugin.add(name); lines.push(`plugin ${name}`); }
    }
    // The CLI could not be read: fall back to the manifest's set. Safe, because this path is
    // update-only and `claude plugin update` never installs a missing plugin.
    if (!seenPlugin.size) for (const p of knownPlugins) lines.push(`plugin ${nameOfPlugin(p)}`);
    return lines;
}

// The FILE layers only. Plugins are machine-level and servers come from a shared file; neither is
// evidence that THIS target has an install.
const hasInstall = (lines) => lines.some((l) => /^(skill|agent|rule|hook) /.test(l));

// Hooks: adopt every shipped one, except a name the PREVIOUS stamp shipped and disk no longer has.
function adoptHooks({ lines, catalog = [], shippedBefore = [], log = () => {} })
{
    if (!lines.some((l) => l.startsWith('hook '))) return lines;
    const have = new Set(lines.filter((l) => l.startsWith('hook ')).map((l) => l.slice(5)));
    const dropped = new Set(shippedBefore);
    const out = [...lines];
    for (const entry of catalog)
    {
        const name = nameOfFile(entry);
        if (have.has(name)) continue;
        if (dropped.has(name)) { log(`installed-only: hook ${name} was dropped from this install - leaving it out`); continue; }
        out.push(`hook ${name}`);
        have.add(name);
        log(`installed-only: adopting hook ${name} - shipped by this release and absent here`);
    }
    return out;
}

// The always-on baseline, with NO drop exception - the set is locked, like serena. A layer this
// install does not carry AT ALL (no rule line, or no mcp line) stays absent.
function adoptAlways({ lines, always = {}, log = () => {} })
{
    const out = [...lines];
    for (const [category, key] of [['rule', 'rules'], ['mcp', 'mcps']])
    {
        if (!out.some((l) => l.startsWith(`${category} `))) continue;
        for (const name of always[key] || [])
        {
            if (out.includes(`${category} ${name}`)) continue;
            out.push(`${category} ${name}`);
            log(`installed-only: adopting ${category} ${name} - always shipped by this release and absent here`);
        }
    }
    return out;
}

module.exports = {
    parseSelection, applySelection, renderPlan, deriveFromDisk, hasInstall,
    adoptHooks, adoptAlways, CATEGORY, RULE_EXCLUDE, HOOK_EXCLUDE,
};
