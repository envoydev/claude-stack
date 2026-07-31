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
// runs' dispatches in one consuming project.
// Generic-seat rule: while a VALID stamp exists (a flow is running), an edit-capable
// generic dispatch (general-purpose/claude) is blocked too - flows dispatch NAMED
// domain seats, and the name-keyed implementer gate is silently bypassed by a generic
// stand-in (measured: one run put all 10 of a loop's dispatches on general-purpose,
// losing every seat pin and this gate; one legitimate generic dispatch in 33 audited
// sessions would have been bounced, a one-retry re-route). Outside a stamped flow,
// generic seats pass untouched; read-only built-ins (Explore etc.) always pass.
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
const GENERIC_SEATS = new Set(['general-purpose', 'claude']);
const isImplementer = /-implementer$/.test(seat);
if (!isImplementer && !GENERIC_SEATS.has(seat)) {
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
  // absent or unreadable - no approval recorded
}
const approved = /^(APPROVED|AUTO)\b/.test(first);
if (isImplementer) {
  if (approved) process.exit(0);
  process.stderr.write(
    (stale
      ? `Blocked: dispatch of ${seat} - the approval stamp at ${gate} is older than 8h and is treated as absent (a stale stamp from an earlier flow is not consent for this run).\n`
      : `Blocked: dispatch of ${seat} without an approval gate.\n`) +
      `Implementer fan-out runs only on the user's explicit approval, or their explicit 'run\n` +
      `without stops' waiver - never on an inferred or ambiguous go-ahead.\n` +
      `If the user gave one THIS conversation, write ${gate}\n` +
      `with one first line - APPROVED <plan/contract id> - "<their words, verbatim>" (or\n` +
      `AUTO - "<their words, verbatim>" for a no-stops run) - then retry the dispatch.\n` +
      `Never fabricate the quote. Otherwise: present the plan and ask the user - that\n` +
      `stop IS the recovery path. Do NOT route around this gate by doing the seat's\n` +
      `build work inline instead: a blocked dispatch means the flow is missing its\n` +
      `approval, not that the flow should be abandoned (measured: one session answered\n` +
      `this block by building inline and shipped the runtime defect the gated flow's\n` +
      `verify step exists to catch).\n` +
      `Clear the file when the run completes.`,
  );
  process.exit(2);
}
// Generic seat: blocked only while a flow is actively stamped.
if (!approved) {
  process.exit(0);
}
process.stderr.write(
  `Blocked: dispatch of ${seat} while a flow is active (${gate} is stamped).\n` +
    `A stamped run dispatches its NAMED domain seats - a generic seat carries none of the\n` +
    `seat's pins, preloads, or trap-lists, and silently bypasses the implementer gate.\n` +
    `Use the matching named seat (or a read-only seat like Explore for pure research).\n` +
    `If this generic dispatch is deliberate ad hoc work and the flow is over, clear the\n` +
    `stamp file first, then retry.`,
);
process.exit(2);
