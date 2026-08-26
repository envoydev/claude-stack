// Behavior tests for stack/hooks/guard-answer-length.js - the short-answer contract's
// mechanization. A hook that fires on the wrong turn is worse than no hook (it trains the model
// to treat blocks as noise), so both directions are pinned: the wall-of-text block AND every
// exemption that must stay silent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-answer-length.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-length-'));

// A transcript is JSONL: one user turn, then the assistant answer under test.
function transcript(name, userText, assistantBlocks) {
    const p = path.join(TMP, `${name}.jsonl`);
    const rows = [];
    if (userText !== null)
        rows.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: userText }] } });
    rows.push({ type: 'assistant', message: { role: 'assistant', content: assistantBlocks } });
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}

function run(payload) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const WALL = 'This sentence exists only to burn prose characters against the cap. '.repeat(40); // ~2600 chars
const SHORT = 'Done - the build is green and the two failing tests now pass.';

test('UserPromptSubmit injects the answer budget as additionalContext', () => {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'what changed?' });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /3 sentences/, 'the budget names the sentence cap');
    assert.match(ctx, /900 characters/, 'the budget names the character cap');
    assert.match(ctx, /Code, tables and command output are exempt/, 'the exemption travels with the budget');
});

test('Stop blocks a wall-of-text answer when nothing asked for depth', () => {
    const p = transcript('wall', 'did the build pass?', [{ type: 'text', text: WALL }]);
    const r = run({ hook_event_name: 'Stop', transcript_path: p });
    assert.strictEqual(r.status, 2, 'over the hard cap with no depth request must block');
    assert.match(r.stderr, /characters of prose/, 'the block reports the measured length');
    assert.match(r.stderr, /do NOT\s*\n?append the short version/i, 'the block forbids appending a summary to the wall');
});

test('Stop allows a wall of text when the user asked for depth', () => {
    for (const ask of ['walk me through it', 'give me the full breakdown', 'explain in detail', 'write a plan for this']) {
        const p = transcript('depth', ask, [{ type: 'text', text: WALL }]);
        assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, `'${ask}' must lift the cap`);
    }
});

test('Stop allows a wall of text when the depth request is Ukrainian or Russian', () => {
    for (const ask of ['розкажи детально', 'опиши покроково', 'розпиши будь ласка', 'напиши план',
        'расскажи подробно', 'объясни развернуто']) {
        const p = transcript('depth-cyr', ask, [{ type: 'text', text: WALL }]);
        assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, `'${ask}' must lift the cap`);
    }
});

test('Stop still blocks a Ukrainian question that asked for no depth', () => {
    const p = transcript('short-cyr', 'що робить цей хук?', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2);
});

test("Stop still blocks on a bare 'explain' - an explanation is capped like any other answer", () => {
    const p = transcript('explain', 'explain what the hook does', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2);
});

test('Stop ignores code blocks, tables, quotes and inline spans when measuring', () => {
    const payload = [
        SHORT,
        '```js\n' + '// a long pasted file\nconst x = 1;\n'.repeat(60) + '```',
        '| col | col |\n|---|---|\n' + '| some fairly wide table cell | another wide cell |\n'.repeat(30),
        '> ' + 'quoted command output line\n> '.repeat(40),
        '`' + 'src/some/very/long/path/to/a/file.ts'.repeat(20) + '`',
    ].join('\n\n');
    const p = transcript('exempt', 'did the build pass?', [{ type: 'text', text: payload }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0,
        'a short answer carrying a big payload is not a wall of text');
});

test('Stop leaves a normal short answer alone', () => {
    const p = transcript('short', 'did the build pass?', [{ type: 'text', text: SHORT }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0);
});

test('Stop never loops: a continuation we caused passes untouched', () => {
    const p = transcript('loop', 'did the build pass?', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p, stop_hook_active: true }).status, 0);
});

test('Stop skips a turn that ended on a tool call', () => {
    const p = transcript('tool', 'did the build pass?', [
        { type: 'text', text: WALL },
        { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
    ]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0);
});

test('a tool_result user message is not mistaken for the user asking for depth', () => {
    const p = path.join(TMP, 'toolresult.jsonl');
    fs.writeFileSync(p, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'did it pass?' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'walk me through in detail' }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: WALL }] } }),
    ].join('\n') + '\n');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2,
        'depth words inside tool output must not lift the cap');
});

test('fails open on a missing transcript, unparseable input, and an unknown event', () => {
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: path.join(TMP, 'nope.jsonl') }).status, 0);
    assert.strictEqual(run({ hook_event_name: 'PreCompact' }).status, 0);
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
});
