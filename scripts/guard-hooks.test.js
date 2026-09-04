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

// The commit gate reads the repo's real diff (a trivial one is exempt by design), so these cases
// need their own dirty repo - keying off this checkout's state made the test pass or fail with it.
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  // a non-trivial diff: past the hook's 2-file / 15-line trivial bar
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'));
  return dir;
}

test('guard-ungated-commit: the receipt must target the gate file, not merely name it', () => {
  const dir = scratchRepo();
  const inRepo = (command) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-ungated-commit.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    cwd: dir,
  }).status;
  assert.equal(inRepo('git commit -am wip'), 2, 'a non-trivial commit with no receipt is blocked');
  assert.equal(inRepo('echo "note: VERIFIED review authorized: go" > notes.txt && git commit -am wip'), 2,
    'prose naming the receipt words in an unrelated file must not satisfy the gate');
  assert.equal(inRepo(heredoc('Step 9: run git commit -F - here')), 0,
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
  // 180k has never crossed 200k, so the window reads as the 200k tier -> the 150k floor applies
  const hot = transcript('hot', [assistantRow('m6', 'ok', { cache_read_input_tokens: 180000 })]);
  const cold = transcript('cold', [assistantRow('m7', 'ok', { cache_read_input_tokens: 50000 })]);
  const call = (skill, tp) => run('guard-fresh-session-start.js', { tool_name: 'Skill', tool_input: { skill }, transcript_path: tp });
  assert.equal(call('project-quality-loop', hot), 2, 'orchestration run on carried history');
  assert.equal(call('claude-stack:project-quality-loop', hot), 2, 'namespaced form');
  assert.equal(call('project-diagnose-failure', hot), 2, 'the gated diagnosis flow chained onto carried history');
  assert.equal(call('project-quality-loop', cold), 0, 'under the threshold');
  assert.equal(call('csharp', hot), 0, 'an ordinary skill is never gated');
});

// A flat 150k is ~75% of a 200k window but only 15% of a 1M one, which is where it fired on
// nearly every ask. The trigger is now 40% of the window, floored at the measured 150k, and the
// window is inferred from the largest per-message context the session has actually carried.
test('guard-fresh-session-start: the threshold scales with the context window', () => {
  const at = (name, ctx) => transcript(name, [assistantRow(name, 'ok', { cache_read_input_tokens: ctx })]);
  const call = (tp, env) => runIn('guard-fresh-session-start.js',
    { tool_name: 'Skill', tool_input: { skill: 'project-quality-loop' }, transcript_path: tp },
    { env: { ...process.env, ...(env || {}) } }).status;

  assert.equal(call(at('w-200k', 190000)), 2, '190k on a 200k window is past the 150k floor');
  assert.equal(call(at('w-1m-300k', 300000)), 0, '300k on a 1M window is only 30% - not yet worth a fresh session');
  assert.equal(call(at('w-1m-450k', 450000)), 2, '450k on a 1M window is past 40%');
  assert.equal(call(at('w-1m-450k', 450000), { CLAUDE_STACK_FRESH_SESSION_PCT: '60' }), 0, 'the percentage is tunable');
  assert.equal(call(at('w-1m-650k', 650000), { CLAUDE_STACK_FRESH_SESSION_PCT: '60' }), 2, '... and still fires at its own step');
});

// ---- hooks audit: every gate branch pinned in both directions (block AND the exemption) ----
const runIn = (hook, payload, opts) =>
  spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });
const BIG_LINES = fs.readFileSync(BIG, 'utf8').split('\n').length;
const SMALL = path.join(HOOKS, 'guard-fresh-session-start.js'); // well under the 200-line threshold
const REPO = path.join(__dirname, '..');
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A seeded repo whose HEAD sits on a named branch (the force-push guard reads HEAD for a bare push).
function scratchRepoOn(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n'); git('add', '-A'); git('commit', '-qm', 'seed');
  return dir;
}
// A seeded repo with a CLEAN tree - tests dirty it the way they need.
function cleanRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-repo-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n'); git('add', '-A'); git('commit', '-qm', 'seed');
  return dir;
}
const gateIn = (dir, command, env = {}) => runIn('guard-ungated-commit.js', { tool_name: 'Bash', tool_input: { command } }, {
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env }, cwd: dir,
}).status;
const forty = () => Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');

test('guard-read-whole-file: the Read matcher gates whole-file shapes and the cumulative cap', () => {
  const read = (input, session_id) => run('guard-read-whole-file.js', { tool_name: 'Read', tool_input: input, session_id });
  assert.equal(read({ file_path: BIG }), 2, 'no offset/limit');
  assert.equal(read({ file_path: BIG, offset: 1, limit: 2000 }), 2, 'a limit spanning the file is a whole-file Read');
  assert.equal(read({ file_path: BIG, offset: 1, limit: BIG_LINES }), 2, 'limit = the line count');
  assert.equal(read({ file_path: BIG, offset: 50, limit: 40 }), 0, 'a ranged read');
  assert.equal(read({ file_path: SMALL }), 0, 'a small file reads whole');
  assert.equal(read({ file_path: path.join(REPO, 'CLAUDE.md') }), 0, 'a non-source file is not gated');
  assert.equal(read({ file_path: '/nope/missing.ts' }), 0, 'a missing file lets Read surface its own error');
  const sid = `cap-${process.pid}-${Date.now()}`;
  const third = Math.floor(BIG_LINES * 0.3);
  assert.equal(read({ file_path: BIG, offset: 1, limit: third }, sid), 0, 'first 30%');
  assert.equal(read({ file_path: BIG, offset: third + 1, limit: third }, sid), 0, 'second 30% - at the cap');
  assert.equal(read({ file_path: BIG, offset: 2 * third + 1, limit: third }, sid), 2, 'third 30% reconstructs the file');
  assert.equal(read({ file_path: BIG, offset: 2 * third + 1, limit: third }, `${sid}-other`), 0, 'the cap is per session');
});

