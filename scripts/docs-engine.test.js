// scripts/docs-engine.test.js - the architecture docs engine, driven through its CLI in throwaway git repos.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repo, section, HOOKS } = require('./docs-fixture');

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

// The overlay is written before the branch has a commit of its own, so BASE.json snapshots head === base and no
// files at all. The branch commits afterwards and lands: the snapshot is one commit behind, and only the branch ref
// still says what the branch actually holds.
test('a section set before the branch\'s first commit is still promoted when the branch merges', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/early');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    const meta = JSON.parse(r.read('.claude/docs/.branches/feat-early/BASE.json'));
    assert.strictEqual(meta.head, meta.base, 'the snapshot is taken before the branch has a commit of its own');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/early');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/early .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10[\s\S]*soft-deleted/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-early'), 'the overlay is folded in and gone');
  } finally { r.rm(); }
});

test('a section set before the first commit is promoted through a squash merge too', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/early-squash');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Squashed early rule.')).status, 0);
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 20; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--squash', 'feat/early-squash'); r.git('commit', '-qm', 'squash');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/early-squash .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Squashed early rule\./);
    assert.ok(!r.exists('.claude/docs/.branches/feat-early-squash'));
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

// Catching up with mainline moves the branch tip without the branch committing anything: the tip is then a mainline
// commit, indistinguishable from a landed one by ancestry alone. The recorded fork point is what keeps them apart.
test('a branch that only caught up with mainline is never taken as merged', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/behind');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Not yet.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'mainline moved');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-behind'));
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
  } finally { r.rm(); }
});

// The release shape this repo itself uses: work lands on develop, develop is merged into main. A branch that only
// caught up sits on develop's tip - and that tip becomes the release merge's SECOND parent, which is exactly the
// shape a merged branch has. Two variants: the tip is still develop's head, and develop has moved on past it.
for (const moveOn of [false, true]) {
  test(`a branch that only caught up is never promoted when a second mainline ref merges that mainline${moveOn ? ', develop moved on' : ''}`, () => {
    const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
    try {
      r.git('branch', 'main');
      r.git('switch', '-qc', 'feat/behind');
      assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still being decided.')).status, 0);
      r.git('switch', '-q', 'develop');
      r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
      r.git('switch', '-q', 'feat/behind');
      r.git('merge', '-q', '--ff-only', 'develop');
      r.git('switch', '-q', 'main');
      r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
      if (moveOn) {
        r.git('switch', '-q', 'develop');
        r.write('README.md', 'z\n'); r.git('commit', '-qam', 'develop moved on');
        r.git('switch', '-q', 'main');
      }
      assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
      assert.ok(r.exists('.claude/docs/.branches/feat-behind'), 'the in-progress overlay survives');
      assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
      assert.match(r.cli(['status']).stdout, /branches sitting on mainline with no proof they merged: feat-behind/);
    } finally { r.rm(); }
  });
}

// The most ordinary state in this workflow: a branch cut, a decision written, nothing committed yet, mainline
// moving on. Nothing landed and nothing is stranded, so naming it would invite a fold that publishes an
// unfinished decision. A branch that has never committed is the one shape here that IS decidable: tip === base.
test('a branch that has never committed anything is never called unpromotable', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/never-committed');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still thinking.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moves on');
    const out = r.cli(['status']).stdout;
    assert.doesNotMatch(out, /no proof they merged/, 'nothing about it is unclear');
    assert.doesNotMatch(out, /deleted branches/);
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-never-committed'));
  } finally { r.rm(); }
});

// A fork point the repo does not have - pruned, re-cloned, hand-edited - makes head !== base true by accident,
// and every route that reads the fork point then reasons from a commit that does not exist.
test('an overlay whose recorded fork point does not resolve is never promoted', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('branch', 'main');
    r.git('switch', '-qc', 'feat/behind');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still being decided.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moves');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
    const metaPath = path.join(r.root, '.claude/docs/.branches/feat-behind/BASE.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    fs.writeFileSync(metaPath, `${JSON.stringify({ ...meta, base: 'f'.repeat(40) }, null, 2)}\n`);
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-behind'), 'the overlay survives an unreadable fork point');
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
  } finally { r.rm(); }
});

