// scripts/docs-session.test.js - the docs session hook, driven through stdin payloads in throwaway git repos.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { repo, section } = require('./docs-fixture');

let n = 0;
const sid = () => `docs-test-${process.pid}-${++n}`;
const ctx = (out) => { try { return JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') + '\n' + section('users', 'src/Api/Users/**', 'Users are soft-deleted.');
const ORIENT = 'Api -> Infrastructure -> Domain. Orders own refunds.\n';

test('session start pushes the orientation block and how to read by section', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    const out = r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    const text = ctx(out);
    assert.match(out.stdout, /"hookEventName":"SessionStart"/);
    assert.match(text, /Orders own refunds/);
    assert.match(text, /node \.claude\/hooks\/docs\.js where <path>/);
    assert.match(text, /node \.claude\/hooks\/docs\.js show <file>#<id>/);
    assert.match(text, /Before your first change under src\/ or tests\//);
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { CLAUDE_STACK_DOCS_BLOCK: '0' }).stdout, '');
  } finally { r.rm(); }
});

test('on a feature branch the start block names its overrides and conflicts', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.'), 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 10.\n');
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 20.\n');
    r.git('switch', '-q', 'feat/cap');
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /You are on branch feat\/cap\. 1 doc section\(s\) hold this branch's own decisions and replace mainline's in every read: patterns#orders/);
    assert.match(text, /Conflicts: patterns#orders/);
  } finally { r.rm(); }
});

test('on mainline the start hook promotes a merged branch and says so', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n'); r.git('commit', '-qam', 'cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are capped at 10.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    // The id, not just the count: a merged decision the session is never told the name of is one it never reads.
    assert.match(text, /Branch feat\/cap was merged: 1 doc section\(s\) folded into mainline and now hold its decisions: patterns#orders\./);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"promote"/);
    assert.ok(!r.exists('.claude/docs-log.jsonl'), 'the ledger lives under the docs root, beside hook-blocks');
  } finally { r.rm(); }
});

// One log file, many sessions: without the id the rows of two sessions cannot be told apart.
test('every log row carries the session it came from', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    const one = sid();
    const two = sid();
    r.git('switch', '-qc', 'feat/logged');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n'); r.git('commit', '-qam', 'cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are capped at 10.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/logged');
    r.hook({ hook_event_name: 'SessionStart', session_id: one });
    r.hook({ hook_event_name: 'PreToolUse', session_id: two, tool_name: 'Edit', tool_input: { file_path: 'src/Api/Orders/Refund.cs' } });
    const all = r.read('.claude/docs/docs-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    // `doc-set` rows come from the docs.js CLI, which is a plain command and has no session to name.
    const rows = all.filter((x) => x.event !== 'doc-set');
    assert.ok(rows.length >= 2, 'both sessions logged');
    assert.ok(rows.every((x) => x.session), 'no hook row is missing its session');
    assert.strictEqual(rows.find((x) => x.event === 'promote').session, one);
    assert.ok(rows.some((x) => x.event === 'hold' && x.session === two), 'the second session is told apart');
  } finally { r.rm(); }
});

// A branch sitting on mainline with nothing to prove it landed is the one case the engine cannot decide. It used to
// be reported nowhere: the branch is alive, so it is not a deleted-unmerged row, and no promote ever picks it up.
test('the start block names a live branch sitting on mainline with no proof it merged', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/behind');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStill being decided.\n');
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'develop');
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })),
      /Doc versions of branches sitting on mainline with no proof they merged: feat-behind/);
  } finally { r.rm(); }
});

test('the start block names conflict markers and duplicate ids, and a detached HEAD', () => {
  const r = repo({ tracked: true, docs: { 'references/patterns.md': `${PATTERNS}\n<<<<<<< HEAD\nA.\n=======\nB.\n>>>>>>> feat\n`, 'ORIENTATION.md': ORIENT } });
  try {
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /The docs need a repair before they are trusted: merge conflict markers in references\/patterns/);
    r.git('checkout', '-q', '--detach');
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /Detached HEAD: the docs are read-only/);
  } finally { r.rm(); }
});

test('subagent start gets the orientation without branch lines or promotion', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nBranch rule.\n');
    const out = r.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_type: 'dotnet-implementer' });
    assert.match(out.stdout, /"hookEventName":"SubagentStart"/);
    assert.match(ctx(out), /Orders own refunds/);
    assert.doesNotMatch(ctx(out), /You are on branch/);
  } finally { r.rm(); }
});

test('no docs folder, garbage stdin, unknown event: silent and exit 0', () => {
  const r = repo({});
  try {
    const a = r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    assert.strictEqual(a.status, 0); assert.strictEqual(a.stdout, '');
    const b = require('node:child_process').spawnSync(process.execPath, [require('./docs-fixture').HOOKS + '/docs-session.js'], { cwd: r.root, input: 'not json', encoding: 'utf8' });
    assert.strictEqual(b.status, 0); assert.strictEqual(b.stdout, '');
    assert.strictEqual(r.hook({ hook_event_name: 'Notification', session_id: sid() }).stdout, '');
  } finally { r.rm(); }
});

const pre = (tool, input, session) => ({ hook_event_name: 'PreToolUse', session_id: session, tool_name: tool, tool_input: input });
const denied = (out) => /"permissionDecision":"deny"/.test(out.stdout);

test('the first source change is held and handed the covering section; a show unlocks it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.ok(denied(held));
    assert.match(held.stdout, /patterns#orders covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /ledgered before the payment call/);
    assert.match(r.read('.claude/docs/hook-blocks/' + s + '.jsonl'), /"hook":"docs-session\.js"/);
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s))), 'the handed-over section counts as read');
    const s2 = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show patterns#orders 2>&1' }, s2));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s2))));
  } finally { r.rm(); }
});

// The scenario this feature exists for: a teammate's branch merges and its decision is folded into mainline before
// turn one. That decision was written about a whole feature area, so three narrower sections outranked it and the
// gate never offered it - measured twice on a paid run, and the session failed the task both times. A decision that
// arrived in THIS session's fold is what the gate hands over, wherever the ranking would have put it.
test('a decision just folded in from a merged branch is what the gate hands over', () => {
  const NARROW = ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n');
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Orders/Order.cs': 'class Order {}\n', 'tests/Zeta/Quux.cs': 'x\n' },
    docs: { 'references/patterns.md': NARROW, 'references/boundaries.md': section('paging', 'src/**', 'Pages hold 20 rows.') },
  });
  try {
    r.git('switch', '-qc', 'feat/drawer');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Page; }\n'); r.git('commit', '-qam', 'drawer');
    r.cli(['set', 'boundaries#paging'], '## paging\n<!-- id: paging -->\n<!-- covers: src/** -->\nA drawer list holds at most 10 rows.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/drawer');
    // Before the fold is announced to a session, the three narrower sections fill the answer, as they should.
    const plain = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, sid()));
    assert.match(plain.stdout, /patterns#a covers src\/Api\/Orders\/Refund\.cs/, 'the narrowest answers first');
    assert.doesNotMatch(plain.stdout, /boundaries#paging/);
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s });
    // A folded decision is never noise on a path it says nothing about.
    assert.doesNotMatch(r.hook(pre('Edit', { file_path: 'tests/Zeta/Quux.cs' }, s)).stdout, /boundaries#paging/);
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.ok(denied(held));
    assert.match(held.stdout, /boundaries#paging covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /at most 10 rows/);
    assert.match(held.stdout, /Also covering it: patterns#a/, 'the ranking still fills the rest');
  } finally { r.rm(); }
});

// Two boundaries at once: a fold never takes the last slot, so the ranking always still answers; and the fold
// reaches the gate even where the start block is switched off - that switch silences text, it does not blind a gate.
test('a fold of two sections leaves the ranking its slot, block or no block', () => {
  const NARROW = ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n');
  const BOUNDS = `${section('paging', 'src/**', 'Pages hold 20 rows.')}\n${section('envelope', 'src/**', 'Every route returns the envelope.')}`;
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': NARROW, 'references/boundaries.md': BOUNDS } });
  try {
    r.git('switch', '-qc', 'feat/drawer');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Page; }\n'); r.git('commit', '-qam', 'drawer');
    r.cli(['set', 'boundaries#paging'], '## paging\n<!-- id: paging -->\n<!-- covers: src/** -->\nA drawer list holds at most 10 rows.\n');
    r.cli(['set', 'boundaries#envelope'], '## envelope\n<!-- id: envelope -->\n<!-- covers: src/** -->\nA drawer list is enveloped like the rest.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/drawer');
    const s = sid();
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: s }, { CLAUDE_STACK_DOCS_BLOCK: '0' }).stdout, '', 'no block text');
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.match(held.stdout, /boundaries#paging covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /Also covering it: boundaries#envelope .*patterns#a /, 'the second fold, then the ranking');
  } finally { r.rm(); }
});

test('where, toc and status do not unlock; a Read of a doc file does', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js where src/Api/Orders' }, s));
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js toc patterns' }, s));
    assert.ok(denied(r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, s))));
    const s2 = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/architecture/references/patterns.md` }, s2));
    assert.ok(!denied(r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, s2))));
  } finally { r.rm(); }
});

test('no covering section: two holds pointing at the doc list, then the change goes through and a bypass is logged', () => {
  const r = repo({ files: { 'tests/Zeta/Quux.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const edit = pre('Edit', { file_path: 'tests/Zeta/Quux.cs' }, s);
    assert.match(r.hook(edit).stdout, /see what is documented: node \.claude\/hooks\/docs\.js files/);
    assert.ok(denied(r.hook(edit)));
    assert.ok(!denied(r.hook(edit)));
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"bypass"/);
  } finally { r.rm(); }
});

test('shell reads are never held; shell writes are', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    assert.ok(!denied(r.hook(pre('Bash', { command: 'grep -n Refund src/Api/Orders/Refund.cs 2>/dev/null' }, s))));
    assert.ok(!denied(r.hook(pre('Bash', { command: 'dotnet test tests/Api > run.log 2>&1' }, s))));
    assert.ok(denied(r.hook(pre('Bash', { command: "cat > src/Api/Orders/Refund.cs <<'EOF'\nclass Refund {}\nEOF" }, s))));
  } finally { r.rm(); }
});

// Both installer twins wire this hook on `Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep|Glob`.
// Judging only `Bash` left the gate open on every Windows session and earned a doc read no consult credit.
test('PowerShell is the same shell route as Bash: its writes are held and its doc reads count', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    assert.ok(!denied(r.hook(pre('PowerShell', { command: 'Select-String -Pattern Refund -Path src/Api/Orders/Refund.cs' }, s))), 'a shell read is never held');
    // The shared syntax is what writeTargets parses on either shell: redirection, and the rm/mv/cp/mkdir aliases
    // PowerShell carries for its own Remove-Item / Move-Item / Copy-Item.
    assert.ok(denied(r.hook(pre('PowerShell', { command: "'class Refund {}' > src/Api/Orders/Refund.cs" }, s))), 'a redirect write is held');
    const sRm = sid();
    assert.ok(denied(r.hook(pre('PowerShell', { command: 'rm src/Api/Orders/Refund.cs' }, sRm))), 'an alias write is held');
    const s2 = sid();
    r.hook(pre('PowerShell', { command: 'node .claude/hooks/docs.js show patterns#orders' }, s2));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s2))), 'a docs.js show through PowerShell unlocks the gate');
    const s3 = sid();
    r.hook(pre('PowerShell', { command: 'Get-Content .claude/docs/architecture/references/patterns.md' }, s3));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s3))), 'a doc file read through PowerShell earns consult credit');
  } finally { r.rm(); }
});

test('source roots come from watch.json; CLAUDE_STACK_DOCS_GATE=0 turns the gate off', () => {
  const r = repo({ files: { 'app/Orders/Refund.cs': 'x\n', 'src/Other.cs': 'x\n' }, docs: { 'references/patterns.md': section('orders', 'app/Orders/**', 'App rule.'), 'watch.json': JSON.stringify({ sourceRoots: ['app'] }) } });
  try {
    assert.ok(denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Other.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()), { CLAUDE_STACK_DOCS_GATE: '0' })));
  } finally { r.rm(); }
});

test('writeTargets: the paths a shell command writes, from real runs', () => {
  const { writeTargets } = require('../stack/hooks/docs-session.js');
  const U = '<unknown source write>';
  const cases = [
    // reads that mention source paths - the live-run false positives
    ['grep -n "CancelDeletionRequest" -A 15 src/Shop.Api/Features/Auth/CancelDeletion/*.cs 2>/dev/null; echo "---"; find src/Shop.Api/Features/Auth -iname "*CancelDeletion*"', []],
    ['grep -rn "AddValidatorsFromAssembly\\|AbstractValidator" --include="*.cs" src/Shop.Api/Program.cs src/Shop.Api/Common 2>/dev/null | grep -v Features', []],
    ['nohup dotnet test tests/Shop.IntegrationTests > shop-integration-full.log 2>&1 &', ['shop-integration-full.log']],
    ['dotnet build Shop.slnx 2>&1 | tail -20', []],
    ['cat src/Api/Orders/OrderRefunds.cs', []],
    ['grep -n "x => x.Id > 0" src/Api/Orders/OrderRefunds.cs', []],
    ['ls src/Api > /dev/null 2>&1', []],
    ['find src -name "*.cs" 2>/dev/null | xargs grep -l Refund', []],
    ['git diff src/Api/Orders/OrderRefunds.cs', []],
    ['git checkout feat/x', []],
    // writes
    ['echo x > src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ['echo x >> src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ["cat > src/Api/Orders/New.cs <<'EOF'\nclass New { bool A(int x) => x > 0; }\nEOF", ['src/Api/Orders/New.cs']],
    ['cat > "src/Api/Orders/Quoted.cs" <<EOF\nx\nEOF', ['src/Api/Orders/Quoted.cs']],
    ["sed -i '' 's/a/b/' src/Api/Orders/OrderRefunds.cs", ['src/Api/Orders/OrderRefunds.cs']],
    ['sed -i.bak -e "s/a/b/" src/A.cs src/B.cs', ['src/A.cs', 'src/B.cs']],
    ['sed -n 1,20p src/Api/Orders/OrderRefunds.cs', []],
    ['perl -pi -e "s/a/b/" tests/X.cs', ['tests/X.cs']],
    ['cp /tmp/x.cs src/Api/Orders/Copy.cs', ['src/Api/Orders/Copy.cs']],
    ['cp src/Api/Orders/OrderRefunds.cs /tmp/backup.cs', ['/tmp/backup.cs']],
    ['mv src/a.cs src/b.cs', ['src/b.cs']],
    ['rm -f src/Api/Orders/OrderQueries.cs tests/Old.cs', ['src/Api/Orders/OrderQueries.cs', 'tests/Old.cs']],
    ['mkdir -p src/Api/Refunds', ['src/Api/Refunds']],
    ['echo x | tee src/T.cs', ['src/T.cs']],
    ['dotnet ef migrations add AddRefunds --project src/Shop.Infrastructure', ['src/Shop.Infrastructure']],
    ['dotnet ef migrations add AddRefunds', [U]],
    ['dotnet ef database update', []],
    ['dotnet new classlib -o src/Shop.New', ['src/Shop.New']],
    ['git apply fix.patch', [U]],
    ['git checkout -- src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ['git restore src/A.cs', ['src/A.cs']],
    ['cd src && echo x > A.cs', ['A.cs']],
  ];
  for (const [command, want] of cases) assert.deepStrictEqual(writeTargets(command).sort(), [...want].sort(), command);
});

const WATCH = (extra = {}) => JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }], ...extra });
const start = (r, s) => r.hook({ hook_event_name: 'SessionStart', session_id: s });
const stopEv = (s, active) => ({ hook_event_name: 'Stop', session_id: s, stop_hook_active: Boolean(active) });

test('a change to a watched file asks once, naming the section; a second stop is silent', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const out = r.hook(stopEv(s));
    const body = JSON.parse(out.stdout);
    assert.strictEqual(body.decision, 'block');
    assert.match(body.reason, /You changed src\/Api\/Program\.cs \(composition root\), which this section owns: patterns#orders/);
    assert.match(body.reason, /docs still hold: patterns#orders/);
    assert.strictEqual(r.hook(stopEv(s)).stdout, '');
  } finally { r.rm(); }
});

test('no hit, stop_hook_active, the ask switched off, or no watch.json: silent', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'x\n', 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const a = sid(); start(r, a);
    r.write('src/Api/Orders/Refund.cs', 'y\n');
    assert.strictEqual(r.hook(stopEv(a)).stdout, '', 'routine change');
    const b = sid(); start(r, b);
    r.write('src/Api/Program.cs', 'y\n');
    assert.strictEqual(r.hook(stopEv(b, true)).stdout, '', 'stop_hook_active');
    assert.strictEqual(r.hook(stopEv(b), { CLAUDE_STACK_DOCS_ASK: '0' }).stdout, '', 'switched off');
    fs.rmSync(`${r.root}/.claude/docs/architecture/watch.json`);
    const c = sid(); start(r, c);
    r.write('src/Api/Program.cs', 'z\n');
    assert.strictEqual(r.hook(stopEv(c)).stdout, '', 'no watch.json');
  } finally { r.rm(); }
});

test('four owning sections: the ask names three', () => {
  const secs = ['a', 'b', 'c', 'd'].map((x) => section(x, '', `${x}.`)).join('\n');
  const r = repo({ files: { 'src/Api/Program.cs': 'x\n' }, docs: { 'references/p.md': secs, 'watch.json': JSON.stringify({ watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['p#a', 'p#b', 'p#c', 'p#d'] }] }) } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Program.cs', 'y\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /these sections own: p#a, p#b, p#c\./);
    assert.doesNotMatch(reason, /p#d/);
  } finally { r.rm(); }
});

test('a new module folder hits newModule; a committed script change counts', () => {
  const r = repo({ files: { 'src/Api/Features/Orders/A.cs': 'x\n', 'src/Api/Program.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH({ newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] } }) } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Features/Billing/Invoice.cs', 'class Invoice {}\n');
    assert.match(JSON.parse(r.hook(stopEv(s)).stdout).reason, /new module[\s\S]*patterns#users/);
    const t = sid(); start(r, t);
    r.write('src/Api/Program.cs', 'changed by a script\n');
    r.git('commit', '-qam', 'script');
    assert.match(JSON.parse(r.hook(stopEv(t)).stdout).reason, /patterns#orders/);
  } finally { r.rm(); }
});
