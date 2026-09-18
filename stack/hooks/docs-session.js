#!/usr/bin/env node
// docs-session.js - makes the architecture docs the starting point of a session and keeps them honest at its end.
//   SessionStart  -> folds merged branches' doc versions into mainline, then pushes ORIENTATION.md, this branch's
//                    overrides and conflicts, and how to read by section; snapshots the tree for the end check
//   SubagentStart -> the same orientation for a dispatched subagent (SessionStart context never reaches one), and
//                    the snapshot the finish ask below compares against
//   SubagentStop  -> what THAT agent WROTE, once: a file it wrote that also changed and hits watch.json blocks with
//                    the owning sections quoted, so whoever made the change says whether the docs still hold
//   PreToolUse    -> records reads of the docs and attributes each write to the agent that made it; holds the FIRST
//                    change under a source root until a section was read, handing the covering section over inline -
//                    what a merge just folded into mainline comes first
//   Stop          -> once per session: a change that hit watch.json asks for the owning sections to be rewritten when
//                    a rule moved, or confirmed
// CLAUDE_STACK_DOCS_BLOCK=0 / CLAUDE_STACK_DOCS_GATE=0 / CLAUDE_STACK_DOCS_ASK=0 turn the three parts off.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const docsRootEnv = () => process.env.CLAUDE_STACK_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs';
const MAX_HOLDS = 2;
const INLINE_CHARS = 3000;
const ASK_SECTIONS = 3;
const FILES_NAMED = 4;
const READ = 'node .claude/hooks/docs.js';

const readInput = () => { try { const v = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const statePath = (s, agent) => path.join(os.tmpdir(), `docs-session-${String(s || 'none').replace(/[^\w-]/g, '')}${agent ? `--${agent}` : ''}.json`);
const loadState = (s) => { let v = {}; try { v = JSON.parse(fs.readFileSync(statePath(s), 'utf8')); } catch {} return { consults: [], holds: 0, edits: 0, asked: false, snapshot: null, ...v }; };
const saveState = (s, v, agent) => { try { fs.writeFileSync(statePath(s, agent), JSON.stringify(v)); } catch {} };
// A dispatched agent gets a state file of its OWN, beside the session's and named for it. Same store, one key finer:
// agents run in parallel, and a shared file they all read-modify-write loses rows - a lost 'blocked' row is a SECOND
// block on an agent that already answered, which is worse than never asking.
const loadAgent = (s, agent) => { let v = {}; try { v = JSON.parse(fs.readFileSync(statePath(s, agent), 'utf8')); } catch {} return { snapshot: null, asked: [], blocked: false, answered: false, ...v }; };
// Both subagent payloads carry `agent_id` (documented on SubagentStart and SubagentStop alike) - that is the only
// field that tells two seats of ONE type apart. The published examples spell the same field 'agent-abc123' at start
// and 'def456' at stop, so the prefix is dropped before keying: a key that matched on only one of the two events
// would snapshot an agent and then ask a different one. With no id at all the type is the best key left, and two
// parallel seats of one type then share a snapshot and one block.
const agentKey = (input) => String(input.agent_id || input.agent_type || 'agent').replace(/^agent-/, '').replace(/[^\w-]/g, '').slice(0, 64) || 'agent';
// A write, attributed to the agent that made it. `agent_id` / `agent_type` are populated on a TOOL event only when
// the hook fires inside a subagent, so the main session records nothing here and its own Stop keeps reading the
// whole tree. Recorded BEFORE the first-change gate below: a write the gate then holds never happened, but the stop
// intersects against what actually CHANGED, so an attributed write that never landed drops out by itself.
const WROTE_CAP = 500;
function recordWrite(input, wrote) {
  if (!input.agent_id && !input.agent_type) return;
  const key = agentKey(input);
  const a = loadAgent(input.session_id, key);
  const next = [...new Set([...(a.wrote || []), ...wrote])].slice(0, WROTE_CAP);
  if (next.length === (a.wrote || []).length) return;
  a.wrote = next;
  saveState(input.session_id, a, key);
}
// Every section an agent of THIS session was already asked about, read from the sibling per-agent files. READ only:
// writing the session's own row here would race preToolUse, and a file that cannot be read simply reinstates the
// ask, which is the safe direction.
function askedByAgents(session) {
  const prefix = `docs-session-${String(session || 'none').replace(/[^\w-]/g, '')}--`;
  const out = new Set();
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
      try { for (const id of JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), 'utf8')).asked || []) out.add(id); } catch {}
    }
  } catch {}
  return out;
}
const emit = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
// SHELL ROUTE: the PowerShell tool is the same route under a second name - its payload carries
// `tool_input.command` exactly as Bash does, and both installer twins wire this hook on the matcher
// `Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep|Glob`. Judging only `Bash` left the first-change
// gate open on every Windows session and earned a doc read through PowerShell no consult credit.
const isShellTool = (n) => n === 'Bash' || n === 'PowerShell';
// One log file holds every session's rows, and two sessions interleave in it, so each row carries the id that
// tells them apart. It lives under the docs root beside hook-blocks/ and tools-usage/ - every other ledger in
// this stack does, and under .claude/ a project that commits that folder accumulated this one in git.
const log = (root, input, row) => {
  try {
    const dir = path.resolve(root, docsRootEnv());
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), session: input.session_id || '', ...row })}\n`);
  } catch {}
};

function orientation(root, docs) {
  let block = '';
  try { block = fs.readFileSync(docs.BLOCK_FILE, 'utf8').trim(); } catch {}
  return [
    'How this project is documented - read this before deciding how to implement anything.',
    ...(block ? ['', block] : []),
    '',
    `The docs live under \`${path.relative(root, docs.DOCS).split(path.sep).join('/')}/\`. Read them by section, not whole files:`,
    `\`${READ} where <path>\` names the sections covering a file; \`${READ} show <file>#<id>\` prints one.`,
    'For a specific symbol the CODE wins; the docs give the decisions, the conventions and the reasons.',
  ];
}

