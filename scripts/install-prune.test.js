'use strict';
// THE SEED'S PRUNES - what a run takes OFF a project, end to end against a recording CLI.
//
// Measured on the 1.0.0 release check, an update over a real 0.2.87 install: the copied hooks were
// unwired but all 13 files stayed; all 43 copied agents stayed, and a project agent outranks the
// plugin's own, so the 0.2.87 seats kept running; and none of the upstream-retired names the twin
// prunes (skills, agents, rules, hooks, the ponytail plugin) was touched, because the seed never read
// those lists. The twin did all three; these cases hold the seed to it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';
const COPY_ROUTE = { CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false', CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false', CLAUDE_STACK_MCPS_VIA_PLUGIN: 'false' };

function write(repo, rel, text = 'x\n')
{
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
}

// A 0.2.x copy-route project: the stack's shipped copies, upstream-retired leftovers, and the user's
// own files beside them, with the hooks wired the way 0.2.87 wrote them.
function oldLayout(repo)
{
    for (const rel of [
        '.claude/agents/aspnet-implementer.md', '.claude/agents/code-analyzer.md', '.claude/agents/my-own-seat.md',
        '.claude/hooks/guard-secret-value.js', '.claude/hooks/require-convention-skill.js', '.claude/hooks/my-own-hook.js',
        '.claude/skills/frontend/SKILL.md', '.claude/skills/my-own-skill/SKILL.md',
        '.claude/rules/house-baseline.md', '.claude/rules/my-own-rule.md',
    ]) write(repo, rel);
    const wire = (file) => ({ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"` });
    write(repo, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read',
        hooks: [wire('guard-secret-value.js'), wire('require-convention-skill.js'), wire('my-own-hook.js')] }] } }, null, 2));
}

// A SNAPSHOT, taken before the sandbox is removed: every path under .claude, and the hook wiring.
function after(repo)
{
    const files = new Set();
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const rel = path.relative(repo, path.join(dir, e.name)).split(path.sep).join('/');
            files.add(rel);
            if (e.isDirectory()) walk(path.join(dir, e.name));
        }
    };
    walk(path.join(repo, '.claude'));
    const wired = JSON.stringify(JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).hooks || {});
    return { has: (rel) => files.has(rel), wired, hooks: [...files].filter((f) => /^\.claude\/hooks\/[^/]+$/.test(f)).map((f) => f.slice(14)).sort() };
}

for (const action of ['update', 'install'])
{
    test(`seed ${action} on the plugin route: a copy a plugin now carries is pruned, the user's own files are not`, POSIX_ONLY, () =>
    {
        const { result: r } = seedRun(action, SELECTION, { prepare: oldLayout, inspect: after });
        assert.ok(!r.has('.claude/agents/aspnet-implementer.md'), 'a plugin-carried agent copy survived - it shadows the plugin seat');
        assert.ok(!r.has('.claude/hooks/guard-secret-value.js'), 'a plugin-carried hook copy survived');
        assert.ok(!r.wired.includes('guard-secret-value.js'), 'the pruned hook is still wired');
        assert.ok(r.has('.claude/agents/my-own-seat.md') && r.has('.claude/hooks/my-own-hook.js'), "the user's own seat or hook was pruned");
        assert.ok(r.wired.includes('my-own-hook.js'), "the user's own hook was unwired");
        assert.ok(r.has('.claude/skills/my-own-skill/SKILL.md') && r.has('.claude/rules/my-own-rule.md'), "the user's own skill or rule was pruned");
        assert.ok(r.hooks.includes('docs.js') && r.hooks.includes('memory.js'), `the engines must stay: ${r.hooks.join(' ')}`);
    });

    test(`seed ${action}: every upstream-retired name is pruned and unwired, on either route`, POSIX_ONLY, () =>
    {
        for (const env of [{}, COPY_ROUTE])
        {
            const { result: r } = seedRun(action, SELECTION, { env, prepare: oldLayout, inspect: after });
            const route = Object.keys(env).length ? 'copy route' : 'plugin route';
            assert.ok(!r.has('.claude/skills/frontend'), `${route}: a retired skill survived`);
            assert.ok(!r.has('.claude/agents/code-analyzer.md'), `${route}: a retired agent survived`);
            assert.ok(!r.has('.claude/rules/house-baseline.md'), `${route}: a retired rule survived - an always-on one costs every session`);
            assert.ok(!r.has('.claude/hooks/require-convention-skill.js'), `${route}: a retired hook file survived`);
            assert.ok(!r.wired.includes('require-convention-skill.js'), `${route}: a retired hook is still wired`);
        }
    });
}

test('seed update on the copy route: a shipped copy is the delivery, so it is never pruned', POSIX_ONLY, () =>
{
    const { result: r } = seedRun('update', SELECTION, { env: COPY_ROUTE, prepare: oldLayout, inspect: after });
    assert.ok(r.has('.claude/agents/aspnet-implementer.md'), 'the copy route pruned a shipped agent');
    assert.ok(r.has('.claude/hooks/guard-secret-value.js'), 'the copy route pruned a shipped hook');
});

test('seed update: a retired plugin still installed is uninstalled at its own scope', POSIX_ONLY, () =>
{
    const listing = JSON.stringify([{ id: 'ponytail@ponytail', version: '4.9.0', scope: 'user', enabled: true }]);
    const { calls } = seedRun('update', SELECTION, { plugins: listing });
    assert.ok(calls.includes('plugin uninstall ponytail --scope user -y'), calls.filter((c) => /uninstall|ponytail/.test(c)).join('\n') || 'no uninstall call');
});
