'use strict';
// THE SELECTION OF THE NODE SEED - Phase 7, T4b.
//
// The filter is what stands between a walk's answers and a project's files, and its safety property
// is an intersection: a name the manifest does not carry can never be installed, so a user-authored
// skill or rule is safe by construction. The adoption rules are the other half - what an UPDATE
// pulls in that the target never asked for, and what it deliberately does not.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sel = require('./install/selection.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-selection-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const LISTS = {
    skills: ['aspnet|project-aspnet', 'web|project-angular'],
    plugins: ['claude-hud@claude-plugins-official', 'security-guidance@claude-plugins-official'],
    mcps: ['serena|-- uvx serena', 'playwright|-- npx pw'],
    agents: ['ng-implementer.md::sonnet', 'security-auditor.md::opus'],
    rules: ['baseline-security.md::x', 'markdown-docs.md::y'],
    hooks: ['guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'docs-session.js::SessionStart'],
};

let seq = 0;
function target({ skills = [], agents = [], rules = [], hooks = [] } = {})
{
    const claudeDir = path.join(TMP, `t-${seq++}`, '.claude');
    for (const s of skills)
    {
        fs.mkdirSync(path.join(claudeDir, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'skills', s, 'SKILL.md'), '# s\n');
    }
    const put = (dir, names, ext) =>
    {
        if (!names.length) return;
        fs.mkdirSync(path.join(claudeDir, dir), { recursive: true });
        for (const n of names) fs.writeFileSync(path.join(claudeDir, dir, `${n}${ext}`), '# x\n');
    };
    put('agents', agents, '.md');
    put('rules', rules, '.md');
    put('hooks', hooks, '.js');
    return claudeDir;
}

// --- the filter -----------------------------------------------------------

test('filter: only the named entries survive, and the manifest is the ceiling', () =>
{
    // 'skill project-invented' is not a manifest name, so it can never be installed - which is what
    // keeps a project's own skill folder safe from this filter.
    const picked = sel.parseSelection('skill project-aspnet\nplugin claude-hud\nmcp serena\nagent ng-implementer\nrule baseline-security\nhook docs-session\nskill project-invented\n');
    const out = sel.applySelection(LISTS, picked);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
    assert.deepStrictEqual(out.plugins, ['claude-hud@claude-plugins-official']);
    assert.deepStrictEqual(out.mcps, ['serena|-- uvx serena']);
    assert.deepStrictEqual(out.agents, ['ng-implementer.md::sonnet']);
    assert.deepStrictEqual(out.rules, ['baseline-security.md::x']);
    assert.deepStrictEqual(out.hooks, ['docs-session.js::SessionStart']);
});

test('filter: a selection with NO hook lines keeps every hook', () =>
{
    // Hooks joined the walk later, so a file written before that layer must keep its
    // install-everything behaviour.
    const out = sel.applySelection(LISTS, sel.parseSelection('skill project-aspnet\n'));
    assert.deepStrictEqual(out.hooks, LISTS.hooks);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
});

test('filter: comments, blank lines and stray whitespace are not names', () =>
{
    const picked = sel.parseSelection('# a walk wrote this\n\n  skill project-aspnet  \n#skill project-angular\n');
    const out = sel.applySelection(LISTS, picked);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
});

test('filter: a hook wired twice is kept or dropped as ONE name', () =>
{
    const out = sel.applySelection(LISTS, sel.parseSelection('hook guard-read-whole-file\n'));
    assert.deepStrictEqual(out.hooks, ['guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash']);
});

test('plan: the dry run prints six lines and counts a twice-wired hook once', () =>
{
    const lines = sel.renderPlan(LISTS);
    assert.strictEqual(lines.length, 6);
    assert.strictEqual(lines[0], 'plan skills: project-aspnet project-angular');
    assert.strictEqual(lines[5], 'plan hooks: guard-read-whole-file docs-session');
    assert.strictEqual(sel.renderPlan({}).join('\n').split('\n')[0], 'plan skills:');
});

// --- deriving from the target --------------------------------------------

test('derive: skills, agents, rules and hooks are read off disk', () =>
{
    const dir = target({ skills: ['project-aspnet'], agents: ['ng-implementer'], rules: ['baseline-security'], hooks: ['docs-session'] });
    const lines = sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] });
    for (const want of ['skill project-aspnet', 'agent ng-implementer', 'rule baseline-security', 'hook docs-session'])
        assert.ok(lines.includes(want), `${want} missing from ${lines.join(', ')}`);
});

test('derive: generated project-owned files and the engine modules are NOT items', () =>
{
    // The captures rewrite baseline-project-* and project-code-style; docs.js / memory.js are
    // engines and hook-prelude.js the shared gate module - none of them is a hook.
    const dir = target({
        rules: ['baseline-security', 'baseline-project-agent-capabilities', 'project-code-style'],
        hooks: ['docs-session', 'docs', 'memory', 'hook-prelude'],
    });
    const lines = sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] });
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('rule ')), ['rule baseline-security']);
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('hook ')), ['hook docs-session']);
});