function sessionStart(input, root, docs, state) {
  if (!state.snapshot) { try { state.snapshot = docs.snapshot(); } catch {} saveState(input.session_id, state); }
  // Repair the branch snapshots BEFORE looking for merged branches, so a snapshot repaired here is promotable in
  // this session and not only the next one.
  try { docs.refreshBaseMeta(); } catch {}
  let promoted = [];
  try { promoted = docs.autoPromote(); } catch {}
  // A row with changed=false is a standing, already-reported conflict - skip it, or it would be re-logged and
  // re-announced at every session start.
  const landed = promoted.filter((p) => p.changed);
  for (const p of landed) log(root, input, { event: 'promote', branch: p.branch, how: p.how, results: p.results });
  if (process.env.CLAUDE_STACK_DOCS_BLOCK === '0') return;
  let st = null;
  try { st = docs.status(); } catch {}
  const lines = orientation(root, docs);
  const extra = [];
  for (const p of landed) {
    const ok = p.results.filter((x) => x.result !== 'conflict');
    const bad = p.results.filter((x) => x.result === 'conflict');
    // The ids, the way the branch-override line beside it names its own: a count tells the session that something
    // it has not read just changed, and nothing about what to read. Six ids, then a count - the block is paid for
    // by every session.
    const names = ok.length ? ` and now hold its decisions: ${ok.slice(0, 6).map((x) => x.id).join(', ')}${ok.length > 6 ? ` (+${ok.length - 6} more)` : ''}` : '';
    extra.push(`Branch ${p.branch} was merged: ${ok.length} doc section(s) folded into mainline${names}.${bad.length ? ` To reconcile: ${bad.map((x) => `${x.id} (\`${READ} show ${x.id} --conflict ${p.branch}\`, then \`${READ} set ${x.id}\`)`).join(', ')}.` : ''}`);
  }
  if (st && st.detached) extra.push('Detached HEAD: the docs are read-only until a branch is checked out.');
  // The declared mode wins over what git does, so where the two disagree the session is told before it writes a doc:
  // one line, the engine's own wording, and nothing at all when the install declares nothing or the two agree.
  if (st && st.mismatch) extra.push(st.mismatch);
  // Branch versions nothing can reach under git versioning. Only `docs.js status` knew, and nothing runs that by
  // itself - so a decision written under the overlay model sat unreadable and unmentioned, session after session.
  // Nothing sweeps them either - the 30-day sweep stands down under git versioning - so this line comes back every
  // session. It is a prompt only if it names the command that ends it, with the branch filled in; a placeholder
  // would make it a nag. The field is guarded like its neighbours: an older engine beside this hook returns a
  // status without it, and an unguarded read would throw away the whole block.
  if (st && st.stranded && st.stranded.length) extra.push(`Doc versions stranded by this install's git versioning: ${st.stranded.slice(0, 6).join(', ')}${st.stranded.length > 6 ? ` (+${st.stranded.length - 6} more)` : ''} - nothing reads or promotes .branches/ any more, and this line returns every session until they are gone: re-apply what is still wanted with \`${READ} set <file>#<id>\`, then end it with \`${READ} prune ${st.stranded[0]}\`${st.stranded.length > 1 ? ' (one prune per name)' : ''}.`);
  // After a git merge of committed docs, or a hand edit: the two breakages that make a doc untrustworthy to read.
  let broken = [];
  try { broken = docs.lint().problems.filter((p) => /^(merge conflict markers|duplicate id)/.test(p)); } catch {}
  if (broken.length) extra.push(`The docs need a repair before they are trusted: ${broken.slice(0, 3).join('; ')}${broken.length > 3 ? ` (+${broken.length - 3} more: \`${READ} lint\`)` : ''}.`);
  if (st && st.overrides.length) extra.push(`You are on branch ${st.branch}. ${st.overrides.length} doc section(s) hold this branch's own decisions and replace mainline's in every read: ${st.overrides.slice(0, 6).join(', ')}${st.overrides.length > 6 ? ` ... (\`${READ} status\`)` : ''}.`);
  if (st && st.conflicts.length) extra.push(`Conflicts: ${st.conflicts.join(', ')} - mainline changed lines this branch also changed; \`${READ} show <id> --conflict\` shows both, \`${READ} set <id>\` saves the reconciled text.`);
  if (st && st.mainline && st.deletedUnmerged.length) extra.push(`Doc versions of deleted branches never detected as merged: ${st.deletedUnmerged.join(', ')} - \`${READ} promote <branch>\` folds one in, \`${READ} prune <branch>\` drops it.`);
  if (st && st.mainline && st.liveOnMainline && st.liveOnMainline.length) extra.push(`Doc versions of branches sitting on mainline with no proof they merged: ${st.liveOnMainline.join(', ')} - one that was merged fast-forward looks exactly like one that only caught up, so nothing was folded in; if it landed, \`${READ} promote <branch>\`.`);
  if (st && st.outgrown) extra.push(`${st.outgrown} section(s) describe code that changed since they were written - each says so when opened, and the code wins there.`);
  if (process.env.CLAUDE_STACK_DOCS_GATE !== '0') {
    let roots = ['src', 'tests'];
    try { roots = docs.loadWatch().sourceRoots; } catch {}
    extra.push(`Before your first change under ${roots.map((x) => `${x}/`).join(' or ')}, read the section covering the file.`);
  }
  emit('SessionStart', [...lines, ...(extra.length ? ['', ...extra] : [])].join('\n'));
}