test('guard-read-whole-file: runtime dumps, file redirects, multi-file cats and unresolvable paths on Bash', () => {
  const noRoot = { ...process.env, CLAUDE_PROJECT_DIR: '' };
  assert.equal(bash('guard-read-whole-file.js', `node -e "console.log(require('fs').readFileSync('${BIG}','utf8'))"`), 2, 'node readFileSync dump');
  assert.equal(bash('guard-read-whole-file.js', `ruby -e "puts File.read('${BIG}')"`), 2, 'ruby File.read dump');
  assert.equal(bash('guard-read-whole-file.js', `cat ${BIG} > ${path.join(TMP, 'copy.js')}`), 0, 'a redirect into a file is a copy, not a dump');
  assert.equal(bash('guard-read-whole-file.js', `cat ${BIG} 2>&1`), 2, 'an fd redirect still prints');
  assert.equal(bash('guard-read-whole-file.js', `cat ${SMALL} ${BIG}`), 2, 'every file of a multi-file cat is sized');
  const rel = (payload, cwd) => runIn('guard-read-whole-file.js', { tool_name: 'Bash', ...payload }, { cwd, env: noRoot }).status;
  assert.equal(rel({ tool_input: { command: 'cat scripts/lint-skills.js' } }, TMP), 2, 'a relative path that resolves nowhere fails CLOSED');
  assert.equal(rel({ tool_input: { command: 'cat scripts/lint-skills.js' }, cwd: REPO }, TMP), 2, 'anchored on the session cwd it is sized - and blocked');
  assert.equal(rel({ tool_input: { command: 'cat stack/hooks/guard-fresh-session-start.js' }, cwd: REPO }, TMP), 0, 'anchored and small - passes');
});

test('guard-protected-force-push: the protected-branch matrix', () => {
  const fp = (c) => bash('guard-protected-force-push.js', c);
  for (const c of ['git push origin :main', 'git push -d origin develop', 'git push origin +main', 'git -C /tmp/x push --force origin master',
    'git push --mirror origin', 'git push origin "main" --force', 'git push --force origin refs/heads/main', 'npm test && git push --force origin main',
    'git push origin HEAD:main --force', 'git push -uf origin main', 'git push --force-with-lease=main:abc origin main', 'git push --all --force',
    'GIT_SSH_COMMAND=ssh git push -f origin main', 'git push -f origin main; echo done', "git push origin 'main' -d"]) {
    assert.equal(fp(c), 2, `must block: ${c}`);
  }
  for (const c of ['git push --force-with-lease origin feature/x', 'git push origin main', 'git push origin feature:main', 'git push --follow-tags origin main',
    'echo "git push --force origin main"', 'git commit -m "no git push --force to main"', 'git push origin --delete feature/x', 'git push -u origin feature/x']) {
    assert.equal(fp(c), 0, `must allow: ${c}`);
  }
});

test('guard-protected-force-push: a bare force targets HEAD, judged from the session cwd', () => {
  const dir = scratchRepoOn('main');
  const fp = (c, cwd) => run('guard-protected-force-push.js', { tool_name: 'Bash', tool_input: { command: c }, cwd });
  assert.equal(fp('git push -f', dir), 2, 'bare -f on main');
  assert.equal(fp('git push', dir), 0, 'a plain push to main is fast-forward work');
  spawnSync('git', ['-C', dir, 'checkout', '-qb', 'feature/z']);
  assert.equal(fp('git push -f', dir), 0, 'bare -f on a feature branch');
  assert.equal(fp('git push -f', TMP), 0, 'outside a repo the guard fails open');
});

test('guard-catastrophic-rm: the catastrophic-target matrix', () => {
  const rm = (c) => bash('guard-catastrophic-rm.js', c);
  for (const c of ['rm -rf /', 'rm -rf /*', 'rm -rf /usr /lib', 'rm -rf .', 'rm -rf ./', 'rm -rf *', 'rm -rf "$HOME"/*', 'rm -rf ${HOME}',
    'rm -rf /home/../', 'rm -rf $PWD', 'sudo rm -rf /', 'cd x && rm -rf *', 'rm --recursive ~/', 'rm -rf -- /', 'rm -r -f "/"',
    'rm -rf dist; rm -rf /', 'rm -rf ..', 'rm -rf ../*', 'rm -rf a/../..']) {
    assert.equal(rm(c), 2, `must block: ${c}`);
  }
  for (const c of ['rm -rf bin obj node_modules', 'git commit -m "rm -rf /"', 'rm -f /', 'rm -rf ./build/*', 'rm -rf /tmp/*', 'rm -rf ~/projects',
    'echo rm -rf /', 'rm -rf ./build 2>&1', 'rm -rf /usr/', 'find . -name "*.o" -delete']) {
    assert.equal(rm(c), 0, `must allow: ${c}`);
  }
});

