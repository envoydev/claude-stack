# Architecture Quality Loop - loop mechanics

Step-scoped mechanics for `project-architecture-quality-loop`: the lens sweep (step 1, when the work list is drained), the seat brief shapes (step 2), the RESUME BLOCK (step 4, on a 'fresh' answer) and the final report's field rules (step 4, on STOP). The body's step 4 Reads this file whole and the report's `Mechanics` line is the receipt; step 1 and step 2 read their own sections when they need them. Every rule here is binding - this file holds the shape, the body holds the step.

## Lens sweep - step 1, when the work list is drained

Run a lens sweep instead of re-capturing when the Must-fix list is empty, or when a later round wants findings the last capture missed:

- Pick 3-5 distinct cross-cutting defect classes the codebase is actually exposed to - e.g. concurrency, money/precision handling, fail-open error paths, boot/config wiring, external-API trust.
- Sweep the code one lens at a time. DELEGATED: one architecture-analyzer seat per lens, each briefed with ONLY its lens plus the areas to read. INLINE: one lens per pass, yourself.
- Lenses are disjoint by construction - a seat that gets two lenses dilutes both.
- For map orientation the brief pastes the RELEVANT sections of `<docs-path>/architecture/ARCHITECTURE.md` (or names them for a ranged read), never a bare path to the whole doc - a path-only brief makes every seat whole-read the map.
- Findings triage into the same tier routing as assessment weaknesses (small / substantial / structural); an off-list finding the round works is added to the assessment at the round's prune, shaped like the capture writes them.

## Seat brief shapes - step 2

- **small-tier implementer brief** - the file/symbol, the smallest correct change, the check that proves it, and `memory: none`: a scoped fix has no serena hand-off. A brief that does hand a note names it literally, read side included (memory hygiene: `references/domain-trio-protocol.md`) - an un-briefed seat writes unrequested notes and fans out over the whole memory store.
- **substantial-tier designer brief** - the weakness, its assessment entry (strength tensions included) and the remediation as the requirement; the designer returns the decomposition, the body's step 2 gates and approves it before any implementer runs.
- **lens-sweep analyzer brief** - ONE lens, the areas to read, the RELEVANT map sections pasted (see above).

## RESUME BLOCK - step 4, on 'fresh'

When the fresh-session ask answers 'fresh', end the turn with this block and nothing else - no 'one more step', no new work in this chat. The new session must be able to start from the block alone:

```text
RESUME - project-architecture-quality-loop
Invocation: /project-architecture-quality-loop <scope> - resumed round <N of 3> (rounds consumed: <list>)
Mode: <DELEGATED | INLINE> - "<the mode answer, verbatim>"
Read first: <docs-path>/architecture/ASSESSMENT.md (pruned at round <N-1>), <docs-path>/architecture/ARCHITECTURE.md
Baseline: build <green | red: what>, tests <green | red: what>, last commit <sha | none>, pushed <yes | no>
Remaining weaknesses, leverage order:
  1. <weakness> - <tier> - <remediation, one line>
Deferred: <structural items declined or undecided | none>
```

The invocation names the rounds already consumed so the 3-round cap survives the resume. On a RESUMED session no mode ask fires: the `Mode:` line is what the body's Rules have the small-tier stamp quote, so it carries the answer verbatim.

## Final report - field rules, step 4 on STOP

One line per field, a table where a field lists several items - the close is an answer like any other and the answer-length hook blocks a wall of prose; tables are exempt.

- **Outcome** - SATISFIED / PLATEAU / CAPPED / BLOCKED, and on which round. CAPPED means the CUMULATIVE improve-round cap was reached - rounds count across sessions via the resume invocation's round numbering. A session ending because the user chose the fresh-session option with fixable weaknesses left is a LOOP handoff, not CAPPED - this rule is the tiebreak.
- **Resolved** - each weakness fixed, its tier, and the change that closed it.
- **Deferred** - structural items the user declined or has not decided, plus accepted tradeoffs left alone - never silently dropped.
- **Docs** - the pruned ASSESSMENT.md + the stop-time reconcile of ARCHITECTURE.md (skipped when nothing shipped), each with its touch count from your own tool calls - `ASSESSMENT: 1 batched edit`. A count above one per doc per round is the serial-edit stream the UPDATE-DOCS step forbids: report it as such, never rationalize it.
- **Baseline** - build + tests green at stop (or the red that blocked it), plus the push state when commits exist - unpushed rounds accumulate silently otherwise.
- **Memories** - `memories purged: <names|none>`, fold-first per `references/domain-trio-protocol.md` - the trio reference's receipt, restated in the report because the rule goes unread otherwise.
- **Next actions** - when Deferred items are blocked on the operator (a live walk, a log grab, a replay), a ranked what-to-do list ships IN this report, not on request.
- **Mechanics** - `loop-mechanics.md: read` - the receipt that this file was read this step.

Then the two closing asks the body mandates, both through AskUserQuestion and never a prose bullet: the commit decision (commit now / hold) when work is uncommitted and no round is queued, and tear-down-vs-keep for anything the round started and still has up.
