'use strict';

// analyze-usage.test.js - the analyzer's accounting invariants against a synthetic
// transcript: per-message usage dedup (fold-max), tool-result volume, per-skill
// attribution incl. cache-read, --from/--to windowing, and flag-before-target parsing.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'analyze-usage.js');

const line = (o) => JSON.stringify(o) + '\n';
const usage = (input, cc, cr, out) => ({
  input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out,
});

function writeFixture(dir) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    // msg m1, duplicated line with identical usage - must count ONCE
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(10, 100, 1000, 50), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x.cs' } }] } }) +
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:01.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(10, 100, 1000, 50), content: [] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:00:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'abcd'.repeat(100) }] } }) +
    // msg m2, attributed to a skill
    line({ type: 'assistant', timestamp: '2026-07-15T07:10:00.000Z', attributionSkill: 'csharp', message: { id: 'm2', model: 'claude-sonnet-5', usage: usage(5, 0, 2000, 30), content: [] } }) +
    // msg m3, outside the test window
    line({ type: 'assistant', timestamp: '2026-07-15T09:00:00.000Z', message: { id: 'm3', model: 'claude-sonnet-5', usage: usage(1, 0, 5000, 10), content: [] } }),
  );
  return file;
}

function run(args) {
  return JSON.parse(execFileSync('node', [SCRIPT, ...args, '--json'], { encoding: 'utf8' }));
}

