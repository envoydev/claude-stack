# <docs-path>/quality/ASSESSMENT.md - required shape and write protocol

## Contents

- **The findings gate** - the four questions a candidate must pass before it is a finding
- **The count rule** - an output, never a target, in both directions
- **The three buckets** - every surviving item lands in exactly one
- **The shape** - Strengths, Must fix, Worth knowing, Deliberate tradeoffs, Summary
- **Format discipline** - the budget, and why there is no per-branch section protocol here
- **Write mechanics** - the stamp, the folder, the single overwrite

## Why this doc lives outside the docs-domain engine

`<docs-path>/quality/` carries no `watch.json`, so `domains()` in `.claude/hooks/docs.js` never picks it up - it
is not a docs domain at all. That is deliberate: weaknesses and strengths are a function of the map plus the
code, recomputable on demand for whatever branch you are on. A domain exists to make a doc survive a branch
switch (git versioning, or a local overlay folded back at merge) - and there is nothing here worth making
survive, because the next run reproduces it from source. Versioning a recomputed doc would be storing a cache
and calling it a record. No `<!-- id: -->` / `<!-- covers: -->` comment lines, no section-level stamp, no
`docs.js set`, no `docs.js lint` pass, no branch-overlay question at session end - none of that machinery applies
here, and this skill never invokes it. On a project that commits its docs, plain git tracks the file exactly like
any other tracked file, with no per-branch overlay; on a project whose docs root is local-only, this file is
local too, same as the rest of the root.

## The findings gate - pass all four questions or it is not a finding

Before ANY candidate is recorded as a weakness, answer all four explicitly; an unanswerable question is a fail, and a failed candidate is routed (Worth knowing, or folded into an existing entry) or dropped - never tiered:

1. **What breaks?** The concrete wrong outcome - wrong or lost data, a crash or 5xx, a security hole, a change that cannot be made safely, or time repeatedly lost by the next developer. 'It differs from how another codebase or a reference doc would do it' is not an answer.
2. **Who notices, and when?** A user, an operator, or the next person to touch this code - named, with the trigger condition.
3. **Is it actually new?** Unchanged code whose behaviour the last run's `<docs-path>/quality/ASSESSMENT.md` already records - a known limit, an accepted tradeoff, an existing entry - is a re-measurement, not a discovery: fold the sharper number into the existing entry. Never open a new entry for it, and never re-tier the old one upward merely because it now has a number.
4. **Has the project already decided this?** Read the decision log FIRST (`<docs-path>/decisions/`, where that domain exists - or wherever the project keeps ADRs). A recorded decision is not a defect, and re-raising it each round is exactly the failure this gate exists to stop.

**The external-preference rule.** A convention skill, reference doc, or industry pattern preferring a different approach is not evidence of a weakness. Where this project has a mechanism that works, it wins unless you can show it FAILING - a real miss, a real regression it let through. A candidate whose only support is 'a reference prefers X' lands under Worth knowing at most, never tiered.

## The count rule - an output, never a target, in both directions

