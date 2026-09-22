'use strict';
// THE SOURCE: what Claude Code already cached, then the release archive, then a clone.
//
// The stack used to keep its own extracted-snapshot cache under the account dir, plus a version
// probe and an adoption path for Claude Code's marketplace clone. Phase 5 of the plugin migration
// deleted all three: every marketplace entry shares this repo's root as its `source`, so installing
// the core plugin leaves the WHOLE repo at <config>/plugins/cache/<marketplace>/claude-stack/
// <version> - RELEASE-SOURCE included - and that is the same snapshot the installer was
// downloading. The archive and clone routes remain for the two paths with no plugin cache to read:
// the copy route (both VIA_PLUGIN switches off) and a machine with no `claude` CLI.
//
// These tests drive the REAL installers against a local HTTP fixture that speaks the release
// endpoints and COUNTS asset hits, which is what proves a run downloaded nothing.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

const VERSION = '9.9.9';
const FAKE_SHA = 'abadcafe'.repeat(5);

// One archive built once for the whole file: a real snapshot of this working tree (so the
// installer finds stack/skills + stack/agents) carrying a RELEASE-SOURCE naming VERSION.
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-fixture-'));
const RELEASE_SOURCE = path.join(FIXTURE, 'RELEASE-SOURCE');
fs.writeFileSync(RELEASE_SOURCE, `sha: ${FAKE_SHA}\nref: main\nversion: ${VERSION}\nbuilt: 2026-09-09T00:00:00Z\n`);
const ARCHIVE = path.join(FIXTURE, 'claude-stack.tar.gz');
execFileSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', `--add-file=${RELEASE_SOURCE}`, '-o', ARCHIVE, 'HEAD'], { stdio: 'ignore' });
const ZIP = path.join(FIXTURE, 'claude-stack.zip');
execFileSync('git', ['-C', ROOT, 'archive', '--format=zip', `--add-file=${RELEASE_SOURCE}`, '-o', ZIP, 'HEAD'], { stdio: 'ignore' });
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

// A GitHub-shaped release host: /releases/latest 302s to the tag (that redirect IS the version
// probe), /releases/latest/download/<asset> serves the archive. It runs in its OWN PROCESS and
// records each request in a log file: the installers are driven with execFileSync, which blocks
// this process's event loop, so an in-process server could never answer them. `tag: 'none'` makes
// the probe unanswerable - the fork / offline / file:// shape the cache has to degrade through.
const SERVER_JS = path.join(FIXTURE, 'release-host.js');
fs.writeFileSync(SERVER_JS, `
const http = require('node:http'), fs = require('node:fs');
const [archive, zip, logFile, portFile, tag] = process.argv.slice(2);
const hit = kind => fs.appendFileSync(logFile, kind + '\\n');
http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/releases/latest') {
        hit('probe');
        if (tag === 'none') { res.writeHead(404); res.end(); return; }
        res.writeHead(302, { location: '/releases/tag/' + tag }); res.end(); return;
    }
    if (url.startsWith('/releases/tag/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
    if (url === '/releases/latest/download/claude-stack.tar.gz' || url === '/releases/latest/download/claude-stack.zip') {
        hit('asset');
        const body = fs.readFileSync(url.endsWith('.zip') ? zip : archive);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(body); return;
    }
    res.writeHead(404); res.end();
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(portFile, String(this.address().port)); });
`);

// a synchronous sleep that does not need a `sleep` binary (Windows runners have none)
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

let hostSeq = 0;
function startHost({ tag = `v${VERSION}` } = {}) {
    const id = `h${++hostSeq}`;
    const logFile = path.join(FIXTURE, `${id}.log`);
    const portFile = path.join(FIXTURE, `${id}.port`);
    fs.writeFileSync(logFile, '');
    const child = spawn(process.execPath, [SERVER_JS, ARCHIVE, ZIP, logFile, portFile, tag ?? 'none'], { stdio: 'ignore' });
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(portFile) && Date.now() < deadline) sleepSync(20);
    assert.ok(fs.existsSync(portFile), 'the release host came up');
    const count = kind => fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l === kind).length;
    return {
        url: `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').trim()}`,
        get assets() { return count('asset'); },
        get probes() { return count('probe'); },
        close: () => child.kill(),
    };
}

