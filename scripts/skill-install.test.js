'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'claude', 'claude-stack.sh');

// Invoke ONLY the skill-copy logic by sourcing the installer's function in a
// subshell with a stubbed environment, cloning from the LOCAL repo (no network).
function runSkillCopy(names) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, names.map(n => `skill ${n}`).join('\n') + '\n');
    // Drive the real installer's skill step in an isolated cwd, cloning the local repo.
    execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only'], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: ROOT, HOME: work },
    });
    return work;
}

test('install copies exactly the selected skills into .claude/skills', () => {
    const work = runSkillCopy(['csharp', 'typescript']);
    try
    {
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'csharp copied');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'typescript', 'SKILL.md')), 'typescript copied');
        assert.ok(!fs.existsSync(path.join(work, '.claude', 'skills', 'dotnet-grpc')), 'unselected skill not copied');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});