test('guard-ungated-commit: untracked-only new files are churn, not an empty tree', () => {
  // The defect this pins: `git diff HEAD` never lists untracked files, so a feature landing in
  // new files only read as 'nothing to commit' and passed ungated (reproduced).
  const dir = cleanRepo();
  for (const f of ['n1.txt', 'n2.txt', 'n3.txt']) fs.writeFileSync(path.join(dir, f), forty());
  assert.equal(gateIn(dir, 'git add -A && git commit -m "feat: new module"'), 2, 'three 40-line new files are not trivial');
  fs.unlinkSync(path.join(dir, 'n2.txt')); fs.unlinkSync(path.join(dir, 'n3.txt')); fs.writeFileSync(path.join(dir, 'n1.txt'), 'one line\n');
  assert.equal(gateIn(dir, 'git add -A && git commit -m "add note"'), 0, 'one small new file is the trivial class');
});

test('guard-ungated-commit: trivial diffs, clean trees, non-commits and non-repos pass', () => {
  const dir = cleanRepo();
  assert.equal(gateIn(dir, 'git commit -am x'), 0, 'a clean tree - let git say so');
  fs.appendFileSync(path.join(dir, 'seed.txt'), 'fix\n');
  assert.equal(gateIn(dir, 'git commit -am typo'), 0, 'one file, one line');
  assert.equal(gateIn(dir, 'git log --grep commit'), 0, 'not a commit');
  assert.equal(gateIn(TMP, 'git commit -am x'), 0, 'outside a repo the guard fails open');
});

test('guard-ungated-commit: the receipt states', () => {
  const dir = scratchRepo();
  const gate = path.join(dir, '.claude', 'docs', 'flow', 'COMMIT-GATE');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const receipt = (s) => fs.writeFileSync(gate, s);
  receipt('WAIVED - "skip the review"\n'); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'WAIVED');
  receipt('VERIFIED scope\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'VERIFIED without the authorized line');
  receipt('VERIFIED scope\nauthorized: yes\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'an authorized line with no quoted words');
  receipt('VERIFIED scope\nauthorized: PENDING - append the words\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a PENDING placeholder');
  receipt('VERIFIED scope\nauthorized: "commit it"\n'); assert.equal(gateIn(dir, 'git commit -am x'), 0, 'VERIFIED plus quoted consent');
  const old = (Date.now() - 3 * 3600 * 1000) / 1000; fs.utimesSync(gate, old, old);
  assert.equal(gateIn(dir, 'git commit -am x'), 2, 'a 3h-old receipt is absent');
  receipt('garbage\n'); assert.equal(gateIn(dir, 'git commit -am x'), 2, 'an unrecognized first line');
  fs.unlinkSync(gate);
  assert.equal(gateIn(dir, `printf 'VERIFIED x\\nauthorized: "go"\\n' > .claude/docs/flow/COMMIT-GATE && git commit -am x`), 0, 'the atomic write+commit shape carries its receipt');
  assert.equal(gateIn(dir, `echo 'VERIFIED x' > .claude/docs/flow/COMMIT-GATE && git commit -am x`), 2, 'atomic VERIFIED without authorized:');
  assert.equal(gateIn(dir, 'git commit -am "COMMIT-GATE VERIFIED authorized: x > flow/COMMIT-GATE"'), 2, 'receipt words inside the commit message');
  fs.mkdirSync(path.join(dir, 'docs', 'flow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'flow', 'COMMIT-GATE'), 'WAIVED - "go"\n');
  assert.equal(gateIn(dir, 'git commit -am x', { CLAUDE_DOCS_PATH: 'docs' }), 0, 'the receipt is looked up under CLAUDE_DOCS_PATH');
});

test('guard-ungated-commit: a cd or -C into a sibling repo judges THAT tree', () => {
  const home = cleanRepo();
  const sib = scratchRepo();
  assert.equal(gateIn(home, 'git commit -am x'), 0, 'the clean home repo passes');
  assert.equal(gateIn(home, `cd ${sib} && git commit -am x`), 2, 'cd into the dirty sibling');
  assert.equal(gateIn(home, `git -C "${sib}" commit -am x`), 2, '-C into the dirty sibling');
});

test('guard-unapproved-dispatch: the stamp lifecycle', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  const disp = (seat, env = {}) => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env } }).status;
  assert.equal(disp('aspnet-implementer'), 2, 'implementer with no stamp');
  assert.equal(disp('aspnet-solution-designer'), 0, 'a designer needs no stamp');
  assert.equal(disp('general-purpose'), 0, 'a generic seat outside a flow');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go ahead"\n');
  assert.equal(disp('aspnet-implementer'), 0, 'stamped');
  assert.equal(disp('general-purpose'), 2, 'a generic seat while a flow is stamped');
  assert.equal(disp('claude'), 2, 'the other generic seat');
  assert.equal(disp('Explore'), 0, 'a read-only built-in');
  assert.equal(disp('aspnet-verifier'), 0, 'a verifier');
  fs.writeFileSync(gate, 'AUTO - "run without stops"\n'); assert.equal(disp('wpf-implementer'), 0, 'the AUTO waiver');
  fs.writeFileSync(gate, 'approved maybe\n'); assert.equal(disp('wpf-implementer'), 2, 'a first line that is neither APPROVED nor AUTO');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  const old = (Date.now() - 9 * 3600 * 1000) / 1000; fs.utimesSync(gate, old, old);
  assert.equal(disp('wpf-implementer'), 2, 'a 9h-old stamp is absent');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  assert.equal(disp('wpf-implementer', { CLAUDE_DOCS_PATH: 'docs' }), 2, 'the stamp is looked up under CLAUDE_DOCS_PATH');
});