// The same broken fork point must not cost a branch whose blobs speak for themselves.
test('a squashed branch is still promoted by blobs when its fork point does not resolve', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/blobbed');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int B; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'b');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Blob rule.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--squash', 'feat/blobbed'); r.git('commit', '-qm', 'squash');
    r.git('branch', '-D', 'feat/blobbed');
    const metaPath = path.join(r.root, '.claude/docs/.branches/feat-blobbed/BASE.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    fs.writeFileSync(metaPath, `${JSON.stringify({ ...meta, base: 'f'.repeat(40) }, null, 2)}\n`);
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/blobbed \(blobs\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Blob rule\./);
  } finally { r.rm(); }
});

// The same release shape, with a branch that really did commit and land: the guard above must not cost this one.
test('a branch merged into develop and released into main is still promoted there', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('branch', 'main');
    r.git('switch', '-qc', 'feat/released');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge feat/released', 'feat/released');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/released .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-released'));
  } finally { r.rm(); }
});

// A snapshot is taken while the branch is still short of mainline and never rewritten afterwards: going back to a
// merged branch for one more session used to re-measure it as 'no commits of its own' and strand its sections.
test('a session on a branch after it merged leaves its snapshot alone', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/revisited');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int R; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'r');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Revisited rule.')).status, 0);
    const before = r.read('.claude/docs/.branches/feat-revisited/BASE.json');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/revisited');
    r.git('switch', '-q', 'feat/revisited');
    r.hook({ hook_event_name: 'SessionStart', session_id: 'revisit-1' });
    assert.strictEqual(r.read('.claude/docs/.branches/feat-revisited/BASE.json'), before, 'the merged branch keeps its snapshot');
    assert.strictEqual(r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nAlso decided here.\n').status, 0);
    assert.strictEqual(JSON.parse(r.read('.claude/docs/.branches/feat-revisited/BASE.json')).base, JSON.parse(before).base, 'and keeps it through a later set');
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/revisited \(ancestor\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Revisited rule\./);
  } finally { r.rm(); }
});

// The other half of the same rule: a branch that only caught up must not have its snapshot re-measured either, or
// its head would advance onto mainline while its base stayed put and the next promote would take it as merged.
test('a set on a branch that only caught up does not make it promotable', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/caught-up');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('First thought.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
    r.git('switch', '-q', 'feat/caught-up');
    r.git('merge', '-q', '--ff-only', 'develop');
    assert.strictEqual(r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nSecond thought.\n').status, 0);
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-caught-up'));
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /Second thought/);
  } finally { r.rm(); }
});

test('a branch cut from develop with no commits is never promoted when origin/HEAD is main', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const remote = `${r.root}-remote`;
  try {
    spawnSync('git', ['init', '-q', '--bare', remote]);
    r.git('branch', 'main');
    r.git('remote', 'add', 'origin', remote);
    r.git('push', '-q', 'origin', 'develop', 'main');
    r.git('remote', 'set-head', 'origin', 'main');
    r.write('README.md', 'ahead\n'); r.git('add', '-A'); r.git('commit', '-qm', 'develop moves ahead');

    // a branch cut here has no commits of its own - it must not be taken as merged, whatever origin/HEAD says.
    r.git('switch', '-qc', 'feat/fresh');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));

    // a branch with a commit of its own, merged into develop, is still promoted correctly.
    r.git('switch', '-qc', 'feat/real');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int R; }\n'); r.git('commit', '-qam', 'r');
    r.cli(['set', 'patterns#orders'], ORDERS('Real rule.'));
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/real');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/real \(ancestor\) patterns#orders: merged/);
  } finally { r.rm(); fs.rmSync(remote, { recursive: true, force: true }); }
});

