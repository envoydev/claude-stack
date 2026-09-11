#!/usr/bin/env node
'use strict';
// update-preflight.js - everything /claude-stack:update needs to know BEFORE it runs the
// installer, in ONE call. It wraps stamp-compare.js and adds the two things the command
// used to compute by hand, in the model, in three more round trips:
//
//   - the migrations catalog's `detect` rules, EVALUATED here. They are purely declarative
//     (file_exists / settings_env_key / settings_env_value / settings_hook_wired) and there
//     was no runner, so the command read all of meta/migrations.json into context - the
//     maintainer `_comment` included - and hand-wrote probes for each entry. Measured: four
//     API round trips and a catalog dump for what is a 3-line existence check.
//   - the scope settings.json `env` KEY NAMES, as a before-state. The close-out asserted
//     'no key renamed, reset or newly seeded' with nothing to diff against; a name set taken
//     before the run makes that line a comparison instead of a claim. Names only - a VALUE
//     never leaves this script, so the credential in that file cannot reach a transcript.
//
// Output is the stamp-compare line contract, unchanged and first (so every existing branch
// still reads), then:
//
//   changed: skills=<n> agents=<n> rules=<n> hooks=<n> template=<yes|no>
//   migration: <id>\t<detect kind>          (one line per DETECTED entry; none -> no lines)
//   migrations: none detected               (only when none fired)
//   env-keys: <comma-separated key names>   (or 'env-keys: none')
//
// Exit codes are stamp-compare's, passed through so the caller's branching is unchanged:
// 0 = compare done, 2 = no stamp, 3 = compare unreachable. A usage error is 1.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function arg(name, fallback)
{
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJson(file)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

// One migration entry's `detect` against the install root. Unknown kinds never fire - a
// catalog written by a newer release must not make an older preflight claim a detection.
function detects(entry, root, settings)
{
    const d = (entry && entry.detect) || {};
    if (d.file_exists) return fs.existsSync(path.resolve(root, d.file_exists));
    if (d.settings_env_key) return !!(settings && settings.env && Object.prototype.hasOwnProperty.call(settings.env, d.settings_env_key));
    if (d.settings_env_value) return !!(settings && settings.env && String(settings.env[d.settings_env_value.key]) === String(d.settings_env_value.equals));
    if (d.settings_hook_wired)
    {
        const [file, matcher] = String(d.settings_hook_wired).split('::');
        const hooks = (settings && settings.hooks) || {};
        for (const [event, groups] of Object.entries(hooks))
        {
            if (matcher && event !== matcher) continue;
            for (const g of Array.isArray(groups) ? groups : [])
                for (const h of (g && g.hooks) || [])
                    if (String((h && h.command) || '').includes(file)) return true;
        }
        return false;
    }
    return false;
}

function detectKind(entry)
{
    return Object.keys((entry && entry.detect) || {})[0] || 'unknown';
}

// The actionable fields of ONE fired entry, as `label, value` pairs. Only what the caller acts
// on: the reason it names in the report, the follow-up it prints, and the edits it applies.
function migrationFields(e)
{
    const out = [];
    if (e.why) out.push(['why', e.why]);
    if (e.then) out.push(['then', e.then]);
    if (Array.isArray(e.remove) && e.remove.length) out.push(['remove', e.remove.join(', ')]);
    if (e.unwire_settings_hook) out.push(['unwire', e.unwire_settings_hook]);
    if (e.rename_settings_env) out.push(['env-rename', `${e.rename_settings_env.from} -> ${e.rename_settings_env.to}`]);
    if (e.remove_settings_env) out.push(['env-remove', e.remove_settings_env.key]);
    return out;
}

// The compare's stack-owned paths, bucketed by the install class they land in. The update
// close names what the release actually refreshed from THIS, not from the installer's log
// tail (which counts everything it copied - it re-copies every file on every run).
function changedClasses(compareLines)
{
    const n = { skills: 0, agents: 0, rules: 0, hooks: 0, template: false };
    for (const line of compareLines)
    {
        const m = /^(modified|added|removed|renamed)\t([^\t]+)/.exec(line);
        if (!m) continue;
        const p = m[2];
        if (/^stack\/skills\//.test(p)) n.skills += 1;
        else if (/^stack\/agents\//.test(p)) n.agents += 1;
        else if (/^stack\/rules\//.test(p)) n.rules += 1;
        else if (/^stack\/hooks\//.test(p)) n.hooks += 1;
        else if (/^stack\/CLAUDE\.template\.md$/.test(p)) n.template = true;
    }
    return n;
}

function main()
{
    const snapshot = arg('--snapshot');
    if (!snapshot)
    {
        console.error('usage: update-preflight.js --snapshot <extracted-repo-dir> [--stamp <stamp-file>] [--root <install root>] [--settings <settings.json>] [--repo <owner/name>] [--fixture <compare.json>]');
        process.exit(1);
    }
    const root = arg('--root', '.');
    const stampFile = arg('--stamp', path.join(root, '.claude', 'claude-stack.stamp'));
    const settingsFile = arg('--settings', path.join(root, '.claude', 'settings.json'));

    const compareArgs = [path.join(snapshot, 'scripts', 'stamp-compare.js'), '--snapshot', snapshot, '--stamp', stampFile];
    for (const flag of ['--repo', '--fixture']) { const v = arg(flag); if (v) compareArgs.push(flag, v); }
    const res = spawnSync(process.execPath, compareArgs, { encoding: 'utf8' });
    const out = String(res.stdout || '').replace(/\n$/, '');
    if (out) console.log(out);
    if (res.stderr) process.stderr.write(res.stderr);

    const lines = out ? out.split('\n') : [];
    const c = changedClasses(lines);
    console.log(`changed: skills=${c.skills} agents=${c.agents} rules=${c.rules} hooks=${c.hooks} template=${c.template ? 'yes' : 'no'}`);

    const catalog = readJson(path.join(snapshot, 'meta', 'migrations.json'));
    const entries = (catalog && catalog.migrations) || [];
    const settings = readJson(settingsFile);
    let fired = 0;
    for (const e of entries)
    {
        if (!detects(e, root, settings)) continue;
        fired += 1;
        console.log(`migration: ${e.id}\t${detectKind(e)}`);
        // Every field the caller ACTS on, for the entries that actually fired - so the catalog
        // itself never has to be opened. Reading 'that one entry by id' still pulled the file
        // into context (measured: 2,182 of a 5,180-char read was the maintainer `_comment`, 42%,
        // paid again on every update of every consuming project). An entry that did not fire
        // prints nothing, so the cost scales with what is true of THIS install.
        for (const [label, value] of migrationFields(e)) console.log(`  ${label}: ${value}`);
    }
    if (!fired) console.log('migrations: none detected');

    const keys = settings && settings.env ? Object.keys(settings.env).sort() : [];
    console.log(`env-keys: ${keys.length ? keys.join(',') : 'none'}`);

    process.exit(typeof res.status === 'number' ? res.status : 3);
}

main();