test("guard-unapproved-dispatch: a stamp written before this session began is another session's consent", () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const gate = path.join(root, '.claude', 'docs', 'flow', 'APPROVAL');
  fs.mkdirSync(path.dirname(gate), { recursive: true });
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  pause(50);
  const tp = path.join(root, 'session.jsonl');
  fs.writeFileSync(tp, '{}\n'); pause(20); fs.appendFileSync(tp, '{}\n'); // born after the stamp, then grown like a real transcript
  const disp = () => runIn('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: 'wpf-implementer' }, transcript_path: tp },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status;
  assert.equal(disp(), 2, 'the stamp predates the session');
  fs.writeFileSync(gate, 'APPROVED plan-1 - "go"\n');
  assert.equal(disp(), 0, 'a stamp written during the session');
});

test('guard-stop-contract: the AskUserQuestion gate never interrupts a response', () => {
  // It used to deny an ask carrying no fresh-session option, which stopped Claude mid-response to
  // rebuild the question. The offer moved to the Stop wiring, so every ask now passes.
  const logDir = fs.mkdtempSync(path.join(TMP, 'asklog-'));
  const hot = transcript('ask-hot', [assistantRow('h1', 'ok', { cache_read_input_tokens: 900000 })]);
  const ask = (options) => runIn('guard-stop-contract.js',
    { tool_name: 'AskUserQuestion', hook_event_name: 'PreToolUse', transcript_path: hot, tool_input: { questions: [{ question: 'Which next?', options }] } },
    { env: { ...process.env, CLAUDE_STACK_HOOK_LOG_DIR: logDir } }).status;
  assert.equal(ask([{ label: 'Continue', description: 'x' }, { label: 'Stop', description: 'y' }]), 0, 'no fresh option, deep into a 1M session - still passes');
  assert.equal(ask([{ label: 'Fresh session', description: 'resume' }]), 0, 'and so does one that has it');
});

test('guard-stop-contract: prose offers, tool-call ends, continuations and unreadable turns', () => {
  const stop = (tp, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, ...extra });
  assert.equal(stop(transcript('p1', [assistantRow('a', 'Patch is ready. Say the word and I will push it.')])), 2, "'say the word'");
  assert.equal(stop(transcript('p2', [assistantRow('a', 'All green. Want me to open the PR?')])), 2, "'want me to'");
  assert.equal(stop(transcript('p3', [{ type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'Want me to push?' }, { type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }])), 0, 'ended on a tool call');
  assert.equal(stop(transcript('p4', [assistantRow('a', 'Want me to push?')]), { stop_hook_active: true }), 0, 'a continuation we caused');
  assert.equal(stop(path.join(TMP, 'absent-stop.jsonl')), 0, 'missing transcript');
  assert.equal(stop(transcript('p5', [{ type: 'assistant', message: { id: 'c', content: [{ type: 'thinking', thinking: 'hm' }] } }])), 0, 'no text at all');
  assert.equal(stop(transcript('p6', [assistantRow('a', 'Is it safe? Yes - the guard fails closed.')])), 0, 'a question answered in the same breath');
  assert.equal(run('guard-stop-contract.js', { hook_event_name: 'PreCompact' }), 0, 'an unrelated event');
});

test('guard-stop-contract: last_assistant_message wins over a lagging transcript', () => {
  // The harness documents the transcript as written asynchronously: here it still holds the
  // PREVIOUS turn's clean close while the payload field carries this turn's decision stop.
  const lag = transcript('lag', [assistantRow('old', 'Fixed and committed; nothing pending.')]);
  const stop = (extra) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: lag, ...extra });
  assert.equal(stop({}), 0, 'the transcript alone reads clean');
  assert.equal(stop({ last_assistant_message: 'Two options for the deploy target. Which one should we go with?' }), 2, 'the field carries the decision stop');
  assert.equal(stop({ last_assistant_message: 'Fixed and committed; nothing pending.' }), 0, 'a clean close in the field');
  assert.equal(stop({ last_assistant_message: '' }), 0, 'an empty field falls back to the transcript');
});

test('guard-fresh-session-start: other tools, unreadable transcripts, the name field and the exact threshold', () => {
  const hot = transcript('fs-hot', [assistantRow('m', 'ok', { cache_read_input_tokens: 190000 })]);   // 200k tier: past the 150k floor
  const call = (payload) => run('guard-fresh-session-start.js', payload);
  assert.equal(call({ tool_name: 'Read', tool_input: { file_path: 'x.ts' }, transcript_path: hot }), 0, 'not a Skill call');
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'project-quality-loop' }, transcript_path: path.join(TMP, 'absent-fs.jsonl') }), 0, 'no transcript - fail open');
  assert.equal(call({ tool_name: 'Skill', tool_input: { name: 'project-solve-task' }, transcript_path: hot }), 2, 'the name field spelling');
  const edge = transcript('fs-edge', [assistantRow('m', 'ok', { cache_read_input_tokens: 150000 })]);
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'project-solve-task' }, transcript_path: edge }), 0, 'exactly 150k is not past it');
  const sum = transcript('fs-sum', [assistantRow('m', 'ok', { cache_read_input_tokens: 100000, cache_creation_input_tokens: 40000, input_tokens: 10001 })]);
  assert.equal(call({ tool_name: 'Skill', tool_input: { skill: 'project-solve-task' }, transcript_path: sum }), 2, 'the three usage fields add up');
});

