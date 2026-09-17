// scripts/docs-engine.test.js - the architecture docs engine, driven through its CLI in throwaway git repos.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo, section } = require('./docs-fixture');

const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') + '\n'
  + section('users', 'src/Api/Users/**', 'Users are soft-deleted, never removed.');

const NESTED = '## orders\n<!-- id: orders -->\nOrders rule.\n\n### paging\n<!-- id: paging -->\nTen rows.\n\n'
  + '## users\n<!-- id: users -->\nUsers are soft-deleted, never removed.\n';

test('show prints one section, several ids print each, toc lists ids', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const one = r.cli(['show', 'patterns#orders']);
    assert.strictEqual(one.status, 0);
    assert.match(one.stdout, /ledgered before the payment call/);
    assert.doesNotMatch(one.stdout, /soft-deleted/);
    assert.match(r.cli(['show', 'patterns#orders', 'patterns#users']).stdout, /ledgered[\s\S]*soft-deleted/);
    assert.match(r.cli(['toc', 'patterns']).stdout, /patterns#orders[\s\S]*patterns#users/);
    assert.match(r.cli(['show', 'references/patterns#users']).stdout, /soft-deleted/, 'a file key may carry its folder');
  } finally { r.rm(); }
});

test('where names the narrowest covering section and never offers history', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Users/User.cs': 'class User {}\n', 'src/Api/Program.cs': 'app.Run();\n' },
    docs: {
      'references/patterns.md': PATTERNS,
      'ARCHITECTURE.md': section('everything', 'src/**', 'All routes return the envelope.'),
      'history/assessment-rounds.md': section('round-1', 'src/Api/Orders/**', 'Refund review notes.'),
    },
  });
  try {
    const out = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(out.split('\n')[0], /^patterns#orders /, 'the narrow glob comes first');
    assert.doesNotMatch(out, /assessment-rounds/, 'history is never a pointer');
    assert.match(r.cli(['show', 'assessment-rounds#round-1']).stdout, /Refund review notes/, 'history stays readable');
  } finally { r.rm(); }
});

test('the docs root follows CLAUDE_STACK_DOCS_PATH', () => {
  const r = repo({ docsPath: 'docs', docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /ledgered/);
    assert.match(r.cli(['files']).stdout, /docs\/architecture\/references\/patterns\.md/);
  } finally { r.rm(); }
});

test('an unknown file or section answers with what exists, exit 0', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['show', 'nope#x']).stdout, /no such doc file: nope\. Known: .*patterns/);
    assert.match(r.cli(['show', 'patterns#nope']).stdout, /no section nope in patterns[\s\S]*patterns#orders/);
  } finally { r.rm(); }
});

const setText = (heading, id, body) => `## ${heading}\n<!-- id: ${id} -->\n<!-- covers: src/Api/Orders/** -->\n${body}\n`;

test('overlay mode: a feature branch writes its own version and mainline keeps its text', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/refund-cap');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('commit', '-qam', 'cap');
    const out = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are capped at 10 per order.'));
    assert.strictEqual(out.status, 0, out.stdout);
    const over = '.claude/docs/.branches/feat-refund-cap/references/patterns/orders.md';
    assert.ok(r.exists(over), 'the override sits at <branch>/<file>/<id>.md');
    assert.match(r.read('.claude/docs/.branches/feat-refund-cap/.base/references/patterns/orders.md'), /ledgered before the payment call/, 'the base holds mainline text');
    const meta = JSON.parse(r.read('.claude/docs/.branches/feat-refund-cap/BASE.json'));
    assert.strictEqual(meta.branch, 'feat/refund-cap');
    assert.strictEqual(meta.head, r.git('rev-parse', 'HEAD'));
    assert.strictEqual(meta.files['src/Api/Orders/Refund.cs'], r.git('rev-parse', 'HEAD:src/Api/Orders/Refund.cs').slice(0, 12), 'the committed change is recorded by its blob');
    assert.ok(!Object.keys(meta.files).some((f) => f.startsWith('.claude/')), 'logs and docs are never recorded');
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/, 'mainline untouched');
    assert.match(r.read(over), /<!-- captured: [0-9a-f]{7,40}/, 'set stamps the section');
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /capped at 10[\s\S]*/);
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /this branch's version of patterns#orders/);
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /ledgered before the payment call/, 'develop reads mainline');
  } finally { r.rm(); }
});

