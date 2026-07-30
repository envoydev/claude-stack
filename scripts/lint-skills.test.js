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

test('lintPreloadClaims flags body-claimed preloads missing from frontmatter skills:', () => {
    const { lintPreloadClaims } = require('./lint-skills.js');
    const skillDirs = new Set(['typescript', 'angular-conventions', 'ionic', 'angular-styling']);

    // the measured regression shape: body claims four, frontmatter carries one
    const lying = '---\nname: x\nskills:\n  - ionic\n---\n\n- `typescript`, `angular-conventions`, `ionic`, and `angular-styling` are preloaded in frontmatter - the source of truth, not recall.\n';
    const findings = lintPreloadClaims('x.md', lying, skillDirs);
    assert.strictEqual(findings.length, 3);
    assert.ok(findings.every(f => f.includes('preloaded in frontmatter')));
    assert.ok(findings.some(f => f.includes('`typescript`')));
    assert.ok(!findings.some(f => f.includes('`ionic`')), 'the declared skill is not flagged');

    // honest file: all named skills declared -> clean
    const honest = lying.replace('skills:\n  - ionic', 'skills:\n  - typescript\n  - angular-conventions\n  - ionic\n  - angular-styling');
    assert.deepStrictEqual(lintPreloadClaims('x.md', honest, skillDirs), []);

    // a non-skill backticked token on the claim line is ignored; no claim line -> clean
    const noClaim = '---\nname: x\nskills:\n  - ionic\n---\n\n- Load `typescript` before the first edit.\n';
    assert.deepStrictEqual(lintPreloadClaims('x.md', noClaim, skillDirs), []);
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
