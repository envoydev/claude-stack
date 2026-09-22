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
//   validate: yes|no                        (the version delta spans more than one release)
//   policy-rev: current|none|stale installed=<hash|none> snapshot=<hash|none>
//   migration: <id>\t<detect kind>          (one line per DETECTED entry; none -> no lines)
//   migrations: none detected               (only when none fired)
//   env-keys: <comma-separated key names>   (or 'env-keys: none')
//
// Exit codes are stamp-compare's, passed through so the caller's branching is unchanged:
// 0 = compare done, 2 = no stamp, 3 = compare unreachable. A usage error is 1.
//
// `--log <installer-log>` is a SEPARATE post-install mode (no --snapshot needed): it reads the
// installer's own log - the command already captures it via the fixed `tee "$TMP/install.log"`
// form - and prints the RESTART/'!!' facts the update close-out used to judge from a raw grep
// dump in the model, one of two report rows the update.md BLOCKER measured missing 1-in-4/1-in-5:
//
//   restart: yes|no                         (mcps=<n> above 0 in the log, or --hooks <n> above 0)
//   warn: <line>                            (one per '!!' fail-soft line; none printed if none)
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
    if (e.clear_settings_env) out.push(['env-reset', `${e.clear_settings_env.key}: ${e.clear_settings_env.when_value} -> ${e.clear_settings_env.to}`]);
    return out;
}

// The compare's stack-owned paths, bucketed by the install class they land in. The update
// close names what the release actually refreshed from THIS, not from the installer's log
// tail (which counts everything it copied - it re-copies every file on every run).
function changedClasses(compareLines)
{
    const n = { skills: 0, agents: 0, rules: 0, hooks: 0, template: false };
    const seen = { skills: new Set(), agents: new Set(), rules: new Set(), hooks: new Set() };
    for (const line of compareLines)
    {
        const m = /^(modified|added|removed|renamed)\t([^\t]+)/.exec(line);
        if (!m) continue;
        const p = m[2];
        // Distinct ITEMS, not files: a skill is its folder, so SKILL.md plus its references count once
        // (measured: skills=108 reported against 78 shipped).
        const item = /^stack\/(skills|agents|rules|hooks)\/([^/]+)/.exec(p);
        if (item) seen[item[1]].add(item[2]);
        else if (/^stack\/CLAUDE\.template\.md$/.test(p)) n.template = true;
    }
    for (const k of Object.keys(seen)) n[k] = seen[k].size;
    return n;
}

// Version-delta span, from the compare's own `version: <old> -> <new>` line - no second call,
// no re-derivation: the same string stamp-compare already printed. Major/minor moving is always
// multi-release; a patch-only move is multi-release past a single step.
function parseVersion(v)
{
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function spansMultipleReleases(versionLine)
{
    const m = /^version: (\S+) -> (\S+)$/.exec(versionLine || '');
    if (!m) return false;
    const a = parseVersion(m[1]);
    const b = parseVersion(m[2]);
    if (!a || !b) return false;
    if (a[0] !== b[0] || a[1] !== b[1]) return true;
    return (b[2] - a[2]) > 1;
}

// The policy-rev second VALIDATE trigger - was two greps the caller ran by hand and then
// re-confirmed 3 extra times in one audited run (~275k tokens): one printed row instead.
function policyRevLine(root, snapshot)
{
    const installedFile = path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md');
    const snapshotFile = path.join(snapshot, 'stack', 'skills', 'project-agent-capabilities', 'SKILL.md');
    const readRev = f => { try { return (fs.readFileSync(f, 'utf8').match(/policy-rev: ([0-9a-f]+)/) || [])[1]; } catch { return undefined; } };
    if (!fs.existsSync(installedFile)) return 'policy-rev: none';
    const installed = readRev(installedFile);
    const snap = readRev(snapshotFile);
    if (installed && snap && installed === snap) return 'policy-rev: current';
    return `policy-rev: stale installed=${installed || 'none'} snapshot=${snap || 'none'}`;
}

// `--log` postcheck mode: the RESTART/'!!' facts read from the installer's own log, after it
// runs - no --snapshot needed, so this never re-hits the compare API.
function runLogMode(logFile)
{
    const hooks = Number(arg('--hooks', '0')) || 0;
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { text = ''; }
    const warnLines = text.split('\n').filter(l => l.includes('!!'));
    for (const l of warnLines) console.log(`warn: ${l.trim()}`);
    const m = /mcps=(\d+)/.exec(text);
    const mcps = m ? Number(m[1]) : 0;
    console.log(`restart: ${(mcps > 0 || hooks > 0) ? 'yes' : 'no'}`);
}

function main()
{
    const logFile = arg('--log');
    if (logFile) { runLogMode(logFile); return; }

    const snapshot = arg('--snapshot');
    if (!snapshot)
    {
        console.error('usage: update-preflight.js --snapshot <extracted-repo-dir> [--stamp <stamp-file>] [--root <install root>] [--settings <settings.json>] [--repo <owner/name>] [--fixture <compare.json>]\n       update-preflight.js --log <installer-log> [--hooks <n>]');
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
    console.log(`validate: ${spansMultipleReleases(lines.find(l => l.startsWith('version: '))) ? 'yes' : 'no'}`);
    console.log(policyRevLine(root, snapshot));

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
