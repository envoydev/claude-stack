'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SH = path.join(__dirname, 'os', 'claude-stack.sh');
const PS1 = path.join(__dirname, 'os', 'claude-stack.ps1');

function writeSelection(lines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
    const file = path.join(dir, 'selection.txt');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return { dir, file };
}

function planLine(out, category) {
    const m = out.match(new RegExp(`^plan ${category}:(.*)$`, 'm'));
    assert.ok(m, `missing 'plan ${category}:' line in output`);
    return m[1].trim().split(/\s+/).filter(Boolean);
}

function runShPlan(lines) {
    const { dir, file } = writeSelection(lines);
    try
    {
        return execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', file, '--print-plan'],
            { encoding: 'utf8' });
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('sh: selection filters each category to the listed names', () => {
    const out = runShPlan([
        'skill csharp', 'skill dotnet',
        'agent aspnet-implementer',
        'mcp serena',
        'plugin superpowers',
        'rule csharp-conventions',
    ]);
    const skills = planLine(out, 'skills');
    assert.ok(skills.includes('csharp'), 'csharp kept');
    assert.ok(skills.includes('dotnet'), 'dotnet kept');
    assert.ok(!skills.includes('angular-conventions'), 'unlisted skill dropped');
    assert.deepStrictEqual(planLine(out, 'agents'), ['aspnet-implementer']);
    assert.deepStrictEqual(planLine(out, 'mcps'), ['serena']);
    assert.deepStrictEqual(planLine(out, 'plugins'), ['superpowers']);
    assert.deepStrictEqual(planLine(out, 'rules'), ['csharp-conventions']);
});

test('sh: a category with no lines installs nothing for it', () => {
    const out = runShPlan(['skill csharp']);
    assert.deepStrictEqual(planLine(out, 'mcps'), []);
    assert.deepStrictEqual(planLine(out, 'agents'), []);
    assert.deepStrictEqual(planLine(out, 'plugins'), []);
    assert.deepStrictEqual(planLine(out, 'rules'), []);
});

test('sh: hook lines filter hooks; a selection without them keeps the install-all legacy behavior', () => {
    const filtered = runShPlan(['skill csharp', 'hook guard-catastrophic-rm']);
    assert.deepStrictEqual(planLine(filtered, 'hooks'), ['guard-catastrophic-rm'], 'only the selected hook survives');
    const legacy = runShPlan(['skill csharp']);
    assert.deepStrictEqual(planLine(legacy, 'hooks'),
        ['guard-protected-force-push', 'guard-catastrophic-rm', 'guard-read-whole-file', 'guard-unapproved-dispatch', 'guard-ungated-commit', 'guard-stop-contract', 'guard-fresh-session-start', 'guard-cross-project-write', 'guard-answer-length', 'instrument-tool-usage'],
        'a pre-hooks-layer selection still installs every hook');
});

test('sh: script parses with no syntax errors', () => {
    const r = spawnSync('bash', ['-n', SH], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
});

test('sh: filterable arrays are always expanded nounset-safe (empty category must not crash install)', () => {
    const src = fs.readFileSync(SH, 'utf8');
    // A negative lookbehind for the preceding "+" excludes the SAFE idiom ${arr[@]+"${arr[@]}"},
    // whose own quoted half would otherwise self-match this pattern and false-positive forever.
    // No trailing \}" here (deliberately) - a modifier form like "${MCPS[@]%%|*}" is bare/unsafe
    // too and must still be flagged; matching only the exact "${ARR[@]}" shape let that slip past.
    const bare = src.match(/(?<!\+)"\$\{(?:SKILLS|PLUGINS|MCPS|AGENTS|CLAUDE_RULES)\[@\]/g) || [];
    assert.deepStrictEqual(bare, [], `bare (non-nounset-safe) array expansions found: ${bare.join(', ')} - use \${arr[@]+"\${arr[@]}"} (or a guarded loop for modifier forms)`);
});

// The ps1 twin can only be exercised where PowerShell is installed. Run it if
// pwsh is present; otherwise log a visible SKIP so the gap is never silent.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
test('ps1: selection filters each category (pwsh required)', { skip: hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped' }, () => {
    const { dir, file } = writeSelection([
        'skill csharp', 'agent aspnet-implementer', 'mcp serena', 'plugin superpowers', 'rule csharp-conventions',
    ]);
    try
    {
        const out = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', file, '-PrintPlan'],
            { encoding: 'utf8' });
        assert.ok(planLine(out, 'skills').includes('csharp'));
        assert.deepStrictEqual(planLine(out, 'agents'), ['aspnet-implementer']);
        assert.deepStrictEqual(planLine(out, 'mcps'), ['serena']);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// --- --installed-only / -InstalledOnly (the update fast path's derive) ------
// A sandbox .claude tree exercises the whole contract: disk items kept,
// user-authored and generated files never enter the set, no-hooks-on-disk
// stays no hooks (the no-hook-lines special case must not fire), and the flag
// is update-only and exclusive with an explicit selection.

function makeInstallSandbox({ hooks = true } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'io-'));
    const c = p => fs.mkdirSync(path.join(root, p), { recursive: true });
    c('.claude/skills/csharp'); c('.claude/skills/my-own-skill');
    c('.claude/agents'); c('.claude/rules'); c('.claude/hooks');
    fs.writeFileSync(path.join(root, '.claude/skills/csharp/SKILL.md'), 'x');
    fs.writeFileSync(path.join(root, '.claude/skills/my-own-skill/SKILL.md'), 'x');
    fs.writeFileSync(path.join(root, '.claude/rules/csharp-conventions.md'), 'x');
    fs.writeFileSync(path.join(root, '.claude/rules/baseline-project-architecture.md'), 'x');  // generated - excluded
    if (hooks) fs.writeFileSync(path.join(root, '.claude/hooks/guard-catastrophic-rm.js'), 'x');
    fs.writeFileSync(path.join(root, '.claude/hooks/inject-code-style.js'), 'x');              // legacy generated - excluded
    fs.writeFileSync(path.join(root, '.mcp.json'), '{"mcpServers":{"serena":{}}}');
    return root;
}

function runInstalledOnly(root, extraArgs = [])
{
    return execFileSync('bash', [SH, 'update', '--scope', 'project', '--installed-only', '--print-plan', ...extraArgs],
        { encoding: 'utf8', cwd: root });
}

test('sh: --installed-only derives the plan from disk, excluding user-authored and generated files', () => {
    const root = makeInstallSandbox();
    try
    {
        const out = runInstalledOnly(root);
        const skills = planLine(out, 'skills');
        assert.ok(skills.includes('csharp'), 'installed stack skill kept');
        assert.ok(!skills.includes('my-own-skill'), 'user-authored skill never enters the set');
        assert.ok(planLine(out, 'rules').includes('csharp-conventions'));
        assert.ok(!planLine(out, 'rules').includes('baseline-project-architecture'), 'generated rule excluded');
        assert.deepStrictEqual(planLine(out, 'hooks'), ['guard-catastrophic-rm'], 'legacy generated hook excluded');
        assert.ok(planLine(out, 'mcps').includes('serena'), 'mcp read from .mcp.json');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sh: --installed-only with no hooks on disk installs no hooks (special case defeated)', () => {
    const root = makeInstallSandbox({ hooks: false });
    try
    {
        assert.deepStrictEqual(planLine(runInstalledOnly(root), 'hooks'), []);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sh: --installed-only rejects install action and an explicit --selection', () => {
    const r1 = spawnSync('bash', [SH, 'install', '--installed-only'], { encoding: 'utf8' });
    assert.notStrictEqual(r1.status, 0);
    assert.match(r1.stderr, /update flag/);
    const r2 = spawnSync('bash', [SH, 'update', '--installed-only', '--selection', 'x.txt'], { encoding: 'utf8' });
    assert.notStrictEqual(r2.status, 0);
    assert.match(r2.stderr, /mutually exclusive/);
});

test('ps1: -InstalledOnly derives the same plan as the sh twin (pwsh required)', { skip: hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped' }, () => {
    const root = makeInstallSandbox();
    try
    {
        const sh = runInstalledOnly(root);
        const ps = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'update', '-Scope', 'project', '-InstalledOnly', '-PrintPlan'],
            { encoding: 'utf8', cwd: root });
        for (const cat of ['skills', 'plugins', 'mcps', 'agents', 'rules', 'hooks'])
            assert.deepStrictEqual(planLine(ps, cat), planLine(sh, cat), `twin parity on ${cat}`);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