test('instrument-tool-usage: off by default, one JSONL row per call when switched on, never blocks', () => {
  const log = path.join(TMP, 'ledger.jsonl');
  const inst = (payload, env) => runIn('instrument-tool-usage.js', payload, { env: { ...process.env, CLAUDE_STACK_INSTRUMENT_LOG: log, ...env } }).status;
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1' }, { CLAUDE_STACK_INSTRUMENT: '0' }), 0);
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1' }, { CLAUDE_STACK_INSTRUMENT: '' }), 0);
  assert.equal(fs.existsSync(log), false, 'nothing is written while the switch is off');
  assert.equal(inst({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1', cwd: '/x' }, { CLAUDE_STACK_INSTRUMENT: '1' }), 0);
  assert.equal(inst({ tool_name: 'Bash', tool_input: { command: 'cat secret', description: 'run tests' }, session_id: 's1' }, { CLAUDE_STACK_INSTRUMENT: 'true' }), 0);
  assert.equal(inst({ tool_name: 'mcp__serena__find_symbol', tool_input: {}, session_id: 's1' }, { CLAUDE_STACK_INSTRUMENT: '1' }), 0);
  const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.tool, r.detail]), [['Read', 'c.ts'], ['Bash', 'run tests'], ['mcp__serena__find_symbol', 'serena']]);
  assert.ok(!JSON.stringify(rows).includes('secret'), 'a command body is never logged');
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'instrument-tool-usage.js')], { input: 'not json', encoding: 'utf8',
    env: { ...process.env, CLAUDE_STACK_INSTRUMENT: '1', CLAUDE_STACK_INSTRUMENT_LOG: log } }).status, 0, 'bad input never blocks');
  const root = fs.mkdtempSync(path.join(TMP, 'inst-'));
  assert.equal(inst({ tool_name: 'Grep', tool_input: { pattern: 'x' }, session_id: 'sid/../up' },
    { CLAUDE_STACK_INSTRUMENT: '1', CLAUDE_STACK_INSTRUMENT_LOG: '', CLAUDE_PROJECT_DIR: root, CLAUDE_DOCS_PATH: 'docs' }), 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'docs', 'tools-usage')), ['sid..up.jsonl'], 'default ledger under the docs root, session id sanitized');
});

test('guard-unapproved-dispatch: a symbol question never goes to a grep-shaped seat', () => {
  const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const disp = (seat, prompt) => runIn('guard-unapproved-dispatch.js',
    { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).status;

  // the measured case: a C# symbol hunt handed to the built-in Explore, which greps
  assert.equal(disp('Explore', 'Find who calls SocketConnection.Send'), 2, 'callers question');
  assert.equal(disp('Explore', 'Where is ISocketFactory declared?'), 2, 'declaration question');
  assert.equal(disp('Explore', 'find the class SocketConnection'), 2, 'named-symbol hunt');
  assert.equal(disp('general-purpose', 'list all usages of AddSocketServices'), 2, 'the generic seat too');

  // a real sweep still passes - no stamp involved, so this is the no-flow path
  assert.equal(disp('Explore', 'Map the auth module and report which files configure logging'), 0, 'a broad sweep');
  assert.equal(disp('Explore', 'x'), 0, 'an empty brief');
  assert.equal(disp('aspnet-verifier', 'who calls Foo'), 0, 'a named seat carries serena itself');
});

test('guard-stop-contract: the fresh-session offer lands at turn end, once per cost step', () => {
  const logDir = fs.mkdtempSync(path.join(TMP, 'freshstop-'));
  const at = (name, ctx, text) => transcript(name, [assistantRow(name, text || 'Applied the change; tests pass.', { cache_read_input_tokens: ctx })]);
  const stop = (tp) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: { ...process.env, CLAUDE_STACK_HOOK_LOG_DIR: logDir } }).status;

  assert.equal(stop(at('fs-cold', 300000)), 0, '300k on a 1M window is under 40% - nothing to offer');
  const s1 = at('fs-hot', 500000);
  assert.equal(stop(s1), 2, 'a CLEAN close past the trigger: held once so the user is asked');
  assert.equal(stop(s1), 0, 'the same session again - already asked at this cost step');
  assert.equal(stop(at('fs-hot', 700000)), 0, 'still under 1.5x of the last offer');
  assert.equal(stop(at('fs-hot', 760000)), 2, 're-armed at the next cost step');
  assert.equal(stop(at('fs-fresh', 900000, 'Done. Worth continuing in a fresh session from the plan file.')), 0,
    'a turn that already made the offer is left alone');
  assert.equal(stop(at('fs-other', 500000)), 2, 'another session is asked on its own first clean close');
});

test('guard-stop-contract: CLAUDE_STACK_FRESH_SESSION_PCT=0 turns the offer off', () => {
  // A `parseInt(...) || 40` fallback used to swallow the 0 and re-enable what the user disabled.
  const logDir = fs.mkdtempSync(path.join(TMP, 'freshoff-'));
  const tp = transcript('fs-off', [assistantRow('fs-off', 'Applied the change; tests pass.', { cache_read_input_tokens: 900000 })]);
  const stop = (pct) => runIn('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp },
    { env: { ...process.env, CLAUDE_STACK_HOOK_LOG_DIR: logDir, CLAUDE_STACK_FRESH_SESSION_PCT: pct } }).status;

  assert.equal(stop('0'), 0, '0 disables the offer outright');
  assert.equal(stop('40'), 2, 'and the same session still qualifies at the default');
});

