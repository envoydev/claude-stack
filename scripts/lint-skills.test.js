'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('requiring lint-skills does not run the linter and exposes parsers', () => {
    const lint = require('./lint-skills.js');
    assert.strictEqual(typeof lint.parseFlatBlock, 'function');
    assert.strictEqual(typeof lint.parseManifest, 'function');
    assert.strictEqual(typeof lint.parseStringArray, 'function');
    assert.strictEqual(typeof lint.localSkillDirs, 'function');
    assert.strictEqual(typeof lint.lintEvidenceCatalog, 'function');
    assert.ok(lint.NON_SKILL_TOKENS instanceof Set);
    assert.ok(lint.paths && typeof lint.paths.SKILLS_DIR === 'string');
    // localSkillDirs reads the real skills/ dir - proves the paths resolve.
    assert.ok(lint.localSkillDirs().length > 0);
});

test('lintEvidenceCatalog passes a clean catalog and flags unknown names, unlabeled regex signals, and unknown layers', () => {
    const { lintEvidenceCatalog } = require('./lint-skills.js');
    const rosters = {
        skills: new Set(['dotnet-performance']),
        mcps: new Set(['sentry']),
        plugins: new Set(),
    };

    const clean = {
        _comment: 'x',
        skills: { 'dotnet-performance': { packages: ['BenchmarkDotNet'], content: [{ glob: 'Program.cs', regex: 'x', label: 'x wiring' }] } },
        mcps: { sentry: { packages: ['Sentry.'] } },
        plugins: {},
    };
    assert.deepStrictEqual(lintEvidenceCatalog(clean, rosters), []);

    const bad = {
        rules: { 'baseline-git': {} },   // the scan reads only skills/mcps/plugins
        skills: {
            'dotnet-perf': { packages: ['BenchmarkDotNet'] },   // typo'd name - would silently never match
            'dotnet-performance': { csprojContent: [{ regex: '<X>' }], content: [{ glob: 'a', regex: 'b', label: '  ' }] },
        },
    };
    const findings = lintEvidenceCatalog(bad, rosters);
    assert.strictEqual(findings.length, 4);
    assert.ok(findings.some(f => f.includes("unknown layer 'rules'")));
    assert.ok(findings.some(f => f.includes("skill 'dotnet-perf'")));
    assert.ok(findings.some(f => f.includes('csprojContent signal without a label')));
    assert.ok(findings.some(f => f.includes('content signal without a label')));
});

test('lintJudgmentCatalog passes a clean catalog and flags bad refs, missing gaps, bad thresholds', () => {
    const { lintJudgmentCatalog } = require('./lint-skills.js');
    const rosters = {
        skills: new Set(['capacitor-release']),
        agents: new Set(['security-auditor']),
        mcps: new Set(['playwright', 'chrome-devtools', 'angular-cli']),
        plugins: new Set(),
    };
    const clean = {
        _comment: 'x',
        overlaps: [{ items: ['mcp:playwright', 'mcp:chrome-devtools'], shared: 'drive a browser', gaps: { 'mcp:playwright': 'a', 'mcp:chrome-devtools': 'b' } }],
        versionConflicts: [{ item: 'mcp:angular-cli', package: '@angular/core', below: '17', conflict: 'newer-major guidance', survives: 'docs lookups' }],
        occasionBound: { 'skill:capacitor-release': 'release-time', 'agent:security-auditor': 'audit-time' },
    };
    assert.deepStrictEqual(lintJudgmentCatalog(clean, rosters), []);

    const bad = {
        overlaps: [{ items: ['mcp:playwright', 'mcp:chrome-devtool'], shared: '', gaps: { 'mcp:playwright': 'a' } }],
        versionConflicts: [{ item: 'skill:nope', package: '@angular/core', below: 'seventeen', conflict: 'x', survives: 'y' }],
        occasionBound: { 'skill:capacitor-release': '  ' },
    };
    const findings = lintJudgmentCatalog(bad, rosters);
    assert.ok(findings.some(f => f.includes("'mcp:chrome-devtool'")), 'unknown ref flagged');
    assert.ok(findings.some(f => f.includes('no gap')), 'overlap item without its gap flagged');
    assert.ok(findings.some(f => f.includes('shared')), 'empty shared flagged');
    assert.ok(findings.some(f => f.includes("'skill:nope'")), 'unknown versionConflicts item flagged');
    assert.ok(findings.some(f => f.includes("below 'seventeen'")), 'non-integer threshold flagged');
    assert.ok(findings.some(f => f.includes('empty cadence')), 'blank occasionBound cadence flagged');
});
