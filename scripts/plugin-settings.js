#!/usr/bin/env node
'use strict';

// plugin-settings.js - the guided walks' plugin-settings substep, made deterministic.
//
// A plugin the stack installs ships its own defaults; meta/plugin-settings.json holds only the
// keys THIS stack has a reason to change, each with a why. This tool reports the delta against
// what is on disk (`--check`) and applies it (`--apply`) - never more than the catalog names.
//
// Two rules the flow depends on:
//   1. ADD-ONLY by default. A key the user already set to something else is reported as a
//      difference and kept; `--replace` is the explicit opt-in that overwrites it. Same
//      discipline as the env step: a pinned choice is never silently overridden.
//   2. A target carrying `requires_path` is skipped when that path is absent - the statusLine
//      block belongs to the plugin's own setup, so a refresh interval never invents one.
//
// Paths resolve against the ACCOUNT config dir (~/.claude, or ~/.claude-<space> under a
// profile), which is where a plugin's config lives whichever scope the plugin was installed at.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function arg(argv, name)
{
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function readJson(file)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

function atPath(obj, dotted)
{
    let cur = obj;
    for (const seg of dotted.split('.'))
    {
        if (!cur || typeof cur !== 'object' || !(seg in cur)) return undefined;
        cur = cur[seg];
    }

    return cur;
}

// Flatten the catalog's nested settings object into dotted leaf keys, so a report line names
// exactly what changes ('display.showCost') instead of a whole block.
function leaves(obj, prefix = '')
{
    const out = [];
    for (const [k, v] of Object.entries(obj || {}))
    {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, key));
        else out.push([key, v]);
    }

    return out;
}

function setLeaf(obj, dotted, value)
{
    const segs = dotted.split('.');
    let cur = obj;
    for (const seg of segs.slice(0, -1))
    {
        if (!cur[seg] || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) cur[seg] = {};
        cur = cur[seg];
    }

    cur[segs[segs.length - 1]] = value;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The delta for one plugin: every catalog leaf classified against what is on disk.
function planFor(entry, configDir)
{
    const targets = [];
    for (const t of entry.targets || [])
    {
        const file = path.join(configDir, t.file);
        const current = readJson(file);
        const rows = [];
        let skipped = null;
        if (t.requires_path && (!current || atPath(current, t.requires_path) === undefined))
        {
            skipped = `no \`${t.requires_path}\` in ${t.file} - the plugin's own setup owns that block`;
        }
        else
        {
            for (const [key, want] of leaves(t.settings))
            {
                const have = current ? atPath(current, key) : undefined;
                rows.push({ key, want, have, status: have === undefined ? 'missing' : same(have, want) ? 'match' : 'differs' });
            }
        }

        targets.push({ file: t.file, absolute: file, exists: current !== null, why: t.why || {}, rows, skipped });
    }

    return targets;
}

function applyTargets(targets, replace)
{
    let written = 0;
    let changed = 0;
    for (const t of targets)
    {
        if (t.skipped) continue;
        const toWrite = t.rows.filter(r => r.status === 'missing' || (replace && r.status === 'differs'));
        if (!toWrite.length) continue;
        const doc = readJson(t.absolute) || {};
        for (const r of toWrite) setLeaf(doc, r.key, r.want);
        fs.mkdirSync(path.dirname(t.absolute), { recursive: true });
        fs.writeFileSync(t.absolute, JSON.stringify(doc, null, 2) + '\n');
        written++;
        changed += toWrite.length;
    }

    return { written, changed };
}

function report(plugins, plan, opts)
{
    const lines = [];
    let missing = 0;
    let differs = 0;
    let match = 0;
    for (const name of plugins)
    {
        lines.push(`# ${name}`);
        for (const t of plan[name])
        {
            if (t.skipped) { lines.push(`  ${t.file}: skipped - ${t.skipped}`); continue; }
            lines.push(`  ${t.file}${t.exists ? '' : ' (will be created)'}`);
            for (const r of t.rows)
            {
                if (r.status === 'missing') missing++;
                else if (r.status === 'differs') differs++;
                else match++;
                const now = r.status === 'missing' ? 'not set' : JSON.stringify(r.have);
                lines.push(`    ${r.status.padEnd(8)} ${r.key} -> ${JSON.stringify(r.want)}${r.status === 'match' ? '' : ` (now: ${now})`}`);
            }
        }
    }

    lines.push('');
    lines.push(`plugin-settings: ${missing} to add, ${differs} already set differently (kept unless you choose replace), ${match} already match`);
    if (opts.applied) lines.push(`applied: ${opts.applied.changed} key(s) across ${opts.applied.written} file(s)`);

    return { text: lines.join('\n'), missing, differs, match };
}

function main(argv)
{
    const root = path.join(__dirname, '..');
    const catalogPath = arg(argv, '--catalog') || path.join(root, 'meta', 'plugin-settings.json');
    const configDir = arg(argv, '--config-dir') || path.join(os.homedir(), '.claude');
    const only = arg(argv, '--plugin');
    const installed = (arg(argv, '--installed') || '').split(',').map(s => s.trim()).filter(Boolean);
    const doApply = argv.includes('--apply');
    const replace = argv.includes('--replace');

    const catalog = readJson(catalogPath);
    if (!catalog || !catalog.plugins) { console.error(`plugin-settings: unreadable catalog ${catalogPath}`); return 2; }

    let names = Object.keys(catalog.plugins).sort();
    if (only) names = names.filter(n => n === only);
    // --installed narrows the offer to the plugins this run actually put in place: a catalog row
    // for a plugin the user did not install is not an invitation to install it.
    if (installed.length) names = names.filter(n => installed.includes(n));
    if (!names.length) { console.log('plugin-settings: nothing to offer (no catalog row for the installed plugins)'); return 0; }

    const plan = {};
    for (const n of names) plan[n] = planFor(catalog.plugins[n], configDir);

    let applied = null;
    if (doApply) for (const n of names) applied = ((a, b) => ({ written: a.written + b.written, changed: a.changed + b.changed }))(applied || { written: 0, changed: 0 }, applyTargets(plan[n], replace));

    const out = report(names, doApply ? Object.fromEntries(names.map(n => [n, planFor(catalog.plugins[n], configDir)])) : plan, { applied });
    console.log(out.text);

    return 0;
}

module.exports = { planFor, applyTargets, report, leaves, atPath, setLeaf };

if (require.main === module) process.exit(main(process.argv.slice(2)));
