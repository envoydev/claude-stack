'use strict';
// The library copy (install/library.js): every skill and agent outside the core is copied into the
// project per pick, and the stamp keeps the hash of what was written so a hand edit is visible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashItem, copyLibrary } = require('./install/library.js');

function fixture()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
    const src = path.join(root, 'src');
    fs.mkdirSync(path.join(src, 'stack/skills/demo/references'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/skills/demo/SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
    fs.writeFileSync(path.join(src, 'stack/skills/demo/references/a.md'), 'a\n');
    fs.mkdirSync(path.join(src, 'stack/agents'), { recursive: true });
    fs.writeFileSync(path.join(src, 'stack/agents/seat.md'), '---\nname: seat\ndescription: s\n---\nbody\n');
    const proj = path.join(root, 'proj/.claude');
    return { root, src, skillsDir: path.join(proj, 'skills'), agentsDir: path.join(proj, 'agents') };
}

test('copies picks and returns their hashes', () =>
{
    const f = fixture();
    const logs = [];
    const got = copyLibrary({ sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['demo'], agents: ['seat'], stamped: null, log: (l) => logs.push(l), note: () => {} });
    assert.equal(got.skills.demo, hashItem(path.join(f.src, 'stack/skills/demo')));
    assert.equal(got.agents.seat, hashItem(path.join(f.src, 'stack/agents/seat.md')));
    assert.ok(fs.existsSync(path.join(f.skillsDir, 'demo/references/a.md')));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('an identical copy is not rewritten', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['demo'], agents: [], stamped: null, log: () => {}, note: () => {} };
    copyLibrary(opts);
    const before = fs.statSync(path.join(f.skillsDir, 'demo/SKILL.md')).mtimeMs;
    const logs = [];
    copyLibrary({ ...opts, log: (l) => logs.push(l) });
    assert.equal(fs.statSync(path.join(f.skillsDir, 'demo/SKILL.md')).mtimeMs, before);
    assert.ok(!logs.some((l) => /skill \[/.test(l)), 'no copy line on an unchanged item');
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a hand-edited copy is overwritten, and the log says so', () =>
{
    const f = fixture();
    const opts = { sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: [], agents: ['seat'], log: () => {}, note: () => {} };
    const first = copyLibrary({ ...opts, stamped: null });
    fs.appendFileSync(path.join(f.agentsDir, 'seat.md'), 'local edit\n');
    const logs = [];
    copyLibrary({ ...opts, stamped: first, log: (l) => logs.push(l) });
    assert.ok(logs.some((l) => l.includes('overwriting a hand-edited copy: agent seat')));
    assert.equal(fs.readFileSync(path.join(f.agentsDir, 'seat.md'), 'utf8'), fs.readFileSync(path.join(f.src, 'stack/agents/seat.md'), 'utf8'));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('a missing source is reported and the existing copy kept', () =>
{
    const f = fixture();
    const notes = [];
    const got = copyLibrary({ sourceDir: f.src, skillsDir: f.skillsDir, agentsDir: f.agentsDir, skills: ['nope'], agents: [], stamped: null, log: () => {}, note: (n) => notes.push(n) });
    assert.deepEqual(got.skills, {});
    assert.ok(notes.some((n) => n.includes("skill 'nope' not found")));
    fs.rmSync(f.root, { recursive: true, force: true });
});

test('hashItem: a file and a directory hash by content and relative path; an absent path is null', () =>
{
    const f = fixture();
    const dir = path.join(f.src, 'stack/skills/demo');
    const h = hashItem(dir);
    assert.match(h, /^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(dir, 'references/a.md'), 'b\n');
    assert.notEqual(hashItem(dir), h, 'a content change moves the hash');
    assert.equal(hashItem(path.join(f.root, 'absent')), null);
    fs.rmSync(f.root, { recursive: true, force: true });
});
