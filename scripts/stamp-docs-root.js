#!/usr/bin/env node
'use strict';
// Stamp the deployed baseline-docs-root.md rule with the CURRENT docs root: the CLAUDE_STACK_DOCS_PATH
// env value in <root>/.claude/settings.json, else the default. Handles both the fresh copy (the
// __DOCS_ROOT__ placeholder) and a previously stamped value - so the guided commands can re-stamp
// after an env change without re-running the installer (the installers stamp fresh copies with
// their own embedded logic; this script is the between-runs re-stamp).
//
// Usage: node stamp-docs-root.js [project-root]        (default: cwd - rules/ + settings.json under <root>/.claude)
//        node stamp-docs-root.js --claude-dir <dir>    (a global install: the account dir itself, e.g. ~/.claude-work)
//        node stamp-docs-root.js [project-root] --reprobe-versioning
// Exit 0 always - a missing rule file or unreadable settings is a fail-soft no-op with a message.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_ROOT = '.claude/docs';
const STAMP_RE = /(This install's root: `)[^`]*(`)/;

function resolveDocsRoot(settingsFile)
{
    try
    {
        const env = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env || {};
        // CLAUDE_DOCS_PATH is the pre-0.2.43 spelling - still read, so an install whose settings
        // the rename has not reached yet stamps its own root rather than the default.
        return env.CLAUDE_STACK_DOCS_PATH || env.CLAUDE_DOCS_PATH || DEFAULT_ROOT;
    }
    catch
    {
        return DEFAULT_ROOT;
    }
}

// claudeDir holds rules/ + settings.json: <project>/.claude for a project install, the account dir
// (~/.claude, ~/.claude-<space>) for a global one.
function stampDir(claudeDir)
{
    const ruleFile = path.join(claudeDir, 'rules', 'baseline-docs-root.md');
    if (!fs.existsSync(ruleFile))
    {
        console.log(`stamp-docs-root: no ${ruleFile} - nothing to stamp`);
        return;
    }
    const val = resolveDocsRoot(path.join(claudeDir, 'settings.json'));
    const text = fs.readFileSync(ruleFile, 'utf8');
    if (!STAMP_RE.test(text))
    {
        console.log(`stamp-docs-root: no stamp line in ${ruleFile} - left unchanged (env value still wins at session start)`);
        return;
    }
    fs.writeFileSync(ruleFile, text.replace(STAMP_RE, `$1${val}$2`));
    console.log(`stamp-docs-root: stamped '${val}' into ${ruleFile}`);
}

function stamp(root)
{
    stampDir(path.join(root, '.claude'));
}

// CLAUDE_STACK_DOCS_VERSIONING is seeded from what the repo does TODAY, probed at the docs path the settings file
// held when the INSTALL ran. On the setup route the user's chosen docs root is applied AFTER that, so a key seeded
// against the old path can describe the wrong folder. The walk that MOVES the path re-probes here, in the same
// step that re-stamps the rule, and only when its own run seeded the key: a value an earlier install wrote is a
// decision, and re-probing it would silently switch an existing install. Forward slashes on every OS, like the
// installers' own probe - a mixed-separator pathspec can fail to match under Git for Windows.
function reprobeVersioning(root)
{
    const settingsFile = path.join(root, '.claude', 'settings.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { console.log(`stamp-docs-root: cannot read ${settingsFile} - docs versioning left as it is`); return; }
    if (!data || typeof data !== 'object' || !data.env || !data.env.CLAUDE_STACK_DOCS_VERSIONING)
    {
        console.log('stamp-docs-root: no CLAUDE_STACK_DOCS_VERSIONING in the env block - nothing to re-probe');
        return;
    }
    const docs = `${String(resolveDocsRoot(settingsFile)).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/architecture`;
    const target = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${docs}`;
    if (spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }).status !== 0)
    {
        console.log('stamp-docs-root: not a git repository - docs versioning left as it is');
        return;
    }
    const value = spawnSync('git', ['ls-files', '--error-unmatch', '--', target], { cwd: root, stdio: 'ignore' }).status === 0 ? 'git' : 'local';
    if (data.env.CLAUDE_STACK_DOCS_VERSIONING === value)
    {
        console.log(`stamp-docs-root: docs versioning already '${value}' at ${docs} - unchanged`);
        return;
    }
    data.env.CLAUDE_STACK_DOCS_VERSIONING = value;
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`stamp-docs-root: docs versioning re-probed at ${docs}: '${value}'`);
}

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const i = argv.indexOf('--claude-dir');
    const root = path.resolve(argv.find(a => !a.startsWith('--')) || '.');
    if (i >= 0 && argv[i + 1]) stampDir(path.resolve(argv[i + 1]));
    else stamp(root);
    if (argv.includes('--reprobe-versioning'))
    {
        // A global install has no project repo to probe, and its docs root is not a path in one.
        if (i >= 0 && argv[i + 1]) console.log('stamp-docs-root: --reprobe-versioning needs a project root - skipped for a global install');
        else reprobeVersioning(root);
    }
}

module.exports = { stamp, stampDir, resolveDocsRoot, reprobeVersioning };