test('full report: dedups per message.id, measures results, attributes skill cache-read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const { main } = run([file]);
  assert.strictEqual(main.total.msgs, 3);
  assert.strictEqual(main.total.output, 90);
  assert.strictEqual(main.total.cacheRead, 8000);
  assert.strictEqual(main.toolCalls.Read.calls, 1);
  assert.strictEqual(main.toolCalls.Read.resultChars, 400);
  // m3 carries no stamp: sticky carry-forward attributes it to the last active skill and
  // counts it separately as carried (the stamp drops at task-notifications mid-run - measured)
  assert.deepStrictEqual(main.skillAttribution.csharp, { msgs: 2, output: 40, cacheRead: 7000, carriedMsgs: 1, maxCarryRun: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('compaction pairs count once; guard denials bucket as hookBlocks, not errors; workflows/ nests are scanned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'Big.cs' } }] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Blocked: whole-file Read of Big.cs (300 lines) - locate the symbol first.' }] } }) +
    // one real compaction emits BOTH markers - must count once
    line({ type: 'system', timestamp: '2026-07-15T07:01:00.000Z', compactMetadata: { trigger: 'auto' } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:01:00.001Z', isCompactSummary: true, message: { content: 'summary' } }) +
    line({ type: 'assistant', timestamp: '2026-07-15T07:02:00.000Z', message: { id: 'm2', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'x.txt' } }] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:02:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'File does not exist.' }] } }),
  );
  const wfDir = path.join(dir, 'subagents', 'workflows', 'wf_1');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'agent-w1.jsonl'),
    line({ type: 'assistant', timestamp: '2026-07-15T07:03:00.000Z', message: { id: 'w1', model: 'claude-sonnet-5', usage: usage(1, 0, 50, 7), content: [] } }),
  );
  const { main, agents } = run([file]);
  assert.strictEqual(main.compactions, 1, 'dual-marker compaction counts once');
  assert.strictEqual(main.toolCalls.Read.hookBlocks, 1, 'guard denial bucketed');
  assert.strictEqual(main.toolCalls.Read.errors, 1, 'real error still counted');
  assert.strictEqual(agents.length, 1, 'nested workflow transcript found');
  assert.strictEqual(agents[0].meta.agentType, 'workflow-subagent');
  assert.strictEqual(agents[0].group, 'workflows/wf_1');
  assert.strictEqual(agents[0].stats.total.output, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--from/--to windows the accounting to the run inside a long session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const report = run([file, '--from', '2026-07-15T06:59:00Z', '--to', '2026-07-15T08:00:00Z']);
  assert.strictEqual(report.window.to, '2026-07-15T08:00:00Z');
  assert.strictEqual(report.main.total.msgs, 2);
  assert.strictEqual(report.main.total.output, 80);
  assert.strictEqual(report.main.total.cacheRead, 3000);
  assert.strictEqual(report.main.lastTs, '2026-07-15T07:10:00.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--report-md emits the machine-written skeleton with tables and fill-in sections', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.ok(md.startsWith('# Stack usage report - session `session`'));
  // machine-written numbers: deduped msgs and the skill attribution row
  assert.ok(md.includes('| main session | 16 | 100 | 8.0k | 90 | 3 |'), 'tokens table row present');
  assert.ok(md.includes('| csharp |  | 0 | ~0 | 2 (1 carried) | 40 | 7.0k |'), 'skills attribution row present (sticky carry labeled)');
  assert.ok(md.includes('| Read | 1 | ~100 | 0 |  |'), 'tools table row present');
  // judgment surface is fill-in only
  // Guard blocks is the FOURTH required fill: the no-ledger branch prints a question ('say which,
  // do not infer') that shipped unanswered in audited bundles because no section was marked.
  assert.ok(md.includes('## Guard blocks - FILL IN'));
  assert.ok(md.includes('## Waste analysis - FILL IN'));
  assert.ok(md.includes('## Protocol check - FILL IN'));
  assert.ok(md.includes('## Verdict - FILL IN'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a flag value before the target is not mistaken for the target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const { main } = run(['--to', '2026-07-15T08:00:00Z', file]);
  assert.strictEqual(main.total.msgs, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the audit's analyzer defects: each test pins a number a shipped report got wrong ---

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-')); }
function fixture(dir, records) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, records.map(line).join(''));
  return file;
}
const bash = (id, command) => ({
  type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z',
  message: { id: `m-${id}`, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
});
const result = (id, extra) => ({
  type: 'user', timestamp: '2026-07-15T07:00:01.000Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(extra || {}) }] },
});

test('hook-log join: the ledger cross-check counts calls in the window, on parsed epochs', () => {
  // Both sides are ISO strings. `firstTs - 250` on a string is NaN, so every comparison was false
  // and inWin was 0 for EVERY session carrying a ledger - the report printed '0% of tool calls are
  // inside the ledger window' plus the false 'wired mid-session' line the latency budget exists to
  // remove. Re-derived by hand across the audited corpus, those same sessions were 8/8, 10/10,
  // 12/12, 25/25, 50/51 and 65/66. Nothing referenced inWin or callPct in this file before.
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo one'), result('t1'), bash('t2', 'echo two'), result('t2')]);
  const ledger = path.join(dir, 'tools-usage.jsonl');
  // The ledger rows straddle the two calls, both of which sit at 07:00:00.000Z.
  fs.writeFileSync(ledger, [
    line({ ts: '2026-07-15T06:59:59.900Z', tool: 'Bash', detail: 'echo one' }),
    line({ ts: '2026-07-15T07:00:00.100Z', tool: 'Bash', detail: 'echo two' }),
  ].join(''));
  const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
  assert.ok(cov, 'the join reports coverage when a ledger is given');
  assert.strictEqual(cov.inWin, 2, 'both calls are inside the ledger window');
  assert.strictEqual(cov.callPct, 100, '... so call coverage is 100%, not 0%');
  assert.strictEqual(cov.tailCalls, 0, 'and nothing sits past the window - the string + number form concatenated and always said 0 here too');

  // A call genuinely outside the window still counts as outside: the fix is arithmetic, not a blanket pass.
  const dir2 = tmp();
  const file2 = fixture(dir2, [bash('t1', 'echo one'), result('t1')]);
  const ledger2 = path.join(dir2, 'tools-usage.jsonl');
  fs.writeFileSync(ledger2, line({ ts: '2026-07-15T09:00:00.000Z', tool: 'Bash', detail: 'much later' }));
  const cov2 = run([file2, '--hook-log', ledger2]).hookLog.coverage;
  assert.strictEqual(cov2.inWin, 0, 'a call two hours before the ledger opens is outside it');
  assert.strictEqual(cov2.callPct, 0, '... and reads as 0% for a real reason');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('generated-docs touches: a Windows Write target matches the docs prefix', () => {
  // `docsPrefixes` is spelled with forward slashes; a Windows run writes `C:\\...\\.claude\\docs\\`,
  // so every doc a Windows session wrote scored 0 writes (measured: five Write calls, three docs).
  const dir = tmp();
  const w = (id, file_path) => ({
    type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z',
    message: { id: `m-${id}`, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id, name: 'Write', input: { file_path, content: 'x' } }] },
  });
  const file = fixture(dir, [
    w('w1', 'C:\\Projects\\app\\.claude\\docs\\architecture\\ARCHITECTURE.md'), result('w1'),
    w('w2', '/home/u/app/.claude/docs/architecture/ARCHITECTURE.md'), result('w2'),
  ]);
  const { main } = run([file]);
  const touch = main.docTouches && main.docTouches['architecture/ARCHITECTURE.md'];
  assert.ok(touch, 'the doc is seen at all');
  assert.strictEqual(touch.writes, 2, 'both separators count - the Windows one was invisible before');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('user prompts: one typed turn counts once; echoes, stdout siblings and compact summaries do not', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'run the audit' } },
    // the same typed turn's sibling records share the parentUuid - they are not new prompts
    { type: 'user', timestamp: '2026-07-15T07:00:00.100Z', parentUuid: 'p1', origin: { kind: 'human' }, message: { content: '<local-command-stdout>done</local-command-stdout>' } },
    { type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p2', origin: { kind: 'slash_command' }, message: { content: '<command-name>/claude-stack:setup</command-name>' } },
    { type: 'user', timestamp: '2026-07-15T07:02:00.000Z', parentUuid: 'p3', isCompactSummary: true, message: { content: 'summary' } },
    // no origin at all: the exclusion list is the fallback
    { type: 'user', timestamp: '2026-07-15T07:03:00.000Z', parentUuid: 'p4', message: { content: '<task-notification>agent done</task-notification>' } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.userPrompts, 1, 'prompt count was inflated up to 500% by echoes and siblings');
  assert.strictEqual(main.commandInvocations['claude-stack:setup'], 1, 'the slash command is still stamped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('git acts: a quoted or heredoc mention is prose, a denied commit never ran, a real one counts', () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('q1', 'echo "git commit -m x" >> notes.txt'),
    result('q1'),
    bash('q2', "cat <<'EOF' > plan.md\ngit commit -m y\ngh pr merge 42\nEOF"),
    result('q2'),
    bash('q3', 'git add -A && git commit -m "the real one"'),
    result('q3'),
    bash('q4', 'git commit -m "denied"'),
    result('q4', { is_error: true, content: 'Blocked: no COMMIT-GATE receipt. Do NOT retry this command yet.' }),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.gitCommits, 1, 'quoted, heredoc and denied commits must not count');
  assert.strictEqual(main.prMerges, 0, 'a heredoc gh pr merge is documentation');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doc touches: assignments and globs open no row, rm clears, a heredoc mention is not a write', () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('d1', 'D=.claude/docs/architecture/ARCHITECTURE.md'),
    result('d1'),
    bash('d2', 'cat .claude/docs/architecture/ARCHITECTURE.md'),
    result('d2'),
    bash('d3', 'rm -f .claude/docs/flow/COMMIT-GATE.md'),
    result('d3'),
    bash('d4', "cat <<'EOF' > /dev/null\nsee .claude/docs/architecture/ASSESSMENT.md\nEOF"),
    result('d4'),
    bash('d5', 'ls .claude/docs/*.md; head -5 .claude/docs/PROJECT-CODE-STYLE.md.'),
    result('d5'),
  ]);
  const { main } = run([file]);
  const docs = main.docTouches;
  assert.strictEqual(docs['architecture/ARCHITECTURE.md'].bashReads, 1, 'the cat is the only read; the binding is neither');
  assert.strictEqual(docs['architecture/ARCHITECTURE.md'].bashWrites, undefined);
  assert.strictEqual(docs['flow/COMMIT-GATE.md'].cleared, 1, 'an rm clears a receipt, it does not write one');
  assert.strictEqual(docs['flow/COMMIT-GATE.md'].bashWrites, undefined);
  assert.ok(!('architecture/ASSESSMENT.md' in docs), 'a heredoc body is data, not doc I/O');
  assert.ok(!Object.keys(docs).some((k) => k.includes('*')), 'a glob names no one document');
  assert.strictEqual(docs['PROJECT-CODE-STYLE.md'].bashReads, 1, 'trailing punctuation is not part of the name');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('peak and floor context, and one row per compaction with its dropped tokens', () => {
  const dir = tmp();
  const msg = (id, ts, cr) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage: usage(0, 0, cr, 1), content: [] } });
  const file = fixture(dir, [
    msg('a1', '2026-07-15T07:00:00.000Z', 60000),
    msg('a2', '2026-07-15T07:10:00.000Z', 390000),
    { type: 'system', timestamp: '2026-07-15T07:15:00.000Z', compactMetadata: { trigger: 'auto', preTokens: 390000, postTokens: 12000, durationMs: 122000 } },
    { type: 'user', timestamp: '2026-07-15T07:15:00.100Z', isCompactSummary: true, message: { content: 'summary' } },
    msg('a3', '2026-07-15T07:20:00.000Z', 12000),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.peakCtx, 390000, 'reports that quoted the LAST context understated the peak by 17-43%');
  assert.strictEqual(main.peakCtxAt, '2026-07-15T07:10:00.000Z');
  assert.strictEqual(main.floorCtx, 12000, 'the cold floor is the standing inventory');
  assert.strictEqual(main.compactions, 1);
  assert.deepStrictEqual(main.compactionEvents, [{
    ts: '2026-07-15T07:15:00.000Z', pre: 390000, post: 12000, dropped: 378000, durationMs: 122000, trigger: 'auto',
  }], 'the dropped tokens and the wall clock were read and never printed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cost-state carries the thinking tokens and the model id the transcript strips', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'a1', model: 'claude-opus-5', usage: usage(1, 0, 100, 5), content: [] } },
    { type: 'cost-state', timestamp: '2026-07-15T07:05:00.000Z', totalCostUSD: 4.5, modelUsage: { 'claude-opus-5[1m]': { thinkingTokens: 1000 } } },
    // cumulative and written more than once - the largest wins
    { type: 'cost-state', timestamp: '2026-07-15T07:09:00.000Z', totalCostUSD: 10.42, modelUsage: { 'claude-opus-5[1m]': { thinkingTokens: 2691 }, 'claude-haiku-4-5-20251001': { thinkingTokens: 0 } } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.thinkingTokens, 2691, 'billed thinking is attributable to no message and was never printed');
  assert.deepStrictEqual(main.modelIdsFull, ['claude-opus-5[1m]', 'claude-haiku-4-5-20251001'], 'only cost-state keeps the [1m] suffix the fresh-session threshold keys off');
  assert.strictEqual(main.totalCostUSD, 10.42);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('denials: a Stop-hook string, a colon-less Blocked, and a user DECLINE are three different things', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', isMeta: true, message: { content: 'Stop hook feedback:\n- ["/p/.claude/hooks/guard-stop-contract.js"]: Blocked: the turn ends on a question.' } },
    bash('b1', 'git push origin develop'),
    // the JSON permission-decision route: no colon after Blocked, and no hooks bracket at all
    result('b1', { is_error: true, content: 'Bash operation blocked by hook. Blocked because no PUSH-GATE receipt. Do NOT retry this command yet.' }),
    { type: 'assistant', timestamp: '2026-07-15T07:02:00.000Z', message: { id: 'm-a1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id: 'a1', name: 'AskUserQuestion', input: {} }] } },
    result('a1', { is_error: true, content: "The user doesn't want to proceed with this tool use." }),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.stopHookBlocks, 1, 'a Stop denial is meta user TEXT and was structurally invisible');
  assert.strictEqual(main.toolCalls.Bash.hookBlocks, 1, 'the colon is not part of the denial contract');
  assert.strictEqual(main.toolCalls.Bash.errors, 0, 'a gate working is not a tool failure');
  assert.strictEqual(main.toolCalls.AskUserQuestion.declines, 1, 'a decline is the user answering, not an error');
  assert.strictEqual(main.toolCalls.AskUserQuestion.errors, 0);
  assert.deepStrictEqual(main.denialsByHook, { 'guard-stop-contract.js': 1, '(unattributed)': 1 }, 'the bracket attributes; its absence still counts');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an attachment and a post-compaction cache-write both reach the spike accumulator', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'a1', model: 'claude-sonnet-5', usage: usage(0, 0, 1000, 1), content: [] } },
    { type: 'user', timestamp: '2026-07-15T07:00:30.000Z', origin: { kind: 'human' }, attachments: [{ type: 'edited_text_file', content: 'x'.repeat(4000) }], message: { content: 'here it is' } },
    { type: 'assistant', timestamp: '2026-07-15T07:01:00.000Z', message: { id: 'a2', model: 'claude-sonnet-5', usage: usage(0, 0, 51000, 1), content: [] } },
    // after a reset the context DROPS, so the re-cache has a negative delta and was invisible
    { type: 'assistant', timestamp: '2026-07-15T07:10:00.000Z', message: { id: 'a3', model: 'claude-sonnet-5', usage: usage(0, 40000, 0, 1), content: [] } },
  ]);
  const { main } = run([file]);
  const att = main.spikes.find((sp) => sp.ts === '2026-07-15T07:01:00.000Z');
  assert.ok(att && /attachment:edited_text_file/.test(att.causes || ''), 'the largest spike printed as (prompt/attachment only)');
  const cw = main.spikes.find((sp) => sp.kind === 'cache-write');
  assert.ok(cw && cw.delta === 40000, 'a post-compaction re-cache is a cost class of its own');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--hook-blocks reaches --json and the markdown report, with the false-positive caveat', () => {
  const dir = tmp();
  const file = writeFixture(dir);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  // named for the SESSION, which is how the guards write it - a directory is narrowed to the
  // analyzed session's own file, so a neighbour's rows can never land in this tally
  fs.writeFileSync(path.join(blocks, 'session.jsonl'),
    line({ ts: '2026-07-15T07:00:00.000Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'whole-file Read of Big.cs' }) +
    line({ ts: '2026-07-15T07:05:00.000Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Bash', reason: 'cat of Big.cs' }),
  );
  const report = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
  assert.strictEqual(report.hookBlocks.rows, 2);
  assert.strictEqual(report.hookBlocks.byHook['guard-read-whole-file.js'].blocks, 2);
  const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
  assert.ok(md.includes('guard-read-whole-file.js'), 'the ledger was dropped from --report-md entirely');
  assert.ok(/false positive/i.test(md), 'a denial may be a false positive - the old gloss scored every block as a success');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The block detector matched 'Blocked' / 'Do NOT retry' bare, and those are the HARNESS's words
// too. Measured over the 489-transcript audit corpus: 90 real stack blocks (every one carrying the
// PreToolUse guard bracket) against 11 auto-mode-classifier denials, 3 foreground-`sleep` blocks
// and 2 AskUserQuestion schema failures - 16 events charged to guards that never ran, one of them
// surfacing as a phantom `denialsByHook: {"(unattributed)": 1}` in a shipped report.
test('harness denials never count as stack hook blocks, and stay visible as their own number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    const call = (id, name) => ({ type: 'tool_use', id, name, input: {} });
    const result = (id, content, extra = {}) => line({
        type: 'user', timestamp: '2026-07-15T07:00:01.000Z', ...extra,
        message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content }] },
    });
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [call('t1', 'Read'), call('t2', 'Bash'), call('t3', 'Bash'), call('t4', 'AskUserQuestion'), call('t5', 'Write')] } }) +
        // a real one: the PreToolUse bracket is how all 90 corpus blocks arrive
        result('t1', 'PreToolUse:Read hook error: [node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-read-whole-file.js"]: Blocked: whole-file Read of Big.cs (300 lines).') +
        // the auto-mode classifier - carries its own denial kind AND says so in the text
        result('t2', 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier.', { toolDenialKind: 'automode-blocked' }) +
        // the Bash tool's own foreground-sleep block; no stack hook blocks sleep
        result('t3', '<tool_use_error>Blocked: sleep 45 followed by: tail -20 out.log. To wait for a condition, use Monitor.</tool_use_error>') +
        // a tool-schema failure whose own text contains 'Do not retry this call'
        result('t4', '<tool_use_error>InputValidationError: questions.0.options too_small. Do not retry this call and do not invent a filler second option.</tool_use_error>') +
        // the user's own no - already a decline, and it reads as neither
        result('t5', "The user doesn't want to proceed with this tool use.", { toolDenialKind: 'user-rejected' }),
    );
    const { main } = run([file]);
    assert.strictEqual(main.toolCalls.Read.hookBlocks, 1, 'the real guard denial still counts');
    assert.strictEqual(main.toolCalls.Bash.hookBlocks || 0, 0, 'classifier and sleep blocks are not guard denials');
    assert.strictEqual(main.toolCalls.AskUserQuestion.hookBlocks || 0, 0, 'a schema failure is not a guard denial');
    assert.deepStrictEqual(main.denialsByHook, { 'guard-read-whole-file.js': 1 }, 'no phantom (unattributed) row');
    assert.strictEqual(main.harnessDenials, 3, "the three that read as a block are counted as the harness's");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- the ledger join --------------------------------------------------------------------------
