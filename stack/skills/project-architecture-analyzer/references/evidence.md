# project-architecture-analyzer - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## Intro
- **a skill-level `model` pin applies only for the rest of the turn in which the skill activates** - measured: invocations ran on the session model, while agent-level pins in the same session held exactly; the documented turn scope is what the measurement shows, so the session model is the lever

## Execution modes
- **An interrupted or declined ask is answered by RE-ASKING, never by inference** - measured: one run took exactly that sequence as 'run it'
- **Zero drift is a complete run and exits HERE** - measured: a zero-drift run walked into the reference loads and the re-verification anyway, and the restart 13 seconds later paid all of it a second time
- **One `+dirty` escape hatch: the same uncommitted files still unchanged** - measured: one run proved exactly this and stayed inline correctly - the escalation is for a dirty set the diff CANNOT account for, not for the suffix itself

## 2. GATHER
- **A spilled digest: grep it, or Read it with an offset and a limit - never whole** - measured: one unranged Read of a spilled result cost ~10.5k tokens for a fact a single grep would have returned

## 3. AGGREGATE + REASON
- **Load the vocabulary you reason with by MATCHING it** - measured: a companion skill invoked by remembered name in a project whose installed set was different - the 'select a skill by DESCRIPTION, not by name' rule failing in the field exactly where it is written down
- **an ABSENCE as proven only from the source of truth** - measured: a wire frame 'had no field' by usage grep - the decompiled model carried it, unused
- **the reasoning pass never stops early because the list already looks long enough** - measured 2026-08-21: one round filed 5 tiered items including the first `structural` in thirteen rounds against code that had not regressed - three of the five were artifacts of a new lens, not defects

## 4. RE-GATHER
- **settle it with the cheapest deterministic probe in-session first** - measured: two digest conflicts settled by one command each, where a re-dispatch would have cost ~50k tokens and returned another opinion

## 5. WRITE
- **the queue is drained in ONE closing pass per doc once every probe is done** - measured: verification that continued past the first write turned one doc into 6 extra patch passes and 1.02M tokens, each pass re-reading a doc that had grown since the last
- **one write (or one batched edit pass) per doc - never a per-claim edit stream** - measured: 31 serial edits to one assessment in a single session, each later re-read costing more as the doc grew
- **the assessment is the doc the quality loop reads at intake** - measured: one assessment reached 1,068 lines / ~31k tokens with no budget to fail against; another reached 1,935 - neither had a number to fail against, because 'length is handled by ranking and spilling' names the mechanism and no threshold, and a rule with no threshold never fires
- **Over target, run the spill pass NOW - this run owns the doc** - measured: a map grew 460 -> 738 lines across rounds because the capture declined to fix it and the loop's intake is ASSESSMENT-only
- **Per-round history is NOT part of the assessment** (doc-shapes) - measured: 352 of one assessment's 1,935 lines were round log

## 6. RULE
- **REPLACE it, never delete it** - measured: the `rm` this step used to mandate is denied by the auto-mode classifier, which costs exactly the blocked-call round-trip the delete was written to avoid
- **'~5 lines' is not a budget on its own** - measured: five 470-character lines satisfy it, which is how a shipped rule reached roughly 3x its intended weight

## 7. REPORT
- **`Vocabulary:` - the line is what makes the load happen** - measured: a run with no such report field loaded zero of them
- **`References:` - same receipt logic** - measured: one capture read neither of its own contract references and nothing surfaced the skip
- **`Decisions:` - unconditional, same receipt logic again** - measured: a project with one Accepted ADR was captured and re-assessed 44 times and no round carries a trace of that ADR; step 1 calls an accepted ADR 'declared intent to reconcile against', and this line is what turns that from a statement into an act
- **shape a follow-up as a RESUME BLOCK** - measured: ~12.9k tokens across two correction rounds reinventing exactly that shape because the convention lived only in a skill this run never loads
- **End with a `Model:` line, UNCONDITIONALLY** - measured both ways: 35 turns of an unrelated command rode Opus after a capture that closed with no such line, and a later capture's line credited the skill's own pin for a session that had been on Opus since message 1 and then declared no reset needed

## The findings gate (doc-shapes)
- **a re-measurement of an already-recorded limit folds into its existing entry, never re-tiered upward** - measured 2026-08-21: a declared, accepted scope limit got promoted to `substantial` for gaining a measurement, on code that had not changed
- **a property true since the project's first commit is not a new finding** - measured 2026-08-21: two such candidates were tiered - one at `structural`, the highest alarm, for a property true since the project's first commit
- **Worth knowing carries a promotion condition, never an untiered ceilings list** - measured 2026-08-21: an untiered ceilings list reached 42 entries and had never retired one
- **stable entry IDs, re-sorted by rank** - measured: the same kept-old-IDs re-sort drew a correction in two projects

## Don't game it
- **counts are the measured failure mode, and a too-clean look is not the trigger** - measured: 3 of 8 digests in one capture carried a wrong count and NONE looked suspicious; the doc's own history was 22 corrections, mostly counts and line refs
- **keep the re-measuring; kill the inflating** - measured: the 2026-08-21 round that inflated three lens artifacts into tiered findings ALSO caught four wrong numbers by re-measurement - one where the doc and the code's own XML doc agreed with each other and were both wrong