function work() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-'));
    fs.writeFileSync(path.join(dir, 'sel.txt'), 'skill csharp\n');
    return dir;
}

// One install run of the sh twin, HOME isolated so the cache lands in this run's own account dir.
// The COPY route on purpose: this file proves which SOURCE a run resolved (archive, cache, clone,
// offline), and it reads that through a skill landing in .claude/skills. On the default plugin
// route a stack skill is carried by a plugin instead of copied, so the same assertion would say
// nothing about the source. The delivery route has its own proofs (mcp-verify.test.js, the matrix).
function runSh(home, host, env = {}) {
    return execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', path.join(home, 'sel.txt'), '--skills-only'], {
        cwd: home,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, CLAUDE_CONFIG_DIR: '',
            CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false', CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false', ...env },
    });
}

function cacheEntries(home) {
    const root = path.join(home, '.claude', 'cache', 'stack-source');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
        .flatMap(slug => fs.readdirSync(path.join(root, slug)).map(v => path.join(root, slug, v)))
        .filter(p => fs.statSync(p).isDirectory());
}

function installedSkill(home) {
    return fs.existsSync(path.join(home, '.claude', 'skills', 'csharp', 'SKILL.md'));
}

// A plugin cache entry the way `claude plugin install` leaves it: the whole repo under
// <config>/plugins/cache/<marketplace>/claude-stack/<version>. Built from the same archive the
// release host serves, so a run that reads it installs exactly what a download would have.
function plantPluginCache(home, { version = VERSION, marketplace = 'claude-stack', truncated = false } = {}) {
    const dir = path.join(home, '.claude', 'plugins', 'cache', marketplace, 'claude-stack', version);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', ARCHIVE, '-C', dir]);
    // The CLI names the directory after the release it installed, so the entry's own RELEASE-SOURCE
    // says the same thing. The archive this fixture untars always names VERSION, so restate it -
    // otherwise a multi-version case would resolve one version by directory and report another.
    fs.writeFileSync(path.join(dir, 'RELEASE-SOURCE'), `sha: ${FAKE_SHA}\nref: main\nversion: ${version}\nbuilt: 2026-09-09T00:00:00Z\n`);
    // a half-written entry: the validity test is stack/skills + stack/agents, so drop one
    if (truncated) fs.rmSync(path.join(dir, 'stack', 'agents'), { recursive: true, force: true });
    return dir;
}

