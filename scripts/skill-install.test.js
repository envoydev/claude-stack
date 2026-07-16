'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');

// The ps1 twin can only be exercised where PowerShell is installed. Run it if
// pwsh is present; otherwise log a visible SKIP so the gap is never silent.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

// The clone-fallback path is pinned to -b main by design, but the installer under
// test is the WORKING TREE's - pointing the clone at the real repo would couple the
// test to whatever main last released (it broke on a layout change main did not have
// yet). So clone-fallback tests get a local fixture repo whose main IS this HEAD.
const SRC_FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-fixture-'));
const SRC_REPO = path.join(SRC_FIXTURE, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', `file://${ROOT}`, SRC_REPO], { stdio: 'ignore' });
// switch -C, not branch -f: the clone's checked-out branch varies by environment (develop
// locally, main on CI), and branch -f refuses to move the branch that is checked out.
execFileSync('git', ['-C', SRC_REPO, 'switch', '-C', 'main'], { stdio: 'ignore' });
test.after(() => fs.rmSync(SRC_FIXTURE, { recursive: true, force: true }));

// Invoke ONLY the skill-copy logic by sourcing the installer's function in a
// subshell with a stubbed environment, cloning from the LOCAL fixture (no network).
function runSkillCopy(names, extraArgs = []) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, names.map(n => `skill ${n}`).join('\n') + '\n');
    // Drive the real installer's skill step in an isolated cwd, cloning the fixture repo.
    const out = execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only', ...extraArgs], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: SRC_REPO, HOME: work },
    });
    return { work, out };
}

// Read the stamp's `key: value` lines (comment lines start with '#').
function readStamp(work) {
    const file = path.join(work, '.claude', 'claude-stack.stamp');
    if (!fs.existsSync(file)) return null;
    const stamp = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n'))
    {
        const m = /^([a-z]+):\s*(.*)$/.exec(line);
        if (m) stamp[m[1]] = m[2];
    }
    return stamp;
}

test('install copies exactly the selected skills into .claude/skills', () => {
    const { work } = runSkillCopy(['csharp', 'typescript']);
    try
    {
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'csharp copied');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'typescript', 'SKILL.md')), 'typescript copied');
        assert.ok(!fs.existsSync(path.join(work, '.claude', 'skills', 'dotnet-grpc')), 'unselected skill not copied');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

// The stack has no per-artifact version (Claude Code only reads `version:` in plugin.json), so the
// INSTALL carries the version: one stamp naming the source commit, which /claude-stack:configure
// diffs to report what an update would bring. These lock the properties that make it trustworthy.
test('install stamps the exact source revision it installed from', () => {
    const { work } = runSkillCopy(['csharp']);
    try
    {
        const stamp = readStamp(work);
        assert.ok(stamp, 'a stamp is written');
        // The fallback clone is pinned to main (the release branch) - never the checked-out branch.
        const mainTip = execFileSync('git', ['-C', SRC_REPO, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
        assert.strictEqual(stamp.sha, mainTip, 'stamped sha is the release branch tip, not an approximation');
        // A git source has no RELEASE-SOURCE - the version comes from the plugin manifest at main,
        // the same file the marketplace serves, so stamp == release == marketplace version.
        const mainManifest = JSON.parse(execFileSync('git', ['-C', SRC_REPO, 'show', 'main:setup-plugin/.claude-plugin/plugin.json'], { encoding: 'utf8' }));
        assert.strictEqual(stamp.version, mainManifest.version, 'stamped version is the plugin/marketplace version at main');
        assert.strictEqual(stamp.action, 'install');
        assert.strictEqual(stamp.scope, 'project');
        assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(stamp.installed), `installed is a UTC timestamp: ${stamp.installed}`);
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('an unreachable source writes NO stamp (a wrong stamp is worse than none)', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only'], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: path.join(work, 'nope.git'), HOME: work },
        });
        assert.strictEqual(readStamp(work), null, 'no stamp when no revision was resolved');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

// --source is what keeps a guided (plugin) run at ONE download: the setup/configure skills fetch
// the snapshot once for their own tooling and hand it here instead of making the installer fetch again.
test('--source installs from a caller-provided checkout and never deletes it', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-src-'));
    const checkout = path.join(src, 'repo');
    execFileSync('git', ['clone', '--depth', '1', `file://${ROOT}`, checkout], { stdio: 'ignore' });
    const { work, out } = runSkillCopy(['csharp'], ['--source', checkout]);
    try
    {
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'installed from the provided checkout');
        assert.match(out, /\(provided\)/, 'reports the borrowed source rather than cloning its own');
        assert.ok(fs.existsSync(path.join(checkout, 'stack', 'skills')), 'the caller owns the checkout - the installer must not delete it');
        const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        assert.strictEqual(readStamp(work).sha, head, 'stamps the provided checkout revision');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
});

// The release-archive delivery: a run downloads <repo>/releases/latest/download/claude-stack.tar.gz
// and stamps the commit named by the RELEASE-SOURCE file inside - no git involved. The fake release
// lives on disk and is served over file://, so the test proves the archive path end to end offline.
test('installs from the release archive and stamps its RELEASE-SOURCE commit', () => {
    const FAKE_SHA = 'deadbeef'.repeat(5);
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-rel-'));
    const dl = path.join(fake, 'releases', 'latest', 'download');
    fs.mkdirSync(dl, { recursive: true });
    const relSrc = path.join(fake, 'RELEASE-SOURCE');
    fs.writeFileSync(relSrc, `sha: ${FAKE_SHA}\nref: main\nversion: 9.9.9\nbuilt: 2026-07-16T00:00:00Z\n`);
    execFileSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', `--add-file=${relSrc}`, '-o', path.join(dl, 'claude-stack.tar.gz'), 'HEAD'], { stdio: 'ignore' });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        const out = execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only'], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: `file://${fake}`, HOME: work },
        });
        assert.match(out, /releases\/latest\/download/, 'took the archive route, not the clone fallback');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'installed from the extracted archive');
        assert.strictEqual(readStamp(work).sha, FAKE_SHA, 'stamps the RELEASE-SOURCE commit, no git involved');
        assert.strictEqual(readStamp(work).version, '9.9.9', 'stamps the RELEASE-SOURCE version (the plugin/marketplace version)');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(fake, { recursive: true, force: true });
    }
});

