'use strict';
// THE DOCS LAYER OF THE NODE SEED - Phase 7, T4.
//
// The versioning seed is the part worth the most care: it decides how every capture's documents
// follow a branch, it is silent when wrong, and it lives in four homes that one table pins
// together. The migration half is absent-only in both directions, which is what keeps an update
// from eating a project's documents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const docs = require('./install/docs.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-docs-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ domains = {}, files = {}, ignore, commit = [] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'x@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'x'], { cwd: root });
    for (const [dir, watch] of Object.entries(domains))
    {
        fs.mkdirSync(path.join(root, '.claude', 'docs', dir), { recursive: true });
        if (watch !== null) fs.writeFileSync(path.join(root, '.claude', 'docs', dir, 'watch.json'), watch);
    }
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    if (ignore) fs.writeFileSync(path.join(root, '.gitignore'), ignore);
    if (commit.length)
    {
        execFileSync('git', ['add', '-f', ...commit], { cwd: root });
        execFileSync('git', ['commit', '-qm', 'docs'], { cwd: root });
    }
    return root;
}

const seed = (root) => docs.docsVersioningSeed({ projectRoot: root, docsPath: '.claude/docs' });

// --- the versioning seed, the four-home rule ------------------------------

test('versioning: a FRESH project with no docs at all seeds git', () =>
{
    // Nothing to have committed and nothing ignored - the safe default, because seeding `local`
    // over docs that are about to be committed hides every section behind an overlay.
    assert.strictEqual(seed(project()), 'git');
});

test('versioning: a domain that is TRACKED seeds git, even beside an untracked one', () =>
{
    const root = project({
        domains: { architecture: null, 'code-style': '{}' },
        files: { '.claude/docs/architecture/ARCHITECTURE.md': '# a\n' },
        commit: ['.claude/docs/architecture/ARCHITECTURE.md'],
    });
    assert.strictEqual(seed(root), 'git');
});

test('versioning: domains that exist and are tracked by NOTHING seed local', () =>
{
    const root = project({ domains: { 'code-style': '{}' }, files: { '.claude/docs/code-style/CODE-STYLE.md': '# s\n' } });
    assert.strictEqual(seed(root), 'local');
});

test('versioning: no domain at all, but git IGNORES the docs root - local', () =>
{
    const root = project({ ignore: '.claude/docs/\n' });
    fs.mkdirSync(path.join(root, '.claude', 'docs'), { recursive: true });
    assert.strictEqual(seed(root), 'local');
});

test('versioning: a WATCH-LESS folder is no domain and casts no vote', () =>
{
    // quality/ is recomputed every run and carries no watch.json by design; a project holding only
    // that is an ordinary shape, not evidence the docs are kept out of git.
    const root = project({ domains: { quality: null }, files: { '.claude/docs/quality/ASSESSMENT.md': '# q\n' } });
    assert.deepStrictEqual(docs.domains(path.join(root, '.claude', 'docs')), []);
    assert.strictEqual(seed(root), 'git');
});

test('versioning: architecture/ is a domain WITHOUT a watch.json, references/ and history/ never are', () =>
{
    const root = project({ domains: { architecture: null, references: '{}', history: '{}', decisions: '{}' } });
    assert.deepStrictEqual(docs.domains(path.join(root, '.claude', 'docs')), ['architecture', 'decisions']);
});

test('versioning: the probe reads the docs path it is GIVEN, not a hardcoded one', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, 'documentation', 'code-style'), { recursive: true });
    fs.writeFileSync(path.join(root, 'documentation', 'code-style', 'watch.json'), '{}');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: 'documentation' }), 'local');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.claude/docs' }), 'git');
});

test('versioning: the git probes are asked with forward slashes on every platform', () =>
{
    // A backslash pathspec can fail to match, and a false negative seeds `local` over committed
    // docs - the exact silent switch this seed exists to prevent.
    const asked = [];
    docs.docsVersioningSeed({
        projectRoot: 'C:\\repo', docsPath: '.claude\\docs',
        git: { tracked: (d) => { asked.push(d); return false; }, ignored: (r) => { asked.push(r); return false; } },
    });
    for (const a of asked) assert.ok(!a.includes('\\'), `a backslash reached git: ${a}`);
    assert.deepStrictEqual(asked, ['.claude/docs']);
});

