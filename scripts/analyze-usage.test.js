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
  assert.deepStrictEqual(main.skillAttribution.csharp, { msgs: 2, output: 40, cacheRead: 7000, carriedMsgs: 1 });
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