test('in place: on mainline, with committed docs, and without git', () => {
  const a = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const b = repo({ tracked: true, docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(a.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Mainline rule.')).stdout, /into .*patterns\.md/);
    assert.match(a.read('.claude/docs/architecture/references/patterns.md'), /Mainline rule\.[\s\S]*soft-deleted/);
    b.git('switch', '-qc', 'feat/x');
    assert.match(b.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Committed rule.')).stdout, /into .*patterns\.md/);
    assert.ok(!b.exists('.claude/docs/.branches'), 'committed docs never get an overlay');
    fs.rmSync(path.join(b.root, '.git'), { recursive: true, force: true });
    assert.match(b.cli(['set', 'patterns#users'], setText('users', 'users', 'No git rule.')).stdout, /into .*patterns\.md/);
  } finally { a.rm(); b.rm(); }
});

test('a section new on a branch is written with an empty base and read as added', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/new');
    assert.strictEqual(r.cli(['set', 'patterns#device-paging'], '## Device paging\n<!-- id: device-paging -->\nTen rows per page.\n').status, 0);
    assert.strictEqual(r.read('.claude/docs/.branches/feat-new/.base/references/patterns/device-paging.md'), '');
    assert.match(r.cli(['show', 'patterns#device-paging']).stdout, /Ten rows per page/);
    assert.match(r.cli(['toc', 'patterns']).stdout, /patterns#device-paging .*\[this branch\]/);
  } finally { r.rm(); }
});

test('mainline edits to other lines reach the branch through a clean three-way merge', () => {
  // Changes three unchanged lines apart: git merge-file treats touching hunks as a conflict, so the test keeps a gap.
  const body = (first, last) => `${first}\nLine two.\nLine three.\nLine four.\n${last}`;
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', body('Line one.', 'Line five.')) } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body('Line one.', 'Line five, on the branch.')}\n`);
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body('Line one, on mainline.', 'Line five.')}\n`);
    r.git('switch', '-q', 'feat/x');
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /Line one, on mainline\.[\s\S]*Line five, on the branch\./);
    assert.doesNotMatch(out, /CONFLICT/);
  } finally { r.rm(); }
});

test('the same line changed on both sides: the branch text is served and flagged, --conflict shows both', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 10.\n');
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 20.\n');
    r.git('switch', '-q', 'feat/x');
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /The cap is 10\./);
    assert.match(out, /CONFLICT/);
    const both = r.cli(['show', 'patterns#orders', '--conflict']).stdout;
    assert.match(both, /<<<<<<< mainline[\s\S]*The cap is 20\.[\s\S]*=======[\s\S]*The cap is 10\.[\s\S]*>>>>>>> feat\/x/);
  } finally { r.rm(); }
});

test('a stamp rewritten on both sides alone never conflicts', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'Stable text.') } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStable text.\nBranch addition.\n');
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'x\n'); r.git('add', '-A'); r.git('commit', '-qm', 'move HEAD');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStable text.\n');
    r.git('switch', '-q', 'feat/x');
    assert.doesNotMatch(r.cli(['show', 'patterns#orders']).stdout, /CONFLICT/);
  } finally { r.rm(); }
});

test("a child section set inside an overridden parent lands in the parent's override and reads back", () => {
  const r = repo({ docs: { 'references/patterns.md': NESTED } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nOrders rule, branch.\n\n### paging\n<!-- id: paging -->\nTen rows.\n');
    r.cli(['set', 'patterns#paging'], '### paging\n<!-- id: paging -->\nTwenty rows.\n');
    assert.match(r.cli(['show', 'patterns#paging']).stdout, /Twenty rows\./);
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /Orders rule, branch\./);
    assert.match(out, /Twenty rows\./);
    assert.ok(!r.exists('.claude/docs/.branches/feat-x/references/patterns/paging.md'), 'no separate child override file');
    assert.ok(r.exists('.claude/docs/.branches/feat-x/references/patterns/orders.md'), 'the parent override still exists');
  } finally { r.rm(); }
});

test('setting a parent drops a nested child override its text now carries', () => {
  const r = repo({ docs: { 'references/patterns.md': NESTED } });
  try {
    r.git('switch', '-qc', 'feat/y');
    r.cli(['set', 'patterns#paging'], '### paging\n<!-- id: paging -->\nTwelve rows.\n');
    assert.ok(r.exists('.claude/docs/.branches/feat-y/references/patterns/paging.md'));
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nParent rewritten.\n\n### paging\n<!-- id: paging -->\nTwelve rows.\n');
    assert.ok(!r.exists('.claude/docs/.branches/feat-y/references/patterns/paging.md'), 'the child override is dropped');
    assert.ok(!r.exists('.claude/docs/.branches/feat-y/.base/references/patterns/paging.md'), 'its base twin is dropped too');
    assert.match(r.cli(['show', 'patterns#paging']).stdout, /Twelve rows\./);
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /Parent rewritten\./);
  } finally { r.rm(); }
});

test('set refuses: detached HEAD, empty text, no section id, unknown file', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['set', 'patterns#orders'], '   \n').stdout, /empty section text/);
    assert.match(r.cli(['set', 'patterns'], 'x').stdout, /name one section/);
    assert.match(r.cli(['set', 'nope#x'], 'x').stdout, /no such doc file/);
    r.git('checkout', '-q', '--detach');
    const d = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'x'));
    assert.strictEqual(d.status, 1);
    assert.match(d.stdout, /detached HEAD/);
  } finally { r.rm(); }
});

function branchWithDecision(r, name, text) {
  r.git('switch', '-qc', name);
  r.write('src/Api/Orders/Refund.cs', `class Refund { /* ${name} */ }\n`);
  r.git('add', '-A'); r.git('commit', '-qm', `work on ${name}`);
  assert.strictEqual(r.cli(['set', 'patterns#orders'], text).status, 0);
  r.git('switch', '-q', 'develop');
}
const ORDERS = (body) => `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body}\n`;

test('a merge commit is detected and promoted; the overlay goes; promoted.jsonl records it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const out = r.cli(['promote', '--merged']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /feat\/cap .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10[\s\S]*soft-deleted/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-cap'));
    assert.match(r.read('.claude/docs/.branches/promoted.jsonl'), /"branch":"feat-cap"/);
  } finally { r.rm(); }
});

test('a squash merge is detected by blobs', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/squash', ORDERS('Squashed rule.'));
    r.git('merge', '-q', '--squash', 'feat/squash'); r.git('commit', '-qm', 'squash');
    r.git('branch', '-D', 'feat/squash');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Squashed rule\./);
  } finally { r.rm(); }
});

test('a fast-forward merge is detected by ancestry, a rebase merge by blobs', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/ff', ORDERS('Fast-forwarded rule.'));
    r.git('merge', '-q', '--ff-only', 'feat/ff');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/ff \(ancestor\) patterns#orders: merged/);
    branchWithDecision(r, 'feat/rebased', ORDERS('Rebased rule.'));
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'mainline moved');
    r.git('cherry-pick', 'feat/rebased');
    r.git('branch', '-D', 'feat/rebased');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/rebased \(blobs\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Rebased rule\./);
  } finally { r.rm(); }
});

test('a branch with no commits of its own is never taken as merged', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/fresh');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));
  } finally { r.rm(); }
});

test('a promote conflict keeps that override; a reconciled mainline lets the next promote finish', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    branchWithDecision(r, 'feat/c', ORDERS('The cap is 10.'));
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/c');
    const first = r.cli(['promote', '--merged']);
    assert.match(first.stdout, /patterns#orders: conflict/);
    assert.ok(r.exists('.claude/docs/.branches/feat-c/references/patterns/orders.md'));
    assert.match(r.cli(['show', 'patterns#orders', '--conflict', 'feat/c']).stdout, /<<<<<<< mainline/);
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 10.'));
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-c'));
  } finally { r.rm(); }
});

test('a section new on the branch is appended on promote; one mainline removed is a conflict', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/add');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int P; }\n'); r.git('commit', '-qam', 'p');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nTen rows.\n');
    r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nUsers are archived.\n');
    r.git('switch', '-q', 'develop');
    r.write('.claude/docs/architecture/references/patterns.md', section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/add');
    const out = r.cli(['promote', '--merged']).stdout;
    assert.match(out, /patterns#paging: added/);
    assert.match(out, /patterns#users: conflict \(mainline removed this section\)/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Ten rows\./);
  } finally { r.rm(); }
});

test('status lists a deleted unmerged branch; promote <branch> folds it in, prune <branch> drops it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/gone', ORDERS('Gone rule.'));
    branchWithDecision(r, 'feat/drop', ORDERS('Dropped rule.'));
    r.git('branch', '-D', 'feat/gone'); r.git('branch', '-D', 'feat/drop');
    assert.match(r.cli(['status']).stdout, /deleted branches never detected as merged: feat-drop, feat-gone|deleted branches never detected as merged: feat-gone, feat-drop/);
    assert.match(r.cli(['promote', 'feat-gone']).stdout, /patterns#orders: merged/);
    assert.match(r.cli(['prune', 'feat-drop']).stdout, /pruned: feat-drop/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-drop'));
  } finally { r.rm(); }
});

test('status: mode, branch, overrides and conflicts; a shallow clone skips promote', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/s');
    r.cli(['set', 'patterns#orders'], ORDERS('Branch rule.'));
    const out = r.cli(['status']).stdout;
    assert.match(out, /mode: overlay/);
    assert.match(out, /branch: feat\/s/);
    assert.match(out, /overrides: patterns#orders/);
    r.write('.claude/docs/architecture/BRANCH-DELTA.md', '## Old delta\nA decision.\n');
    assert.match(r.cli(['status']).stdout, /BRANCH-DELTA\.md from an older capture/);
    assert.doesNotMatch(r.cli(['files']).stdout, /BRANCH-DELTA/, 'never read as a doc');
    assert.ok(r.exists('.claude/docs/architecture/BRANCH-DELTA.md'));
    r.git('switch', '-q', 'develop');
    const clone = `${r.root}-shallow`;
    require('node:child_process').spawnSync('git', ['clone', '-q', '--depth', '1', `file://${r.root}`, clone]);
    const s = require('node:child_process').spawnSync(process.execPath, [require('./docs-fixture').HOOKS + '/docs.js', 'promote', '--merged'], { cwd: clone, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: clone, CLAUDE_STACK_DOCS_PATH: '.claude/docs' } });
    assert.match(s.stdout, /shallow clone: merged branches cannot be detected/);
    fs.rmSync(clone, { recursive: true, force: true });
  } finally { r.rm(); }
});
