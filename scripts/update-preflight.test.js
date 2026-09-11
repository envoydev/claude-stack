'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'update-preflight.js');

// A credential-shaped value, so the 'names only' assertion below is a real test: this is what
// leaked into a transcript twice when the command read the env block with a plain dump.
const FAKE_TOKEN = 'sntrys_' + 'A'.repeat(48);

const FIXTURE = { files: [
    { status: 'modified', filename: 'stack/skills/csharp/SKILL.md' },
    { status: 'modified', filename: 'stack/skills/dotnet/SKILL.md' },
    { status: 'modified', filename: 'stack/hooks/guard-secret-value.js' },
    { status: 'added', filename: 'stack/hooks/guard-new-thing.js' },
    { status: 'removed', filename: 'stack/rules/web-conventions.md' },
    { status: 'modified', filename: 'README.md' },
] };

function scaffold({ migrations = [], settings = null, stamp = 'sha: aaa111\nversion: 0.2.60\n', fixture = FIXTURE } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
    const snap = path.join(root, 'repo');
    fs.mkdirSync(path.join(snap, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'stamp-compare.js'), path.join(snap, 'scripts', 'stamp-compare.js'));
    fs.writeFileSync(path.join(snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.2.70\n');
    fs.writeFileSync(path.join(snap, 'meta', 'migrations.json'), JSON.stringify({ _comment: 'x'.repeat(2000), migrations }));

    const install = path.join(root, 'project');
    fs.mkdirSync(path.join(install, '.claude'), { recursive: true });
    if (stamp !== null) fs.writeFileSync(path.join(install, '.claude', 'claude-stack.stamp'), stamp);
    if (settings) fs.writeFileSync(path.join(install, '.claude', 'settings.json'), JSON.stringify(settings));
    const fixtureFile = path.join(root, 'compare.json');
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
    return { snap, install, fixtureFile };
}

function run(args)
{
    try { return { out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), code: 0 }; }
    catch (e) { return { out: e.stdout, code: e.status }; }
}

test('ONE call carries the compare contract, the changed classes, the fired migrations and the env key names', () => {
    const { snap, install, fixtureFile } = scaffold({
        migrations: [
            { id: 'inject-code-style-hook-to-rule', detect: { file_exists: '.claude/hooks/inject-code-style.js' } },
            { id: 'docs-path-env-rename', detect: { settings_env_key: 'CLAUDE_DOCS_PATH' } },
        ],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs', SENTRY_ACCESS_TOKEN: FAKE_TOKEN } },
    });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'inject-code-style.js'), '// legacy');

    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(code, 0);
    assert.match(out, /^version: 0\.2\.60 -> 0\.2\.70$/m);
    assert.match(out, /^modified\tstack\/skills\/csharp\/SKILL\.md$/m);
    // the counts the close-out names refreshed paths from - the installer's log tail counts
    // every file it copied, which is all of them on every run
    assert.match(out, /^changed: skills=2 agents=0 rules=1 hooks=2 template=no$/m);
    assert.match(out, /^migration: inject-code-style-hook-to-rule\tfile_exists$/m);
    assert.match(out, /^migration: docs-path-env-rename\tsettings_env_key$/m);
    assert.match(out, /^env-keys: CLAUDE_DOCS_PATH,SENTRY_ACCESS_TOKEN$/m);
});

test('an env VALUE never leaves the script - the key names are the whole output', () => {
    const { snap, install, fixtureFile } = scaffold({ settings: { env: { SENTRY_ACCESS_TOKEN: FAKE_TOKEN } } });
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.ok(!out.includes(FAKE_TOKEN), 'the credential value is never printed');
    assert.ok(!out.includes('sntrys_'), 'not even a fragment of it');
    assert.match(out, /^env-keys: SENTRY_ACCESS_TOKEN$/m);
});

test('the maintainer catalog never reaches the caller - only detected ids do', () => {
    const { snap, install, fixtureFile } = scaffold({
        migrations: [{ id: 'never-fires', detect: { file_exists: '.claude/hooks/absent.js' }, why: 'y'.repeat(400) }],
    });
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(out, /^migrations: none detected$/m);
    assert.ok(!out.includes('x'.repeat(50)), 'the catalog _comment stays out of context');
    assert.ok(!out.includes('y'.repeat(50)), 'so does an undetected entry');
});

