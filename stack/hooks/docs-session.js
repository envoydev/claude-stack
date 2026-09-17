#!/usr/bin/env node
// docs-session.js - makes the architecture docs the starting point of a session and keeps them honest at its end.
//   SessionStart  -> folds merged branches' doc versions into mainline, then pushes ORIENTATION.md, this branch's
//                    overrides and conflicts, and how to read by section; snapshots the tree for the end check
//   SubagentStart -> the same orientation for a dispatched subagent (SessionStart context never reaches one)
//   PreToolUse    -> records reads of the docs; holds the FIRST change under a source root until a section was read,
//                    handing the covering section over inline
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
const READ = 'node .claude/hooks/docs.js';

const readInput = () => { try { const v = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const statePath = (s) => path.join(os.tmpdir(), `docs-session-${String(s || 'none').replace(/[^\w-]/g, '')}.json`);
const loadState = (s) => { let v = {}; try { v = JSON.parse(fs.readFileSync(statePath(s), 'utf8')); } catch {} return { consults: [], holds: 0, edits: 0, asked: false, snapshot: null, ...v }; };
const saveState = (s, v) => { try { fs.writeFileSync(statePath(s), JSON.stringify(v)); } catch {} };
const emit = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
const log = (root, row) => { try { fs.appendFileSync(path.join(root, '.claude', 'docs-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); } catch {} };

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
  let promoted = [];
  try { promoted = docs.autoPromote(); } catch {}
  // A row with changed=false is a standing, already-reported conflict - skip it, or it would be re-logged and
  // re-announced at every session start.
  const landed = promoted.filter((p) => p.changed);
  for (const p of landed) log(root, { event: 'promote', branch: p.branch, how: p.how, results: p.results });
  try { docs.refreshBaseMeta(); } catch {}
  if (process.env.CLAUDE_STACK_DOCS_BLOCK === '0') return;
  let st = null;
  try { st = docs.status(); } catch {}
  const lines = orientation(root, docs);
  const extra = [];
  for (const p of landed) {
    const ok = p.results.filter((x) => x.result !== 'conflict');
    const bad = p.results.filter((x) => x.result === 'conflict');
    extra.push(`Branch ${p.branch} was merged: ${ok.length} doc section(s) folded into mainline.${bad.length ? ` To reconcile: ${bad.map((x) => `${x.id} (\`${READ} show ${x.id} --conflict ${p.branch}\`, then \`${READ} set ${x.id}\`)`).join(', ')}.` : ''}`);
  }
  if (st && st.detached) extra.push('Detached HEAD: the docs are read-only until a branch is checked out.');
  // After a git merge of committed docs, or a hand edit: the two breakages that make a doc untrustworthy to read.
  let broken = [];
  try { broken = docs.lint().problems.filter((p) => /^(merge conflict markers|duplicate id)/.test(p)); } catch {}
  if (broken.length) extra.push(`The docs need a repair before they are trusted: ${broken.slice(0, 3).join('; ')}${broken.length > 3 ? ` (+${broken.length - 3} more: \`${READ} lint\`)` : ''}.`);
  if (st && st.overrides.length) extra.push(`You are on branch ${st.branch}. ${st.overrides.length} doc section(s) hold this branch's own decisions and replace mainline's in every read: ${st.overrides.slice(0, 6).join(', ')}${st.overrides.length > 6 ? ` ... (\`${READ} status\`)` : ''}.`);
  if (st && st.conflicts.length) extra.push(`Conflicts: ${st.conflicts.join(', ')} - mainline changed lines this branch also changed; \`${READ} show <id> --conflict\` shows both, \`${READ} set <id>\` saves the reconciled text.`);
  if (st && st.mainline && st.deletedUnmerged.length) extra.push(`Doc versions of deleted branches never detected as merged: ${st.deletedUnmerged.join(', ')} - \`${READ} promote <branch>\` folds one in, \`${READ} prune <branch>\` drops it.`);
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
  if (event === 'SubagentStart') { if (process.env.CLAUDE_STACK_DOCS_BLOCK !== '0') emit('SubagentStart', orientation(root, docs).join('\n')); return; }
  if (event === 'PreToolUse') return preToolUse(input, root, docs, state);
  if (event === 'Stop') return stop(input, root, docs, state);
}

// Task 7 and Task 8 replace these two.
function preToolUse() {}
function stop() {}

module.exports = {};
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`docs-session: ${error.message}\n`); }
}
