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
    assert.ok(findings.every(f => f.includes('is preloaded but the frontmatter')));
    assert.ok(findings.some(f => f.includes('`typescript`')));
    assert.ok(!findings.some(f => f.includes('`ionic`')), 'the declared skill is not flagged');

    // honest file: all named skills declared -> clean
    const honest = lying.replace('skills:\n  - ionic', 'skills:\n  - typescript\n  - angular-conventions\n  - ionic\n  - angular-styling');
    assert.deepStrictEqual(lintPreloadClaims('x.md', honest, skillDirs), []);

    // a non-skill backticked token on the claim line is ignored; no claim line -> clean
    const noClaim = '---\nname: x\nskills:\n  - ionic\n---\n\n- Load `typescript` before the first edit.\n';
    assert.deepStrictEqual(lintPreloadClaims('x.md', noClaim, skillDirs), []);

    // shape A without 'in frontmatter' is still a claim; on-demand loads AFTER the keyword are not
    const bare = '---\nname: x\nskills:\n  - ionic\n---\n\n- `typescript` and `ionic` are preloaded - judge against them directly. Load `angular-styling` on demand.\n';
    const bareFindings = lintPreloadClaims('x.md', bare, skillDirs);
    assert.strictEqual(bareFindings.length, 1);
    assert.ok(bareFindings[0].includes('`typescript`'));

    // shape B ('the preloaded `x` skill') is a claim; namespaced frontmatter entries count as declared
    const shapeB = '---\nname: x\nskills:\n  - superpowers:ionic\n---\n\n- The method is the preloaded `ionic` skill. Also per the preloaded `typescript` hub.\n';
    const bFindings = lintPreloadClaims('x.md', shapeB, skillDirs);
    assert.strictEqual(bFindings.length, 1);
    assert.ok(bFindings[0].includes('`typescript`'));
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

test('optionalSkills is every skill no seed closure reaches', () => {
    const { optionalSkills } = require('./lint-skills.js');
    const recs = {
        always: { skills: ['project-solve-task'], agents: ['security-auditor'] },
        stacks: {
            aspnet: { skills: ['dotnet-architecture'], agents: ['aspnet-implementer'] },
        },
    };
    const graph = {
        agents: {
            'aspnet-implementer': { skills: ['csharp', 'dotnet-testing'] },
            'security-auditor': { skills: [] },
        },
        rules: {},
    };
    const dirs = new Set(['project-solve-task', 'dotnet-architecture', 'csharp', 'dotnet-testing', 'dotnet-architecture-tests', 'postgres']);
    const optional = optionalSkills(recs, graph, dirs);

    // seeded directly, or pulled through a seeded agent -> always installed
    for (const reached of ['project-solve-task', 'dotnet-architecture', 'csharp', 'dotnet-testing'])
    {
        assert.ok(!optional.has(reached), `${reached} is reachable from a seed`);
    }

    // evidence-gated / opt-in only -> an install can lack them
    assert.deepStrictEqual([...optional].sort(), ['dotnet-architecture-tests', 'postgres']);
});

test('absentSkillsFor is the cross-stack case: a skill missing where the citing artifact still ships', () => {
    const { seedClosures, hostStacks, absentSkillsFor } = require('./lint-skills.js');
    const recs = {
        always: { agents: ['security-auditor'], skills: ['docs-as-code'] },
        general: { skills: ['frontend'] },
        stacks: {
            aspnet: { agents: ['aspnet-implementer'] },
            'web-angular': { skills: ['angular-security'], agents: [] },
        },
    };
    const graph = { agents: { 'aspnet-implementer': { skills: ['csharp'] } }, rules: {} };
    const closures = seedClosures(recs, graph);
    const skills = new Set(['csharp', 'angular-security', 'docs-as-code', 'frontend']);

    // an ALWAYS agent ships into every stack, so anything stack-scoped is absent somewhere
    assert.deepStrictEqual([...hostStacks(closures, 'agents', 'security-auditor')].sort(), ['aspnet', 'web-angular']);
    const absent = absentSkillsFor(closures, 'agents', 'security-auditor', skills);
    assert.ok(absent.has('angular-security'), 'the measured shape: a cross-cutting seat naming an Angular skill');
    assert.ok(absent.has('csharp'), 'and the mirror case in the other direction');
    assert.ok(!absent.has('docs-as-code'), 'an always-on skill is present in every stack closure');
    assert.ok(absent.has('frontend'), "the opt-in `general` list seeds no stack, so it is never guaranteed");

    // a stack-scoped seat may name its own stack's skills freely
    const own = absentSkillsFor(closures, 'agents', 'aspnet-implementer', skills);
    assert.ok(!own.has('csharp'), 'its own stack ships csharp');
    assert.ok(own.has('angular-security'), 'but not another stack\'s');

    // an artifact no seed installs proves nothing - no findings rather than false ones
    assert.strictEqual(absentSkillsFor(closures, 'agents', 'not-seeded-anywhere', skills).size, 0);
});

