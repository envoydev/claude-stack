'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseHookWirings, hooksBlock, HOOKS_PLUGIN } = require('./build-marketplace.js');

const wirings = parseHookWirings();
const block = hooksBlock(wirings);

test('the wirings come from the installer table, not a second list', () => {
    assert.ok(wirings.length >= 26, `expected the installer's whole HOOKS table, got ${wirings.length}`);
    const files = new Set(wirings.map(w => w.file));
    assert.strictEqual(files.size, 13, 'thirteen hooks, however many wirings they take');
    for (const w of wirings) assert.ok(/^[a-z-]+\.js$/.test(w.file), `odd file name: ${w.file}`);
});

test('a bare matcher is a PreToolUse wiring; an @ prefix names its own event', () => {
    const read = wirings.find(w => w.file === 'guard-read-whole-file.js' && w.matcher === 'Read');
    assert.ok(read, 'the Read wiring must survive');
    assert.strictEqual(read.event, 'PreToolUse');

    const stop = wirings.find(w => w.file === 'guard-stop-contract.js' && w.event === 'Stop');
    assert.ok(stop, 'the Stop wiring must survive');
    assert.strictEqual(stop.matcher, undefined, 'Stop takes no matcher');

    const compact = wirings.find(w => w.file === 'guard-fresh-session-start.js' && w.event === 'SessionStart');
    assert.ok(compact, 'the SessionStart wiring must survive');
    assert.strictEqual(compact.matcher, 'compact', 'an @Event:matcher form keeps its matcher');
});

test('the block is a valid plugin hooks object: exec form, timeout 10, plugin-root paths', () => {
    for (const [event, blocks] of Object.entries(block))
    {
        assert.ok(Array.isArray(blocks) && blocks.length, `${event} must hold at least one block`);
        for (const b of blocks)
            for (const h of b.hooks)
            {
                assert.strictEqual(h.type, 'command');
                assert.strictEqual(h.timeout, 10, `${event} wiring must carry timeout 10`);
                assert.match(h.command, /^\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\/[a-z-]+\.js$/,
                    `${event} command must resolve through the plugin root: ${h.command}`);
                assert.ok(!('args' in h) || Array.isArray(h.args));
            }
    }
});

test('every event the stack wires is present, and each keeps its own matchers', () => {
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop', 'SubagentStart', 'SessionStart', 'UserPromptSubmit'])
        assert.ok(block[event], `${event} must be wired`);
    const pre = block.PreToolUse.map(b => b.matcher);
    assert.ok(pre.includes('Read'), 'the Read matcher survives');
    assert.ok(pre.includes('Task|Agent'), 'the dispatch matcher survives');
    assert.ok(pre.includes('.*'), 'the instrumentation catch-all survives');
    const session = block.SessionStart.map(b => b.matcher);
    assert.ok(session.includes('compact'), 'the compact matcher survives');
    assert.ok(session.includes(undefined), 'and the bare SessionStart wiring beside it');
});

test('one matcher holding several hooks groups them, so the entry stays readable', () => {
    for (const [event, blocks] of Object.entries(block))
    {
        const seen = new Set();
        for (const b of blocks)
        {
            const key = String(b.matcher);
            assert.ok(!seen.has(key), `${event} repeats the matcher ${key} instead of grouping it`);
            seen.add(key);
        }
    }
});

test('the hooks plugin entry is the shared-root, inline shape spike S9 and Phase 2 proved', () => {
    assert.strictEqual(HOOKS_PLUGIN.name, 'claude-stack-hooks');
    assert.strictEqual(HOOKS_PLUGIN.source, './');
    assert.strictEqual(HOOKS_PLUGIN.strict, false);
    assert.ok(HOOKS_PLUGIN.hooks, 'the hooks are declared INLINE, so nothing sits at the shared root');
    assert.ok(!HOOKS_PLUGIN.skills && !HOOKS_PLUGIN.agents, 'it ships hooks only');
});
