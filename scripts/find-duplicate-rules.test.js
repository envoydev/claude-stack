'use strict';
// find-duplicate-rules.js on synthetic inputs only - the scan itself is advisory, run by hand before a
// release, and never over the real tree in CI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findDuplicates } = require('./find-duplicate-rules.js');

const SHARED = 'A seat that returns without its report leaves the orchestrator guessing, so the brief names the report shape and the close refuses to start without it.';
const REWORDED = 'A seat that returns without its report leaves the orchestrator guessing, so every brief names the report shape and the close refuses to start without it.';
const OTHER = 'Unrelated guidance about formatting tables in markdown documents keeps each column aligned for readers who scan them.';

const rule = (body) => `---\npaths:\n  - '**/*.md'\n---\n\n# A rule\n\n${body}\n`;
const skill = (body) => `---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n\n${body}\n`;
const EMPTY = { rules: {} };

test('a planted duplicate across two files is found, with both locations', () =>
{
    const files = [
        { path: 'stack/rules/a.md', text: rule(`- ${SHARED}\n- ${OTHER}`) },
        { path: 'stack/skills/demo/SKILL.md', text: skill(`Some intro sentence that says nothing in particular about seats at all.\n\n${REWORDED}`) },
    ];
    const found = findDuplicates({ files, registry: EMPTY });
    assert.strictEqual(found.length, 1, 'exactly the planted pair');
    const [hit] = found;
    assert.ok(hit.score >= 0.5 && hit.score < 1, `a reworded copy scores below 1, got ${hit.score}`);
    assert.deepStrictEqual(hit.homes.map((h) => `${h.file}:${h.line}`), ['stack/rules/a.md:8', 'stack/skills/demo/SKILL.md:10'], 'both homes, each on its own line');
    assert.deepStrictEqual(hit.homes.map((h) => h.text), [SHARED, REWORDED]);
});

test('a pair meta/shared-rules.json already pins is not reported, and an unpinned one beside it still is', () =>
{
    const THIRD = 'Every verify pass names the command it ran and quotes the verdict line, because a pass with no command behind it is a claim.';
    const files = [
        { path: 'stack/rules/a.md', text: rule(`- ${SHARED}\n- ${THIRD}`) },
        { path: 'stack/skills/demo/SKILL.md', text: skill(`${SHARED}\n\n${THIRD}`) },
    ];
    const registry = { rules: { 'report-shape': {
        _note: 'synthetic',
        owner: { file: 'stack/rules/a.md', marker: 'leaves the orchestrator guessing' },
        sites: [{ file: 'stack/skills/demo/SKILL.md', marker: 'leaves the orchestrator guessing' }],
    } } };
    const found = findDuplicates({ files, registry });
    assert.strictEqual(found.length, 1, 'the pinned pair is subtracted, the unpinned one stays');
    assert.ok(found[0].homes.every((h) => h.text === THIRD), 'the unpinned pair is the one reported');
    assert.strictEqual(findDuplicates({ files, registry: EMPTY }).length, 2, 'without the pin both pairs are reported');
});

test('a pin between OTHER files does not hide the pair, and a marker in a different block does not either', () =>
{
    const files = [
        { path: 'stack/rules/a.md', text: rule(`- ${SHARED}\n- ${OTHER}`) },
        { path: 'stack/skills/demo/SKILL.md', text: skill(`${OTHER}\n\n${SHARED}`) },
    ];
    // Pinned on the OTHER sentence's block: the SHARED pair is still undeliberate.
    const registry = { rules: { 'tables': {
        owner: { file: 'stack/rules/a.md', marker: 'formatting tables in markdown' },
        sites: [{ file: 'stack/skills/demo/SKILL.md', marker: 'formatting tables in markdown' }],
    } } };
    const found = findDuplicates({ files, registry });
    assert.strictEqual(found.length, 1);
    assert.ok(found[0].homes.every((h) => h.text === SHARED));
});

test('one sentence restated in three files is one finding with three homes, not three pairs', () =>
{
    const files = [
        { path: 'stack/rules/a.md', text: rule(`- ${SHARED}`) },
        { path: 'stack/rules/b.md', text: rule(`- ${SHARED}`) },
        { path: 'stack/skills/demo/SKILL.md', text: skill(SHARED) },
    ];
    const found = findDuplicates({ files, registry: EMPTY });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].score, 1);
    assert.strictEqual(found[0].pairs, 3);
    assert.deepStrictEqual(found[0].homes.map((h) => h.file), ['stack/rules/a.md', 'stack/rules/b.md', 'stack/skills/demo/SKILL.md']);
});

test('short sentences, fenced code and a duplicate inside one file are not reported', () =>
{
    const fence = '```\n' + SHARED + '\n```';
    const files = [
        { path: 'stack/rules/a.md', text: rule(`- Keep it short.\n- ${SHARED}\n\n${SHARED}`) },
        { path: 'stack/skills/demo/SKILL.md', text: skill(`- Keep it short.\n\n${fence}`) },
    ];
    assert.deepStrictEqual(findDuplicates({ files, registry: EMPTY }), []);
});

test('the CLI scans a root, prints the advisory header and exits 0 even with findings', () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-rules-'));
    try
    {
        fs.mkdirSync(path.join(root, 'stack', 'rules'), { recursive: true });
        fs.mkdirSync(path.join(root, 'stack', 'skills', 'demo', 'references'), { recursive: true });
        fs.mkdirSync(path.join(root, 'meta'));
        fs.writeFileSync(path.join(root, 'stack', 'rules', 'a.md'), rule(`- ${SHARED}`));
        fs.writeFileSync(path.join(root, 'stack', 'skills', 'demo', 'SKILL.md'), skill(REWORDED));
        // A reference is not a skill body - the scan reads SKILL.md and the rules only.
        fs.writeFileSync(path.join(root, 'stack', 'skills', 'demo', 'references', 'x.md'), `# X\n\n${SHARED}\n`);
        fs.writeFileSync(path.join(root, 'meta', 'shared-rules.json'), JSON.stringify(EMPTY));
        const out = execFileSync(process.execPath, [path.join(__dirname, 'find-duplicate-rules.js'), '--root', root], { encoding: 'utf8' });
        assert.match(out, /^find-duplicate-rules: 1 unpinned cluster\(s\) at >= 0\.5 across 2 file\(s\) - advisory/m);
        assert.match(out, /stack\/rules\/a\.md:8/);
        assert.match(out, /stack\/skills\/demo\/SKILL\.md:8/);
        assert.doesNotMatch(out, /references/);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
