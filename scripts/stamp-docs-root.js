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
// Exit 0 always - a missing rule file or unreadable settings is a fail-soft no-op with a message.

const fs = require('node:fs');
const path = require('node:path');

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

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const i = argv.indexOf('--claude-dir');
    if (i >= 0 && argv[i + 1]) stampDir(path.resolve(argv[i + 1]));
    else stamp(path.resolve(argv.find(a => !a.startsWith('--')) || '.'));
}

module.exports = { stamp, stampDir, resolveDocsRoot };