test('a branch cut from origin/develop with no commits is never promoted when the local develop is stale', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const remote = `${r.root}-remote`;
  try {
    spawnSync('git', ['init', '-q', '--bare', remote]);
    r.git('remote', 'add', 'origin', remote);
    r.git('push', '-q', 'origin', 'develop');
    r.write('README.md', 'ahead\n'); r.git('add', '-A'); r.git('commit', '-qm', 'develop moves ahead');
    r.git('push', '-q', 'origin', 'develop');
    r.git('reset', '--hard', 'HEAD~1'); // the local develop goes stale; origin/develop stays ahead
    r.git('fetch', '-q', 'origin');

    // cut from origin/develop, the real tip - not from the local branch, which has not caught up.
    r.git('switch', '-qc', 'feat/fresh', 'origin/develop');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', 'develop');
    r.git('merge', '-q', '--ff-only', 'origin/develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));
  } finally { r.rm(); fs.rmSync(remote, { recursive: true, force: true }); }
});

test('two branches adding the same new section: the second promote conflicts, not overwrites', () => {
  const r = repo({ files: { 'src/Api/Orders/A.cs': 'class A {}\n', 'src/Api/Orders/B.cs': 'class B {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/a');
    r.write('src/Api/Orders/A.cs', 'class A { int X; }\n'); r.git('commit', '-qam', 'a');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nFrom A.\n');
    r.git('switch', '-q', 'develop');

    r.git('switch', '-qc', 'feat/b');
    r.write('src/Api/Orders/B.cs', 'class B { int X; }\n'); r.git('commit', '-qam', 'b');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nFrom B.\n');
    r.git('switch', '-q', 'develop');

    r.git('merge', '-q', '--no-ff', '-m', 'merge a', 'feat/a');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#paging: added/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /From A\./);

    r.git('merge', '-q', '--no-ff', '-m', 'merge b', 'feat/b');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#paging: conflict \(both added this section\)/);
    const doc = r.read('.claude/docs/architecture/references/patterns.md');
    assert.match(doc, /From A\./);
    assert.doesNotMatch(doc, /From B\./);
  } finally { r.rm(); }
});

test('a promote conflict keeps that override; setting the section on mainline resolves it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    branchWithDecision(r, 'feat/c', ORDERS('The cap is 10.'));
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/c');
    const first = r.cli(['promote', '--merged']);
    assert.match(first.stdout, /patterns#orders: conflict/);
    assert.ok(r.exists('.claude/docs/.branches/feat-c/references/patterns/orders.md'));
    assert.match(r.cli(['show', 'patterns#orders', '--conflict', 'feat/c']).stdout, /<<<<<<< mainline/);
    const resolved = r.cli(['set', 'patterns#orders'], ORDERS('The cap is 10.'));
    assert.match(resolved.stdout, /resolved the pending doc conflict with: feat-c/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-c'));
  } finally { r.rm(); }
});

test("keeping mainline's text resolves a conflict too", () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    branchWithDecision(r, 'feat/e', ORDERS('The cap is 10.'));
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/e');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: conflict/);
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: conflict/);
    const lines = r.read('.claude/docs/.branches/promoted.jsonl').trim().split('\n');
    assert.strictEqual(lines.length, 1, 'a repeated, unchanged conflict never appends another row');
    const resolved = r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    assert.match(resolved.stdout, /resolved the pending doc conflict with: feat-e/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-e'));
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /The cap is 20\./);
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

test('a doc file mainline no longer has stays a plain conflict, never traps an unclearable marker', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' },
    docs: {
      'references/patterns.md': PATTERNS,
      'references/legacy.md': section('old-rule', 'src/Api/Legacy/**', 'Legacy behavior.'),
    },
  });
  try {
    r.git('switch', '-qc', 'feat/mix');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int M; }\n'); r.git('commit', '-qam', 'm');
    r.cli(['set', 'patterns#orders'], ORDERS('Mixed rule.'));
    r.cli(['set', 'legacy#old-rule'], '## old rule\n<!-- id: old-rule -->\nBranch keeps it.\n');
    r.git('switch', '-q', 'develop');

    // mainline drops the whole doc file this branch also touched.
    fs.rmSync(path.join(r.root, '.claude/docs/architecture/references/legacy.md'), { force: true });
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/mix');

    const first = r.cli(['promote', '--merged']).stdout;
    assert.match(first, /patterns#orders: merged/);
    assert.match(first, /legacy#old-rule: conflict \(mainline has no such doc file\)/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-mix/.conflict/references/legacy/old-rule.md'), 'no marker for a missing doc file - set can never match one to clear it');
    assert.ok(r.exists('.claude/docs/.branches/feat-mix/references/legacy/old-rule.md'), 'the conflicting override is kept as-is');

    const second = r.cli(['promote', '--merged']).stdout;
    assert.match(second, /legacy#old-rule: conflict \(mainline has no such doc file\)/);
    assert.doesNotMatch(second, /patterns#orders/, 'the already-landed side is never revisited');
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

test('prune without a branch drops only overlays of deleted branches idle for 30 days', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const backdate = (rel) => {
      const meta = JSON.parse(r.read(rel));
      meta.updated = old;
      r.write(rel, `${JSON.stringify(meta, null, 2)}\n`);
    };

    // idle: BASE.json itself says it was last touched 40 days ago - pruned.
    branchWithDecision(r, 'feat/idle', ORDERS('Idle rule.'));
    r.git('branch', '-D', 'feat/idle');
    backdate('.claude/docs/.branches/feat-idle/BASE.json');

    // recent: BASE.json still says 'now' - a backdated directory mtime must not fool prune into dropping it.
    branchWithDecision(r, 'feat/recent', ORDERS('Recent rule.'));
    r.git('branch', '-D', 'feat/recent');
    const oldTime = new Date(Date.now() - 40 * 86400000);
    fs.utimesSync(path.join(r.root, '.claude/docs/.branches/feat-recent'), oldTime, oldTime);

    // merged: idle by BASE.json's clock too, but still merged into develop - promote owns it, not bulk prune.
    branchWithDecision(r, 'feat/merged', ORDERS('Merged rule.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/merged');
    r.git('branch', '-D', 'feat/merged');
    backdate('.claude/docs/.branches/feat-merged/BASE.json');

    const out = r.cli(['prune']).stdout;
    assert.strictEqual(out.trim(), 'pruned: feat-idle');
    assert.ok(!r.exists('.claude/docs/.branches/feat-idle'));
    assert.ok(r.exists('.claude/docs/.branches/feat-recent'), 'BASE.json says now, so it is kept despite the backdated directory');
    assert.ok(r.exists('.claude/docs/.branches/feat-merged'), 'a merged overlay belongs to promote, not to bulk prune');
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

test('lint: duplicate id, missing id, conflict markers, size at 6000 passes and 6001 fails', () => {
  const body = (n) => 'x'.repeat(n);
  const head = '## big\n<!-- id: big -->\n';
  const r = repo({ docs: {
    'references/a.md': `${head}${body(6000 - head.length)}\n\n## dup\n<!-- id: same -->\nOne.\n\n## dup two\n<!-- id: same -->\nTwo.\n\n## no id here\nText.\n`,
    'references/b.md': `## over\n<!-- id: over -->\n${body(6001 - '## over\n<!-- id: over -->\n'.length)}\n`,
    'references/c.md': '## merged\n<!-- id: merged -->\n<<<<<<< mainline\nx\n=======\ny\n>>>>>>> feat\n',
  } });
  try {
    const out = r.cli(['lint']);
    assert.strictEqual(out.status, 1);
    assert.doesNotMatch(out.stdout, /oversized section \(\d+ chars, cap 6000\): a#big/, '6000 passes');
    assert.match(out.stdout, /oversized section \(6001 chars, cap 6000\): b#over/);
    assert.match(out.stdout, /duplicate id a#same/);
    assert.match(out.stdout, /section without an id: references\/a 'no id here'/);
    assert.match(out.stdout, /merge conflict markers in references\/c/);
  } finally { r.rm(); }
});

test('lint: ORIENTATION.md at 4096 bytes passes, 4097 fails; watch.json problems are reported', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': 'o'.repeat(4096) } });
  try {
    assert.doesNotMatch(r.cli(['lint']).stdout, /ORIENTATION\.md is/);
    r.write('.claude/docs/architecture/ORIENTATION.md', 'o'.repeat(4097));
    assert.match(r.cli(['lint']).stdout, /ORIENTATION\.md is 4097 bytes, cap 4096/);
    r.write('.claude/docs/architecture/watch.json', '{ not json');
    assert.match(r.cli(['lint']).stdout, /watch\.json is not valid JSON/);
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['patterns#nope'] }] }));
    assert.match(r.cli(['lint']).stdout, /watch\.json 'root' names a section that does not exist: patterns#nope/);
  } finally { r.rm(); }
});

test('seed-ids adds missing ids once; a second run changes nothing; duplicate headings get distinct ids', () => {
  const r = repo({ docs: { 'references/p.md': '## Orders\nA.\n\n## Orders\nB.\n\n## Users\n<!-- id: users -->\nC.\n' } });
  try {
    assert.match(r.cli(['seed-ids']).stdout, /^2 ids added/);
    const once = r.read('.claude/docs/architecture/references/p.md');
    assert.match(once, /<!-- id: orders -->[\s\S]*<!-- id: orders-2 -->/);
    assert.match(r.cli(['seed-ids']).stdout, /^0 ids added/);
    assert.strictEqual(r.read('.claude/docs/architecture/references/p.md'), once);
  } finally { r.rm(); }
});

test('watch: globs and new module folders map to their sections; missing or malformed watch.json hits nothing', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['watch', 'src/Api/Program.cs']).stdout, /no watch\.json/);
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
      newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] },
    }));
    const hit = r.cli(['watch', 'src/Api/Program.cs', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(hit, /composition root: src\/Api\/Program\.cs -> patterns#orders/);
    assert.doesNotMatch(hit, /Refund/);
    assert.match(r.cli(['watch', '--dir', 'src/Api/Features/Billing']).stdout, /new module: src\/Api\/Features\/Billing\/ -> patterns#users/);
    r.write('.claude/docs/architecture/watch.json', '[]');
    assert.match(r.cli(['watch', 'src/Api/Program.cs']).stdout, /nothing hit/);
  } finally { r.rm(); }
});

// changedSince/snapshot carry no CLI verb of their own, so this drives the engine as a module: require
// stack/hooks/docs.js directly with CLAUDE_PROJECT_DIR pointed at the throwaway repo. The module is cached by
// resolved path, so the cache entry is cleared before and after - each test that does this gets a fresh ROOT.
const ENGINE_PATH = require.resolve(path.join(require('./docs-fixture').HOOKS, 'docs.js'));
function requireEngine(root) {
  delete require.cache[ENGINE_PATH];
  process.env.CLAUDE_PROJECT_DIR = root;
  process.env.CLAUDE_STACK_DOCS_PATH = '.claude/docs';
  process.env.CLAUDE_DOCS_PATH = '';
  return require(ENGINE_PATH);
}

test('changedSince reports both sides of a staged rename', () => {
  const r = repo({ files: { 'src/Api/Old.cs': 'class Old {}\n' } });
  try {
    const engine = requireEngine(r.root);
    const snap = engine.snapshot();
    r.git('mv', 'src/Api/Old.cs', 'src/Api/New.cs');
    const changed = engine.changedSince(snap);
    assert.ok(changed.files.includes('src/Api/Old.cs'), `expected Old.cs in ${JSON.stringify(changed.files)}`);
    assert.ok(changed.files.includes('src/Api/New.cs'), `expected New.cs in ${JSON.stringify(changed.files)}`);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('lint: a watch entry missing sections and a newModule missing globs are both reported; a complete watch.json lints clean', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'root', globs: ['src/*/Program.cs'] }],
      newModule: { sections: ['patterns#users'] },
    }));
    const broken = r.cli(['lint']);
    assert.strictEqual(broken.status, 1);
    assert.match(broken.stdout, /watch\.json watch\[0\]\.sections is missing/);
    assert.match(broken.stdout, /watch\.json newModule\.globs is missing/);

    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
      newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] },
    }));
    const clean = r.cli(['lint']);
    assert.strictEqual(clean.status, 0, clean.stdout);
    assert.doesNotMatch(clean.stdout, /is missing/);
  } finally { r.rm(); }
});