// The plugin path after the switch: setup/configure extract the archive (no .git) and hand the
// dir over with --source - the stamp must come from RELEASE-SOURCE, not silently go missing.
test('--source pointed at an extracted archive stamps from its RELEASE-SOURCE', () => {
    const FAKE_SHA = 'cafebabe'.repeat(5);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-arc-'));
    const repo = path.join(src, 'repo');
    fs.mkdirSync(path.join(repo, 'stack', 'agents'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'stack', 'skills', 'csharp'), path.join(repo, 'stack', 'skills', 'csharp'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'RELEASE-SOURCE'), `sha: ${FAKE_SHA}\nref: main\nversion: 8.8.8\n`);
    const { work, out } = runSkillCopy(['csharp'], ['--source', repo]);
    try
    {
        assert.match(out, /\(provided\)/, 'reports the borrowed source');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'installed from the extracted archive');
        assert.strictEqual(readStamp(work).sha, FAKE_SHA, 'stamp read from RELEASE-SOURCE when there is no git checkout');
        assert.strictEqual(readStamp(work).version, '8.8.8', 'stamp version read from RELEASE-SOURCE');
        assert.ok(fs.existsSync(path.join(repo, 'stack', 'skills')), 'the caller owns the extracted archive - the installer must not delete it');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
});

test('--source pointed at a non-checkout fails once, clearly', () => {
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-bogus-'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        const out = execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only', '--source', bogus], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, HOME: work },
        });
        assert.match(out, /is not a claude-stack checkout/, 'one clear diagnosis, not a per-file failure storm');
        assert.strictEqual(readStamp(work), null, 'no stamp when the source was never resolved');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(bogus, { recursive: true, force: true });
    }
});

// The ps1 twin of the two properties above. The pre-existing ps1 test only drives -PrintPlan, which
// exits before installing - so without these the whole Windows source/stamp path ships unexercised.
test('ps1: install stamps the source revision it installed from (pwsh required)', { skip: skipNoPwsh }, () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-ps-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', sel, '-SkillsOnly'], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: `file://${SRC_REPO}`, HOME: work },
        });
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'ps1 copied the selected skill');
        const mainTip = execFileSync('git', ['-C', SRC_REPO, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
        assert.strictEqual(readStamp(work).sha, mainTip, 'ps1 stamps the same release-branch sha the sh would');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('ps1: -Source pointed at an extracted archive stamps from its RELEASE-SOURCE (pwsh required)', { skip: skipNoPwsh }, () => {
    const FAKE_SHA = 'facefeed'.repeat(5);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-psarc-'));
    const repo = path.join(src, 'repo');
    fs.mkdirSync(path.join(repo, 'stack', 'agents'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'stack', 'skills', 'csharp'), path.join(repo, 'stack', 'skills', 'csharp'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'RELEASE-SOURCE'), `sha: ${FAKE_SHA}\nref: main\nversion: 7.7.7\n`);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-ps-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', sel, '-SkillsOnly', '-Source', repo], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, HOME: work },
        });
        assert.strictEqual(readStamp(work).sha, FAKE_SHA, 'ps1 stamp read from RELEASE-SOURCE when there is no git checkout');
        assert.strictEqual(readStamp(work).version, '7.7.7', 'ps1 stamp version read from RELEASE-SOURCE');
        assert.ok(fs.existsSync(path.join(repo, 'stack', 'skills')), 'the caller owns the extracted archive - the ps1 must not delete it');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
});

test('ps1: -Source installs from a caller-provided checkout and never deletes it (pwsh required)', { skip: skipNoPwsh }, () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-pssrc-'));
    const checkout = path.join(src, 'repo');
    execFileSync('git', ['clone', '--depth', '1', `file://${ROOT}`, checkout], { stdio: 'ignore' });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-ps-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, 'skill csharp\n');
    try
    {
        const out = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', sel, '-SkillsOnly', '-Source', checkout], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, HOME: work },
        });
        assert.match(out, /\(provided\)/, 'ps1 reports the borrowed source rather than cloning its own');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'installed from the provided checkout');
        assert.ok(fs.existsSync(path.join(checkout, 'stack', 'skills')), 'the caller owns the checkout - the ps1 must not delete it');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
});
