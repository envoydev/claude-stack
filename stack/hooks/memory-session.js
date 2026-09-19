#!/usr/bin/env node
// memory-session.js - pushes the memory MCP's own stored memories into every session, the SessionStart
// half of the shared-memory pair (memory.js is the engine, copied beside this hook and not itself
// wired - same split as docs.js/docs-session.js). Silent wherever nothing can be shown: no memory
// server registered for this project, an empty selection, a missing/locked/wrong-schema database, a
// Node below 22.13 (memory.js's own selectForSession already degrades to an empty selection there),
// garbage stdin, or any other error - exit 0 throughout, since a session start that cannot be enriched
// must never be a session start that fails.
'use strict';
const fs = require('fs');
const os = require('os');

const CAP_BYTES = 4096;
const TOOL_SEARCH_LINE = 'ToolSearch select:mcp__memory__memory_store,mcp__memory__memory_search,mcp__memory__memory_list';

const readInput = () => { try { const v = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const emit = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));

function main() {
  const input = readInput();
  if (input.hook_event_name !== 'SessionStart') return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  process.env.CLAUDE_PROJECT_DIR = root;
  const memory = require('./memory.js');
  const home = os.homedir();
  const dbPath = memory.registeredDbPath(root, { home });
  if (!dbPath) return; // no memory server registered for this project - nothing to push
  const level = memory.levelOfPath(dbPath, { home, projectRoot: root }) || 'unknown';
  const project = memory.projectName(root);
  // related-projects is read through docs.js's own docs-root resolution (CLAUDE_STACK_DOCS_PATH in the
  // settings.json env, default '.claude/docs') - never re-derived here. Its absence (an older or
  // missing docs.js copy) just means no related-project group this session, not a failed push.
  let related = [];
  try { related = memory.relatedProjects(root, require('./docs.js').DOCS_ROOT); } catch {}
  const { text } = memory.selectForSession(dbPath, { project, related, capBytes: CAP_BYTES });
  if (!text) return;
  const lines = [`Memory (memory MCP, ${level}):`, text, '', `Store, search or list more: ${TOOL_SEARCH_LINE}`];
  emit('SessionStart', lines.join('\n'));
}

module.exports = { main };
if (require.main === module) {
  try { main(); } catch { /* a session start must never fail here - no output, exit 0 */ }
}
