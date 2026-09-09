'use strict';
// The SOURCE CACHE: one download per RELEASE, not one per run.
//
// Every run used to fetch the 1.4MB release archive into a fresh temp dir and delete it at the
// end, so installing into a second project - or the same project twice - paid the download again
// (measured: 1.4MB / ~1.8s per run, against 0.3s for the version probe and 0.1s to copy the
// extracted 5.4MB snapshot off disk). The cache keeps the extracted snapshot under the account
// dir, keyed by the release version, and a run reuses it whenever the probe says that version is
// still the newest.
//
// These tests drive the REAL installers against a local HTTP fixture that speaks the two
// endpoints the cache depends on - the /releases/latest redirect that names the tag, and the
// archive asset - and counts asset hits, which is what proves a run downloaded nothing.
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
function runSh(home, host, env = {}) {
    return execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', path.join(home, 'sel.txt'), '--skills-only'], {
        cwd: home,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, CLAUDE_CONFIG_DIR: '', ...env },
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

// THE POINT OF THE FEATURE: the second run downloads nothing. Same account, so the second run is
// the 'now install it into another project' case the cache exists for.
test('a second run reuses the cached snapshot and fetches no archive', () => {
    const host = startHost();
    const home = work();
    try
    {
        const first = runSh(home, host);
        assert.match(first, /releases\/latest\/download/, 'the first run downloads the archive');
        assert.strictEqual(host.assets, 1, 'exactly one asset fetch so far');
        assert.ok(installedSkill(home), 'the first run installed from the download');
        assert.deepStrictEqual(cacheEntries(home).map(p => path.basename(p)), [VERSION], 'the download is promoted into the cache');

        fs.rmSync(path.join(home, '.claude', 'skills'), { recursive: true, force: true });
        const second = runSh(home, host);
        assert.match(second, /source: cache/, 'the second run reports the cache, not a download');
        assert.strictEqual(host.assets, 1, 'the second run fetched no archive');
        assert.ok(host.probes >= 2, 'it still probed for a newer release');
        assert.ok(installedSkill(home), 'the second run installed from the cache');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// A cache the run deletes is not a cache. The installer already refuses to delete a --source it
// was handed; a cache entry it resolved for itself is the same promise.
test('the cache entry survives the run that used it', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host);
        const [entry] = cacheEntries(home);
        assert.ok(entry, 'the first run left a cache entry');
        runSh(home, host);
        assert.ok(fs.existsSync(path.join(entry, 'stack', 'skills')), 'the entry is still a usable snapshot after a run consumed it');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// A half-written entry (an interrupted promote, a pruned tree) must never be installed FROM - the
// validity check is the same stack/skills + stack/agents pair every other source path uses.
test('a partial cache entry is ignored and re-downloaded', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host);
        const [entry] = cacheEntries(home);
        fs.rmSync(path.join(entry, 'stack', 'agents'), { recursive: true, force: true });
        fs.rmSync(path.join(home, '.claude', 'skills'), { recursive: true, force: true });

        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/, 'the damaged entry is not trusted');
        assert.strictEqual(host.assets, 2, 'it downloaded again');
        assert.ok(installedSkill(home), 'and still installed');
        assert.ok(fs.existsSync(path.join(entry, 'stack', 'agents')), 'the entry was rebuilt');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// A new release must win immediately - the probe names the version, so a cached older one is
// simply not the entry the run asks for.
test('a newer release is downloaded even with an older version cached', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host);
        assert.strictEqual(host.assets, 1);
        const older = path.join(cacheEntries(home)[0], '..', '0.0.1');
        fs.cpSync(cacheEntries(home)[0], older, { recursive: true });
        fs.rmSync(cacheEntries(home).find(p => p.endsWith(VERSION)), { recursive: true, force: true });
        fs.rmSync(path.join(home, '.claude', 'skills'), { recursive: true, force: true });

        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/, 'the older entry is not what the probe named');
        assert.strictEqual(host.assets, 2, 'it fetched the release the probe named');
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// The escape hatch: an environment that wants the old always-fresh guarantee keeps it, and the
// cache is not merely bypassed for reading - nothing is written either.
test('STACK_SOURCE_CACHE=0 downloads every run and writes no cache', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host, { STACK_SOURCE_CACHE: '0' });
        runSh(home, host, { STACK_SOURCE_CACHE: '0' });
        assert.strictEqual(host.assets, 2, 'both runs downloaded');
        assert.deepStrictEqual(cacheEntries(home), [], 'and nothing was cached');
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// A host that cannot answer the probe (a fork with no releases, a file:// fixture, an offline
// run) must install exactly as it did before the cache existed - fail-soft, never a hard stop.
test('an unanswerable version probe still installs from the download', () => {
    const host = startHost({ tag: null });
    const home = work();
    try
    {
        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/, 'falls through to the archive');
        assert.strictEqual(host.assets, 1);
        assert.ok(installedSkill(home), 'the install is unaffected by a dead probe');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// Both twins share one cache layout, so a script install on Windows reuses what a run on the same
// account already fetched. Same two assertions that matter: one asset fetch, the second run says cache.
test('the ps1 twin caches and reuses the same way', { skip: skipNoPwsh }, () => {
    const host = startHost();
    const home = work();
    try
    {
        const run = () => execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project',
            '-Selection', path.join(home, 'sel.txt'), '-SkillsOnly'], {
            cwd: home,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' },
        });
        run();
        assert.strictEqual(host.assets, 1, 'the first run downloaded once');
        assert.deepStrictEqual(cacheEntries(home).map(p => path.basename(p)), [VERSION], 'promoted into the shared cache layout');
        const second = run();
        assert.match(second, /source: cache/, 'the second run reports the cache');
        assert.strictEqual(host.assets, 1, 'and fetched no archive');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
