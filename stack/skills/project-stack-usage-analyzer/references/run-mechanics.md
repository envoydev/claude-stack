# Stack usage audit - run mechanics (steps 2-3)

Read at step 2, once the snapshot is on disk, and before the first analyzer call; the report's Environment rows carry `Mechanics: read` as the receipt. This file holds the command shapes - the body holds the rules about when each runs.

## The batch shape - a file, not a pipe

The harness's auto-mode classifier blocks a piped compound (`curl | tar || git clone`) verbatim, and a denied pipe costs a cold clone; a loop it reads fine, and at real scope a loop is unavoidable (a per-session command times N sessions is N calls). So write the batch to a file and execute the file - one simple command the classifier reads as one, with the loop inside the file rather than inside the command line:

```bash
cat > "$TMP/run.sh" <<'EOF'
for f in <the session files>; do
  node "<snapshot>/scripts/analyze-usage.js" "$f" --report-md > "<out>/$(basename "$f" .jsonl)/report-usage.md"
done
EOF
bash "$TMP/run.sh"
```

`<snapshot>` = `$TMP` when the archive extracted, `$TMP/repo` when the clone ran.

## The analyzer calls

- `node <snapshot>/scripts/analyze-usage.js <projects-dir>` - one-line rollup, to confirm which sessions matter (and the SUMMARY.md rollup table).
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl>` - full report, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --json` - machine dump, once per matching session.
- `node <snapshot>/scripts/analyze-usage.js <session.jsonl> --report-md > report-usage.md` - the report SKELETON: machine-written tables plus the FILL IN judgment sections. Add `--hook-log` here too when the ledger exists (below).
- Non-default docs root (`CLAUDE_STACK_DOCS_PATH` set): add `--docs-root <that root>` to every per-session call - the analyzer's Generated-docs table watches only `.claude/docs/` by default, so a custom root silently drops every doc touch. The flag covers BOTH routes (the Read/Write calls and the doc I/O routed through Bash); it used to reach only the first, which made the table disagree with itself.

## The ledger test - one command per session, its output quoted

Never assert a ledger's absence from a prose instruction; run this for each audited session and quote what it prints:

```bash
for d in tools-usage hook-blocks; do
  f="<docs-path>/$d/<sid>.jsonl"
  [ -f "$f" ] && echo "$d: $f ($(wc -l < "$f") rows)" || echo "$d: absent"
done
```

`absent` in the report means that command printed `absent` for that session. The instrumentation ledgers: `CLAUDE_STACK_INSTRUMENT=1` writes one per session/agent id under `<docs-path>/tools-usage/<sid>.jsonl` (or wherever `CLAUDE_STACK_INSTRUMENT_LOG` pointed) - check that folder for the session's own id and its dispatched agents' ids; on a hit add `--hook-log <ledger>` to the per-session calls - it joins the who-fired-what identity side the transcript alone cannot attribute. No ledger: skip the flag and say so in the report. The guard-block ledger: `<docs-path>/hook-blocks/<sid>.jsonl`, checked the same way; on a hit add `--hook-blocks <that file>` - the session's OWN file. The tool narrows a directory to `<session-id>.jsonl`, but name the file anyway: it says which session you meant. That ledger is the only record of WHICH guard denied a call (the transcript names the denied tool and nothing else), and a block costs its denial text plus the retried turn, so the per-hook block rate is what says a gate earns its keep.
