#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matcher: Bash): the pre-commit checkpoint, mechanized. A non-trivial
// `git commit` runs only after the house review gate (project-verify-code, plus
// /security-review on auth/crypto/data-access paths) or the user's explicit waiver -
// recorded as a receipt file the gate step writes. Prose measured unreliable: 8 ungated
// commit events across 6 audited sessions, including one where baseline-git.md was
// provably read into context the same session and skipped anyway, and one commit with
// no user authorization at all. Trivial diffs pass untouched (the rule's own
// typo/one-line exemption, judged from the working-tree diff). exit 2 = block
// (stderr fed back to the model); exit 0 = allow.
// Receipt lifecycle: the gate step writes <docs-root>/flow/COMMIT-GATE when its checks
// pass (VERIFIED <scope>) or the user explicitly waives (WAIVED - "<their words>");
// the commit turn clears it after the commit lands. Receipts older than
// MAX_RECEIPT_AGE_MS are treated as absent - the stale-stamp lesson from the approval
// gate (a leftover stamp silently authorized later, unrelated runs).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}

// --- block telemetry (shared by every guard hook; keep the copies identical) ------------
// A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
// FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
// the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
// nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
// scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
// telemetry never changes the verdict and never throws.
(() => {
  let last = '';
  const w = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 2) {
      try {
        const fs = require('fs');
        const path = require('path');
        const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
        const dir = path.join(root, process.env.CLAUDE_DOCS_PATH || '.claude/docs', 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
          ts: new Date().toISOString(),
          hook: path.basename(__filename),
          event: payload.hook_event_name || payload.tool_name || '',
          reason: last.split('\n')[0].slice(0, 200),
        }) + '\n');
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();
const command = String((payload.tool_input || {}).command || '');
// A heredoc body is DATA, not shell: a plan document, a commit-message draft or a receipt that
// merely describes `git commit` is inert text. Matching it blocked a 47KB plan write and cost a
// full re-author of the same document (~19.8k output + 24.4k cache-write, ~3 minutes), and a
// second session lost a plan-doc write the same way. Blank the payload spans before matching,
// keeping the character count so commitMatch.index still points into the real command.
const scanned = command.replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => m.replace(/[^\n]/g, ' '),
);
// A real `git commit` subcommand (allowing -C/-c/global flags between), not e.g. `git log --grep commit`.
const commitMatch = scanned.match(/\bgit(\s+-[cC]?\s*\S+|\s+--\S+)*\s+commit\b/);
if (!commitMatch) process.exit(0);
// An atomic write-receipt-then-commit command carries its own receipt: the gate file is
// written (with a VERIFIED/WAIVED line in the same command text) before git runs. Blocking
// it would reject the receipt discipline this gate exists to enforce (measured: the
// write+commit+clear-in-one-call shape is the corpus's dominant conforming pattern).
// All matches are bound to the PRE-commit segment (a commit message merely mentioning
// COMMIT-GATE VERIFIED is not a receipt), and a VERIFIED receipt needs its authorized:
// line here too - same contract as the file path below.
const preCommit = command.slice(0, commitMatch.index);
// The receipt must be WRITTEN, not merely mentioned: requiring the words anywhere in the
// pre-commit text let a single `echo "... VERIFIED ... authorized: ..." > notes.txt` satisfy the
// gate on a real dirty tree (reproduced). The redirect/tee/printf has to target a path that ends
// in flow/COMMIT-GATE for the atomic shape to count as its own receipt.
const writesGate = /(?:>>?|\btee\s+(?:-a\s+)?|\bprintf\b[^>]*>>?)\s*["']?(\S*flow\/COMMIT-GATE)\b/.test(preCommit)
  || /\bcat\s*>>?\s*["']?(\S*flow\/COMMIT-GATE)\b/.test(preCommit);
if (preCommit.includes('COMMIT-GATE')
  && writesGate
  && (/\bWAIVED\b/.test(preCommit)
    || (/\bVERIFIED\b/.test(preCommit) && /authorized:/.test(preCommit)))) process.exit(0);
let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Resolve the repo the commit actually runs in: a `cd <sibling> && git commit` or a
// `git -C <sibling> commit` executes in a DIFFERENT repo than this hook's default root,
// so the diff/receipt checks below would silently judge the wrong tree (measured: a
// cross-repo commit's ledger cwd named the home repo while the commit ran in the sibling).
const unq = (s) => s.replace(/^["']|["']$/g, '');
const cdMatches = [...command.slice(0, commitMatch.index).matchAll(/(?:^|&&|;|\n|\|)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
if (cdMatches.length) root = path.resolve(root, unq(cdMatches[cdMatches.length - 1][1]));
const dashC = commitMatch[0].match(/\s-C\s*("[^"]+"|'[^']+'|\S+)/);
if (dashC) root = path.resolve(root, unq(dashC[1]));
// Trivial-diff exemption: total churn across the uncommitted tree (staged + unstaged -
// a chained `git add && git commit` stages mid-command, so staged-only would undercount).
// <= 2 files and <= 15 changed lines is the typo/one-line class; anything bigger gates.
// Untracked files count too: `git diff HEAD` never lists them, so a feature landing in NEW
// files only (`git add -A && git commit`) read as 'nothing to commit' and passed ungated
// (reproduced: three 40-line new files, exit 0). An untracked file is one row and its line
// count is its churn - the same arithmetic a staged add gets.
try {
  const git = (args) => execSync(`git ${args}`, { cwd: root, timeout: 5000 }).toString().trim();
  const numstat = git('diff HEAD --numstat');
  const rows = numstat ? numstat.split('\n') : [];
  let files = rows.length;
  let lines = rows.reduce((n, r) => {
    const [a, d] = r.split('\t');
    return n + (parseInt(a, 10) || 0) + (parseInt(d, 10) || 0);
  }, 0);
  for (const f of git('ls-files --others --exclude-standard').split('\n').filter(Boolean)) {
    files += 1;
    if (files > 2) break; // already past the bar - no need to size the rest
    try { lines += fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(Boolean).length; } catch { /* unreadable - the row alone counts */ }
  }
  if (files === 0) process.exit(0); // nothing to commit - let git say so
  if (files <= 2 && lines <= 15) process.exit(0);
} catch {
  process.exit(0); // not a git repo / git unavailable - never block on our own failure
}
const docsRoot = process.env.CLAUDE_DOCS_PATH || '.claude/docs';
const gate = path.join(root, docsRoot, 'flow', 'COMMIT-GATE');
const MAX_RECEIPT_AGE_MS = 2 * 60 * 60 * 1000; // 2h - the gate runs right before the commit; re-stamping is one Write
let first = '';
let second = '';
let stale = false;
try {
  const age = Date.now() - fs.statSync(gate).mtimeMs;
  if (age > MAX_RECEIPT_AGE_MS) {
    stale = true;
  } else {
    const lines = fs.readFileSync(gate, 'utf8').split('\n');
    first = (lines[0] || '').trim();
    second = (lines[1] || '').trim();
  }
} catch {
  // absent or unreadable - no gate receipt
}
// WAIVED carries the user's words on its own line; VERIFIED needs the authorized: second
// line - a review receipt alone is not consent (measured: a self-written VERIFIED receipt
// once cleared a commit no user had requested).
if (/^WAIVED\b/.test(first)) process.exit(0);
// The authorized: line must carry the user's actual quoted words - the label alone is not
// consent. A two-stage receipt's draft placeholder ('authorized: PENDING - append...') matches
// the bare prefix, so the prefix check silently accepted a receipt that records no consent
// (measured: a PENDING draft sat gate-passing for ~2 minutes before the real words landed).
const authReal = /^authorized:/.test(second) && /["'“‘]/.test(second) && !/\bPENDING\b/i.test(second);
const noAuth = /^VERIFIED\b/.test(first) && !authReal;
if (/^VERIFIED\b/.test(first) && !noAuth) process.exit(0);
process.stderr.write(
  (stale
    ? `Blocked: git commit - the gate receipt at ${gate} is older than 2h and is treated as absent (a stale receipt from an earlier round is not this diff's review).\n`
    : noAuth
      ? `Blocked: git commit - the gate receipt at ${gate} has a VERIFIED first line but its 'authorized:' second line is missing, a PENDING placeholder, or carries no quoted words; the review ran, but nothing records the user asking for THIS commit. Append authorized: "<their words, verbatim>" and retry.\n`
      : `Blocked: git commit on a non-trivial diff without the pre-commit gate receipt.\n`) +
    `The checkpoint (baseline-git.md) runs BEFORE a non-trivial commit: the formatter, then\n` +
    `the house review project-verify-code - plus /security-review when the diff touches\n` +
    `auth/crypto/secrets/payment/data-access paths (baseline-security.md). When those pass, write\n` +
    `${gate}\n` +
    `with one first line - VERIFIED <what was reviewed, one phrase> - and a second line\n` +
    `authorized: "<the user's words asking for THIS commit, verbatim>" (a receipt proves\n` +
    `the review ran, the authorized line proves the user asked for the commit - measured: a\n` +
    `self-written VERIFIED receipt once passed this gate on a commit no user requested).\n` +
    `Then retry the commit. If the user EXPLICITLY waived the gate this conversation, write\n` +
    `WAIVED - "<their words, verbatim>" instead; never fabricate either quote, and 'commit\n` +
    `it' alone is an instruction to commit, not a waiver of the review. Do not split a real\n` +
    `change into tiny commits to slip under this gate's trivial-diff exemption. Clear the\n` +
    `file once the commit lands (after the LAST commit when one receipt covers a batch).`,
);
process.exit(2);
