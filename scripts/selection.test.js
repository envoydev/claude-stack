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
        ['guard-protected-force-push', 'guard-catastrophic-rm', 'guard-read-whole-file', 'guard-unapproved-dispatch', 'instrument-tool-usage'],
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