// --- the migration, absent-only both ways ---------------------------------

test('migration: a document at the old path MOVES, byte-identical, and its domain is switched on', () =>
{
    const root = project({ files: { '.claude/docs/PROJECT-CODE-STYLE.md': '# style\n\n## naming\n' } });
    const logs = [];
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.moved, ['code-style/CODE-STYLE.md']);
    assert.deepStrictEqual(out.switched, ['code-style']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/CODE-STYLE.md'), 'utf8'), '# style\n\n## naming\n');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md')));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/watch.json'), 'utf8'), '{}\n');
    assert.ok(logs.some((m) => /sections predate section ids/.test(m)), 'a doc with headings and no ids was not flagged');
});

test('migration: a file ALREADY at the new path is never overwritten, and the old one stays put', () =>
{
    const root = project({ files: {
        '.claude/docs/PROJECT-CODE-STYLE.md': '# old\n',
        '.claude/docs/code-style/CODE-STYLE.md': '# new\n',
    } });
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/CODE-STYLE.md'), 'utf8'), '# new\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/PROJECT-CODE-STYLE.md'), 'utf8'), '# old\n');
    assert.ok(logs.some((m) => /already exists .* nothing overwritten/.test(m)), logs.join(' | '));
});

test('migration: an EXISTING watch.json is never overwritten, a dangling link included', () =>
{
    const root = project({ files: { '.claude/docs/code-style/CODE-STYLE.md': '# s\n' } });
    fs.writeFileSync(path.join(root, '.claude/docs/code-style/watch.json'), '{"src":["app"]}');
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/code-style/watch.json'), 'utf8'), '{"src":["app"]}');

    const root2 = project({ files: { '.claude/docs/related-projects/RELATED-PROJECTS.md': '# r\n' } });
    fs.symlinkSync(path.join(root2, 'nowhere.json'), path.join(root2, '.claude/docs/related-projects/watch.json'));
    const out = docs.migrateDocsDomains({ projectRoot: root2, docsPath: '.claude/docs' });
    assert.deepStrictEqual(out.switched, [], 'a dangling watch.json symlink was replaced - it is still theirs');
});

test('migration: quality/ and related-context/ are watch-less BY DESIGN and stay that way', () =>
{
    const root = project({ files: {
        '.claude/docs/architecture/ASSESSMENT.md': '# q\n',
        '.claude/docs/related-context/PROJECT-RELATED-CONTEXT.md': '# rc\n',
        '.claude/docs/related-context/sibling-notes.md': '# keep me\n',
    } });
    const out = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/quality/watch.json')), 'quality/ became a domain');
    assert.ok(!fs.existsSync(path.join(root, '.claude/docs/related-context/watch.json')), 'the drop box became a domain');
    // related-projects/ IS switched on, and the drop box keeps every other paper it holds.
    assert.deepStrictEqual(out.switched, ['related-projects']);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/docs/related-context/sibling-notes.md'), 'utf8'), '# keep me\n');
});

test('migration: a second run moves nothing and switches nothing on', () =>
{
    const root = project({ files: { '.claude/docs/PROJECT-CODE-STYLE.md': '# s\n' } });
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    const again = docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs' });
    assert.deepStrictEqual(again, { moved: [], switched: [] });
});

test('migration: a doc that already carries section ids is switched on WITHOUT the lint note', () =>
{
    const root = project({ files: { '.claude/docs/code-style/CODE-STYLE.md': '## naming <!-- id: s1 -->\n' } });
    const logs = [];
    docs.migrateDocsDomains({ projectRoot: root, docsPath: '.claude/docs', log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /code-style\/ switched on/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /predate section ids/.test(m)), logs.join(' | '));
});

test('migration: an absent docs root is nothing to do, never a crash', () =>
{
    assert.deepStrictEqual(docs.migrateDocsDomains({ projectRoot: path.join(TMP, 'nope'), docsPath: '.claude/docs' }),
        { moved: [], switched: [] });
});