function main() {
  const input = readInput();
  const event = input.hook_event_name;
  if (!event) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  process.env.CLAUDE_PROJECT_DIR = root;
  const docs = require('./docs.js');
  if (!fs.existsSync(docs.DOCS)) return;
  const state = loadState(input.session_id);
  if (event === 'SessionStart') return sessionStart(input, root, docs, state);
  if (event === 'SubagentStart') return subagentStart(input, root, docs);
  if (event === 'SubagentStop') return subagentStop(input, root, docs);
  if (event === 'PreToolUse') return preToolUse(input, root, docs, state);
  if (event === 'Stop') return stop(input, root, docs, state);
}

function subagentStart(input, root, docs) {
  // The snapshot is what makes the finish ask possible, and it is NOT the orientation block: the block's switch
  // must not blind the ask, and the ask's switch must not cost a snapshot nobody will read.
  if (process.env.CLAUDE_STACK_DOCS_ASK !== '0') {
    const key = agentKey(input);
    const a = loadAgent(input.session_id, key);
    // Only the first start writes it: where two seats fold onto one key, the earlier snapshot keeps both their
    // changes in view instead of hiding the first agent's work behind the second's start.
    if (!a.snapshot) { try { a.snapshot = docs.snapshot(); } catch {} saveState(input.session_id, a, key); }
  }
  if (process.env.CLAUDE_STACK_DOCS_BLOCK !== '0') emit('SubagentStart', orientation(root, docs).join('\n'));
}

