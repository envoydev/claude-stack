#!/usr/bin/env node
// PreToolUse gate (matcher: Task|Agent): the approval gate for implementer fan-out.
// An *-implementer dispatch is the expensive, hard-to-reverse step of a build flow -
// it runs only after the user's explicit approval (or an explicit 'run without stops'
// waiver), recorded as a gate file the flows write. Prose approval gates measured
// unreliable (collapse on an ambiguous 'go'); this converts the gate into a file
// check the dispatch tool cannot pass without. Designers pass (they produce the plan
// BEFORE approval exists) and verifiers pass (read-only audits; verify-plan dispatches
// one pre-approval). exit 2 = block (stderr fed back to the model); exit 0 = allow.
// Stamp lifecycle: each flow/loop writes its OWN stamp when its consent lands and
// clears it at run end; a stamp persists across a flow's resumed sessions until that
// clear. Stamps older than MAX_STAMP_AGE_MS are treated as absent - measured: a
// leftover stamp from a finished flow silently authorized three later, unrelated
// runs' dispatches in one consuming project. Known limit: the gate keys on the seat
// NAME, so a generic-seat dispatch doing implementer work bypasses it - the skills'
// named-seat-only rule is the mitigation, not this hook.
const fs = require('fs');
const path = require('path');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
const input = payload.tool_input || {};
const seat = String(input.subagent_type || '');
if (!/-implementer$/.test(seat)) {
  process.exit(0);
}
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const docsRoot = process.env.CLAUDE_DOCS_PATH || '.claude/docs';
const gate = path.join(root, docsRoot, 'flow', 'APPROVAL');
const MAX_STAMP_AGE_MS = 8 * 60 * 60 * 1000; // 8h - re-stamping is one Write; staleness shipped unapproved dispatches
let first = '';
let stale = false;
try {
  const age = Date.now() - fs.statSync(gate).mtimeMs;
  if (age > MAX_STAMP_AGE_MS) {
    stale = true;
  } else {
    first = fs.readFileSync(gate, 'utf8').split('\n')[0].trim();
  }
} catch {
  // absent or unreadable - no approval recorded; blocked below
}
if (/^(APPROVED|AUTO)\b/.test(first)) {
  process.exit(0);
}
process.stderr.write(
  (stale
    ? `Blocked: dispatch of ${seat} - the approval stamp at ${gate} is older than 8h and is treated as absent (a stale stamp from an earlier flow is not consent for this run).\n`
    : `Blocked: dispatch of ${seat} without an approval gate.\n`) +
    `Implementer fan-out runs only on the user's explicit approval, or their explicit 'run\n` +
    `without stops' waiver - never on an inferred or ambiguous go-ahead.\n` +
    `If the user gave one THIS conversation, write ${gate}\n` +
    `with one first line - APPROVED <plan/contract id> - "<their words, verbatim>" (or\n` +
    `AUTO - "<their words, verbatim>" for a no-stops run) - then retry the dispatch.\n` +
    `Never fabricate the quote. Otherwise: present the plan and ask the user.\n` +
    `Clear the file when the run completes.`,
);
process.exit(2);