// `hookLog.firstTs - HOOK_LATENCY_MS` on an ISO STRING is NaN, and every `>=` against NaN is
// false, so `inWin` was 0 for every session that had a ledger at all: 107 of the 136 cross-check
// lines in the audit corpus's shipped reports read '0% of tool calls are inside the ledger window'
// while the true coverage of those same sessions ran 8/8, 10/10, 25/25, 50/51, 65/66. Nothing could
// pin it because the function was unreachable - hence the export.
const { hookJoinStats } = require('./analyze-usage.js');

test('hook-ledger join: coverage is computed on parsed epochs, and the latency budget is the measured one', () => {
    const at = (ms) => new Date(Date.parse('2026-07-15T07:00:00.000Z') + ms).toISOString();
    // 8 calls, all inside the ledger's own span; the last one lands 400ms after the final ledger
    // row - inside the measured hook latency (183-497ms), so it is coverage, not a tail.
    const main = {
        file: 'x.jsonl', firstTs: at(0), lastTs: at(10000), clearTs: null,
        toolCallTs: [at(0), at(1000), at(2000), at(3000), at(4000), at(5000), at(6000), at(6400)],
    };
    const hookLog = { rows: 8, firstTs: at(0), lastTs: at(6000) };
    const j = hookJoinStats(main, [], hookLog, { Read: { calls: 8, resultChars: 0, errors: 0, hookBlocks: 0 } });
    assert.strictEqual(j.coverage.inWin, 8, 'every in-window call counts - this was 0 for every session');
    assert.strictEqual(j.coverage.callPct, 100);
    assert.strictEqual(j.coverage.tailCalls, 0, 'a call inside the latency budget is not a tail');
    assert.strictEqual(j.coverage.outside, 0);

    // A call well past the budget IS a tail, and must still be reported as one.
    const late = { ...main, toolCallTs: [...main.toolCallTs, at(20000)], lastTs: at(20000) };
    const j2 = hookJoinStats(late, [], hookLog, { Read: { calls: 9, resultChars: 0, errors: 0, hookBlocks: 0 } });
    assert.strictEqual(j2.coverage.tailCalls, 1, 'a genuinely late call is a tail');
    assert.strictEqual(j2.coverage.inWin, 8);
});

// A DIRECTORY of hook-block ledgers is the PROJECT's shared collection, one file per session.
// Reading all of it charged one session with eight sessions' blocks (measured: 28 reported against
// the session's own 1, which is also what its transcript's hook-blk column says).
test('hook-block ledger: a directory is narrowed to the analyzed session, never merged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const blocks = path.join(dir, 'hook-blocks');
    fs.mkdirSync(blocks);
    const row = (hook) => JSON.stringify({ ts: '2026-07-15T07:00:00.000Z', hook, event: 'PreToolUse', tool: 'Read', reason: 'Blocked: x' }) + '\n';
    fs.writeFileSync(path.join(blocks, 'mine.jsonl'), row('guard-read-whole-file.js'));
    fs.writeFileSync(path.join(blocks, 'someone-else.jsonl'), row('guard-secret-value.js').repeat(9));
    const file = path.join(dir, 'mine.jsonl');
    fs.writeFileSync(file, line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [] } }));

    const { hookBlocks } = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
    assert.strictEqual(hookBlocks.rows, 1, "only this session's ledger is read");
    assert.deepStrictEqual(Object.keys(hookBlocks.byHook), ['guard-read-whole-file.js']);

    // The file may still be passed directly - that bypasses the narrowing entirely.
    const direct = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', path.join(blocks, 'someone-else.jsonl'), '--json'], { encoding: 'utf8' }));
    assert.strictEqual(direct.hookBlocks.rows, 9, 'an explicit file is read as given');
    fs.rmSync(dir, { recursive: true, force: true });
});

