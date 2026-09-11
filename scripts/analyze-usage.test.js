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
