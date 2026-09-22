'use strict';
// THE PLUGIN LAYER - what this run enables, at which scope, and what it takes back out.
//
// From Phase 3 onward the plugins ARE the delivery: the skills, agents, hooks and (Phase 6) MCP
// servers all arrive through the project's own closure, and the copy route is the escape hatch.
// So the decisions here are the install.
//
// Five rules, each one measured:
//
//   - THE CLOSURE IS COMPUTED ONCE, by `selection-plugins.js`, and it is fed skill/agent lines only
//     when the skills route is on and mcp lines only when the MCP route is. Whatever comes back is
//     exactly what this combination of routes needs enabled.
//   - A FAILURE TO COMPUTE IT DROPS BOTH ROUTES TO COPY, together and loudly. Half a closure would
//     leave a project with neither the plugin's copy of an item nor its own.
//   - `claude plugin update` IS A NO-OP ON A PLUGIN THAT IS NOT INSTALLED, and says nothing about
//     one that is installed but DISABLED. So update must install an absent plugin and enable a
//     parked one BEFORE it updates - measured: two added plugins still `disabled` after a run,
//     recovered by hand over eight messages and ~1.05M of context.
//   - THE PLUGIN'S OWN SCOPE WINS on update, read from the listing: `claude plugin update --scope
//     <other>` is a silent no-op, so passing the INSTALL's scope left every user-scoped plugin on
//     its old version under a project install.
//   - VERSIONS ARE READ BACK. `claude plugin update` reports success whether or not anything moved.
const path = require('node:path');

// claude-hud is a statusline HUD: a project-scoped install plus the global statusline enable
// mismatch, so every OTHER project warns 'plugin not cached'. It is user scope, always.
const USER_SCOPE_PLUGINS = ['claude-hud'];

const OFFICIAL_MARKETPLACE = 'anthropics/claude-plugins-official';

// `...=false` restores the copy route - the documented contract, and the only value either twin
// ever promised. (The sh twin read anything but the literal 'true' as off and the ps1 anything but
// 'false' as on; on every documented value they agree, and this takes the documented reading.)
const pluginRoutes = (env = {}) => ({
    hooks: env.CLAUDE_STACK_HOOKS_VIA_PLUGIN !== 'false',
    skills: env.CLAUDE_STACK_SKILLS_VIA_PLUGIN !== 'false',
    mcps: env.CLAUDE_STACK_MCPS_VIA_PLUGIN !== 'false',
});

const corePluginOn = (routes) => Boolean(routes.hooks || routes.skills || routes.mcps);

// `claude plugin list --json` -> one row per plugin NAME. A row carrying a projectPath belongs to
// that project and is dropped unless it is this one; where both exist, THIS project's row wins over
// the account-level one. Anything unparseable is an empty listing, never a crash: the callers all
// treat 'the listing cannot say' as a real answer.
function parsePluginList(json, projectRoot)
{
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return []; }
    const rows = Array.isArray(data) ? data : (data && Array.isArray(data.installed) ? data.installed : []);
    const here = path.resolve(projectRoot || '.');
    const best = new Map();
    for (const row of rows)
    {
        if (!row || typeof row !== 'object') continue;
        const name = String(row.id ?? '').split('@')[0];
        if (!name) continue;
        const pp = row.projectPath;
        if (pp && path.resolve(String(pp)) !== here) continue;
        const rank = pp ? 0 : 1;                      // this project first, then the account rows
        const prev = best.get(name);
        if (prev && prev.rank <= rank) continue;
        best.set(name, {
            rank, name,
            version: String(row.version ?? '?'),
            scope: String(row.scope ?? ''),
            enabled: row.enabled !== false,
        });
    }
    return [...best.values()].map(({ rank, ...row }) => row);
}

const fieldOf = (listing, name, key) =>
{
    const row = (listing || []).find((r) => r.name === name);
    return row ? row[key] : undefined;
};

const bareName = (spec) => String(spec).split('@')[0];