// The generated-docs table read one hardcoded spelling on each route: `/.claude/docs/` with
// forward slashes for Read/Write (blank for every Windows project - 4 of the 9 audited) and the
// literal `.claude/docs/` for Bash (so `--docs-root` fixed only half the table).
test('generated docs: both routes honour --docs-root, and a Windows path is not invisible', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: "cat > docs/architecture/ARCHITECTURE.md <<'EOF'\nx\nEOF" } },
            { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'C:\\proj\\docs\\architecture\\ASSESSMENT.md' } },
        ] } }) +
        line({ type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }) +
        line({ type: 'user', timestamp: '2026-07-15T07:00:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }));

    const { main } = run([file, '--docs-root', 'docs']);
    assert.strictEqual(main.docTouches['architecture/ARCHITECTURE.md'].bashWrites, 1, 'the Bash route sees the remapped root');
    assert.strictEqual(main.docTouches['architecture/ASSESSMENT.md'].writes, 1, 'a backslash path is the same document');
    fs.rmSync(dir, { recursive: true, force: true });
});

// The exclusion list is only as good as its enumeration: <local-command-caveat> appears 117 times
// in the audit corpus and <fork-boilerplate> once, and each one manufactured a free-text user turn -
// which is exactly what an unheld-stop candidate is built from.
test('user prompts: every harness-injected wrapper is excluded, not just the ones first thought of', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    const userText = (txt, ts, uuid) => line({ type: 'user', uuid, timestamp: ts, message: { content: [{ type: 'text', text: txt }] } });
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }) +
        userText('<local-command-caveat>the command output is shown below</local-command-caveat>', '2026-07-15T07:00:01.000Z', 'u1') +
        userText('<fork-boilerplate>a fork was started</fork-boilerplate>', '2026-07-15T07:00:02.000Z', 'u2') +
        userText('now fix the parser', '2026-07-15T07:00:03.000Z', 'u3'));
    const { main } = run([file]);
    assert.strictEqual(main.userPrompts, 1, 'only the typed turn is a prompt');
    fs.rmSync(dir, { recursive: true, force: true });
});

// Four report defects the audit filed against the same table set: a companion skill's row read as
// a run that cost nothing, a denial the bracket could not name left as a phantom guard, result
// SIZES with no call beside them, and one reason per hook standing in for several causes.
test('report joins: a folded companion, an unattributed denial, the biggest results and every block reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const blocks = path.join(dir, 'hook-blocks');
    fs.mkdirSync(blocks);
    const file = path.join(dir, 'sess.jsonl');
    const at = (i) => `2026-07-15T07:${String(i).padStart(2, '0')}:00.000Z`;
    let body = '';
    // two Skill calls in one turn: the second reads as an in-protocol companion load
    body += line({ type: 'assistant', timestamp: at(1), message: { id: 'm1', model: 'claude-opus-5', usage: usage(1, 0, 900, 20), content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'project-solve-task' } }] } });
    body += line({ type: 'assistant', timestamp: at(2), attributionSkill: 'project-solve-task', message: { id: 'm2', model: 'claude-opus-5', usage: usage(1, 0, 1000, 20), content: [{ type: 'tool_use', id: 's2', name: 'Skill', input: { skill: 'create-ticket' } }] } });
    body += line({ type: 'assistant', timestamp: at(3), attributionSkill: 'project-solve-task', message: { id: 'm3', model: 'claude-opus-5', usage: usage(1, 0, 1100, 20), content: [] } });
    // a big Bash result with its own description, and a failing one 30 minutes earlier in the day
    body += line({ type: 'assistant', timestamp: at(4), message: { id: 'm4', model: 'claude-opus-5', usage: usage(1, 0, 1200, 20), content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'cat meta/migrations.json', description: 'read the migrations catalog' } }] } });
    body += line({ type: 'user', timestamp: at(5), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'x'.repeat(5180) }] } });
    body += line({ type: 'assistant', timestamp: at(6), message: { id: 'm5', model: 'claude-opus-5', usage: usage(1, 0, 1300, 20), content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'npm test', description: 'run the suite' } }] } });
    body += line({ type: 'user', timestamp: at(7), message: { content: [{ type: 'tool_result', tool_use_id: 'b2', content: 'boom', is_error: true }] } });
    // a Stop-hook denial with NO bracket - the JSON permission route the report called a phantom
    body += line({ type: 'user', isMeta: true, timestamp: at(8), message: { role: 'user', content: 'Stop hook feedback:\nBlocked: this turn ends on a decision-shaped question in prose.' } });
    fs.writeFileSync(file, body);
    fs.writeFileSync(path.join(blocks, 'sess.jsonl'),
        JSON.stringify({ ts: '2026-07-15T07:08:00.300Z', hook: 'guard-stop-contract.js', event: 'Stop', tool: '', reason: 'Blocked: decision-shaped question', detail: { branch: 'prose-ask', matched: 'your call' } }) + '\n'
        + JSON.stringify({ ts: at(9), hook: 'guard-secret-value.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: Read of /a/settings.json' }) + '\n'
        + JSON.stringify({ ts: at(10), hook: 'guard-secret-value.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: Read of /b/.env' }) + '\n');

    const { main, hookBlocks } = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
    // the companion's cost is charged to its parent, and the terminal row says so instead of 0
    assert.strictEqual(main.companionOf['create-ticket'], 'project-solve-task', 'the second Skill call in one turn is a companion load');
    const text = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
    assert.match(text, /create-ticket\s+1\s+~\d+\s+folded -> project-solve-task/, 'the companion row names where its cost went, never a bare 0');
    // the unattributed denial is joined to the ledger row 300ms away
    assert.match(text, /joined by ledger timestamp \(within 300ms\): guard-stop-contract\.js×1/, 'the phantom guard becomes the one that actually fired');
    // the biggest results carry the call's own label
    assert.match(text, /Bash read the migrations catalog/, 'a result size is printed beside what the call asked for');
    // errors carry their timestamps, so a phase cannot be blamed for another phase's failures
    assert.match(text, /errors, by WHEN they landed/, 'the errors get a when');
    assert.match(text, /07:07:00/, '... naming each one');
    // one row per DISTINCT reason, not one per hook
    const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
    assert.match(md, /\| `guard-secret-value\.js` \| 1 \| PreToolUse \/ Read \| Blocked: Read of \/a\/settings\.json \|/, 'the first file gets its own row');
    assert.match(md, /\| `guard-secret-value\.js` \| 1 \| PreToolUse \/ Read \| Blocked: Read of \/b\/\.env \|/, 'and so does the second - two files are two causes');
    assert.match(md, /\[prose-ask\]/, "the guard's own branch tag rides along with the reason");
    assert.strictEqual(hookBlocks.rows, 3);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the window tier names its source, and an abandoned session says so', () => {
    const dir = tmp();
    const file = path.join(dir, 'sess.jsonl');
    const at = (i) => `2026-07-16T09:${String(i).padStart(2, '0')}:00.000Z`;
    let body = '';
    // the session's own reminder carries the suffix; cost-state's billing key does NOT
    body += line({ type: 'user', timestamp: at(1), message: { role: 'user', content: 'You are powered by the model named Opus 5. The exact model ID is claude-opus-5[1m].' } });
    body += line({ type: 'assistant', timestamp: at(2), message: { id: 'm1', model: 'claude-opus-5', usage: usage(1, 0, 900, 20), content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls', description: 'list' } }] } });
    body += line({ type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } });
    body += line({ type: 'cost-state', timestamp: at(4), modelUsage: { 'claude-opus-5': { thinkingTokens: 10 } }, totalCostUSD: 0.5 });
    // the last row in the file is the interrupt marker: the run was abandoned, not closed
    body += line({ type: 'user', timestamp: at(5), message: { role: 'user', content: '[Request interrupted by user for tool use]' } });
    fs.writeFileSync(file, body);

    const text = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
    assert.match(text, /model \(with window suffix\) claude-opus-5\[1m\] \(the session's own model reminder\) - cost-state says claude-opus-5/,
        'the reminder answers and the disagreement is printed, never silently resolved');
    assert.match(text, /user interrupts 1 - the session ENDS on one/, 'a session ending on an interrupt is reported as abandoned');
    const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
    assert.match(md, /\*\*Model \(with window suffix\)\*\* claude-opus-5\[1m\]/, 'the markdown report carries the same source line');
    assert.match(md, /\*\*Interrupts\*\* 1 - the session ENDS on one/, '... and the same interrupt line');
    fs.rmSync(dir, { recursive: true, force: true });
});

// A FORK's transcript opens as a copy of its parent's rows, each still carrying the parent's id
// under `session_id` (the camel-case `sessionId` is rewritten to the fork's own): two forks of one conversation shared 90-92 assistant ids with their parent and the
// rollup counted that run three times; the dedupe was done by hand (measured).
test('fork prefix: rows carrying another session id are counted apart, and the ledger join runs over the tail only', () => {
  const dir = tmp();
  const own = '22222222-2222-4222-8222-222222222222';
  const parent = '11111111-1111-4111-8111-111111111111';
  const file = path.join(dir, own + '.jsonl');
  const parentCall = bash('t1', 'echo parent');
  parentCall.message.usage = usage(1, 0, 5000, 1);
  const ownCall = bash('t2', 'echo own');
  ownCall.timestamp = '2026-07-15T07:10:00.000Z';
  fs.writeFileSync(file, [
    line({ ...parentCall, sessionId: own, session_id: parent }),
    line({ ...result('t1'), sessionId: own, session_id: parent }),
    line({ ...ownCall, sessionId: own, session_id: own }),
    line({ ...result('t2'), sessionId: own, session_id: own, timestamp: '2026-07-15T07:10:01.000Z' }),
  ].join(''));
  const ledger = path.join(dir, 'tools-usage.jsonl');
  fs.writeFileSync(ledger, line({ ts: '2026-07-15T07:10:00.100Z', tool: 'Bash', detail: 'echo own' }));
  const out = run([file, '--hook-log', ledger]);
  assert.deepStrictEqual(out.main.forkPrefix, { rows: 2, msgs: 1, cacheRead: 5000, cacheCreate: 0, output: 1, toolCalls: 1, sessionIds: [parent] });
  assert.strictEqual(out.main.total.msgs, 2, 'the totals still count the whole file');
  assert.strictEqual(out.main.total.cacheRead, 5010);
  const cov = out.hookLog.coverage;
  assert.strictEqual(cov.calls, 1, 'the join sees the tail only');
  assert.strictEqual(cov.inWin, 1);
  assert.strictEqual(cov.outside, 0, "the parent's call is not this ledger's gap");
  // a plain session file is nobody's fork
  const plain = fixture(tmp(), [{ ...bash('t1', 'echo'), sessionId: 'not-a-session-id' }, result('t1')]);
  assert.strictEqual(run([plain]).main.forkPrefix.msgs, 0);
});

// A call the harness rejects before PreToolUse leaves no ledger row, and a ledger row can have no
// transcript call (an ask the transcript never wrote). A count-based 'unmatched' cancelled the two
// into a false 40 vs 40 (measured): the join now lists each side.
test('hook-log join: unmatched calls and unmatched rows are listed per side, not netted', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo one'), result('t1'), bash('t2', 'echo two'), result('t2')]);
  const ledger = path.join(dir, 'tools-usage.jsonl');
  fs.writeFileSync(ledger, [
    line({ ts: '2026-07-15T07:00:00.100Z', tool: 'Bash', detail: 'echo one' }),
    line({ ts: '2026-07-15T07:00:00.200Z', tool: 'AskUserQuestion', detail: 'q' }),
  ].join(''));
  const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
  assert.strictEqual(cov.unmatched, 0, 'the netted count says all is well');
  assert.strictEqual(cov.matchedCalls, 1);
  assert.strictEqual(cov.unmatchedCallCount, 1, '... one call has no row');
  assert.strictEqual(cov.unmatchedCalls[0].tool, 'Bash');
  assert.strictEqual(cov.unmatchedRowCount, 1, '... and one row has no call');
  assert.strictEqual(cov.unmatchedRows[0].tool, 'AskUserQuestion');
  assert.strictEqual(run([file, '--hook-log', ledger]).hookLog.rowsIdx, undefined, 'the row index stays out of the dump');
});

