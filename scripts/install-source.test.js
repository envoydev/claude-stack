'use strict';
// THE SOURCE LAYER OF THE NODE SEED - Phase 7, T1.
//
// `scripts/source-cache.test.js` drives the two shell twins end to end against a live release host
// and proves the ROUTES. This file is its unit-level counterpart for the Node seed: the same rules,
// asserted on the module directly, so a route change fails in a second rather than in a matrix run.
// Both survive - the end-to-end file is what catches a route that works in isolation and not from a
// real install, and it is rewritten against the Node entry in T7.
//
// The rules under test are the shell's, unchanged (Phase 7 is a rewrite, never a behaviour change):
//   1. a handed --source wins, and is REJECTED when it is not a stack checkout;
//   2. else the plugin cache, newest valid entry across every marketplace, by version sort;
//   3. else the release archive; 4. else a shallow clone of main;
//   5. a directory counts as the stack only with BOTH stack/skills and stack/agents, so a
//      half-written cache entry is passed over rather than half-installed;
//   6. the failure is memoised - five callers on an offline machine pay one timeout, not five.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSource, isValidSource } = require('./install/source.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-source-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
const dir = (name) => { const d = path.join(TMP, `${name}-${seq++}`); fs.mkdirSync(d, { recursive: true }); return d; };

