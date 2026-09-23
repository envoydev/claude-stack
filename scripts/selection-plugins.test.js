'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSelection, pluginsFor, itemsOf } = require('./selection-plugins.js');
const { placement, CORE } = require('./plugin-placement.js');

const ROOT = path.join(__dirname, '..');
const place = placement();

function sel(lines)
{
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'selplug-')), 'selection.txt');
    fs.writeFileSync(f, lines.join('\n') + '\n');
    return f;
}

test('a selection file yields the plugins its picks live in, and the core is always one of them', () => {
    const picked = readSelection(sel(['skill dotnet-wpf', 'agent wpf-implementer', '# a comment', '']));
    const { plugins } = pluginsFor(picked);
    assert.ok(plugins.includes(CORE), 'the core carries the commands and the baseline skills');
    assert.ok(plugins.includes('claude-stack-wpf'), 'the stack the picks live in');
});

test('the set is closure-complete - a per-stack entry brings the shared groups under it', () => {
    const { plugins } = pluginsFor(readSelection(sel(['skill dotnet-wpf'])));
    for (const name of plugins)
        for (const dep of place.plugins[name].dependencies)
            assert.ok(plugins.includes(dep), `${name} depends on ${dep}, which the set leaves out`);
    assert.ok(plugins.includes('claude-stack-csharp'), 'wpf reaches the shared C# group');
});

test('an item no plugin carries is an EXTRA and stays on the copy route', () => {
    const { plugins, copy } = pluginsFor(readSelection(sel(['skill angular-material', 'agent related-project-analyzer'])));
    assert.deepStrictEqual(plugins, [CORE], 'an extra pulls in no stack plugin of its own');
    assert.deepStrictEqual(copy.skills, ['angular-material']);
    assert.deepStrictEqual(copy.agents, ['related-project-analyzer']);
});

// The whole point of the split: what the plugins carry plus what is copied must be exactly what was
// picked. A gap here is a skill that reaches no project at all.
test('plugins + extras cover every picked item, with nothing invented', () => {
    const skills = fs.readdirSync(path.join(ROOT, 'stack/skills')).filter(d => fs.existsSync(path.join(ROOT, 'stack/skills', d, 'SKILL.md')));
    const agents = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    const picked = { skills: new Set(skills), agents: new Set(agents) };
    const { plugins, copy } = pluginsFor(picked);
    const carried = itemsOf(plugins);
    const gotSkills = new Set([...carried.skills, ...copy.skills]);
    const gotAgents = new Set([...carried.agents, ...copy.agents]);
    assert.deepStrictEqual([...gotSkills].sort(), [...skills].sort());
    assert.deepStrictEqual([...gotAgents].sort(), [...agents].sort());
    assert.ok(copy.skills.length + copy.agents.length > 0, 'the extras are a real category, not an empty branch');
});

// `--installed-only` reads the plugins back, so the inverse direction has to round-trip: the items a
// picked set's plugins carry must re-pick exactly those plugins. Without it an update read a
// plugin-native install as 'nothing installed' and dropped every per-stack plugin it had.
test('itemsOf round-trips: the items of a plugin set re-select that same set', () => {
    for (const stack of ['claude-stack-wpf', 'claude-stack-angular-web', 'claude-stack-aspnet'])
    {
        if (!place.plugins[stack]) continue;
        const first = pluginsFor({ skills: new Set(place.plugins[stack].skills), agents: new Set(place.plugins[stack].agents) });
        const back = itemsOf(first.plugins);
        const again = pluginsFor({ skills: new Set(back.skills), agents: new Set(back.agents) });
        assert.ok(again.plugins.includes(stack), `${stack} did not survive the round trip`);
        assert.deepStrictEqual(again.copy, { skills: [], agents: [] }, `${stack}: a plugin's own items are never extras`);
    }
});

test('itemsOf ignores a name no placement knows, and accepts the @marketplace spelling', () => {
    const a = itemsOf(['claude-stack-wpf@claude-stack', 'claude-stack-hooks', 'not-a-plugin']);
    const b = itemsOf(['claude-stack-wpf']);
    assert.deepStrictEqual(a, b, 'the hooks entry and an unknown name carry no skills or agents');
});

test('readSelection takes only skill and agent lines, and strips a .md suffix', () => {
    const picked = readSelection(sel(['skill a', 'agent b.md', 'rule c', 'hook d', 'plugin e', 'mcp f', 'nonsense']));
    assert.deepStrictEqual([...picked.skills], ['a']);
    assert.deepStrictEqual([...picked.agents], ['b']);
});

test('a selection file that is not there is reported, never read as an empty pick', () => {
    assert.throws(() => readSelection(path.join(os.tmpdir(), 'no-such-selection-file.txt')), /cannot read/);
});