// The bill sees calls the transcript never records - the harness's post-turn recap call is one -
// so cost-state cache-read exceeded the transcript's by exactly one peak context (694,773 vs
// 590,045, measured) and nothing said so.
test('cost-state cache-read above the transcript is reported as untranscribed calls', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1'),
    { type: 'cost-state', sessionId: 'x', modelUsage: { 'claude-sonnet-5': { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cacheReadInputTokens: 22, cacheCreationInputTokens: 0 } } }]);
  const { main } = run([file]);
  assert.strictEqual(main.costState.cacheRead, 22);
  assert.strictEqual(main.total.cacheRead, 10);
  assert.deepStrictEqual(main.untranscribed, { cacheRead: 12, contexts: 1.1 });
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\*\*Untranscribed calls\*\* cost-state cache-read 22 vs transcript 10 - gap 12/);
});

// The fork-liveness probe writes a mode: probe row into the same ledger the guards block into; a
// probe is a measurement, never a block, and the tally must not read it as one.
test('hook-blocks: a probe row is counted apart from the blocks', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [
    line({ ts: '2026-07-15T07:00:00.500Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: whole-file Read of Big.cs' }),
    line({ ts: '2026-07-15T07:00:01.500Z', hook: 'guard-cross-project-write.js', event: 'PreToolUse', tool: 'Edit', mode: 'probe', kind: 'fork-liveness', reason: 'probe: Edit of a file while a live sibling session' }),
  ].join(''));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.rows, 1, 'one block');
  assert.strictEqual(hookBlocks.probes, 1, 'one probe, apart');
  assert.deepStrictEqual(hookBlocks.probeKinds, { 'fork-liveness': 1 });
  assert.strictEqual(Object.keys(hookBlocks.byHook).length, 1, 'the probe is not a hook block row');
});

// ---------- the efficiency scorecard ----------
// Each row is a measured practice with a denominator; these pin the classifiers on synthetic
// transcripts so a regex drift cannot silently move a rate the observation week is read from.