// Install scope for one plugin: claude-hud is pinned to user, everything else follows the run -
// unless the LISTING already says where it lives, which wins on update.
function scopeFor(spec, installScope, listing)
{
    const name = bareName(spec);
    const known = fieldOf(listing, name, 'scope');
    if (known) return known;
    return USER_SCOPE_PLUGINS.includes(name) ? 'user' : installScope;
}

// The stack's own closure for this run. Returns the entries to enable, the extras still copied, and
// the routes as they stand AFTER any fallback - the caller reads those, never the env again.
function resolveStackPlugins({ routes, selection, runSelection, log = () => {} })
{
    if (!routes.skills && !routes.mcps) return { entries: [], extraSkills: [], extraAgents: [], routes };

    let out;
    try { out = runSelection(selection); }
    catch (err)
    {
        const next = { ...routes, skills: false, mcps: false };
        log(`  !! ${err.message} - skills, agents and MCP servers stay on the copy route`);
        return { entries: [], extraSkills: [], extraAgents: [], routes: next };
    }

    const entries = (out.entries || []).filter(Boolean);
    const extraSkills = [];
    const extraAgents = [];
    for (const line of out.copy || [])
    {
        if (line.startsWith('skill ')) extraSkills.push(line.slice(6));
        else if (line.startsWith('agent ')) extraAgents.push(line.slice(6));
    }
    log(`plugins carry ${entries.length} entr(ies); extras copied: ${extraSkills.length} skill(s), ${extraAgents.length} agent(s)`);
    return { entries, extraSkills, extraAgents, routes };
}

// The SELECTION lines `selection-plugins.js` reads, built from what each route actually needs.
function selectionLines({ routes, skills = [], agents = [], mcps = [], context7Mode })
{
    const lines = [];
    if (routes.skills)
    {
        for (const s of skills) lines.push(`skill ${typeof s === 'string' ? s.split('|').pop() : s.name}`);
        for (const a of agents) lines.push(`agent ${String(typeof a === 'string' ? a.split('::')[0] : a.file).replace(/\.md$/, '')}`);
    }
    if (routes.mcps)
    {
        for (const m of mcps) lines.push(`mcp ${typeof m === 'string' ? m.split('|')[0] : m.name}`);
        // The local context7 transport is its OWN entry beside the hosted one: two servers in one
        // plugin both load, so local mode ADDS a plugin rather than swapping a server.
        if (context7Mode === 'local') lines.push('mcp context7-local');
    }
    return lines;
}

// The core's dependency plugins, but ONLY when this run enables no stack plugin of its own -
// otherwise the CLI installs them transitively with the core.
const coreDepsNeeded = (stackEntries, coreDeps = []) => (stackEntries.length ? [] : [...coreDeps]);

// Everything this run hands to `claude plugin install`, in order: the third-party picks, then the
// stack's own entries (the hooks plugin first, so it resolves in the same run that prunes the
// copied hooks it replaces), then the core deps when nothing else pulls them in.
function pluginSet({ routes, thirdParty = [], hooksPlugin, stackEntries = [], coreDeps = [] })
{
    const stack = [];
    if (corePluginOn(routes))
    {
        if (routes.hooks && hooksPlugin) stack.push(hooksPlugin);
        stack.push(...stackEntries);
    }
    return [...thirdParty, ...stack, ...coreDepsNeeded(stack, coreDeps)];
}

// A stack entry cannot ENABLE while one of the core's hard dependencies is set to false at a scope
// with higher precedence - the one documented enable failure whose symptom ('plugin ... failed')
// names nothing the user can act on. Printed once, and only for a dependency the listing actually
// shows as disabled, so a run that failed for another reason is not sent chasing it.
function depLockHint({ spec, listing, coreDeps = [], log = () => {} })
{
    if (!String(spec).endsWith('@claude-stack')) return false;
    for (const dep of coreDeps)
    {
        const name = bareName(dep);
        if (fieldOf(listing, name, 'enabled') !== false) continue;
        log(`     ${name} is DISABLED and ${spec} depends on it - enable it first: claude plugin enable ${dep} --scope ${fieldOf(listing, name, 'scope') || 'user'}`);
        return true;
    }
    return false;
}

