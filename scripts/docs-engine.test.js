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