const scAsst = (id, ts, u, content, extra = {}) => line({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage: u, content, ...extra } });
const scHuman = (ts, text) => line({ type: 'user', timestamp: ts, message: { content: text } });
const toolRes = (ts, id, text, isError) => line({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
const scBash = (id, cmd) => ({ type: 'tool_use', id, name: 'Bash', input: { command: cmd } });
const scRead = (id, file) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: file } });
const scT = (n) => `2026-07-15T07:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;

test("scorecard: a cache miss uses Claude Code's own rule, and the first request after a compaction is an expected rebuild", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    scAsst('m1', scT(0), usage(10, 100000, 0, 5), []) +
    scAsst('m2', scT(1), usage(10, 500, 100000, 5), []) +          // read everything m1 cached: continuous
    scAsst('m3', scT(2), usage(10, 90000, 20000, 5), []) +         // re-processed 80.5k of 100.5k: a MISS
    line({ type: 'system', timestamp: scT(3), compactMetadata: { trigger: 'auto', preTokens: 110000, postTokens: 30000 } }) +
    line({ type: 'user', timestamp: scT(3), isCompactSummary: true, message: { content: 'summary' } }) +
    scAsst('m4', scT(4), usage(10, 30000, 0, 5), []) +             // the rebuild after the compaction: EXPECTED
    scAsst('m5', scT(5), usage(10, 100, 30000, 5), []),            // continuous again
  );
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.cacheMisses, 1);
  assert.strictEqual(e.cacheMissTokens, 90000);
  assert.strictEqual(e.cacheMissAt[0].reprocessed, 80500);
  assert.strictEqual(e.expectedRebuilds, 1);
  assert.strictEqual(e.expectedRebuildTokens, 30000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: build-dir reads and post-compaction re-reads are counted on both routes, once per file per compaction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    scAsst('m1', scT(0), usage(1, 0, 100, 5), [scRead('t1', 'src/a.cs'), scRead('t2', 'node_modules/x/index.js'), scBash('t3', 'cat dist/main.js'), scBash('t4', "sed -n '1,20p' src/b.cs")]) +
    toolRes(scT(1), 't1', 'a'.repeat(400)) + toolRes(scT(1), 't2', 'b'.repeat(800)) + toolRes(scT(1), 't3', 'c'.repeat(200)) + toolRes(scT(1), 't4', 'd'.repeat(100)) +
    line({ type: 'system', timestamp: scT(2), compactMetadata: { trigger: 'auto' } }) +
    line({ type: 'user', timestamp: scT(2), isCompactSummary: true, message: { content: 'summary' } }) +
    scAsst('m2', scT(3), usage(1, 0, 100, 5), [scRead('t5', 'src/a.cs'), scRead('t6', 'src/c.cs'), scBash('t7', 'head -n 5 src/b.cs'), scRead('t8', 'src/a.cs')]) +
    toolRes(scT(4), 't5', 'a'.repeat(400)) + toolRes(scT(4), 't6', 'e'.repeat(300)) + toolRes(scT(4), 't7', 'd'.repeat(50)) + toolRes(scT(4), 't8', 'a'.repeat(400)),
  );
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.buildDirReads.calls, 2, 'the Read and the cat under a build dir');
  assert.strictEqual(e.buildDirReads.chars, 1000);
  assert.strictEqual(e.buildDirReads.paths['node_modules/x/index.js'], 800);
  assert.deepStrictEqual(e.compactionRereads, [{ ts: scT(2), candidates: 4, files: 2, chars: 450 }], 'a.cs once (its second post-compaction read is not a second re-read), b.cs via head');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: test runs split scoped from whole-suite, and a commit is checked only when a check sat within the window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  let body = '';
  body += scAsst('m1', scT(0), usage(1, 0, 100, 5), [scBash('c1', 'dotnet test --filter FullyQualifiedName~Foo'), scBash('c2', 'dotnet test'), scBash('c3', 'npm run build')]);
  body += toolRes(scT(1), 'c1', 'x'.repeat(300)) + toolRes(scT(1), 'c2', 'y'.repeat(5000)) + toolRes(scT(1), 'c3', 'z'.repeat(100));
  body += scAsst('m2', scT(2), usage(1, 0, 100, 5), [scBash('g1', 'git commit -m first')]) + toolRes(scT(3), 'g1', '[main abc] first');
  // 45 unrelated calls push the last check out of the 40-call window
  const filler = []; for (let i = 0; i < 45; i++) filler.push(scBash(`f${i}`, `echo ${i}`));
  body += scAsst('m3', scT(4), usage(1, 0, 100, 5), filler);
  for (let i = 0; i < 45; i++) body += toolRes(scT(5), `f${i}`, String(i));
  body += scAsst('m4', scT(6), usage(1, 0, 100, 5), [scBash('g2', 'git commit -m second')]) + toolRes(scT(7), 'g2', '[main def] second');
  // the check and the commit in ONE call: checked
  body += scAsst('m5', scT(8), usage(1, 0, 100, 5), [scBash('g3', 'npm test -- src/a.spec.ts && git commit -m third')]) + toolRes(scT(9), 'g3', '12 passed\n[main ghi] third');
  fs.writeFileSync(file, body);
  const { main } = run([file]);
  const e = main.efficiency;
  assert.deepStrictEqual(e.checks.test, { calls: 3, chars: 300 + 5000 + '12 passed\n[main ghi] third'.length, scoped: 2, whole: 1 });
  assert.strictEqual(e.checks.build.calls, 1);
  assert.strictEqual(main.gitCommits, 3);
  assert.strictEqual(e.commitsChecked, 2);
  assert.deepStrictEqual(e.commitsUnchecked, [scT(6)]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: a green claim with no check in its turn is listed, a checked or negated one is not; long answers and correction streaks count as the hook would', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  const endTurn = (id, ts, text) => scAsst(id, ts, usage(1, 0, 100, 5), [{ type: 'text', text }], { stop_reason: 'end_turn' });
  let body = '';
  body += scHuman(scT(0), 'do it');
  body += endTurn('m1', scT(1), 'Done. All tests pass now.');                       // no check this turn: UNVERIFIED
  body += scHuman(scT(2), 'ok');
  body += scAsst('m2', scT(3), usage(1, 0, 100, 5), [scBash('c1', 'npm test')]) + toolRes(scT(4), 'c1', '12 passed');
  body += endTurn('m3', scT(5), 'Tests pass, 12/12.');                              // the turn ran the check
  body += scHuman(scT(6), 'and?');
  body += endTurn('m4', scT(7), 'The tests do not pass yet - two failures remain.'); // negated: not a claim
  body += scHuman(scT(8), 'more');
  body += endTurn('m5', scT(9), 'word '.repeat(420));                              // 2,099 chars of prose: LONG
  // a correction streak: three short turns, each after a 1,500+ char answer
  for (let i = 0; i < 4; i++) {
    body += endTurn(`L${i}`, scT(10 + 2 * i), 'prose '.repeat(280));
    body += scHuman(scT(11 + 2 * i), 'no, shorter');
  }
  fs.writeFileSync(file, body);
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.greenClaims, 2);
  assert.deepStrictEqual(e.unverifiedGreenClaims, [scT(1)]);
  assert.strictEqual(e.longAnswers, 1, 'the 2,099-char answer; the four 1,680-char streak answers sit under the 1,800 cap');
  assert.strictEqual(e.correctionTurns, 4, 'every short turn after a merged 1,500+ char answer');
  assert.strictEqual(e.longAnswered, 4);
  assert.strictEqual(e.finalAnswers, 8);
  assert.deepStrictEqual(e.correctionStreaks, [scT(15)], 'recorded once, at the third short turn, not again at the fourth');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: dispatch overhead flags a seat whose input was mostly its own first-message context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, scAsst('m1', scT(0), usage(1, 0, 100, 5), []));
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'),
    scAsst('a1', scT(1), usage(0, 0, 50000, 10), []) + scAsst('a2', scT(2), usage(0, 2000, 50000, 10), []));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'aspnet-implementer' }));
  fs.writeFileSync(path.join(sub, 'agent-b1.jsonl'),
    scAsst('b1', scT(3), usage(0, 0, 10000, 10), []) + scAsst('b2', scT(4), usage(0, 40000, 10000, 10), []) + scAsst('b3', scT(5), usage(0, 0, 50000, 10), []));
  fs.writeFileSync(path.join(sub, 'agent-b1.meta.json'), JSON.stringify({ agentType: 'evidence-gatherer' }));
  const { dispatchOverhead: d } = run([file]);
  assert.strictEqual(d.seats, 2);
  assert.strictEqual(d.heavy, 1);
  assert.deepStrictEqual(d.heavySeats, [{ type: 'aspnet-implementer', msgs: 2, floor: 50000, share: 98 }]);
  assert.strictEqual(d.preloadTokens, 130000);
  assert.strictEqual(d.seatInputTokens, 212000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: the markdown skeleton carries the scorecard table and the efficiency verdict fill-in; the text report carries the block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /## Efficiency scorecard/);
  assert.match(md, /\| cache continuity \| 0 miss\(es\)/);
  assert.match(md, /\| long answers \| 0 of 0 final answer/);
  assert.ok(md.indexOf('## Efficiency verdict - FILL IN') < md.indexOf('## Verdict - FILL IN'), 'the efficiency verdict precedes the skill verdict');
  assert.match(md, /TOKEN VERDICT/);
  assert.match(md, /EFFECTIVENESS/);
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /\nEFFICIENCY \(/);
  assert.match(txt, /checked commits\s+no commit/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- INVENTORY vs USE: the complement the report never had ---
// The analyzer counted consumption and never what was installed and never touched, so
// 'unused in this corpus' was an ad-hoc script every time it was asked. These fixtures pin
// one detection branch per layer plus the unused complement.

// A synthetic install: two skills reached three different ways, one never; an agent whose
// frontmatter PRELOADS a skill; an always-on rule, a path-scoped rule with a glob the session
// matches, one named only by the shell-route notice, and one nothing touches.
function writeInventory(root) {
  const claude = path.join(root, '.claude');
  const mk = (p) => fs.mkdirSync(p, { recursive: true });
  mk(path.join(claude, 'skills'));
  mk(path.join(claude, 'agents'));
  mk(path.join(claude, 'rules'));
  for (const s of ['alpha-skill', 'beta-skill', 'gamma-skill', 'delta-skill']) {
    mk(path.join(claude, 'skills', s));
    fs.writeFileSync(path.join(claude, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: "fixture"\n---\n\nbody\n`);
  }
  fs.writeFileSync(path.join(claude, 'agents', 'demo-implementer.md'),
    '---\nname: demo-implementer\ndescription: fixture seat\nmodel: sonnet\nskills:\n  - gamma-skill\n  - demo-plugin:preloaded-helper\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'agents', 'unused-agent.md'), '---\nname: unused-agent\ndescription: never dispatched\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'baseline-demo.md'), '---\ndescription: always-on, no paths\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'demo-conventions.md'), '---\npaths: ["**/*.cs"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'shell-only-conventions.md'), '---\npaths: ["**/*.sql"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'other-conventions.md'), '---\npaths: ["**/*.{ts,tsx}"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {}, context7: {} } }));
  const pluginsFile = path.join(root, 'installed_plugins.json');
  fs.writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: { 'demo-plugin@market': [{ scope: 'user' }], 'typescript-lsp@market': [{ scope: 'user' }], 'hooks-only-plugin@market': [{ scope: 'user' }] } }));
  return { claude, pluginsFile };
}

