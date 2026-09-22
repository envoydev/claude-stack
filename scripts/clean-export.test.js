'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cleanExport } = require('./clean-export.js');

function fixture()
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init', '-q');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.mcp.json\nnode_modules/\n');
    fs.mkdirSync(path.join(repo, 'stack'));
    fs.writeFileSync(path.join(repo, 'stack', 'a.md'), 'committed\n');
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    // the three shapes that matter: a tracked file changed in the tree, an ignored file, an untracked one
    fs.writeFileSync(path.join(repo, 'stack', 'a.md'), 'working tree\n');
    fs.writeFileSync(path.join(repo, '.mcp.json'), '{"mcpServers":{"local":{}}}\n');
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'untracked\n');
    return { tmp, repo, dest: path.join(tmp, 'out') };
}

test('the export carries tracked files at their WORKING-TREE content, not HEAD', () => {
    const { tmp, repo, dest } = fixture();
    const result = cleanExport(repo, dest);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'stack', 'a.md'), 'utf8'), 'working tree\n',
        'the matrix proves THIS working tree, so the export must carry it');
    assert.ok(result.files >= 2, 'it reports how many files it wrote');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('the export carries no ignored and no untracked file - the S9c leak', () => {
    const { tmp, repo, dest } = fixture();
    cleanExport(repo, dest);
    assert.ok(!fs.existsSync(path.join(dest, '.mcp.json')),
        'a machine-local .mcp.json at the root would register this repo\'s own servers into the temp project');
    assert.ok(!fs.existsSync(path.join(dest, 'scratch.txt')), 'nor any other untracked file');
    assert.ok(fs.existsSync(path.join(dest, '.gitignore')), 'a tracked dotfile still comes over');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('a re-export into the same destination replaces it rather than merging', () => {
    const { tmp, repo, dest } = fixture();
    cleanExport(repo, dest);
    fs.writeFileSync(path.join(dest, 'stale.txt'), 'left over\n');
    cleanExport(repo, dest);
    assert.ok(!fs.existsSync(path.join(dest, 'stale.txt')), 'a stale file from an earlier export is gone');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('a file mode is preserved - an installer script has to stay executable', () => {
    const { tmp, repo, dest } = fixture();
    const script = path.join(repo, 'run.sh');
    fs.writeFileSync(script, '#!/bin/sh\necho hi\n', { mode: 0o755 });
    execFileSync('git', ['-C', repo, 'add', 'run.sh'], { stdio: 'ignore' });
    cleanExport(repo, dest);
    assert.ok(fs.statSync(path.join(dest, 'run.sh')).mode & 0o111, 'the executable bit survives the export');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('a non-repository source fails loudly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    assert.throws(() => cleanExport(tmp, path.join(tmp, 'out')), /not a git repository|git/i);
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('the export carries a RELEASE-SOURCE, because it has no .git for the installer to read', () => {
    const { tmp, repo, dest } = fixture();
    const result = cleanExport(repo, dest);
    const said = fs.readFileSync(path.join(dest, 'RELEASE-SOURCE'), 'utf8');
    assert.match(said, /^sha: [0-9a-f]{40}$/m, 'the installer reads sha: from it, and writes no stamp without one');
    assert.match(said, /^ref: .+$/m);
    assert.match(said, /^source: clean-export$/m);
    assert.match(said, /^tree: working-tree$/m, 'the fixture has uncommitted changes, and the file says so');
    assert.strictEqual(result.sha.length, 40);
    assert.ok(!fs.existsSync(path.join(dest, '.git')), 'and no .git, which is the whole point');
    fs.rmSync(tmp, { recursive: true, force: true });
});
