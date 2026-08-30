// Behavior tests for the guard hooks that had no coverage at all - written from defects the
// 74-session investigation and the hook audit REPRODUCED, so each case pins a real regression:
// a silent evasion the gate exists to stop, or a false positive that blocked honest work.
// Both directions matter: a hook that fires on the wrong turn trains the model to ignore blocks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-hooks-'));
const BIG = path.join(__dirname, 'lint-skills.js'); // a real, long source file in this repo

function run(hook, payload) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8' });
  return r.status;
}
const bash = (hook, command) => run(hook, { tool_name: 'Bash', tool_input: { command } });
const heredoc = (body) => `cat <<'EOF' > /tmp/plan.md\n${body}\nEOF`;

function transcript(name, rows) {
  const p = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}
const assistantRow = (id, text, usage) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage: usage || { cache_read_input_tokens: 10 } } });

test('guard-read-whole-file: shell sweeps and runtime reads are dumps', () => {
  assert.equal(bash('guard-read-whole-file.js', 'for f in src/*.cs; do cat -n "$f"; done'), 2, 'loop over a glob');
  assert.equal(bash('guard-read-whole-file.js', 'find . -name "*.cs" -exec cat {} +'), 2, 'find -exec cat');
  assert.equal(bash('guard-read-whole-file.js', 'find . -name "*.cs" | xargs cat'), 2, 'xargs cat');
  assert.equal(bash('guard-read-whole-file.js', `head -n 100000 ${BIG}`), 2, 'head -n <huge>');
  assert.equal(bash('guard-read-whole-file.js', `tail -n +1 ${BIG}`), 2, 'tail -n +1');
  assert.equal(bash('guard-read-whole-file.js', `python3 -c "print(open('${BIG}').read())"`), 2, 'runtime read');
});

test('guard-read-whole-file: targeted reads and doc prose stay silent', () => {
  assert.equal(bash('guard-read-whole-file.js', `head -40 ${BIG}`), 0, 'bounded head');
  assert.equal(bash('guard-read-whole-file.js', `sed -n '50,60p' ${BIG}`), 0, 'ranged sed');
  assert.equal(bash('guard-read-whole-file.js', `grep -n Foo ${BIG}`), 0, 'grep');
  assert.equal(bash('guard-read-whole-file.js', heredoc(`Step 1: cat ${BIG} to check the patterns`)), 0, 'heredoc prose');
});

test('guard-ungated-commit: the receipt must target the gate file, not merely name it', () => {
  assert.equal(bash('guard-ungated-commit.js', 'echo "note: VERIFIED review authorized: go" > notes.txt && git commit -am wip'), 2,
    'prose naming the receipt words in an unrelated file must not satisfy the gate');
  assert.equal(bash('guard-ungated-commit.js', heredoc('Step 9: run git commit -F - here')), 0,
    'a plan document describing a commit is data, not a commit');
});

test('guard-protected-force-push / guard-catastrophic-rm: heredoc bodies are data', () => {
  assert.equal(bash('guard-protected-force-push.js', heredoc('Deploy: git push --force origin main')), 0);
  assert.equal(bash('guard-protected-force-push.js', 'git push --force origin main'), 2);
  assert.equal(bash('guard-catastrophic-rm.js', heredoc('Cleanup: rm -rf ~')), 0);
  assert.equal(bash('guard-catastrophic-rm.js', 'rm -rf ~'), 2);
});

test('guard-stop-contract: a decision question in ordinary words is still a stop', () => {
  const q = transcript('q', [assistantRow('m1', "Two options exist for the deploy target: staging or prod. What's the deploy target?")]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: q }), 2);
  const done = transcript('done', [assistantRow('m2', 'Done. Not pushed yet - the branch is ready whenever you are.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: done }), 2, 'declarative step-done close');
});

test('guard-stop-contract: status about a running job is not a pending decision', () => {
  const ci = transcript('ci', [assistantRow('m3', 'The fix is committed and pushed. Tests are still running in CI.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: ci }), 0);
  const plain = transcript('plain', [assistantRow('m4', 'Here is the summary of what changed: three files, all tests green.')]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: plain }), 0);
});

test('guard-stop-contract: one turn split across rows sharing a message.id is judged whole', () => {
  // The defect this pins: keeping only the LAST row read a thinking-only fragment as the turn and
  // passed a real decision stop - measured in six audited sessions.
  const split = transcript('split', [
    { type: 'assistant', message: { id: 'm5', content: [{ type: 'text', text: 'Weighing the options.' }], usage: { cache_read_input_tokens: 10 } } },
    { type: 'assistant', message: { id: 'm5', content: [{ type: 'text', text: 'Which one should we go with - A or B?' }], usage: { cache_read_input_tokens: 10 } } },
  ]);
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: split }), 2);
});

test('guard-fresh-session-start: gates orchestration runs only, and only past the threshold', () => {
  const hot = transcript('hot', [assistantRow('m6', 'ok', { cache_read_input_tokens: 300000 })]);
  const cold = transcript('cold', [assistantRow('m7', 'ok', { cache_read_input_tokens: 50000 })]);
  const call = (skill, tp) => run('guard-fresh-session-start.js', { tool_name: 'Skill', tool_input: { skill }, transcript_path: tp });
  assert.equal(call('project-quality-loop', hot), 2, 'orchestration run on carried history');
  assert.equal(call('claude-stack:project-quality-loop', hot), 2, 'namespaced form');
  assert.equal(call('project-quality-loop', cold), 0, 'under the threshold');
  assert.equal(call('csharp', hot), 0, 'an ordinary skill is never gated');
});