const invAsst = (id, ts, content) => ({
  type: 'assistant', timestamp: ts,
  message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content },
});
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });

function writeInventoryTranscript(dir, root, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [
    // the transcript's own cwd - the machine that ran it. Present so the resolution is exercised.
    line({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: root, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'do the thing' } }),
    line(invAsst('m1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'alpha-skill' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    // the slash route - a skill invoked as a command emits no Skill event at all
    line({ type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p2', origin: { kind: 'slash_command' }, message: { content: '<command-name>/beta-skill</command-name>' } }),
    // a harness command must NOT open a skill row
    line({ type: 'user', timestamp: '2026-07-15T07:01:01.000Z', parentUuid: 'p3', origin: { kind: 'slash_command' }, message: { content: '<command-name>/model</command-name>' } }),
    line(invAsst('m2', '2026-07-15T07:02:00.000Z', [use('t2', 'Task', { subagent_type: 'demo-implementer', description: 'build one task' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:02:30.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'done' }] } }),
    // a governed file touched through a file tool - the glob proxy's input
    line(invAsst('m3', '2026-07-15T07:03:00.000Z', [use('t3', 'Edit', { file_path: `${root}/src/Foo.cs`, old_string: 'a', new_string: 'b' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:03:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } }),
    // the DIRECT attach record the harness writes when it loads the rule
    line({ type: 'attachment', timestamp: '2026-07-15T07:03:02.000Z', attachment: { type: 'nested_memory', path: `${root}/.claude/rules/demo-conventions.md`, displayPath: '.claude/rules/demo-conventions.md', content: { type: 'Project', content: 'body' } } }),
    // guard-read-whole-file's shell-route reminder names its rule, and nothing else does
    line({ type: 'attachment', timestamp: '2026-07-15T07:03:03.000Z', attachment: { type: 'hook_additional_context', hookName: 'guard-read-whole-file.js', content: ['This command touches files governed by `.claude/rules/shell-only-conventions.md`. Read the rule.'] } }),
    line(invAsst('m4', '2026-07-15T07:04:00.000Z', [use('t4', 'mcp__serena__find_symbol', { name_path: 'Foo' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:04:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'sym' }] } }),
    line(invAsst('m5', '2026-07-15T07:05:00.000Z', [use('t5', 'LSP', { method: 'definition' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:05:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't5', content: 'def' }] } }),
    // a plugin skill: the namespace is the plugin layer's evidence, and the skill row is observed
    line(invAsst('m6', '2026-07-15T07:06:00.000Z', [use('t6', 'Skill', { skill: 'demo-plugin:helper' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:06:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't6', content: 'ok' }] } }),
  ].join(''));
  return file;
}

const invRow = (rows, name) => rows.find((r) => r.name === name);

test('inventory vs use: every layer scores what was used, HOW it was observed, and what never was', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const file = writeInventoryTranscript(dir, root, 'session.jsonl');
  const { inventory } = run([file, '--inventory', claude, '--plugins', pluginsFile]);

  // --- skills: three routes in, three different columns
  assert.deepStrictEqual(invRow(inventory.skills, 'alpha-skill').how, ['Skill call x1'], 'the Skill tool');
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').firstUse, '2026-07-15T07:00:10.000Z');
  assert.deepStrictEqual(invRow(inventory.skills, 'beta-skill').how, ['slash command x1'], 'the slash route emits no Skill event');
  assert.deepStrictEqual(invRow(inventory.skills, 'gamma-skill').how, ['preloaded via demo-implementer x1'],
    "a seat's frontmatter preload is paid for in full and shows zero calls - its own column, never the caller's");
  assert.strictEqual(invRow(inventory.skills, 'delta-skill').used, 'no');
  assert.strictEqual(invRow(inventory.skills, 'model'), undefined, '/model is the harness, not a skill');
  assert.strictEqual(invRow(inventory.skills, 'demo-plugin:helper').source, 'observed', 'a plugin skill is used but not in the project inventory');
  assert.deepStrictEqual(invRow(inventory.skills, 'demo-plugin:preloaded-helper').how, ['preloaded via demo-implementer x1']);

  // --- agents
  assert.deepStrictEqual(invRow(inventory.agents, 'demo-implementer').how, ['dispatched x1']);
  assert.strictEqual(invRow(inventory.agents, 'unused-agent').used, 'no');

  // --- rules: always-on is not a question a transcript can answer; the rest have two direct
  // records and a glob proxy under them
  assert.strictEqual(invRow(inventory.rules, 'baseline-demo.md').used, 'not observable');
  assert.deepStrictEqual(invRow(inventory.rules, 'demo-conventions.md').how.sort(),
    ['attached (transcript record) x1', 'glob proxy x1'], 'the attach record AND the proxy, never one instead of the other');
  assert.deepStrictEqual(invRow(inventory.rules, 'shell-only-conventions.md').how, ['shell-route notice x1'],
    'the shell route attaches no rule, so the guard notice is the only record there is');
  assert.strictEqual(invRow(inventory.rules, 'other-conventions.md').used, 'no');

  // --- plugins: a namespace, an LSP call, and one that ships only hooks and can never score
  assert.deepStrictEqual(invRow(inventory.plugins, 'demo-plugin').how.sort(), ['namespaced skill/command x1', 'preloaded skill x1'],
    "a plugin skill named in a seat's preload list is that plugin's body entering the seat, on its own evidence line");
  assert.deepStrictEqual(invRow(inventory.plugins, 'typescript-lsp').how, ['LSP call x1']);
  assert.strictEqual(invRow(inventory.plugins, 'hooks-only-plugin').used, 'no');

  // --- MCP
  assert.deepStrictEqual(invRow(inventory.mcps, 'serena').how, ['calls x1']);
  assert.strictEqual(invRow(inventory.mcps, 'context7').used, 'no');
  assert.match(inventory.source.skills_agents_rules, /^project /);
  assert.strictEqual(inventory.source.sessions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the corpus answer is used in N of M sessions, and the never-used set per layer', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  writeInventoryTranscript(sessions, root, 'a.jsonl');
  // the second session touches nothing the first did
  fs.writeFileSync(path.join(sessions, 'b.jsonl'),
    line(invAsst('n1', '2026-07-16T07:00:00.000Z', [use('u1', 'Read', { file_path: `${root}/README.txt` })])));
  const { inventory } = run([sessions, '--inventory', claude, '--plugins', pluginsFile]);
  assert.strictEqual(inventory.source.sessions, 2);
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').sessionsUsed, 1, 'used in 1 of 2');
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').ofSessions, 2);
  assert.strictEqual(invRow(inventory.skills, 'delta-skill').used, 'no', 'never used across the corpus');
  assert.strictEqual(invRow(inventory.rules, 'other-conventions.md').used, 'no');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the block renders in the text report, the skeleton and the rollup', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const file = writeInventoryTranscript(dir, root, 'session.jsonl');
  const args = ['--inventory', claude, '--plugins', pluginsFile];

  const txt = execFileSync('node', [SCRIPT, file, ...args], { encoding: 'utf8' });
  assert.match(txt, /\nINVENTORY vs USE \(/);
  assert.match(txt, /SKILLS - used 3 of 4 installed, \+2 used but in no inventory the run could read/);
  assert.match(txt, /unused \(1\): delta-skill/);
  assert.match(txt, /always-on - in every prompt, use not observable \(1\): baseline-demo\.md/);

  const md = execFileSync('node', [SCRIPT, file, ...args, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /## Inventory vs use/);
  assert.match(md, /### Skills \(used 3 of 4 installed, \+2 used but in no inventory the run could read\)/);
  assert.match(md, /\| alpha-skill \| installed \| 1\/1 \| yes \| Skill call x1 \| 2026-07-15T07:00:10\.000Z \|/);
  assert.match(md, /> unused \(1\): delta-skill/);
  assert.ok(md.indexOf('## Inventory vs use') < md.indexOf('## Tools ('), 'the complement sits with the surface tables, before the tools table');

  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  fs.copyFileSync(file, path.join(sessions, 'a.jsonl'));
  const roll = execFileSync('node', [SCRIPT, sessions, ...args], { encoding: 'utf8' });
  assert.match(roll, /\nINVENTORY vs USE \(/, 'directory mode carries the corpus answer');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the glob subset covers **, *, ? and brace groups, and nothing else', () => {
  const { globToRe, parseFrontmatter } = require('./analyze-usage.js');
  assert.ok(globToRe('**/*.cs').test('C:/Projects/app/src/Foo.cs'));
  assert.ok(globToRe('**/*.cs').test('Foo.cs'), 'a bare relative path still matches');
  assert.ok(!globToRe('**/*.cs').test('/app/src/Foo.csproj'));
  assert.ok(globToRe('**/*.{ts,tsx}').test('/app/src/app.tsx'), 'brace group');
  assert.ok(!globToRe('**/*.{ts,tsx}').test('/app/src/app.js'));
  assert.ok(globToRe('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRe('src/*.ts').test('src/deep/a.ts'), 'a single star never crosses a separator');
  assert.ok(globToRe('**/file?.md').test('/x/file1.md'));
  // the frontmatter subset the loaders read: an inline array, a block list, a plain value
  const fm = parseFrontmatter('---\nname: demo\npaths: ["**/*.cs", "**/*.razor"]\nskills:\n  - one\n  - two\n---\nbody');
  assert.deepStrictEqual(fm.paths, ['**/*.cs', '**/*.razor']);
  assert.deepStrictEqual(fm.skills, ['one', 'two']);
  assert.strictEqual(fm.name, 'demo');
});

test('inventory vs use: a nested corpus is walked recursively, per project, and ledgers are not sessions', () => {
  // The collected-bundle layout is `<corpus>/<project>/<session-id>/<session-id>.jsonl` with the
  // ledgers beside it, and directory mode used to read only the files directly inside the folder
  // it was given: an empty TOTAL, no inventory block, and every ledger file a bogus session row.
  // Two projects, two different installs - the point of resolving the inventory per session.
  const dir = tmp();
  const corpus = path.join(dir, 'corpus');
  const mkSkill = (claude, name) => {
    fs.mkdirSync(path.join(claude, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(claude, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: "fixture"\n---\n\nbody\n`);
  };
  const project = (name, skills) => {
    const root = path.join(dir, name);
    const claude = path.join(root, '.claude');
    for (const s of skills) mkSkill(claude, s);
    return root;
  };
  // `shared-skill` is installed in BOTH and used in ONE; `solo-skill` is installed in one project
  // only and never used; `absent-skill` exists nowhere and must never appear at all.
  const rootA = project('project-a', ['shared-skill', 'solo-skill']);
  const rootB = project('project-b', ['shared-skill']);

  const bundle = (proj, sid, root, records) => {
    const d = path.join(corpus, proj, sid);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${sid}.jsonl`), records.map(line).join(''));
    // the two ledger families a bundle carries - JSONL of the same shape, never a session
    fs.writeFileSync(path.join(d, `tool-usage-${sid}.jsonl`), line({ ts: '2026-07-15T07:00:00.000Z', tool: 'Read' }));
    fs.writeFileSync(path.join(d, `hook-blocks-${sid}.jsonl`), line({ ts: '2026-07-15T07:00:00.000Z', hook: 'guard-read-whole-file.js' }));
    // a dispatched seat's transcript belongs to its parent, never to the rollup as a session
    fs.mkdirSync(path.join(d, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(d, 'subagents', 'agent-s1.jsonl'), line(invAsst('s1', '2026-07-15T07:09:00.000Z', [])));
    return d;
  };
  bundle('project-a', 'aaaaaaaa-1111-1111-1111-111111111111', rootA, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: rootA, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } },
    invAsst('a1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'shared-skill' })]),
    { type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  ]);
  bundle('project-b', 'bbbbbbbb-2222-2222-2222-222222222222', rootB, [
    { type: 'user', timestamp: '2026-07-16T07:00:00.000Z', cwd: rootB, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } },
    invAsst('b1', '2026-07-16T07:00:10.000Z', [use('t1', 'Read', { file_path: `${rootB}/README.md` })]),
    { type: 'user', timestamp: '2026-07-16T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  ]);
  // a collection-level ledger folder: its files are named `<session-id>.jsonl` and are not sessions
  fs.mkdirSync(path.join(corpus, 'project-a', 'tools-usage'), { recursive: true });
  fs.writeFileSync(path.join(corpus, 'project-a', 'tools-usage', 'cccccccc-3333-3333-3333-333333333333.jsonl'),
    line({ ts: '2026-07-15T07:00:00.000Z', tool: 'Bash' }));

  const pluginsFile = path.join(dir, 'installed_plugins.json');
  fs.writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: {} }));
  const out = run([corpus, '--plugins', pluginsFile]);

  assert.deepStrictEqual(out.sessions.map((x) => x.session).sort(),
    ['aaaaaaaa-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222'],
    'two sessions found two folders deep, and no ledger or seat transcript among them');
  assert.strictEqual(out.sessions.length, 2, 'and no third row for either seat transcript');
  assert.strictEqual(out.total.msgs, 4, "2 main msgs + each bundle's seat, counted under its parent - the TOTAL was empty before the walk recursed");
  const inv = out.inventory;
  assert.strictEqual(inv.source.sessions, 2);
  assert.strictEqual(inv.source.inventories, 2, 'two cwds resolved two project inventories, not one');

  const shared = invRow(inv.skills, 'shared-skill');
  assert.strictEqual(shared.installedIn, 2, 'installed in 2 of 2 sessions');
  assert.strictEqual(shared.sessionsUsed, 1, '... and used in 1');
  const solo = invRow(inv.skills, 'solo-skill');
  assert.strictEqual(solo.used, 'no');
  assert.strictEqual(solo.installedIn, 1, 'installed in one project only - the unused line must say so');
  assert.strictEqual(invRow(inv.skills, 'absent-skill'), undefined, 'a name nothing installed is not a non-use finding');

  const txt = execFileSync('node', [SCRIPT, corpus, '--plugins', pluginsFile], { encoding: 'utf8' });
  assert.match(txt, /SKILLS - used 1 of 2 installed/);
  assert.match(txt, /never used \(1\): solo-skill \(installed in 1\/2\)/,
    'the unused line carries the install count when the run spans installs that differ');
  assert.doesNotMatch(txt, /tool-usage-|hook-blocks-|agent-s1/, 'no ledger or seat row in the rollup table');
  fs.rmSync(dir, { recursive: true, force: true });
});