// The agent that made a change is the only context that knows why it was made - the main session usually does not -
// so the ask lands here, once, for the files THAT agent changed (its start snapshot against the tree now).
function subagentStop(input, root, docs) {
  if (process.env.CLAUDE_STACK_DOCS_ASK === '0') return;
  const key = agentKey(input);
  const a = loadAgent(input.session_id, key);
  // The stop our own block caused. It carries the agent's ANSWER in `last_assistant_message`, the one place the
  // answer is observable at all, so it is logged once and nothing more: no dedupe rests on it, because an agent
  // that simply stopped and one that answered 'docs ok' are otherwise the same event.
  if (input.stop_hook_active) {
    if (a.blocked && !a.answered) {
      a.answered = true;
      saveState(input.session_id, a, key);
      log(root, input, { event: 'ask-answer', agent: key, sections: a.asked, ok: /\bdocs ok\b/i.test(String(input.last_assistant_message || '')) });
    }
    return;
  }
  // One block per agent, whatever it answered, and never one for an agent whose start was never seen: with no
  // snapshot there is nothing that says what this agent changed, and a guess would ask the wrong seat.
  if (a.blocked || !a.snapshot || typeof docs.askRef !== 'function') return;
  // What THIS agent wrote, not what the tree did. `changedSince` is a whole-TREE diff, so a seat that opened nothing
  // was otherwise told it changed whatever the writer running BESIDE it changed - and this stack dispatches in
  // parallel by design. A seat that wrote nothing is silent (the brief's read-only seats, now true under parallel
  // dispatch); a seat that wrote is judged on its own files, and the tree still has to agree they CHANGED.
  const own = a.wrote || [];
  if (!own.length) return;
  let changed;
  let hits = [];
  try {
    changed = docs.changedSince(a.snapshot);
    if (!changed.files.length && !changed.dirs.length) return;
    // A write whose target the shell route could not name ('dotnet ef migrations add', 'git apply'): the agent did
    // write, and nothing says what, so it answers for the whole change rather than for none of it.
    const blind = own.includes(UNKNOWN_SOURCE_WRITE);
    const mine = new Set(own);
    const mineFiles = blind ? changed.files : changed.files.filter((f) => mine.has(f));
    const mineDirs = blind ? changed.dirs : changed.dirs.filter((d) => own.some((p) => p.startsWith(`${d}/`)));
    if (!mineFiles.length && !mineDirs.length) return;
    hits = docs.watchHits(mineFiles, mineDirs);
  } catch { return; }
  if (!hits.length) return;
  // Dedupe on the pair (agent, section), never the section alone: two agents in one run often touch the same
  // section, and the second is the one most likely to notice the first's rewrite only covered half the change.
  const ids = [...new Set(hits.flatMap((h) => h.sections))].filter((id) => !a.asked.includes(id)).slice(0, ASK_SECTIONS);
  const refs = ids.map((id) => docs.askRef(id)).filter(Boolean);
  if (!refs.length) return;
  const files = [...new Set(hits.flatMap((h) => h.files))];
  const reason = finishAsk(docs, files, refs);
  a.blocked = true;
  a.asked = [...a.asked, ...refs.map((r) => r.id)];
  saveState(input.session_id, a, key);
  log(root, input, { event: 'ask-update', agent: key, agentType: input.agent_type || '', sections: refs.map((r) => r.id), files: files.slice(0, 5), kinds: [...new Set(hits.map((h) => h.kind))] });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// What the tool is about to touch, project-relative.
function toolPaths(input, root) {
  const t = input.tool_input || {};
  const out = [];
  for (const p of [t.file_path, t.path, t.relative_path, t.notebook_path]) if (typeof p === 'string' && p) out.push(p);
  if (typeof t.command === 'string') {
    for (const w of t.command.split(/[\s;|&<>()'"`]+/)) {
      if (/[\w.-]\/[\w.-]/.test(w)) out.push(w.replace(/^[^\w./~-]+|[,:]+$/g, '').replace(/:\d+(:\d+)?$/, ''));
    }
  }
  return [...new Set(out.map((p) => path.relative(root, path.resolve(root, p))).filter((p) => p && !p.startsWith('..')))];
}

// The paths a shell command WRITES, not every path it mentions: redirect targets (never /dev/null or a file
// descriptor), tee arguments, files edited in place by sed/perl, cp/mv destinations, rm/mkdir/touch arguments, and the
// project a migration or a patch lands in. `grep -n X src/... 2>/dev/null` writes nothing, and neither does
// `dotnet test tests/Api > run.log`. A write whose target cannot be named counts as a write under the first source root.
const UNKNOWN_SOURCE_WRITE = '<unknown source write>';
function writeTargets(command) {
  let c = String(command);
  // A heredoc body is content, not shell: `x => y` inside it is no redirect.
  c = c.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0]);
  // Quoted text is an argument, not syntax - kept only as a redirect target.
  c = c.replace(/(>>?\s*)?(["'])((?:(?!\2)[^\\]|\\.)*)\2/g, (m, redirect, q, body) => (redirect ? `${redirect}${body.replace(/\s/g, '_')}` : 'QUOTED'));
  const out = [];
  for (const m of c.matchAll(/(?:^|[^\w&<>=-])(?:\d|&)?>>?\|?\s*([^\s;|&<>()]+)/g)) if (m[1] !== '/dev/null' && !/^&/.test(m[1])) out.push(m[1]);
  for (const simple of c.split(/&&|\|\||[;|\n]/)) {
    const words = simple.trim().split(/\s+/).filter(Boolean);
    while (words.length && (/^\w+=/.test(words[0]) || /^(sudo|env|nohup|time|command|xargs)$/.test(words[0]))) words.shift();
    const [cmd, ...rest] = words;
    const args = rest.filter((w) => !w.startsWith('-') && !/^\d?>|^</.test(w));
    if (!cmd) continue;
    if (cmd === 'tee') out.push(...args);
    else if (cmd === 'sed' && rest.some((w) => /^-[a-zA-Z]*i/.test(w) || w === '--in-place')) out.push(...args.filter((w) => w !== 'QUOTED' && !/^s\W/.test(w)));
    else if (cmd === 'perl' && rest.some((w) => /^-[a-zA-Z]*i/.test(w))) out.push(...args.filter((w) => w !== 'QUOTED'));
    else if (/^(cp|mv|install|ln|rsync)$/.test(cmd)) { const t = rest.indexOf('-t'); out.push(t >= 0 && rest[t + 1] ? rest[t + 1] : args[args.length - 1]); }
    else if (/^(rm|rmdir|mkdir|touch|truncate)$/.test(cmd)) out.push(...args);
    else if (cmd === 'chmod') out.push(...args.slice(1));
    else if (cmd === 'dd') out.push(...rest.filter((w) => w.startsWith('of=')).map((w) => w.slice(3)));
    else if (cmd === 'dotnet' && rest[0] === 'new') { const o = rest.findIndex((w) => w === '-o' || w === '--output'); out.push(o >= 0 && rest[o + 1] ? rest[o + 1] : UNKNOWN_SOURCE_WRITE); }
    else if (cmd === 'dotnet' && rest[0] === 'ef' && rest[1] === 'migrations' && /^(add|remove)$/.test(rest[2] || '')) { const o = rest.findIndex((w) => w === '-p' || w === '--project'); out.push(o >= 0 && rest[o + 1] ? rest[o + 1] : UNKNOWN_SOURCE_WRITE); }
    else if (cmd === 'git' && rest[0] === 'apply') out.push(UNKNOWN_SOURCE_WRITE);
    else if (cmd === 'git' && (rest[0] === 'restore' || (rest[0] === 'checkout' && rest.includes('--')))) out.push(...rest.slice(rest.includes('--') ? rest.indexOf('--') + 1 : 1).filter((w) => !w.startsWith('-')));
  }
  return [...new Set(out.filter((t) => t && t !== 'QUOTED'))];
}
const relative = (root, paths) => [...new Set(paths.map((p) => path.relative(root, path.resolve(root, p.replace(/^['"]|['"]$/g, '')))).filter((p) => p && !p.startsWith('..')))];

// Only reading a section's text is a consult: `where`, `toc` and listings point at sections without reading them.
function consultedBy(input, paths, docsRel) {
  const name = input.tool_name || '';
  const t = input.tool_input || {};
  const command = typeof t.command === 'string' ? t.command : '';
  if (/docs\.js[ \t]+show[ \t]/.test(command)) {
    return (command.match(/docs\.js[ \t]+show[ \t]+[\w#.\/-]+(?:[ \t]+[\w#.\/-]+)*/g) || [])
      .flatMap((r) => r.split(/[ \t]+/).slice(2))
      .filter((r) => !r.startsWith('-') && /^[A-Za-z][\w.\/-]*(#[\w-]+)?$/.test(r));
  }
  if (/docs\.js[ \t]+(toc|where|files|status|lint|watch|stale)\b/.test(command)) return [];
  const isDoc = (p) => p === docsRel || p.startsWith(`${docsRel}/`);
  const hits = paths.filter(isDoc);
  if (hits.length && (/^(Read|Grep|Glob)$/.test(name) || (isShellTool(name) && !writeTargets(command).length))) return hits;
  return [];
}

function blockRow(root, input, reason) {
  try {
    const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${input.session_id || 'nosession'}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'docs-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', reason: String(reason).split('\n')[0].slice(0, 200) })}\n`);
  } catch {}
}

function preToolUse(input, root, docs, state) {
  const paths = toolPaths(input, root);
  const docsRel = path.relative(root, docs.DOCS).split(path.sep).join('/');
  const consults = consultedBy(input, paths, docsRel);
  if (consults.length) {
    state.consults.push(...consults);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: consults.slice(0, 5), tool: input.tool_name });
    return;
  }
  // Only these six tools can name a source target, so nothing else pays for the watch list.
  const name = input.tool_name || '';
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name) && !isShellTool(name)) return;
  let roots = ['src', 'tests'];
  try { roots = docs.loadWatch().sourceRoots; } catch {}
  const inRoots = (p) => roots.some((x) => p === x || p.startsWith(`${x}/`));
  const command = typeof (input.tool_input || {}).command === 'string' ? input.tool_input.command : '';
  const shellWrites = isShellTool(name) ? writeTargets(command) : null;
  let wrote = [];
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) wrote = paths;
  else if (shellWrites) wrote = relative(root, shellWrites.map((x) => (x === UNKNOWN_SOURCE_WRITE ? `${roots[0]}/*` : x)));
  // Attributed before the source-root filter: a watch entry may name a path no source root covers, and a write this
  // hook never judges is still a write the agent made.
  if (wrote.length) recordWrite(input, shellWrites && shellWrites.includes(UNKNOWN_SOURCE_WRITE) ? [...wrote, UNKNOWN_SOURCE_WRITE] : wrote);
  const targets = wrote.filter(inRoots);
  if (!targets.length) return;
  const allow = () => {
    state.edits++;
    saveState(input.session_id, state);
    if (state.edits === 1) log(root, input, { event: 'first-edit', target: targets[0], consulted: state.consults.length > 0 });
  };
  if (process.env.CLAUDE_STACK_DOCS_GATE === '0' || state.consults.length) { allow(); return; }
  if (state.holds >= MAX_HOLDS) { log(root, input, { event: 'bypass', target: targets[0], holds: state.holds }); allow(); return; }
  state.holds++;
  saveState(input.session_id, state);
  let hits = [];
  try { hits = docs.where(targets, 3); } catch {}
  let reason;
  if (!hits.length) {
    reason = `Architecture docs not read yet in this session. Before changing ${targets[0]}, see what is documented: ${READ} files`;
  } else {
    const [first, ...rest] = hits;
    const body = first.text.length > INLINE_CHARS ? `${first.text.slice(0, INLINE_CHARS)}\n... (${first.text.length - INLINE_CHARS} more chars: \`${READ} show ${first.id}\`)` : first.text;
    state.consults.push(first.id);
    saveState(input.session_id, state);
    log(root, input, { event: 'consult', refs: [first.id], tool: 'gate-inline' });
    reason = [
      `Architecture docs not read yet in this session. ${first.id} covers ${targets[0]} - here it is:`,
      '', body, '',
      ...(rest.length ? [`Also covering it: ${rest.map((h) => `${h.id} (${h.chars} chars, \`${READ} show ${h.id}\`)`).join(', ')}`, ''] : []),
      'That is the convention this change follows. Now make the change.',
    ].join('\n');
  }
  log(root, input, { event: 'hold', target: targets[0], offered: hits.map((h) => h.id) });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

// The one ask this hook makes - a finished agent's SubagentStop and the main session's Stop send the same shape, so
// there is a single thing to learn. It has to be answerable by someone who has never read these docs: the section
// named the way a person would say it, the file it sits in, its CURRENT first sentence to compare the change
// against, and what each answer costs. The quoted line is ONE sentence (docs.js caps it at 200 chars), so the ask is
// a fixed size whatever the section grew to. The --expect hash is of the text being shown here: a rewrite of a
// section that moved meanwhile is refused instead of silently dropping whoever moved it.
function finishAsk(docs, files, refs) {
  const one = refs.length === 1;
  const named = `${files.slice(0, FILES_NAMED).join(', ')}${files.length > FILES_NAMED ? ` and ${files.length - FILES_NAMED} more` : ''}`;
  const subject = files.length === 1 ? 'this file' : 'these files';
  let mode = 'git';
  let branch = '';
  let mainline = true;
  try { mode = docs.docsMode(); branch = docs.branch() || ''; mainline = docs.isMainline(branch); } catch {}
  // What saving the doc costs, which is the whole difference between the two versioning modes. On mainline under
  // local versioning there is no overlay and nothing to commit, so neither of the other two lines is true there.
  const tail = mode === 'git'
    ? [`         and commit the doc${one ? '' : 's'} with your code, so ${one ? 'it travels' : 'they travel'} with this branch.`]
    : mainline
      ? [`         and ${one ? 'it lands' : 'they land'} in the shared docs at once. Nothing to commit.`]
      : [
        `         and ${one ? 'it is' : 'they are'} stored for branch ${branch} only. ${one ? 'It moves' : 'They move'} into the`,
        `         shared docs by ${one ? 'itself' : 'themselves'} once this branch is merged. Nothing to commit.`,
      ];
  return [
    `Docs check: you changed ${named}`,
    '',
    ...(one
      ? [`One section documents ${subject} - '${refs[0].heading}', in ${refs[0].file}:`, `  "${refs[0].first}"`]
      : [`${refs.length} sections document ${subject}:`, ...refs.flatMap((r) => ['', `  '${r.heading}', in ${r.file}:`, `    "${r.first}"`])]),
    '',
    one ? 'Does your change still leave that true?' : 'Do your changes still leave those true?',
    '',
    '  Yes -> reply: docs ok',
    `  No  -> rewrite ${one ? 'the section' : 'each section your change made untrue'}, then run`,
    ...refs.map((r) => `           ${READ} set ${r.id} --expect ${r.hash}`),
    ...tail,
  ].join('\n');
}

// The same check for work done outside any subagent - and the only cover skills have, since a skill has no end
// event of its own and its work lands here.
function stop(input, root, docs, state) {
  if (process.env.CLAUDE_STACK_DOCS_ASK === '0' || input.stop_hook_active || state.asked || !state.snapshot) return;
  if (typeof docs.askRef !== 'function') return;
  let changed;
  let hits = [];
  try {
    changed = docs.changedSince(state.snapshot);
    if (!changed.files.length && !changed.dirs.length) return;
    hits = docs.watchHits(changed.files, changed.dirs);
  } catch { return; }
  if (!hits.length) return;
  // A section an agent of this session already answered for is not asked again here: the same block twice in a row
  // is how a gate earns itself a CLAUDE_STACK_DOCS_ASK=0, and the session is not the actor that made that change.
  // Agent-to-agent dedupe is untouched - two agents still both get asked.
  const seen = askedByAgents(input.session_id);
  const ids = [...new Set(hits.flatMap((h) => h.sections))].filter((id) => !seen.has(id)).slice(0, ASK_SECTIONS);
  if (!ids.length) return;
  const refs = ids.map((id) => docs.askRef(id)).filter(Boolean);
  if (!refs.length) return;
  // Only the entries that still have something to ask about name their files, so the ask never names a file whose
  // only section was already answered for.
  const kept = hits.filter((h) => h.sections.some((id) => ids.includes(id)));
  const files = [...new Set(kept.flatMap((h) => h.files))];
  state.asked = true;
  saveState(input.session_id, state);
  const reason = finishAsk(docs, files, refs);
  log(root, input, { event: 'ask-update', sections: refs.map((r) => r.id), files: files.slice(0, 5), kinds: [...new Set(kept.map((h) => h.kind))] });
  blockRow(root, input, reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

module.exports = { writeTargets, consultedBy, toolPaths };
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`docs-session: ${error.message}\n`); }
}