// --- the seams the final whole-branch review found ---

// One `git hash-object` per dirty file is one PROCESS per file. Stop runs changedSince at the end of every turn
// until a watch entry hits, so this is the per-turn floor of a session whose tree is dirty.
test('a dirty tree costs one batched hash, never one git process per file', () => {
  const files = {};
  for (let i = 0; i < 200; i++) files[`src/Api/T${i}.cs`] = `class T${i} {}\n`;
  const r = repo({ files, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const engine = requireEngine(r.root);
    for (let i = 0; i < 200; i++) r.write(`src/Api/T${i}.cs`, `class T${i} { int x; }\n`);
    for (let i = 0; i < 200; i++) r.write(`src/Api/U${i}.cs`, `class U${i} {}\n`);
    const t0 = Date.now();
    const snap = engine.snapshot();
    r.write('src/Api/T0.cs', 'class T0 { int y; }\n');
    const changed = engine.changedSince(snap);
    const ms = Date.now() - t0;
    assert.strictEqual(Object.keys(snap.dirty).length, 400, 'every dirty and untracked path is snapshotted');
    assert.ok(changed.files.includes('src/Api/T0.cs'), `expected T0.cs among ${changed.files.length} changed files`);
    assert.ok(!changed.files.includes('src/Api/T1.cs'), 'a file that did not move is not reported');
    assert.ok(ms < 2500, `400 dirty files took ${ms}ms - one git hash-object per file (measured 6.4s at 400, 13.2s at 800, past the wired 10s hook timeout, which kills the end-of-session ask)`);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('the batched hash answers exactly what one hash-object per file answers', () => {
  const r = repo({ files: { 'src/Api/Kept.cs': 'class Kept {}\n', 'src/Api/Gone.cs': 'class Gone {}\n' } });
  try {
    const engine = requireEngine(r.root);
    r.write('src/Api/New.cs', 'class New {}\n');
    fs.rmSync(path.join(r.root, 'src', 'Api', 'Gone.cs'));
    const paths = ['src/Api/Kept.cs', 'src/Api/New.cs', 'src/Api/Gone.cs', 'src/Api/Kept.cs'];
    const batched = engine.blobsOf(paths);
    for (const p of paths) assert.strictEqual(batched.get(p), engine.blobOf(p), `${p} hashes the same either way`);
    assert.strictEqual(batched.get('src/Api/Gone.cs'), '-', 'a path that is gone never reaches git');
    assert.strictEqual(batched.size, 3, 'a repeated path is hashed once');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Two sessions starting on mainline at the same moment each read the doc file before either writes: one
// promoted section is lost and BOTH overlays are deleted, so that branch's text is gone for good.
test('promote does nothing while another promote holds the lock', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    r.write('.claude/docs/.branches/.promote.lock', '{"pid":1}\n');
    const out = r.cli(['promote', '--merged']);
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/, 'mainline is not written while the lock is held');
    assert.ok(r.exists('.claude/docs/.branches/feat-cap/references/patterns/orders.md'), 'the overlay survives a skipped promote');
    assert.match(out.stdout, /another promote is running/);
    fs.rmSync(path.join(r.root, '.claude', 'docs', '.branches', '.promote.lock'));
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/, 'the next run picks it up');
    assert.ok(!r.exists('.claude/docs/.branches/.promote.lock'), 'the lock is released');
  } finally { r.rm(); }
});

test('a stale lock left by a killed process never blocks a promote forever', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const lock = path.join(r.root, '.claude', 'docs', '.branches', '.promote.lock');
    fs.writeFileSync(lock, '{"pid":1}\n');
    const old = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(lock, old, old);
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/);
  } finally { r.rm(); }
});