test('settings_env_value fires only on the exact seeded value; an unknown detect kind never fires', () => {
    const migrations = [
        { id: 'autocompact-seed-dropped', detect: { settings_env_value: { key: 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', equals: '40' } } },
        { id: 'from-the-future', detect: { some_new_kind: 'whatever' } },
    ];
    const hand = scaffold({ migrations, settings: { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55' } } });
    assert.match(run(['--snapshot', hand.snap, '--root', hand.install, '--fixture', hand.fixtureFile]).out, /^migrations: none detected$/m);

    const seeded = scaffold({ migrations, settings: { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' } } });
    const out = run(['--snapshot', seeded.snap, '--root', seeded.install, '--fixture', seeded.fixtureFile]).out;
    assert.match(out, /^migration: autocompact-seed-dropped\tsettings_env_value$/m);
    assert.ok(!out.includes('from-the-future'), 'a detect kind this release does not know never claims a detection');
});

test('settings_hook_wired reads the wiring, not a file; the matcher scopes it', () => {
    const migrations = [{ id: 'unwire-one-matcher', detect: { settings_hook_wired: 'guard-stop-contract.js::AskUserQuestion' } }];
    const wired = { hooks: { AskUserQuestion: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js"' }] }] } };
    const a = scaffold({ migrations, settings: wired });
    assert.match(run(['--snapshot', a.snap, '--root', a.install, '--fixture', a.fixtureFile]).out, /^migration: unwire-one-matcher\tsettings_hook_wired$/m);

    const elsewhere = { hooks: { Stop: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js"' }] }] } };
    const b = scaffold({ migrations, settings: elsewhere });
    assert.match(run(['--snapshot', b.snap, '--root', b.install, '--fixture', b.fixtureFile]).out, /^migrations: none detected$/m);
});

test('the compare exit codes pass through unchanged, and the preflight still reports the rest', () => {
    const { snap, install, fixtureFile } = scaffold({
        stamp: null,
        migrations: [{ id: 'docs-path-env-rename', detect: { settings_env_key: 'CLAUDE_DOCS_PATH' } }],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs' } },
    });
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(code, 2, 'no-stamp is still the refresh-only signal');
    assert.match(out, /^no-stamp$/m);
    assert.match(out, /^migration: docs-path-env-rename\tsettings_env_key$/m, 'a migration detect does not depend on the compare');
    assert.match(out, /^env-keys: CLAUDE_DOCS_PATH$/m);
});

test('the shipped catalog parses under the shipped detect vocabulary - every entry has a known kind', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'migrations.json'), 'utf8'));
    const known = new Set(['file_exists', 'settings_env_key', 'settings_env_value', 'settings_hook_wired']);
    for (const e of catalog.migrations)
    {
        const kinds = Object.keys(e.detect || {});
        assert.strictEqual(kinds.length, 1, `${e.id} declares exactly one detect kind`);
        assert.ok(known.has(kinds[0]), `${e.id} uses a detect kind the preflight implements (${kinds[0]})`);
    }
});

test('a FIRED migration carries everything the caller acts on, so the catalog is never opened', () => {
    // Reading 'just that one entry by id' still pulled the whole catalog into context: measured
    // 2,182 of a 5,180-char read was the maintainer `_comment` - 42%, paid on every update of
    // every consuming project. The fields that matter are printed for the entries that fired.
    const { snap, install, fixtureFile } = scaffold({
        migrations: [
            { id: 'fired-one',
              detect: { file_exists: '.claude/hooks/inject-code-style.js' },
              remove: ['.claude/hooks/inject-code-style.js'],
              unwire_settings_hook: 'inject-code-style.js::PostToolUse',
              why: 'style delivery moved to a generated rule',
              then: 're-run /project-code-style-analyzer' },
            { id: 'env-one',
              detect: { settings_env_key: 'CLAUDE_DOCS_PATH' },
              rename_settings_env: { from: 'CLAUDE_DOCS_PATH', to: 'CLAUDE_STACK_DOCS_PATH' },
              why: 'every other variable this stack owns is CLAUDE_STACK_*' },
            { id: 'quiet-one',
              detect: { file_exists: '.claude/hooks/never-here.js' },
              why: 'this entry did not fire and must print nothing',
              then: 'nothing' },
        ],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs' } },
    });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'inject-code-style.js'), '// legacy');

    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(out, /^migration: fired-one\tfile_exists$/m, 'the id line is unchanged - existing branches still read');
    assert.match(out, /^ {2}why: style delivery moved to a generated rule$/m, 'the reason the report labels it with');
    assert.match(out, /^ {2}then: re-run \/project-code-style-analyzer$/m, 'the follow-up the report prints');
    assert.match(out, /^ {2}remove: \.claude\/hooks\/inject-code-style\.js$/m, 'what the prune list takes');
    assert.match(out, /^ {2}unwire: inject-code-style\.js::PostToolUse$/m, 'the exact settings.json entry to drop');
    assert.match(out, /^ {2}env-rename: CLAUDE_DOCS_PATH -> CLAUDE_STACK_DOCS_PATH$/m, 'the env edit, on the entry that carries one');
    assert.doesNotMatch(out, /quiet-one|did not fire/, 'an entry that did not fire costs nothing at all');
    assert.doesNotMatch(out, /xxxx/, 'and the maintainer comment never reaches the caller');
});