// --- guard-cross-project-write: one session, one project -------------------
// Both directions carry equal weight here: a gate that fires on an ordinary in-project write
// would block almost every turn, so the passes are as load-bearing as the blocks.
const XP_ROOT = fs.mkdtempSync(path.join(TMP, 'projA-'));
const XP_OTHER = fs.mkdtempSync(path.join(TMP, 'projB-'));
const xp = (payload) => {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: XP_ROOT, CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: '' },
  });
  return r.status;
};
const xpWrite = (file) => xp({ tool_name: 'Write', tool_input: { file_path: file } });
const xpBash = (command) => xp({ tool_name: 'Bash', tool_input: { command } });

test('guard-cross-project-write: a write into another project is blocked', () => {
  assert.equal(xpWrite(path.join(XP_OTHER, 'src', 'a.ts')), 2, 'an absolute path in the sibling repo');
  assert.equal(xpWrite('../projB/src/a.ts'), 2, 'the same reach expressed relatively');
  assert.equal(xp({ tool_name: 'Edit', tool_input: { file_path: path.join(XP_OTHER, 'a.cs') } }), 2, 'Edit too');
  assert.equal(xp({ tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(XP_OTHER, 'a.ipynb') } }), 2, 'and NotebookEdit');
});

test('guard-cross-project-write: the shell routes around the file tools the same way', () => {
  assert.equal(xpBash(`echo x > ${path.join(XP_OTHER, 'f.txt')}`), 2, 'redirection into the other repo');
  assert.equal(xpBash('printf y >> ../projB/f.txt'), 2, 'appending, relative');
  assert.equal(xpBash(`cp build/out.js ${path.join(XP_OTHER, 'vendor', 'out.js')}`), 2, 'a copy destination');
  assert.equal(xpBash(`git -C ${XP_OTHER} commit -m "fix"`), 2, 'a commit in another checkout');
  assert.equal(xpBash(`rm -rf ${path.join(XP_OTHER, 'dist')}`), 2, 'a delete outside the project');
  assert.equal(xpBash(`sed -i.bak 's/a/b/' ${path.join(XP_OTHER, 'f.txt')}`), 2, 'an in-place edit');
  // `mv` removes its SOURCE, so an out-of-tree source is a write there even when the
  // destination is local - a destination-only rule waves this through.
  assert.equal(xpBash(`mv ${path.join(XP_OTHER, 'a.txt')} ./b.txt`), 2, 'moving a file OUT of the other project');
  assert.equal(xpBash('mv src/a.ts src/b.ts'), 0, 'but our own rename is ordinary work');
});

test('guard-cross-project-write: reading and investigating the other project stays open', () => {
  // The whole point of the gate is that the handoff card must be SPECIFIC, which takes reading B.
  assert.equal(xpBash(`cat ${path.join(XP_OTHER, 'src', 'a.ts')}`), 0, 'reading a file there');
  assert.equal(xpBash(`grep -rn "Foo" ${XP_OTHER}`), 0, 'searching there');
  assert.equal(xpBash(`git -C ${XP_OTHER} log --oneline -5`), 0, 'read-only git in the other checkout');
  assert.equal(xpBash(`git -C ${XP_OTHER} diff HEAD~1`), 0, 'and a diff');
  assert.equal(xp({ tool_name: 'Read', tool_input: { file_path: path.join(XP_OTHER, 'a.ts') } }), 0, 'Read is not even matched');
});

test('guard-cross-project-write: ordinary in-project work is never touched', () => {
  assert.equal(xpWrite(path.join(XP_ROOT, 'src', 'a.ts')), 0, 'an absolute path inside the project');
  assert.equal(xpWrite('src/a.ts'), 0, 'a relative path inside the project');
  assert.equal(xpBash('echo x > out.txt'), 0, 'redirection to a relative file');
  assert.equal(xpBash('npm test 2>&1 | tail -3'), 0, '2>&1 is not a file target');
  assert.equal(xpBash('node build.js > dist/bundle.js'), 0, 'a build output inside the tree');
  assert.equal(xpBash("sed -i.bak 's/a/b/' src/a.ts"), 0, 'an in-place edit of our own file');
  assert.equal(xpBash('rm -rf node_modules'), 0, 'cleaning our own tree');
  assert.equal(xpBash('mkdir -p src/nested'), 0, 'making our own directory');
});

test('guard-cross-project-write: the session\'s own scratch and the account dir stay writable', () => {
  // A real project does not live in the temp tree, so this case runs with THIS repo as the
  // root - the fixtures above deliberately do, which is what proves the containment rule.
  const repoRoot = path.join(__dirname, '..');
  const inRepo = (payload) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: '' } }).status;
  const w = (f) => inRepo({ tool_name: 'Write', tool_input: { file_path: f } });

  assert.equal(w(path.join(os.tmpdir(), 'scratch', 'notes.md')), 0, 'the harness scratchpad');
  assert.equal(inRepo({ tool_name: 'Bash', tool_input: { command: 'echo x > /tmp/probe.txt' } }), 0, 'a temp file from the shell');
  const home = os.homedir();
  if (home) assert.equal(w(path.join(home, '.claude', 'projects', 'p', 'memory', 'm.md')), 0, 'memory writes must keep working');
  assert.equal(w(path.join(path.dirname(repoRoot), 'some-other-repo', 'src', 'a.ts')), 2, 'a real sibling repo is still blocked');
});

