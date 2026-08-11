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
const command = String((payload.tool_input || {}).command || '');
// A real `git commit` subcommand (allowing -C/-c/global flags between), not e.g. `git log --grep commit`.
const commitMatch = command.match(/\bgit(\s+-[cC]?\s*\S+|\s+--\S+)*\s+commit\b/);
if (!commitMatch) process.exit(0);
// An atomic write-receipt-then-commit command carries its own receipt: the gate file is
// written (with a VERIFIED/WAIVED line in the same command text) before git runs. Blocking
// it would reject the receipt discipline this gate exists to enforce (measured: the
// write+commit+clear-in-one-call shape is the corpus's dominant conforming pattern).
// All matches are bound to the PRE-commit segment (a commit message merely mentioning
// COMMIT-GATE VERIFIED is not a receipt), and a VERIFIED receipt needs its authorized:
// line here too - same contract as the file path below.
const preCommit = command.slice(0, commitMatch.index);
if (preCommit.includes('COMMIT-GATE')
  && /(>>?|\btee\b|\bcat\b|\bprintf\b)/.test(preCommit)
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
try {
  const numstat = execSync('git diff HEAD --numstat', { cwd: root, timeout: 5000 })
    .toString()
    .trim();
  if (numstat) {
    const rows = numstat.split('\n');
    const lines = rows.reduce((n, r) => {
      const [a, d] = r.split('\t');
      return n + (parseInt(a, 10) || 0) + (parseInt(d, 10) || 0);
    }, 0);
    if (rows.length <= 2 && lines <= 15) process.exit(0);
  } else {
    process.exit(0); // nothing to commit - let git say so
  }
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
const noAuth = /^VERIFIED\b/.test(first) && !/^authorized:/.test(second);
if (/^VERIFIED\b/.test(first) && !noAuth) process.exit(0);
process.stderr.write(
  (stale
    ? `Blocked: git commit - the gate receipt at ${gate} is older than 2h and is treated as absent (a stale receipt from an earlier round is not this diff's review).\n`
    : noAuth
      ? `Blocked: git commit - the gate receipt at ${gate} has a VERIFIED first line but no 'authorized:' second line; the review ran, but nothing records the user asking for THIS commit. Append the second line and retry.\n`
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
