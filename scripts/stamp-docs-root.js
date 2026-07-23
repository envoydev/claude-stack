#!/usr/bin/env node
'use strict';
// Stamp the deployed baseline-docs-root.md rule with the CURRENT docs root: the CLAUDE_DOCS_PATH
// env value in <root>/.claude/settings.json, else the default. Handles both the fresh copy (the
// __DOCS_ROOT__ placeholder) and a previously stamped value - so the guided commands can re-stamp
// after an env change without re-running the installer (the installers stamp fresh copies with
// their own embedded logic; this script is the between-runs re-stamp).
//
// Usage: node stamp-docs-root.js [project-root]   (default: cwd)
// Exit 0 always - a missing rule file or unreadable settings is a fail-soft no-op with a message.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = '.claude/docs';
const STAMP_RE = /(This install's root: `)[^`]*(`)/;

function resolveDocsRoot(settingsFile)
{
    try
    {
        const val = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env?.CLAUDE_DOCS_PATH;
        return val || DEFAULT_ROOT;
    }
    catch
    {
        return DEFAULT_ROOT;
    }
}

function stamp(root)
{
    const ruleFile = path.join(root, '.claude', 'rules', 'baseline-docs-root.md');
    if (!fs.existsSync(ruleFile))
    {
        console.log(`stamp-docs-root: no ${ruleFile} - nothing to stamp`);
        return;
    }
    const val = resolveDocsRoot(path.join(root, '.claude', 'settings.json'));
    const text = fs.readFileSync(ruleFile, 'utf8');
    if (!STAMP_RE.test(text))
    {
        console.log(`stamp-docs-root: no stamp line in ${ruleFile} - left unchanged (env value still wins at session start)`);
        return;
    }
    fs.writeFileSync(ruleFile, text.replace(STAMP_RE, `$1${val}$2`));
    console.log(`stamp-docs-root: stamped '${val}' into ${ruleFile}`);
}

if (require.main === module) stamp(path.resolve(process.argv[2] || '.'));

module.exports = { stamp, resolveDocsRoot };