test('the plugin cache is the source, and nothing is downloaded', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home);
        const out = runSh(home, host);
        assert.match(out, /source: plugin cache/, 'the run did not read the cache Claude Code left');
        assert.strictEqual(host.assets, 0, 'an archive was fetched although the cache was there');
        assert.strictEqual(host.probes, 0, 'the version probe is gone - the cache needs no release lookup');
        assert.ok(installedSkill(home), 'and it installed from it');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('the newest version directory wins when the cache holds several', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, { version: '0.9.0' });
        plantPluginCache(home, { version: '0.10.0' });   // newer by VERSION order, older by string order
        const out = runSh(home, host);
        assert.match(out, /source: plugin cache .*0\.10\.0/, `the older entry was taken:\n${out}`);
        assert.strictEqual(host.assets, 0);
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('a half-written cache entry is rejected and the archive is taken instead', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, { truncated: true });
        const out = runSh(home, host);
        assert.doesNotMatch(out, /source: plugin cache/, 'a broken entry was installed from');
        assert.match(out, /releases\/latest\/download/, 'the archive is the fallback');
        assert.strictEqual(host.assets, 1);
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('no cache at all still installs, from the archive', () => {
    const host = startHost();
    const home = work();
    try
    {
        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/);
        assert.strictEqual(host.assets, 1, 'exactly one download');
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// The stack keeps no cache of its own any more: a run must leave nothing behind under the old
// location, or a later release would read a snapshot nothing maintains.
test('no run writes the retired stack-source cache', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host);
        assert.deepStrictEqual(cacheEntries(home), [], 'the retired cache layout was written again');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('an unanswerable version probe is no longer a factor - the archive still installs', () => {
    const host = startHost({ tag: 'none' });
    const home = work();
    try
    {
        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/);
        assert.ok(installedSkill(home), 'a fork with no tag still installs');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('the ps1 twin reads the same plugin cache', { skip: skipNoPwsh }, () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project',
            '-Selection', path.join(home, 'sel.txt'), '-SkillsOnly'], {
            cwd: home,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '',
                CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false', CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false' },
        });
        assert.match(out, /source: plugin cache/, 'ps1: the cache was not read');
        assert.strictEqual(host.assets, 0, 'ps1: an archive was fetched anyway');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// The guided walks do not run the installer's resolver - each command body pastes its own snippet
// from setup-plugin/references/source-protocol.md, one per platform. Three copies of one rule is
// exactly where they drift, and a drifted walk silently pays a download the installer would not.
// So run the protocol's OWN snippets against a planted cache and assert they land where the twins
// land: the newest valid entry, the half-written one rejected, nothing fetched.
function protocolSnippet(lang, index) {
    const md = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const blocks = [...md.matchAll(/```(bash|powershell)\n([\s\S]*?)```/g)].filter(m => m[1] === lang);
    assert.ok(blocks[index], `source-protocol.md has no ${lang} block #${index}`);
    return blocks[index][2];
}

// The same three entries both snippets and both twins have to agree on.
function plantThree(home) {
    plantPluginCache(home, { version: '0.9.0' });
    plantPluginCache(home, { version: '0.10.0' });                   // newest VALID - the expected answer
    plantPluginCache(home, { version: '0.11.0', truncated: true });  // newer, but half-written
    return path.join(home, '.claude', 'plugins', 'cache', 'claude-stack', 'claude-stack', '0.10.0');
}

test("the protocol's bash snippet resolves the same entry as the sh twin", () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    let tmp = '';
    try
    {
        const want = plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const out = execFileSync('bash', [script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude') },
        });
        const m = out.match(/RESOLVED TMP=(\S+) (\S+)/);
        assert.ok(m, `the snippet printed no RESOLVED line:\n${out}`);
        tmp = m[1];
        assert.strictEqual(m[2], '0.10.0', 'it read a different version than the twins take');
        assert.ok(fs.existsSync(path.join(tmp, 'repo', 'stack', 'skills')), 'nothing was copied into $TMP/repo');
        assert.ok(!fs.existsSync(path.join(tmp, 'claude-stack.tar.gz')), 'it downloaded the archive over a usable cache');
        assert.strictEqual(
            fs.readFileSync(path.join(tmp, 'repo', 'RELEASE-SOURCE'), 'utf8'),
            fs.readFileSync(path.join(want, 'RELEASE-SOURCE'), 'utf8'),
            'the copy did not come from the newest valid entry');
    }
    finally
    {
        const mark = `/tmp/claude-stack-run.${home.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.path`;
        for (const p of [tmp, mark]) if (p) fs.rmSync(p, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("the protocol's PowerShell snippet resolves the same entry", { skip: skipNoPwsh }, () => {
    const home = work();
    const script = path.join(home, 'resolve.ps1');
    try
    {
        const want = plantThree(home);
        // The block ends at $Ver; the two Write-Output lines are the test's probe, not the contract.
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-SRC=$Src"\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-TMP=$TMP"\n`);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude') },
        });
        assert.match(out, /PS-VER=0\.10\.0/, `the ps twin read a different version:\n${out}`);
        assert.strictEqual(out.match(/PS-SRC=(.+)/)[1].trim(), want, 'it took a different cache entry than the sh snippet');
        const tmp = out.match(/PS-TMP=(.+)/)[1].trim();
        assert.ok(fs.existsSync(path.join(tmp, 'repo', 'stack', 'skills')), 'nothing was copied into $TMP/repo');
        assert.ok(!fs.existsSync(path.join(tmp, 'claude-stack.zip')), 'it downloaded the archive over a usable cache');
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});
