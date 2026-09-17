// scripts/docs-engine.test.js - the architecture docs engine, driven through its CLI in throwaway git repos.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { repo, section } = require('./docs-fixture');

const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') + '\n'
  + section('users', 'src/Api/Users/**', 'Users are soft-deleted, never removed.');

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