test('lintOptionalCites flags a NAMED load of a skill that can be absent; a description passes', () => {
    const { lintOptionalCites } = require('./lint-skills.js');
    const optional = new Set(['dotnet-architecture-tests', 'angular-material']);

    // the measured regression: an unconditional 'add `x`' in a second sentence
    const bare = 'Load the router first. In .NET, add `dotnet-architecture-tests` when judging a boundary.\n';
    const flagged = lintOptionalCites('skills/x/SKILL.md', bare, optional);
    assert.strictEqual(flagged.length, 1);
    assert.match(flagged[0], /skills\/x\/SKILL\.md:1/);
    assert.match(flagged[0], /BY NAME/);

    // A GUARD PHRASE next to the name is no longer the remedy. It made the cite safe to skip,
    // but a project without that skill still learned nothing about what to do instead - and the
    // name is what invites the Skill call in the first place.
    assert.strictEqual(
        lintOptionalCites('f.md', 'Load `dotnet-architecture-tests` only when it is in your skill list.\n', optional).length, 1,
        'naming it and guarding it is still naming it');

    // The remedy: describe what the skill covers, so it is matched from the installed inventory
    // and a seat without it reads what to do anyway.
    assert.deepStrictEqual(
        lintOptionalCites('f.md', 'Load the skill covering architecture fitness tests, if your skill list has one.\n', optional), []);

    // a router-table row under a 'Load' column is a directive too
    const table = '| You are about to... | Load |\n|---|---|\n| build Material UI | `angular-material` |\n';
    assert.strictEqual(lintOptionalCites('f.md', table, optional).length, 1);

    // the header cell only has to END in the word 'load' ('Also load' measured unflagged in 11 rows);
    // 'Payload' is a different word and not a routing column
    const alsoLoad = '| Situation | Also load |\n|---|---|\n| Material UI | `angular-material` |\n';
    assert.strictEqual(lintOptionalCites('f.md', alsoLoad, optional).length, 1, 'an Also-load column is a Load column');
    const payload = '| Field | Payload |\n|---|---|\n| material | `angular-material` |\n';
    assert.deepStrictEqual(lintOptionalCites('f.md', payload, optional), [], 'Payload is not a load column');

    // the flow twins' spelling is a directive; a pointer ('see `x`') and domain prose ('Run migrations') are not
    assert.strictEqual(lintOptionalCites('f.md', 'Re-enter `dotnet-architecture-tests` after the plan changes.\n', optional).length, 1);
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Never bake secrets into the image (see `dotnet-architecture-tests`).\n', optional), []);
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Run migrations before the roll (mechanics in `dotnet-architecture-tests`).\n', optional), []);

    // ... and the one escape: a router hub's explicit Availability callout blankets its table
    const blanketed = '**Availability** - a row whose skill is not installed means the area is absent here.\n' + table;
    assert.deepStrictEqual(lintOptionalCites('f.md', blanketed, optional), []);
    const qualified = '**Availability - required vs optional.** A row not in your skill list means the area is absent.\n' + table;
    assert.deepStrictEqual(lintOptionalCites('f.md', qualified, optional), []);

    // a pointer is not a directive - no load verb in the token's own sentence
    assert.deepStrictEqual(
        lintOptionalCites('f.md', 'Boundary enforcement lives in `dotnet-architecture-tests`.\n', optional), []);

    // The blanket must be DELIBERATE. It used to fire on any line pairing a guard phrase with a
    // common word ('every', 'rows', 'below'), which silenced 13 of 263 files by accident.
    const accidental = 'Every seat reads the docs; a skill not installed is simply absent.\nLoad `angular-material` for Material work.\n';
    assert.strictEqual(lintOptionalCites('f.md', accidental, optional).length, 1);
});