// A directory that looks like the stack to rule 5. `releaseSource` writes the RELEASE-SOURCE file a
// cache entry and an extracted archive both carry, which is where a non-git snapshot's revision
// comes from.
function stackDir(name, { releaseSource } = {})
{
    const d = dir(name);
    fs.mkdirSync(path.join(d, 'stack', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(d, 'stack', 'agents'), { recursive: true });
    if (releaseSource) fs.writeFileSync(path.join(d, 'RELEASE-SOURCE'), releaseSource);
    return d;
}

// The cache the CLI writes: <config>/plugins/cache/<marketplace>/claude-stack/<version>/<the repo>.
function cacheEntry(configDir, marketplace, version, { valid = true, releaseSource } = {})
{
    const d = path.join(configDir, 'plugins', 'cache', marketplace, 'claude-stack', version);
    fs.mkdirSync(path.join(d, 'stack', 'skills'), { recursive: true });
    if (valid) fs.mkdirSync(path.join(d, 'stack', 'agents'), { recursive: true });
    if (releaseSource) fs.writeFileSync(path.join(d, 'RELEASE-SOURCE'), releaseSource);
    return d;
}

// Never let a test reach the network: the two outward routes are replaced by counters, so a test
// that expects 'no download' proves it by the counter being zero rather than by being fast.
function source(opts = {})
{
    const calls = { archive: 0, clone: 0 };
    const s = createSource({
        configDir: opts.configDir || dir('cfg'),
        sourceDir: opts.sourceDir,
        repoUrl: 'https://example.invalid/envoydev/claude-stack',
        log: () => {},
        note: (m) => calls.notes = [...(calls.notes || []), m],
        fetchArchive: opts.fetchArchive || (() => { calls.archive++; return null; }),
        clone: opts.clone || (() => { calls.clone++; return null; }),
    });
    return { s, calls };
}

test('install-source: rule 5 - both trees, or it is not the stack', () =>
{
    assert.strictEqual(isValidSource(stackDir('valid')), true);
    const half = dir('half');
    fs.mkdirSync(path.join(half, 'stack', 'skills'), { recursive: true });
    assert.strictEqual(isValidSource(half), false, 'a half-written entry passed as the stack');
    assert.strictEqual(isValidSource(path.join(TMP, 'does-not-exist')), false);
});

test('install-source: a handed --source wins, and nothing is downloaded', () =>
{
    const provided = stackDir('provided');
    const { s, calls } = source({ sourceDir: provided });
    const got = s.resolve();
    assert.strictEqual(got.dir, provided);
    assert.strictEqual(got.route, 'provided');
    assert.strictEqual(got.owned, false, 'a borrowed source must never be owned - the run would delete the caller\'s tree');
    assert.strictEqual(calls.archive + calls.clone, 0, 'a handed source still reached the network');
});

test('install-source: a --source that is NOT a checkout fails loudly instead of installing nothing', () =>
{
    const { s, calls } = source({ sourceDir: dir('not-the-stack') });
    assert.strictEqual(s.resolve(), null);
    assert.ok((calls.notes || []).some((m) => /not a claude-stack checkout/.test(m)),
        'the wrong --source was accepted silently - the run would report a failure per file instead');
    assert.strictEqual(calls.archive + calls.clone, 0, 'a rejected --source fell through to the network');
});

test('install-source: the plugin cache is taken before any download', () =>
{
    const cfg = dir('cfg-cache');
    const entry = cacheEntry(cfg, 'claude-stack', '1.0.0', { releaseSource: 'sha: abc123\nref: main\n' });
    const { s, calls } = source({ configDir: cfg });
    const got = s.resolve();
    assert.strictEqual(got.dir, entry);
    assert.strictEqual(got.route, 'plugin-cache');
    assert.strictEqual(got.owned, false, 'the cache is the CLI\'s own install, never ours to delete');
    assert.strictEqual(got.sha, 'abc123');
    assert.strictEqual(got.ref, 'main');
    assert.strictEqual(calls.archive + calls.clone, 0, 'the common run downloaded something');
});

test('install-source: the NEWEST cache entry wins, by version order and not by string order', () =>
{
    const cfg = dir('cfg-newest');
    cacheEntry(cfg, 'claude-stack', '0.9.0');
    const newest = cacheEntry(cfg, 'claude-stack', '0.10.0');   // string-sorts BELOW 0.9.0
    const { s } = source({ configDir: cfg });
    assert.strictEqual(s.resolve().dir, newest, '0.10.0 lost to 0.9.0 - the sort is lexical, not version');
});

test('install-source: the newest entry across DIFFERENT marketplaces wins', () =>
{
    const cfg = dir('cfg-marketplaces');
    cacheEntry(cfg, 'marketplace-a', '1.0.0');
    const newest = cacheEntry(cfg, 'marketplace-b', '1.2.0');
    const { s } = source({ configDir: cfg });
    assert.strictEqual(s.resolve().dir, newest);
});

test('install-source: a half-written cache entry is passed over, not installed from', () =>
{
    const cfg = dir('cfg-half');
    const good = cacheEntry(cfg, 'claude-stack', '1.0.0');
    cacheEntry(cfg, 'claude-stack', '2.0.0', { valid: false });   // newer, but missing stack/agents
    const { s } = source({ configDir: cfg });
    assert.strictEqual(s.resolve().dir, good, 'the half-written 2.0.0 entry was taken');
});

test('install-source: with no cache, the release archive is next - and it is OWNED', () =>
{
    const cfg = dir('cfg-archive');
    const extracted = stackDir('archive-extract', { releaseSource: 'sha: deadbeef\nref: main\n' });
    const { s, calls } = source({ configDir: cfg, fetchArchive: () => { calls.archive++; return extracted; } });
    const got = s.resolve();
    assert.strictEqual(got.route, 'release-archive');
    assert.strictEqual(got.dir, extracted);
    assert.strictEqual(got.owned, true, 'what the run downloaded must be cleaned up by the run');
    assert.strictEqual(got.sha, 'deadbeef');
});

test('install-source: with no cache and no archive, a shallow clone is the last route', () =>
{
    const cfg = dir('cfg-clone');
    const cloned = stackDir('cloned');
    const { s, calls } = source({ configDir: cfg, clone: () => { calls.clone++; return { dir: cloned, sha: 'c0ffee', ref: 'main' }; } });
    const got = s.resolve();
    assert.strictEqual(got.route, 'clone');
    assert.strictEqual(got.dir, cloned);
    assert.strictEqual(got.owned, true);
    assert.strictEqual(calls.archive, 1, 'the clone ran without the archive route being tried first');
});

test('install-source: nothing reachable reports the CACHE by name - it is the offline route', () =>
{
    const { s, calls } = source({ configDir: dir('cfg-none') });
    assert.strictEqual(s.resolve(), null);
    assert.ok((calls.notes || []).some((m) => /no plugin cache is present/.test(m)),
        `the failure did not name the cache: ${(calls.notes || []).join(' | ')}`);
});

test('install-source: the FAILURE is memoised - five callers pay one timeout, not five', () =>
{
    const { s, calls } = source({ configDir: dir('cfg-memo') });
    for (let i = 0; i < 5; i++) assert.strictEqual(s.resolve(), null);
    assert.strictEqual(calls.archive, 1, `the archive route ran ${calls.archive} times for one run`);
    assert.strictEqual(calls.clone, 1, `the clone route ran ${calls.clone} times for one run`);
    assert.strictEqual((calls.notes || []).length, 1, 'one root cause was reported as several failures');
});

test('install-source: the SUCCESS is memoised too - the worktree is resolved once', () =>
{
    const cfg = dir('cfg-memo-ok');
    const entry = cacheEntry(cfg, 'claude-stack', '1.0.0');
    const { s } = source({ configDir: cfg });
    const first = s.resolve();
    assert.strictEqual(s.resolve(), first, 'a second caller re-resolved instead of reusing the worktree');
    assert.strictEqual(first.dir, entry);
});

test('install-source: cleanup removes what the run OWNS and never what it borrowed', () =>
{
    const borrowed = stackDir('borrowed');
    const { s } = source({ sourceDir: borrowed });
    s.resolve();
    s.cleanup();
    assert.ok(fs.existsSync(borrowed), 'cleanup deleted a borrowed source - that is the caller\'s tree');

    const cfg = dir('cfg-owned');
    const downloaded = stackDir('downloaded');
    const { s: s2 } = source({ configDir: cfg, fetchArchive: () => downloaded });
    s2.resolve();
    s2.cleanup();
    assert.ok(!fs.existsSync(downloaded), 'cleanup left the downloaded tree behind');
});