test('derive: a skill folder without a SKILL.md is not a skill', () =>
{
    const dir = target({ skills: ['project-aspnet'] });
    fs.mkdirSync(path.join(dir, 'skills', 'half-written'), { recursive: true });
    assert.deepStrictEqual(sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] }).filter((l) => l.startsWith('skill ')),
        ['skill project-aspnet']);
});

test('derive: the four playwright engines collapse back to the ONE manifest entry', () =>
{
    const lines = sel.deriveFromDisk({
        claudeDir: target({ skills: ['x'] }),
        mcpServers: ['serena', 'playwright-chrome', 'playwright-firefox', 'my-own'],
        knownPlugins: [],
    });
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('mcp ')), ['mcp serena', 'mcp playwright', 'mcp my-own']);
});

test('derive: only KNOWN plugins are taken from the listing, and an unreadable listing falls back', () =>
{
    const dir = target({ skills: ['x'] });
    const known = ['claude-hud@claude-plugins-official', 'security-guidance@claude-plugins-official'];
    const got = sel.deriveFromDisk({ claudeDir: dir, plugins: ['claude-hud@x', 'someone-elses@y'], knownPlugins: known });
    assert.deepStrictEqual(got.filter((l) => l.startsWith('plugin ')), ['plugin claude-hud']);
    // Nothing readable: the manifest set, which is safe because this path is update-only.
    const fallback = sel.deriveFromDisk({ claudeDir: dir, plugins: [], knownPlugins: known });
    assert.deepStrictEqual(fallback.filter((l) => l.startsWith('plugin ')), ['plugin claude-hud', 'plugin security-guidance']);
});

test('derive: the nothing-installed guard reads the FILE layers only', () =>
{
    // A machine-level plugin listing, or a shared .mcp.json, is no evidence that THIS target has an
    // install - a bare `any lines` test could never fail, because the plugin fallback always adds some.
    assert.strictEqual(sel.hasInstall(['plugin claude-hud', 'mcp serena']), false);
    assert.strictEqual(sel.hasInstall(['plugin claude-hud', 'rule baseline-security']), true);
});

// --- adoption -------------------------------------------------------------

test('adopt-hooks: every shipped hook reaches an install that HAS hooks', () =>
{
    // A hook the release added is invisible to a disk scan - measured: the commit gate reached zero
    // of three consuming projects.
    const logs = [];
    const out = sel.adoptHooks({
        lines: ['hook docs-session'],
        catalog: ['docs-session.js::SessionStart', 'guard-ungated-commit.js::Bash'],
        shippedBefore: [], log: (m) => logs.push(m),
    });
    assert.ok(out.includes('hook guard-ungated-commit'), out.join(', '));
    assert.ok(logs.some((m) => /adopting hook guard-ungated-commit/.test(m)), logs.join(' | '));
});

test('adopt-hooks: a hook the PREVIOUS stamp shipped and disk no longer has stays out', () =>
{
    const logs = [];
    const out = sel.adoptHooks({
        lines: ['hook docs-session'],
        catalog: ['docs-session.js::SessionStart', 'guard-answer-length.js::Stop'],
        shippedBefore: ['docs-session', 'guard-answer-length'], log: (m) => logs.push(m),
    });
    assert.ok(!out.includes('hook guard-answer-length'), 'a deliberate drop was re-adopted');
    assert.ok(logs.some((m) => /was dropped from this install/.test(m)), logs.join(' | '));
});

test('adopt-hooks: an install with NO hooks adopts none', () =>
{
    assert.deepStrictEqual(sel.adoptHooks({ lines: ['rule baseline-security'], catalog: ['docs-session.js::SessionStart'] }),
        ['rule baseline-security']);
});

test('adopt-always: the locked baseline is adopted with NO drop exception', () =>
{
    // A stamp that named the shipped list once read as a drop of everything, and the memory rule
    // never arrived - so the always set ignores the stamp entirely.
    const logs = [];
    const out = sel.adoptAlways({
        lines: ['rule markdown-docs', 'mcp serena'],
        always: { rules: ['baseline-security', 'baseline-memory'], mcps: ['serena', 'memory'] },
        log: (m) => logs.push(m),
    });
    assert.ok(out.includes('rule baseline-memory') && out.includes('mcp memory'), out.join(', '));
    assert.strictEqual(logs.filter((m) => /adopting/.test(m)).length, 3);
});

test('adopt-always: a layer this install does not carry at all stays absent', () =>
{
    const out = sel.adoptAlways({
        lines: ['rule markdown-docs'],
        always: { rules: ['baseline-security'], mcps: ['serena', 'memory'] },
    });
    assert.ok(!out.some((l) => l.startsWith('mcp ')), 'servers were adopted into an install that registers none');
});