- **Never pad upward.** No observation is promoted to a weakness, and no minor to a major, to make the doc look thorough. Zero gate-passing weaknesses is a valid, complete result on a healthy codebase - state it plainly.
- **Never truncate downward.** EVERY candidate that passed the gate is recorded - twenty-five real weaknesses means the doc carries twenty-five; dropping one because a list is getting long is silent data loss the next run cannot detect. Strengths the same: every genuine one, not a round number.
- **Length is handled by ranking and spilling, never by deletion.** Order by blast radius so the top is actionable at a glance; spill entry detail to `<docs-path>/architecture/references/` topic files (this doc has no `references/` of its own - it borrows the map's, since the detail is about the code, not about this file). The entry itself stays. The threshold that triggers the spill is in *Format discipline* below - ~300 lines, `wc -l`-checked after the write; without a number this rule never fires.

## The three buckets - every surviving item lands in exactly one

| Bucket | Meaning | The quality loop may act on it? |
|---|---|---|
| **Must fix** | A real defect that passed the gate - carries Tier, Remediation, Strength check | Yes |
| **Worth knowing** | True and verified, but no action warranted now: a documented ceiling, a declared scope limit, a measured property of an accepted tradeoff. Not a weakness. | Never - a loop must not 'fix' these |
| **Deliberate tradeoff** | A decision the project made on purpose, with the reason | Never - and never re-raise it |

No bucket has a size limit. **Worth knowing retirement rule** - what stops the list growing forever: every entry states the condition that would promote it to Must fix - an entry whose promotion condition you cannot state is dropped, not listed. Each re-run checks every entry against its own condition: promote it, leave it, or DELETE it when the condition can no longer occur. That is the one sanctioned way an entry leaves the list - by its own recorded condition, never by trimming.

## The shape

- **Strengths** - every genuine strength the analysis found, titled, each with the reasoning (what it buys - testability, isolation, evolvability, clear ownership) tied to located code (the module / boundary / pattern it comes from). However many that is - a small codebase supports few; say so rather than invent.
- **Must fix** - every weakness that passed the gate, titled, ranked by blast radius, each with the reasoning (what it costs - coupling, fragility, blast radius, a captive dependency, a perf or consistency hazard) tied to located code, then two required fields. W-IDs are rank labels, not stable identities: a re-rank RENUMBERS so W1 is always the current top item; a cross-run reference cites the title, not the number, and a user reorder ask that is ambiguous about renumbering gets asked. Test-suite weaknesses are OUT OF SCOPE - coverage numbers, missing or weak tests, absent test infrastructure belong to the `project-test-coverage-analyzer` capture and its COVERAGE.md, never here (the two docs would drift over the same fact). The architecture-side line stays in: a *structural* testability blocker (a missing seam, static coupling, a dependency that cannot be substituted) is an architecture weakness; the tests it blocks are the coverage capture's.
  - **Remediation** - concretely how to resolve it: the boundary to introduce, the dependency to invert, the pattern to adopt, the seam to guard with a fitness test. Every remediation is **strength-checked** against the Strengths list before it lands: if applying it would erode a listed strength, the entry names that tension and shapes the fix to preserve the strength - and where the two genuinely trade off, the entry says so explicitly, which forces the weakness to the structural tier (a user decision, never an auto-fix).
  - **Tier** - **small** (a localized edit an implementer can land), **substantial** (a designer-led multi-task change - decompose, build, verify), or **structural** (a risky cross-cutting rework - flag it, do not let a loop auto-apply it).

  One entry in that shape:

  > **W3 - Invoicing queries Orders' persistence entities across the module boundary.** `InvoiceBuilder.BuildAsync` reaches into Orders' data context directly (located: `Invoicing/InvoiceBuilder` -> `Orders.Order`), so an Orders schema change ripples into Invoicing untested - the boundary exists in folders, not in the dependency graph.
  > **Remediation** - feed Invoicing from an Orders-owned read projection (or an integration event), and guard the seam with an architecture test asserting Invoicing never references Orders' data context.
  > **Strength check** - preserves S2 (module isolation): the projection keeps Orders' persistence private instead of widening the shared surface a direct-reference fix would.
  > **Tier** - substantial.
- **Worth knowing** - one line per entry plus its promotion condition; detail spills to a `references/` topic file when it needs more. A long list stays cheap to read - that is what the lighter shape is for.
- **Deliberate tradeoffs** - the decision and the reason it was made, so no later run re-litigates it. Sourced from the decision log (gate question 4) - never written here from this skill's own judgment.
- **Proposed decisions** - a repeatedly-declined Must-fix entry, or a tradeoff this run judged worth recording, shaped ready to accept: the claim, the reason, what it costs. This skill NEVER writes to the decision log; a person accepts a proposal by writing it themselves, at which point the next run's gate question 4 picks it up and the entry moves out of Must fix.
- **Summary** - the per-bucket and Must-fix tier tally, and the top few highest-leverage fixes.

## Format discipline - the budget

This doc is read at intake by every `project-architecture-quality-loop` round, so its weight is paid again each
time - and a rule with no threshold never fires.

- **Target: ~300 lines.** Double the map's, because an entry carries reasoning the map does not - but a number, and a checked one: `wc -l` it after the write, and over target run the spill pass. Spilling is not deleting: the entry's title, tier, one-line cost and its Remediation and Strength-check fields stay inline; the supporting detail - the located-code walkthrough, the measurement, the alternatives weighed - moves to `<docs-path>/architecture/references/<topic>.md` and the entry links it. Ranking still comes first, so the top of the doc is actionable before anything is spilled.
- **No per-round history in this doc, ever.** Not '3 rounds inline, then archive' like a versioned doc gets - none at all. A running log of what changed round to round is exactly the kind of thing that belongs to a record, not a cache; recomputing this file fresh every run means there is no 'round' to log inside it. A project that wants that history keeps it in `project-architecture-quality-loop`'s own report trail, never here.

## Write mechanics

**No write gate, no diff check, no stamp-triggered skip.** Every other capture in this stack asks before
overwriting an existing doc, because that doc accretes content a person might still want. This one does not ask:
it is recomputed from the map, the code and the decision log every time it runs, so there is nothing an overwrite
could destroy that a re-run would not reproduce anyway. REPLACE the file wholesale - Write over whatever was
there (READ it first if it exists, so the Write is legal - an `rm` first is denied by the auto-mode classifier).

Open the doc with a freshness line for the human reader - `As of: <branch>@<short-sha>, <YYYY-MM-DD>` (`+dirty`
appended when the working tree holds uncommitted changes). This is informational only, never a gate: nothing
reads it to decide whether to skip the run, unlike the `Captured:` stamp on a real domain doc.

Create `<docs-path>/quality/` only when absent. Write ONLY `<docs-path>/quality/ASSESSMENT.md` - never source,
never the map, never the decision log. After the write, `wc -l` it against the ~300-line target above and run
the spill pass now if it is over.