// INSTALL: register the marketplaces, then install each plugin at its scope. A failure is noted and
// the run continues - fail-soft, like every other layer.
function installPlugins({ plugins, scope, marketplaces = [], listing = [], coreDeps = [], cli, log = () => {}, note = () => {} })
{
    cli(['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE], { quiet: true });
    cli(['plugin', 'marketplace', 'update', 'claude-plugins-official'], { quiet: true });
    for (const mp of marketplaces) cli(['plugin', 'marketplace', 'add', mp], { quiet: true });

    let hinted = false;
    for (const spec of plugins)
    {
        const pscope = USER_SCOPE_PLUGINS.includes(bareName(spec)) ? 'user' : scope;
        log(`plugin [${pscope}]: ${spec}`);
        // -y: the marketplace-command consent prompt cannot be answered when stdin is not a TTY,
        // which is every guided run.
        const ok = cli(['plugin', 'install', spec, '--scope', pscope, '-y']);
        if (ok) continue;
        note(`plugin ${spec} failed`);
        if (!hinted) hinted = depLockHint({ spec, listing, coreDeps, log });
    }
}

// UPDATE: uninstall the retired names this machine actually carries, at the scope the listing
// reports. A name that is not installed here is not an error, it is nothing to do.
function prunedRetired({ listing, retired = [], scope, cli, log = () => {} })
{
    const gone = [];
    for (const name of retired)
    {
        if (!fieldOf(listing, name, 'version')) continue;
        const pscope = fieldOf(listing, name, 'scope') || scope;
        if (cli(['plugin', 'uninstall', name, '--scope', pscope, '-y'], { quiet: true }))
        {
            log(`  plugin pruned (retired upstream) [${pscope}]: ${name}`);
            gone.push(name);
        }
    }
    return gone;
}

// UPDATE: adopt, enable, update, then READ THE VERSIONS BACK.
function updatePlugins({ plugins, scope, before = [], after, cli, log = () => {} })
{
    for (const spec of plugins)
    {
        const name = bareName(spec);
        const pscope = scopeFor(spec, scope, before);
        if (!fieldOf(before, name, 'version'))
        {
            log(`plugin install [${pscope}]: ${spec}`);
            cli(['plugin', 'install', spec, '--scope', pscope, '-y']);
        }
        else if (fieldOf(before, name, 'enabled') === false)
        {
            log(`plugin enable [${pscope}]: ${spec} (installed but disabled)`);
            cli(['plugin', 'enable', spec, '--scope', pscope]);
        }
        log(`plugin update [${pscope}]: ${spec}`);
        cli(['plugin', 'update', spec, '--scope', pscope, '-y']);
    }

    const now = typeof after === 'function' ? after() : (after || []);
    const report = [];
    for (const spec of plugins)
    {
        const name = bareName(spec);
        const was = fieldOf(before, name, 'version');
        const is = fieldOf(now, name, 'version');
        let line;
        if (!is) line = `  plugin ${name}: NOT installed - the install above did not take (is the marketplace reachable?)`;
        else if (fieldOf(now, name, 'enabled') === false) line = `  plugin ${name}: ${is} but DISABLED - 'claude plugin enable ${spec}' turns it back on`;
        else if (was && was !== is) line = `  plugin ${name}: ${was} -> ${is}`;
        else line = `  plugin ${name}: ${is} (already newest)`;
        log(line);
        report.push(line);
    }
    return report;
}

module.exports = {
    OFFICIAL_MARKETPLACE, USER_SCOPE_PLUGINS,
    pluginRoutes, corePluginOn, parsePluginList, fieldOf, scopeFor,
    resolveStackPlugins, selectionLines, coreDepsNeeded, pluginSet, depLockHint,
    installPlugins, prunedRetired, updatePlugins,
};
