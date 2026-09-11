# The capture's artifacts - required shape and write protocol

## <docs-path>/architecture/ARCHITECTURE.md - the structure map

The durable, whole-project architecture record - the orientation a solution-designer reads to keep new work consistent with the structure that already exists. Keep it LEAN: it carries the CORE map only, and deep-dive detail spills to `<docs-path>/architecture/references/<topic>.md` topic files that the main file links from a short index (the same hub-and-spoke shape as a skill's `SKILL.md` plus its `references/`). The five core sections, in order, each concise:

1. **Framework and packages** - the runtime and target framework version, the language version, and the load-bearing packages (ORM, DI, messaging, auth, UI) with their role and major version. The dependencies that shape the architecture, not a lockfile echo.
2. **Architecture logic** - the architecture style (clean / vertical-slice / modular-monolith / layered / MVVM ...) and the layering, as ONE Mermaid `flowchart TD` block (15 nodes max, short labels; an arrow is a proven reference - `A --> B` means A references B) plus one prose line for the rules the arrows cannot say (what an inner layer may not reference - 'Domain references nothing; nothing references Api'). Mermaid because it costs the same tokens as an edge list, GitHub renders it, and agents parse it reliably; structure that will not fit 15 nodes spills to a `references/` topic file, never into a bigger diagram.
3. **Project structure** - a module-inventory table, one row per module/project: module | path + entry point (a `file:symbol` anchor) | responsibility | depends on (why). One row carries everything about a module in one place - the grouped shape agents resolve dependencies from most reliably - and doubles as the concern-to-place map.
4. **Patterns in play** - the recurring patterns and cross-cutting mechanisms actually in use (CQRS, repository / unit-of-work, mediator, options binding, the DI composition root, the error envelope, the auth seam), each anchored where it lives (`file:symbol`), so new work reuses the established pattern instead of inventing a rival.
5. **Boundaries and specifications** - the module and bounded-context boundaries and the contracts that guard them: which boundary is enforced by an architecture test versus held only by convention, the schema-ownership lines, and the constraints new work must satisfy (the house conventions in force, the non-functional targets, the seams that must not be crossed).

Format discipline - every seat reads this map at orientation, so its weight is paid on every dispatch: keep the core file within ~150 lines and spill the rest to `references/`. Anchors are `file:symbol` throughout (the entry points in section 3, the pattern homes in section 4, the guarded seams in section 5) - the map doubles as the navigation index, so a seat jumps to the anchor via serena instead of re-deriving where things live. Tables and lists for anything enumerable; prose only for reasoning structure cannot carry (why a boundary exists, an accepted tradeoff). Never ASCII-art box diagrams - the same graph costs about double the tokens and models misread 2D text layout. A `references/` deep-dive may carry a Mermaid sequence diagram for ONE key runtime flow the static map cannot show (events, messaging) or an ER diagram for a bounded context's schema ownership - authored per the `docs-as-code` skill; the core map stays flowchart + tables only.

## <docs-path>/architecture/ASSESSMENT.md - the reasoned evaluation

The companion to the neutral map: a candid judgement of the architecture as it stands, so its weaknesses are visible and improvable rather than silently inherited. The `project-architecture-quality-loop` skill reads this to drive fixes, keyed by the tier assigned - and it acts on **Must fix** entries only, never on the other two buckets.

### The findings gate - pass all four questions or it is not a finding

Before ANY candidate is recorded as a weakness, answer all four explicitly; an unanswerable question is a fail, and a failed candidate is routed (Worth knowing, or folded into an existing entry) or dropped - never tiered:

1. **What breaks?** The concrete wrong outcome - wrong or lost data, a crash or 5xx, a security hole, a change that cannot be made safely, or time repeatedly lost by the next developer. 'It differs from how another codebase or a reference doc would do it' is not an answer.
2. **Who notices, and when?** A user, an operator, or the next person to touch this code - named, with the trigger condition.
3. **Is it actually new?** Unchanged code whose behaviour the docs already record - a known limit, an accepted tradeoff, an existing entry - is a re-measurement, not a discovery: fold the sharper number into the existing entry. Never open a new entry for it, and never re-tier the old one upward merely because it now has a number.
4. **Has the project already decided this?** Read the Deliberate tradeoffs list FIRST. A recorded decision is not a defect, and re-raising it each round is exactly the failure this gate exists to stop.

**The external-preference rule.** A convention skill, reference doc, or industry pattern preferring a different approach is not evidence of a weakness. Where this project has a mechanism that works, it wins unless you can show it FAILING - a real miss, a real regression it let through. A candidate whose only support is 'a reference prefers X' lands under Worth knowing at most, never tiered.

### The count rule - an output, never a target, in both directions

- **Never pad upward.** No observation is promoted to a weakness, and no minor to a major, to make the doc look thorough. Zero gate-passing weaknesses is a valid, complete result on a healthy codebase - state it plainly.
- **Never truncate downward.** EVERY candidate that passed the gate is recorded - twenty-five real weaknesses means the doc carries twenty-five; dropping one because a list is getting long is silent data loss the next capture cannot detect. Strengths the same: every genuine one, not a round number.
- **Length is handled by ranking and spilling, never by deletion.** Order by blast radius so the top is actionable at a glance; spill entry detail to `<docs-path>/architecture/references/` topic files. The entry itself stays. The threshold that triggers the spill is in *Format discipline* below - ~300 lines, `wc -l`-checked after the write; without a number this rule never fires.

### The three buckets - every surviving item lands in exactly one

| Bucket | Meaning | The quality loop may act on it? |
|---|---|---|
| **Must fix** | A real defect that passed the gate - carries Tier, Remediation, Strength check | Yes |
| **Worth knowing** | True and verified, but no action warranted now: a documented ceiling, a declared scope limit, a measured property of an accepted tradeoff. Not a weakness. | Never - a loop must not 'fix' these |
| **Deliberate tradeoff** | A decision the project made on purpose, with the reason | Never - and never re-raise it |

No bucket has a size limit. **Worth knowing retirement rule** - what stops the list growing forever: every entry states the condition that would promote it to Must fix - an entry whose promotion condition you cannot state is dropped, not listed. Each re-run checks every entry against its own condition: promote it, leave it, or DELETE it when the condition can no longer occur. That is the one sanctioned way an entry leaves the list - by its own recorded condition, never by trimming.

### The shape

- **Strengths** - every genuine strength the analysis found, titled, each with the reasoning (what it buys - testability, isolation, evolvability, clear ownership) tied to located code (the module / boundary / pattern it comes from). However many that is - a small codebase supports few; say so rather than invent.
- **Must fix** - every weakness that passed the gate, titled, ranked by blast radius, each with the reasoning (what it costs - coupling, fragility, blast radius, a captive dependency, a perf or consistency hazard) tied to located code, then two required fields. W-IDs are rank labels, not stable identities: a re-rank RENUMBERS so W1 is always the current top item; a cross-round reference cites the title, not the number, and a user reorder ask that is ambiguous about renumbering gets asked. Test-suite weaknesses are OUT OF SCOPE - coverage numbers, missing or weak tests, absent test infrastructure belong to the `project-test-coverage-analyzer` capture and its COVERAGE.md, never here (the two docs would drift over the same fact). The architecture-side line stays in: a *structural* testability blocker (a missing seam, static coupling, a dependency that cannot be substituted) is an architecture weakness; the tests it blocks are the coverage capture's.
  - **Remediation** - concretely how to resolve it: the boundary to introduce, the dependency to invert, the pattern to adopt, the seam to guard with a fitness test. Every remediation is **strength-checked** against the Strengths list before it lands: if applying it would erode a listed strength, the entry names that tension and shapes the fix to preserve the strength - and where the two genuinely trade off, the entry says so explicitly, which forces the weakness to the structural tier (a user decision, never an auto-fix).
  - **Tier** - **small** (a localized edit an implementer can land), **substantial** (a designer-led multi-task change - decompose, build, verify), or **structural** (a risky cross-cutting rework - flag it, do not let a loop auto-apply it).

  One entry in that shape:

  > **W3 - Invoicing queries Orders' persistence entities across the module boundary.** `InvoiceBuilder.BuildAsync` reaches into Orders' data context directly (located: `Invoicing/InvoiceBuilder` -> `Orders.Order`), so an Orders schema change ripples into Invoicing untested - the boundary exists in folders, not in the dependency graph.
  > **Remediation** - feed Invoicing from an Orders-owned read projection (or an integration event), and guard the seam with an architecture test asserting Invoicing never references Orders' data context.
  > **Strength check** - preserves S2 (module isolation): the projection keeps Orders' persistence private instead of widening the shared surface a direct-reference fix would.
  > **Tier** - substantial.
- **Worth knowing** - one line per entry plus its promotion condition; detail spills to a `references/` topic file when it needs more. A long list stays cheap to read - that is what the lighter shape is for.
- **Deliberate tradeoffs** - the decision and the reason it was made, so no later round re-litigates it.
- **Summary** - the per-bucket and Must-fix tier tally, and the top few highest-leverage fixes.

### Format discipline - the assessment has a budget too

The map is capped and checked; the assessment was not, and it is the doc the `project-architecture-quality-loop` reads at INTAKE on every round, so its weight is paid again each time - and a rule with no threshold never fires.

- **Target: ~300 lines for `ASSESSMENT.md` itself.** Double the map's, because an entry carries reasoning the map does not - but a number, and a checked one: `wc -l` it after the write, and over target run the spill pass. Spilling is not deleting: the entry's title, tier, one-line cost and its Remediation and Strength-check fields stay inline; the supporting detail - the located-code walkthrough, the measurement, the alternatives weighed - moves to `<docs-path>/architecture/references/<topic>.md` and the entry links it. Ranking still comes first, so the top of the doc is actionable before anything is spilled.
- **Per-round history is NOT part of this doc.** A running log of what each capture or loop round did is orientation for one reader on one day, and it grows without bound while every intake pays for it. Keep at most the **last 3 rounds** inline as a short table - date, what changed, entries opened/closed - and move everything older to `<docs-path>/architecture/references/assessment-rounds.md`, appended to, never rewritten. A project that keeps no log keeps none; nothing here asks for one.

## Write protocol - how step 5 lands the docs

Followed after AGGREGATE has settled, in this order. Verification is finished before the first byte is written (the
skill body's precondition); this section is the mechanics of the write itself.

### The stamp

Every doc this capture writes opens with `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`. Append `+dirty` to the
sha when the working tree holds uncommitted changes (`git status --porcelain` non-empty): a dirty capture describes
code no commit contains, and the suffix is what stops a later update from trusting it. Prefer capturing on a clean
tree; a dirty one is allowed but marked. In ARCHITECTURE.md the stamp is followed by the fixed pointer sentence
`On another branch, check architecture/BRANCH-DELTA.md for that branch's recorded changes.` - so any later reader
(and the next capture) knows exactly which code the map describes and where a branch's own picture lives; a
reader on a different branch treats the main content as the base picture, approximate for their branch.

The `+dirty` escape hatch on an UPDATE: when the SAME uncommitted files still sit in the tree unchanged since the
capture (provable - their mtimes at or before the prior capture's write, or a matching `git stash create` sha), the
dirty set is accounted for and the update may stay inline, saying so in the report. The escalation to per-module
dispatch is for a dirty set the diff CANNOT account for, not for the suffix itself.

### The branch delta

On a foreign branch (the ORIENT branch check), write `<docs-path>/architecture/BRANCH-DELTA.md` INSTEAD of touching
the main docs: its own stamp plus ONLY what this branch changes against the base map - a new/removed module, a
moved boundary, a new dependency edge, a pattern introduced - table-formatted, replaced whole on each delta capture,
never a second full map. A capture running on the main docs' own branch again refreshes the main docs and then
judges the delta against the code it just mapped: delta changes now PRESENT in this branch (the branch merged -
the fresh map already covers them) -> DELETE the delta; changes still absent (the branch lives unmerged) -> the
delta STAYS, it is another branch's record. A delta capture leaves the generated awareness rule untouched - the
rule keeps describing the base map.

### Diagrams and format

Load `docs-as-code` before writing - its Mermaid ground rules govern the core-map flowchart and any deep-dive
sequence/ER diagram (one exception: a reconcile whose diagrams carry forward verified unchanged may skip the load
and say so in the report). This file fixes WHAT each doc contains - including the format-for-agents discipline
above (tables and grouped rows over prose, no ASCII art) that keeps the docs cheap for every seat that reads them
at orientation; `docs-as-code` fixes HOW the diagrams are written. Both docs are clean, scannable Markdown per the
`markdown-style` skill.

### The folder

Create `<docs-path>/architecture/` and `<docs-path>/architecture/references/` only when absent. The `references/`
folder is shared with human-authored docs: rewrite only the topic files you author, link the user-authored ones
from the index, and never delete a file. Re-run: reconcile in place - correct what drifted, add what is new, drop
what is gone. Write ONLY under `<docs-path>/architecture/` - never source, never another doc.

### The budget check and the spill

After the write, `wc -l` BOTH docs against the targets stated above (~150 lines for the map, ~300 for the
assessment). Over target, spill the overweight sections to `references/` files NOW - the spill is the sanctioned
second pass on the doc (a restructure, not the per-claim edit stream the one-write rule forbids); this run owns
the doc, and no other flow will. An overrun this run genuinely cannot resolve is filed as a small-tier ASSESSMENT
entry so the quality loop picks it up.

## .claude/rules/baseline-project-architecture.md - the awareness rule

Step 6 writes this from the fresh capture, wholesale, to the template below. `<docs-path>` is baked to the LITERAL
resolved root this capture wrote under - the generated rule is a deterministic pointer and must name the real
path, never a placeholder (the rule cannot itself follow the remap convention it exists to reinforce). Create
`.claude/rules/` when absent. The summary lines come from THIS run's capture, never stale-copied; the trigger
paragraph is fixed. Budget: ~700 bytes, checked with `wc -c` and reported on the `Rule:` line.

```markdown
---
description: Project architecture awareness - generated by /project-architecture-analyzer; edit via a re-run, not by hand.
---

# Architecture

<one line: project type + architecture style, from the capture - e.g. 'ASP.NET Core modular monolith, vertical slices'>
<one line: the modules/layers, named - e.g. 'Modules: Orders, Catalog, Identity; shared kernel in BuildingBlocks'>

The full map is `<docs-path>/architecture/ARCHITECTURE.md` (deep-dives under `<docs-path>/architecture/references/`,
the reasoned assessment in `<docs-path>/architecture/ASSESSMENT.md`) - read the map before planning or
designing any structural change, instead of re-deriving the project.
```
