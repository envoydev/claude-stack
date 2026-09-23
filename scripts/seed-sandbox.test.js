'use strict';
// The sandbox is hermetic by default. The seed's pin lookups ask npm (`npm view <pkg> version`) and
// PyPI (curl) for a version on every run; a sandbox that left those two to the machine's own tools
// sent every installer test to registry.npmjs.org and pypi.org. The proof is a PATH-level sentinel:
// recording npm and curl stubs placed on the PATH the sandbox inherits, BEHIND its own bin - a call
// that gets past the sandbox's stubs lands in the sentinel's record instead of on the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';

// Runs `fn` with a recording npm and curl first on process.env.PATH (which the sandbox appends after
// its own bin), and returns what reached them.
function withSentinel(fn)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-sentinel-'));
    const record = path.join(dir, 'reached.log');
    for (const tool of ['npm', 'curl'])
        fs.writeFileSync(path.join(dir, tool), `#!/bin/sh\nprintf '${tool} %s\\n' "$*" >> '${record}'\nexit 1\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = dir + path.delimiter + saved;
    try
    {
        const result = fn();
        const reached = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean) : [];
        return { result, reached };
    }
    finally
    {
        process.env.PATH = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('sandbox: a run with no stubs of its own reaches neither npm nor curl on the machine', POSIX_ONLY, () =>
{
    for (const action of ['install', 'update'])
    {
        const { reached } = withSentinel(() => seedRun(action, SELECTION));
        assert.deepStrictEqual(reached, [], `${action}: a registry lookup got past the sandbox - it would have gone to the network`);
    }
});

test('sandbox: the positive control - with the sandbox stub removed, the lookups do reach the sentinel', POSIX_ONLY, () =>
{
    // A sentinel that records nothing proves nothing unless the seed really makes these calls: remove
    // the sandbox's own npm stub for one run and the sentinel must see `npm view`.
    const { reached } = withSentinel(() => seedRun('install', SELECTION, { prepare: (repo) => fs.rmSync(path.join(path.dirname(repo), 'bin', 'npm'), { force: true }) }));
    assert.ok(reached.some((l) => /^npm view \S+ version$/.test(l)), `the seed made no npm lookup at all: ${JSON.stringify(reached)}`);
});

test('sandbox: a test that needs a working npm still passes its own stub over the default', POSIX_ONLY, () =>
{
    const { result, reached } = withSentinel(() => seedRun('install', SELECTION, {
        tools: { npm: 'printf \'%s\\n\' "$*" >> "$HOME/own-npm.log"; echo 9.9.9' },
        inspect: (repo) =>
        {
            const log = path.join(path.dirname(repo), 'own-npm.log');
            return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
        },
    }));
    assert.ok(result.result.some((l) => /^view \S+ version$/.test(l)), 'the test\'s own npm stub answered the lookups');
    assert.deepStrictEqual(reached, [], 'nothing got past the sandbox');
});
