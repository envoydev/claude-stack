# Stack Usage Collect in Project and Sessions Audit - Run From claude-stack

Gather Claude Code session usage data from several consuming projects into this repo's local
collection, then audit the collection against the stack source. One run, two halves: a
deterministic COLLECT half driven entirely from the claude-stack clone, and an ANALYZE half that
hands the result to `docs/stack-usage-sessions-audit.prompt.md`.

Run from the claude-stack repo root, in a FRESH session. Nothing here runs inside the audited
projects - the sweep reads their session history where Claude Code already stores it, so no
project is modified and no project session has to be started.

Sibling prompt: `docs/stack-usage-collect-in-project.prompt.md` runs INSIDE one project and
produces a model-authored `report-usage.md` per session. Use that one when you want the judgment
sections written; use THIS one to sweep many projects cheaply - it emits the same bundles with the
report skeleton left unauthored.

## Parameters

- `PROJECTS`: the absolute paths of the consuming projects to sweep. Supply them at invocation -
  there is no default, and no project name or path is ever written into a tracked file.
- `SINCE` / `UNTIL`: optional ISO date bounds on the session's first timestamp (default: all).
- `DEST`: collection root (default: `docs/session-investigation/<project-name>/<session-id>/`,
  where `<project-name>` is the project directory's own basename).
- `ANALYZE`: run the audit half when collection finishes (default: `ask`).

## Phase A - resolve, and prove the destination is safe

1. `DEST`'s root must be ignored by git before ANYTHING is written - it will hold raw transcripts:

       git check-ignore -q docs/session-investigation && echo IGNORED   # expect IGNORED
       git status --porcelain docs/session-investigation | wc -l        # expect 0

   Not ignored is a stop condition: fix `.gitignore` first, collect second.
2. For each project in `PROJECTS`, resolve its history folder. Claude Code stores one folder per
   project under `<config-dir>/projects/`, named by the absolute project path with every `/`
   replaced by `-` (so the name starts with a dash). There can be MORE THAN ONE config dir on a
   machine - the default `~/.claude` plus any `CLAUDE_CONFIG_DIR` space (`~/.claude-<space>`) -
   and a project's sessions may live in any of them, so glob all of them (`~/.claude*/projects/`)
   and take every match, not the first.
3. A project with no matching folder has no Claude Code history on this machine and nothing to
   audit - record it as skipped, do not create an empty bundle, and carry on with the rest.
4. Use ABSOLUTE paths in every command from here on. A `cd` persists between commands, so a later
   relative path silently resolves somewhere else - one earlier run wrote a whole bundle tree into
   a nested copy of its own destination and it looked like data loss.

## Phase B - choose the sessions

1. Per resolved history folder, run the rollup once: `node scripts/analyze-usage.js <history-dir>`
   - one line per session, cheap, and it is what tells you which sessions carry real work.
2. Apply `SINCE` / `UNTIL` against each session's first timestamp, and drop sessions already
   collected (a bundle folder exists at the destination) - list them as previously collected.
3. Print the resolved per-project session list before collecting. Never print analyzer output
   itself into the chat: reading full reports back is what drives a run's context into the
   hundreds of thousands of tokens - every command in Phase C redirects to a file.

## Phase C - collect, one bundle per session

Write `<DEST>/<project-name>/<session-id>/` containing:

| Artifact | How |
|---|---|
| `analyzer.json` | `node scripts/analyze-usage.js <transcript> --json > .../analyzer.json` |
| `analyzer-full.txt` | `node scripts/analyze-usage.js <transcript> > .../analyzer-full.txt` |
| `report-usage.md` | `node scripts/analyze-usage.js <transcript> --report-md > .../report-usage.md` - the skeleton; its FILL IN judgment sections stay unauthored, the audit does not need them |
| `<session-id>.jsonl` | copy of the transcript - the audit's ground truth |
| `subagents/` | copy of the transcript's sibling `subagents/` folder when it exists |
| `tool-usage-<sid>.jsonl` | the instrumentation ledgers from the project's own docs root (`<project>/.claude/docs/tools-usage/<sid>.jsonl`, or its `CLAUDE_STACK_DOCS_PATH` root), the session's own and its dispatched agents' - COPIED, never moved: the project owns its data and this sweep is a reader |
| `hook-blocks-<sid>.jsonl` | the guard-block ledger from the same docs root (`<project>/.claude/docs/hook-blocks/<sid>.jsonl`) - one row per BLOCK, naming which hook fired. COPIED like the ledger above. The transcript records only which TOOL was denied, never which guard denied it, so without this file the per-hook block rate - the number that says whether a gate earns its keep or misfires - is unmeasurable for the swept session |

Add `--hook-log <ledger>` to the three analyzer calls when a ledger exists; say so per session when
none does. Add `--hook-blocks <that session's hook-blocks file>` the same way - pass the session's
own FILE, never the whole directory, or every other session's blocks land in this session's tally. Add `--docs-root <root>` for any project whose `CLAUDE_STACK_DOCS_PATH` is non-default, or the
analyzer's generated-docs table silently reports nothing.

Then write `<DEST>/<project-name>/rollup.txt` (Phase B's rollup output) and, when the project
contributed more than one session, `<DEST>/<project-name>/SUMMARY.md` - the one-row-per-session
table, so the audit's Phase 0 has its orientation file.

Raw transcripts carry full conversation content - code, file contents, possibly secrets. The
gitignore proven in Phase A is the only thing keeping them out of a public repo: re-run both
checks after the copy, and never lift a quote from a bundle into a tracked file without
genericizing it to 'a consuming project'.

## Phase D - analyze

Report the collection first: projects swept, projects skipped for missing history, sessions
collected per project, total size, and the two gitignore checks.

Then route the analysis through AskUserQuestion - run the audit now on the fresh collection
(recommended) / collect only, audit later - unless `ANALYZE` already decides it. On yes, follow
`docs/stack-usage-sessions-audit.prompt.md` with `SESSIONS_ROOT=docs/session-investigation`,
noting that this collection nests one project level above the session-id folders, so its bundle
enumeration walks `<SESSIONS_ROOT>/<project>/<session-id>/` and its cross-session synthesis spans
projects - a defect reproducing across two projects' stacks is the strongest cluster the sweep can
produce.
