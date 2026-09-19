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
    const root = makeProject('{"env":{"CLAUDE_STACK_DOCS_PATH":"docs"}}');
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
    const root = makeProject('{"env":{"CLAUDE_STACK_DOCS_PATH":"docs"}}');
    run(root);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"env":{"CLAUDE_STACK_DOCS_PATH":"team/docs"}}');
    run(root);
    assert.match(stampLine(root), /This install's root: `team\/docs`/);
});

test('missing rule file is a fail-soft no-op with exit 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
    const out = run(root);
    assert.match(out, /nothing to stamp/);
});

// --reprobe-versioning: the docs-versioning seed is probed at the path the file held when the INSTALL ran, and on
// the setup route the user's chosen docs root is applied afterwards. The walk that moves the path re-probes at the
// new one - and only when its own run seeded the key, so a decision an earlier install wrote is never re-probed.
const gitIn = (root, ...args) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
// The flag carries the value the install SEEDED, and the script refuses when the file holds anything else: the
// condition that an existing install is never switched silently is then machine-checked, not advisory prose.
const reprobe = (root, seeded = 'local') => execFileSync('node', [SCRIPT, root, '--reprobe-versioning', seeded], { encoding: 'utf8' });
const envOf = root => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).env;

// `domain` names the ONE folder the committed docs live in - 'architecture' carries no watch.json (it is
// grandfathered in), any other folder is a domain only because of the watch.json written beside its doc.
function projectWithCommittedDocs(docsPath, versioning, domain = 'architecture')
{
    const root = makeProject(JSON.stringify({ env: { CLAUDE_STACK_DOCS_PATH: docsPath, CLAUDE_STACK_DOCS_VERSIONING: versioning } }));
    gitIn(root, 'init', '-q', '-b', 'develop', '.');
    fs.mkdirSync(path.join(root, docsPath, domain), { recursive: true });
    fs.writeFileSync(path.join(root, docsPath, domain, 'ARCHITECTURE.md'), '# Map\n');
    if (domain !== 'architecture') fs.writeFileSync(path.join(root, docsPath, domain, 'watch.json'), '{}\n');
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-qm', 'docs');
    return root;
}

test('--reprobe-versioning re-reads the mode at the docs path that ended up in the file', () => {
    const root = projectWithCommittedDocs('docs', 'local');   // seeded against .claude/docs, then the path moved
    try
    {
        assert.match(reprobe(root), /docs versioning re-probed at docs\/: 'git'/);
        assert.strictEqual(envOf(root).CLAUDE_STACK_DOCS_VERSIONING, 'git');
        assert.match(reprobe(root, 'git'), /docs versioning already 'git' at docs\//, 'a second run says so and rewrites nothing');
        assert.match(reprobe(root), /holds 'git', not the 'local'/, 'and the same command twice stops at the guard');
        assert.strictEqual(envOf(root).CLAUDE_STACK_DOCS_VERSIONING, 'git');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Task 14 / whole-branch review finding 2: the re-probe is the mechanism that CORRECTS a wrong seed, and it
// carried the same architecture-only blind spot - so a project documented in code-style/ alone kept the 'local'
// a fresh install always seeds, and wrote branch overlays into a docs root git versions. Any DOMAIN counts now
// (a watch.json is what makes one), and a committed folder that is no domain still counts for nothing.
test('--reprobe-versioning reads committed docs in any domain, and a watch-less folder is no domain', () => {
    const style = projectWithCommittedDocs('docs', 'local', 'code-style');
    const quality = projectWithCommittedDocs('docs', 'local', 'quality');
    try
    {
        assert.match(reprobe(style), /docs versioning re-probed at docs\/: 'git'/, 'code-style/ alone is committed docs');
        assert.strictEqual(envOf(style).CLAUDE_STACK_DOCS_VERSIONING, 'git');
        fs.rmSync(path.join(quality, 'docs', 'quality', 'watch.json'));   // the findings folder never carries one
        assert.match(reprobe(quality), /docs versioning already 'local' at docs\//, 'a folder with no watch.json is no domain');
        assert.strictEqual(envOf(quality).CLAUDE_STACK_DOCS_VERSIONING, 'local');
    }
    finally { for (const d of [style, quality]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('--reprobe-versioning refuses when the file holds a value this run did not seed', () => {
    const root = projectWithCommittedDocs('docs', 'local');   // a decision already in the file
    try
    {
        const out = reprobe(root, 'git');                     // ... and an install that seeded something else
        assert.match(out, /holds 'local', not the 'git'/);
        assert.strictEqual(envOf(root).CLAUDE_STACK_DOCS_VERSIONING, 'local', 'a decision is never re-probed away');
        assert.match(execFileSync('node', [SCRIPT, root, '--reprobe-versioning'], { encoding: 'utf8' }),
            /needs the value the install seeded/, 'and the flag without its value probes nothing');
        assert.strictEqual(envOf(root).CLAUDE_STACK_DOCS_VERSIONING, 'local');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--reprobe-versioning is a no-op where there is no key, no repo or no project root', () => {
    const noKey = makeProject('{"env":{"CLAUDE_STACK_DOCS_PATH":"docs"}}');
    const noRepo = makeProject('{"env":{"CLAUDE_STACK_DOCS_PATH":"docs","CLAUDE_STACK_DOCS_VERSIONING":"git"}}');
    const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-acct-'));
    try
    {
        assert.match(reprobe(noKey), /no CLAUDE_STACK_DOCS_VERSIONING/);
        assert.strictEqual(envOf(noKey).CLAUDE_STACK_DOCS_VERSIONING, undefined, 'a key nobody set is never introduced here');
        assert.match(reprobe(noRepo, 'git'), /not a git repository/);
        assert.strictEqual(envOf(noRepo).CLAUDE_STACK_DOCS_VERSIONING, 'git', 'and the value is left alone');
        fs.mkdirSync(path.join(acct, 'rules'), { recursive: true });
        fs.copyFileSync(SOURCE_RULE, path.join(acct, 'rules', 'baseline-docs-root.md'));
        fs.writeFileSync(path.join(acct, 'settings.json'), '{"env":{"CLAUDE_STACK_DOCS_VERSIONING":"git"}}');
        const out = execFileSync('node', [SCRIPT, '--claude-dir', acct, '--reprobe-versioning'], { encoding: 'utf8' });
        assert.match(out, /needs a project root/, 'a global install has no repo to probe');
    }
    finally { for (const d of [noKey, noRepo, acct]) fs.rmSync(d, { recursive: true, force: true }); }
});

// A global install keeps rules/ + settings.json in the account dir (no <root>/.claude between).
test('--claude-dir stamps a global install from the account dir itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-acct-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
        fs.copyFileSync(SOURCE_RULE, path.join(dir, 'rules', 'baseline-docs-root.md'));
        fs.writeFileSync(path.join(dir, 'settings.json'), '{"env":{"CLAUDE_STACK_DOCS_PATH":"global/docs"}}');
        execFileSync('node', [SCRIPT, '--claude-dir', dir], { encoding: 'utf8' });
        const line = fs.readFileSync(path.join(dir, 'rules', 'baseline-docs-root.md'), 'utf8').split('\n').find(l => l.includes("This install's root"));
        assert.match(line, /This install's root: `global\/docs`/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
