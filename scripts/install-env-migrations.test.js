'use strict';
// The seed's settings pass reads meta/migrations.json - the real file, never a hand-fed list,
// because the hand-fed unit test is what let the seed apply nothing for a whole release line.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { envMigrations } = require('./install/env-migrations.js');
const { applyEnv } = require('./install/settings.js');

const REAL = require(path.join(__dirname, '..', 'meta', 'migrations.json'));

test('every settings-env migration in the real file reaches applyEnv', () =>
{
    const m = envMigrations(REAL);
    assert.deepEqual(m.renames, [['CLAUDE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH']]);
    assert.ok(m.retired.some(([k]) => k === 'CLAUDE_STACK_FRESH_SESSION_PCT'));
    assert.ok(m.reseed.some(([k]) => k === 'CLAUDE_STACK_FRESH_SESSION_DEFAULT'));
});

test('an old install is migrated by the real file', () =>
{
    const env = { CLAUDE_DOCS_PATH: 'docs', CLAUDE_STACK_FRESH_SESSION_PCT: '60', CLAUDE_STACK_FRESH_SESSION_DEFAULT: '250000' };
    applyEnv(env, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(env.CLAUDE_STACK_DOCS_PATH, 'docs');
    assert.ok(!('CLAUDE_DOCS_PATH' in env));
    assert.ok(!('CLAUDE_STACK_FRESH_SESSION_PCT' in env));
    assert.equal(env.CLAUDE_STACK_FRESH_SESSION_DEFAULT, '180000');
});

test('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is dropped only while it still holds the old stack seed', () =>
{
    const removed = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' };
    applyEnv(removed, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.ok(!('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' in removed));

    const kept = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '35' };
    applyEnv(kept, { catalog: [], migrations: envMigrations(REAL), log: () => {} });
    assert.equal(kept.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '35');
});