// safe() folds both names onto '.branches/feature-login'. Without an owner check the second branch reads the
// first branch's decisions as its own, overwrites them, and a promote folds them in under the wrong name.
test('two branch names that collide under safe() never share one overlay', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feature/login');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Slash branch decision.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.git('switch', '-qc', 'feature-login');
    assert.doesNotMatch(r.cli(['show', 'patterns#orders']).stdout, /Slash branch decision/, 'the dash branch reads mainline, not the slash branch');
    const st = r.cli(['status']).stdout;
    assert.match(st, /overrides: none/);
    assert.match(st, /feature\/login/, 'status names the branch that owns the directory');
    const w = r.cli(['set', 'patterns#orders'], ORDERS('Dash branch decision.'));
    assert.strictEqual(w.status, 1, 'the write is refused, never blended into the other branch');
    assert.match(w.stdout, /feature\/login/);
    assert.match(r.read('.claude/docs/.branches/feature-login/references/patterns/orders.md'), /Slash branch decision/, 'the owner keeps its text');
    r.git('switch', '-q', 'develop');
    const p = r.cli(['promote', 'feature-login']);
    assert.strictEqual(p.status, 1, 'promoting by the colliding live name is refused');
    assert.match(p.stdout, /feature\/login/);
  } finally { r.rm(); }
});

