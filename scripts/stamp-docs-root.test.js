'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'stamp-docs-root.js');
const SOURCE_RULE = path.join(__dirname, '..', 'stack', 'rules', 'baseline-docs-root.md');

function makeProject(settings)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    fs.copyFileSync(SOURCE_RULE, path.join(root, '.claude', 'rules', 'baseline-docs-root.md'));
    if (settings !== null) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
    return root;
}

const run = root => execFileSync('node', [SCRIPT, root], { encoding: 'utf8' });
const stampLine = root => fs.readFileSync(path.join(root, '.claude', 'rules', 'baseline-docs-root.md'), 'utf8')
    .split('\n').find(l => l.includes("This install's root"));

test('stamps the placeholder with the settings env value', () => {
    const root = makeProject('{"env":{"CLAUDE_DOCS_PATH":"docs"}}');
    run(root);
    assert.match(stampLine(root), /This install's root: `docs`/);
});

test('missing settings, missing key, and broken JSON all stamp the default', () => {
    for (const settings of [null, '{"env":{}}', '{broken'])
    {
        const root = makeProject(settings);
        run(root);
        assert.match(stampLine(root), /This install's root: `\.claude\/docs`/, `settings=${settings}`);
    }
});

test('re-stamps an already stamped value after an env change (the configure path)', () => {
    const root = makeProject('{"env":{"CLAUDE_DOCS_PATH":"docs"}}');
    run(root);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"env":{"CLAUDE_DOCS_PATH":"team/docs"}}');
    run(root);
    assert.match(stampLine(root), /This install's root: `team\/docs`/);
});

test('missing rule file is a fail-soft no-op with exit 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    const out = run(root);
    assert.match(out, /nothing to stamp/);
});
