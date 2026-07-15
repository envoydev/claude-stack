'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('requiring lint-skills does not run the linter and exposes parsers', () => {
    const lint = require('./lint-skills.js');
    assert.strictEqual(typeof lint.parseFlatBlock, 'function');
    assert.strictEqual(typeof lint.parseManifest, 'function');
    assert.strictEqual(typeof lint.parseStringArray, 'function');
    assert.strictEqual(typeof lint.localSkillDirs, 'function');
    assert.ok(lint.NON_SKILL_TOKENS instanceof Set);
    assert.ok(lint.paths && typeof lint.paths.SKILLS_DIR === 'string');
    // localSkillDirs reads the real skills/ dir - proves the paths resolve.
    assert.ok(lint.localSkillDirs().length > 0);
});