// The third pillar reads git. Without a repo it can never fire, and only the mode line can say so.
test('status says the end-of-session check is blind without git', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-nogit-')));
  try {
    fs.mkdirSync(path.join(root, '.claude', 'docs', 'architecture', 'references'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'docs', 'architecture', 'references', 'patterns.md'), PATTERNS);
    const out = spawnSync(process.execPath, [path.join(HOOKS, 'docs.js'), 'status'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_STACK_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '' },
    });
    assert.strictEqual(out.status, 0);
    assert.match(out.stdout, /^mode: no git \(docs written in place; the end-of-session check cannot see what changed\)/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Committing a docs root that used to be ignored flips tracked() - and every overlay under .branches/ becomes
// unreadable and unpromotable at once, with no word anywhere.
test('status reports overlays stranded by committing a previously ignored docs root', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    assert.match(r.cli(['status']).stdout, /^mode: overlay/m);
    r.write('.gitignore', '.claude/docs/docs-log.jsonl\n.claude/docs/.branches/\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'commit the docs');
    const out = r.cli(['status']).stdout;
    assert.match(out, /^mode: git/m);
    assert.match(out, /stranded/);
    assert.match(out, /feat-cap/);
  } finally { r.rm(); }
});

// The only ledger in this stack that was not under <docs-path>: hook-blocks and tools-usage are both there,
// and a project that commits .claude/ accumulated this one in git.
test('the engine log lands under the docs root, beside hook-blocks', () => {
  const r = repo({ docsPath: 'docs', files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    assert.ok(r.exists('docs/docs-log.jsonl'), 'the log is written under the docs root');
    assert.match(r.read('docs/docs-log.jsonl'), /"event":"doc-set"/);
    assert.ok(!r.exists('.claude/docs-log.jsonl'), 'and never under .claude/ any more');
  } finally { r.rm(); }
});