test('guard-cross-project-write: prose describing a command is not a command', () => {
  // The measured false-positive class: a plan or report that QUOTES a dangerous command is
  // inert text, and blocking the document write for its own prose stalls honest work.
  assert.equal(xpBash(heredoc('Then run: echo x > /etc/hosts')), 0, 'a heredoc body is data');
  assert.equal(xpBash('echo "writes go to ../projB/f.txt" '), 0, 'a quoted mention is not a redirection');
});

test('guard-cross-project-write: it fails open rather than guessing', () => {
  assert.equal(xpBash('cp a.txt "$OTHER_REPO/a.txt"'), 0, 'an unexpanded variable is not judged');
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: 'not json', encoding: 'utf8' }).status, 0, 'unparseable stdin never blocks');
  const opened = spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(XP_OTHER, 'a.ts') } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: XP_ROOT, CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: XP_OTHER },
  }).status;
  assert.equal(opened, 0, 'the escape hatch opens a second tree this project really owns');
});

// --- block telemetry: the block RATE is what says a gate earns its keep ----
// Measured 2026-09-04: hooks cost 22-25ms, essentially all of it the node spawn, so their
// runtime is not the risk - a FALSE block is, because it costs the denial text plus a whole
// retried turn. Until this ledger existed the per-hook block count was unmeasurable.
test('guard hooks record every block, and nothing on a pass', () => {
  const proj = fs.mkdtempSync(path.join(TMP, 'blocklog-'));
  const run = (hook, payload) => spawnSync(process.execPath, [path.join(HOOKS, hook)], {
    input: JSON.stringify({ session_id: 'sess1', hook_event_name: 'PreToolUse', ...payload }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
  }).status;
  const ledger = () => {
    const f = path.join(proj, '.claude', 'docs', 'hook-blocks', 'sess1.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };

  assert.equal(run('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), 0);
  assert.deepEqual(ledger(), [], 'a pass writes nothing - the ledger is blocks only');

  assert.equal(run('guard-catastrophic-rm.js', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), 2);
  assert.equal(run('guard-cross-project-write.js', { tool_name: 'Write', tool_input: { file_path: '/etc/elsewhere/x.ts' } }), 2);
  assert.equal(run('guard-unapproved-dispatch.js', { tool_name: 'Task', tool_input: { subagent_type: 'Explore', prompt: 'who calls Foo' } }), 2);

  const rows = ledger();
  assert.equal(rows.length, 3, 'one row per block');
  assert.deepEqual(rows.map((r) => r.hook).sort(),
    ['guard-catastrophic-rm.js', 'guard-cross-project-write.js', 'guard-unapproved-dispatch.js']);
  for (const r of rows) {
    assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/, 'timestamped');
    assert.equal(r.event, 'PreToolUse', 'carries the event that was blocked');
    assert.ok(['Bash', 'Task', 'Write'].includes(r.tool), 'and the TOOL - the event alone is PreToolUse for every guard, which says nothing');
    assert.match(r.reason, /^Blocked|^Refusing/, 'carries the first line of the denial');
    assert.ok(r.reason.length <= 200, 'reason is capped - a ledger is not a transcript');
  }
});

test('block telemetry never interferes with the gate', () => {
  // An unwritable docs root must not turn a block into a pass, nor a pass into an error.
  const proj = fs.mkdtempSync(path.join(TMP, 'blockro-'));
  fs.mkdirSync(path.join(proj, '.claude', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'docs', 'hook-blocks'), 'not a directory');
  const run = (cmd) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-catastrophic-rm.js')], {
    input: JSON.stringify({ session_id: 's', tool_name: 'Bash', tool_input: { command: cmd } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
  });
  const blocked = run('rm -rf /');
  assert.equal(blocked.status, 2, 'still blocks when the ledger cannot be written');
  assert.match(blocked.stderr, /Refusing/, 'and the model still gets the reason');
  assert.equal(run('npm test').status, 0, 'and an ordinary command still passes');
});

// --- hooks audit 2026-09-04: the cross-project guard's remaining routes, each pinned from a probe
// that reproduced the wrong verdict before the fix (a pass on a real cross-repo write, or a block
// on honest in-project work). The fixtures above are reused: XP_ROOT is the project, XP_OTHER the sibling.
test('guard-cross-project-write: a cd into the other project moves the anchor for what follows', () => {
  assert.equal(xpBash(`cd ${XP_OTHER} && git commit -am x`), 2, 'cd then a bare git commit is the -C write, spelled the usual way');
  assert.equal(xpBash('cd ../projB && git add -A && git commit -m x'), 2, 'a relative cd, chained');
  assert.equal(xpBash(`cd ${XP_OTHER}; git add -A; git commit -m x`), 2, 'semicolon-chained');
  assert.equal(xpBash(`(cd ${XP_OTHER} && git commit -am x)`), 2, 'inside a subshell');
  assert.equal(xpBash(`pushd ${XP_OTHER} && git commit -am x`), 2, 'pushd too');
  assert.equal(xpBash(`cd ${XP_OTHER} && echo x > f.txt`), 2, 'a bare relative write after the cd lands over there');
  assert.equal(xpBash(`cd ${XP_OTHER} && git log --oneline -3 && cat f.txt`), 0, 'reading after the cd stays open');
  assert.equal(xpBash('cd src && echo x > ../out.txt'), 0, '../ from a subdirectory of our own project resolves inside it');
  assert.equal(xpBash('cd $OTHER && echo x > f.txt'), 0, 'an anchor that cannot be followed judges nothing relative');
  assert.equal(xpBash(`cd $OTHER && echo x > ${path.join(XP_OTHER, 'f.txt')}`), 2, '...while an absolute target is still judged');
});

test('guard-cross-project-write: prose inside quotes is not a write, and a heredoc keeps its own redirect', () => {
  assert.equal(xpBash(`git commit -m "fix: pipe > ${path.join(XP_OTHER, 'f.txt')}"`), 0, 'a > inside a commit message');
  assert.equal(xpBash(`echo "copy with: cp a ${path.join(XP_OTHER, 'b')}"`), 0, 'a verb inside an echo string');
  assert.equal(xpBash(`echo x > "${path.join(XP_OTHER, 'my file.txt')}"`), 2, 'a quoted TARGET is still a target');
  assert.equal(xpBash(`cat <<'EOF' > ${path.join(XP_OTHER, 'f.txt')}\nhello\nEOF`), 2, 'the heredoc line carries its redirect - only the body is data');
  assert.equal(xpBash(`cat > ${path.join(XP_OTHER, 'f.txt')} <<'EOF'\nhello\nEOF`), 2, 'either order');
});

test('guard-cross-project-write: every argument of an in-place edit or filesystem change is judged', () => {
  assert.equal(xpBash(`perl -pi -e 's/a/b/' ${path.join(XP_OTHER, 'f.txt')}`), 2, "perl's -pi cluster is an in-place edit");
  assert.equal(xpBash(`sed -i 's/a/b/' ${path.join(XP_OTHER, 'f.txt')} src/a.ts`), 2, 'the FIRST of two sed targets');
  assert.equal(xpBash(`rm -f a.txt ${path.join(XP_OTHER, 'b.txt')}`), 2, 'the second rm argument');
  assert.equal(xpBash(`mkdir -p x ${path.join(XP_OTHER, 'y')}`), 2, 'the second mkdir argument');
  assert.equal(xpBash(`truncate -s 0 ${path.join(XP_OTHER, 'log')}`), 2, 'truncate, after its size argument');
  assert.equal(xpBash(`chmod +x ${path.join(XP_OTHER, 'bin', 'x')}`), 2, 'chmod, after its mode');
  assert.equal(xpBash(`chown me ${path.join(XP_OTHER, 'bin', 'x')}`), 2, 'chown, after its owner');
  assert.equal(xpBash('chmod 755 bin/x && truncate -s 0 log && rm -f a b && perl -pi -e "s/a/b/" src/a.ts'), 0, 'the same verbs on our own files');
});

test('guard-cross-project-write: git listing forms in the other checkout are reads', () => {
  assert.equal(xpBash(`git -C ${XP_OTHER} stash list`), 0, 'stash list');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag`), 0, 'tag (list)');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag -l 'v*'`), 0, 'tag -l');
  assert.equal(xpBash(`git -C ${XP_OTHER} branch`), 0, 'branch (list)');
  assert.equal(xpBash(`git -C ${XP_OTHER} stash`), 2, 'a stash push is a write');
  assert.equal(xpBash(`git -C ${XP_OTHER} tag v1.0`), 2, 'creating a tag is a write');
  assert.equal(xpBash(`git -C ${XP_OTHER} branch -d x`), 2, 'deleting a branch is a write');
});

test('guard-cross-project-write: space account dirs, ~ in the allowance, and unresolvable roots', () => {
  const home = os.homedir();
  const repoRoot = path.join(__dirname, '..');
  const inRepo = (payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: '', ...env } }).status;
  if (home) {
    // A --space install keeps its memory under ~/.claude-<space>; the old check disabled that
    // allowance for every project living under HOME, i.e. every real project (reproduced).
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(home, '.claude-work', 'projects', 'p', 'memory', 'm.md') } }), 0, 'a space account dir');
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(home, '.claude-x', '..', 'elsewhere', 'f.txt') } }), 2, 'reaching back out of one');
    const owned = path.join(home, `claude-stack-owned-tree-${process.pid}`); // never created - realish resolves through the missing tail
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(owned, 'f.txt') } }), 2, 'a second tree under HOME is outside');
    assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(owned, 'f.txt') } }, { CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: '~' + owned.slice(home.length) }), 0, 'a ~ in the allowance expands');
  }
  assert.equal(inRepo({ tool_name: 'Write', tool_input: { file_path: path.join(XP_OTHER, 'f.txt') } }, { CLAUDE_PROJECT_DIR: '/nonexistent/root' }), 0, 'a root that does not exist fails open, as the header promises');
  // Without CLAUDE_PROJECT_DIR the nearest .git ancestor of the session cwd is the root - the cwd
  // itself may be a subdirectory the session cd-ed into, which called a sibling folder 'outside'.
  assert.equal(spawnSync(process.execPath, [path.join(HOOKS, 'guard-cross-project-write.js')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(repoRoot, 'stack', 'x.md') }, cwd: path.join(repoRoot, 'scripts') }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', CLAUDE_STACK_ALLOW_WRITE_OUTSIDE: '' },
  }).status, 0, 'a subdirectory cwd still sees the whole repo');
});

test('every guard fails open on a JSON scalar or null payload', () => {
  // `null` parses, so the parse guard let it through and the first field read threw a TypeError -
  // exit 1 with a stack trace surfaced as a hook error (reproduced on 7 of 9 guards).
  for (const hook of fs.readdirSync(HOOKS).filter((f) => f.startsWith('guard-'))) {
    for (const input of ['null', '"str"', '[]', '{"tool_name":"Bash","tool_input":null}']) {
      const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input, encoding: 'utf8' });
      assert.equal(r.status, 0, `${hook} on ${input}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || ''}`);
    }
  }
});
