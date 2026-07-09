# Agent flow & token-cost optimization

2026-07-07. Branch `flow-optimization-2026-07`. Optimizing effectiveness-per-token across the multi-agent stack. This is a tightening of the routing the repo already has (`subagent-flow` + `domain-build`), not a redesign.

Headline: the routing was already mature - the mode ladder, the small-fix floor, the escalation guardrails, the issue family, the model-routing floors, and the Ponytail/Caveman policy all already existed, and the per-seat model/effort pins are the product of a prior worst-case audit (recorded, and re-confirmed by the inventory below). The genuine slack was on one axis the references did not cover: **capability reuse as a cost lever** - which the memory-handoff capability (added the same day) makes newly material. Per-seat tiers: **0 changes, by design.**

## Step 1 - Baseline cost posture

**Per-seat model/effort (32 seats), from frontmatter:**

| Tier group | Seats | model / effort |
|---|---|---|
| Domain solution designers (6: aspnet/angular/data/devops/mobile/wpf) | 6 | opus / xhigh |
| Cross-cutting design + gate (greenfield, cross-stack-contract-designer, architecture-analyzer, framework-upgrade-planner, security-auditor, integration-reviewer, issue-diagnoser) | 7 | opus / xhigh |
| Task/CI classifiers (task-analyzer, ci-failure-diagnoser) | 2 | opus / high |
| Domain verifiers (6) | 6 | sonnet / xhigh |
| Domain implementers (6) | 6 | sonnet / medium |
| Repair resolvers (4: dotnet-build/test, ng-build, angular-test) | 4 | sonnet / high |
| evidence-gatherer | 1 | sonnet / low |

Tally: **15 opus / 17 sonnet; 19 xhigh / 6 high / 6 medium / 1 low.** The expensive concentration is the 13 opus seats (6 designers + 7 cross-cutting), of which 11 are opus/xhigh. This matches the `subagent-model-routing-decisions` record verbatim ("opus/xhigh design, sonnet/xhigh verify, sonnet/medium build, gatherer sonnet/low, task-analyzer + ci-failure-diagnoser opus/high; a prior 3-pass worst-case audit found 0 model changes and only a few effort trims - don't re-run"). So the per-seat axis is already optimized; re-tiering it would be churn and risk rework.

**Modes (already defined in `references/execution-modes.md`):** `single_chat`, `implementer_only`, `domain_trio`, `fanout_domain_trio`, `cross_domain_light`, `full_cross_domain`, plus the issue family (`investigation_only`, `investigation_safe_fix`, `ci_repair_loop`, `cross_domain_issue_fix`, `security_issue_fix`). The small-fix floor and the escalation guardrails already exist.

**Token-reduction (already per-role in `references/token-reduction.md`):** Ponytail full for implementers/resolvers/verifiers/integration-reviewer, lite for designers/contract-designer/task-analyzer; Caveman selective on reports/punch-lists, off for contracts/design/security.

**Relative happy-path cost per mode** (unit = one sonnet/medium seat; opus~5x sonnet, effort low/med/high/xhigh ~ 0.5/1/1.5/2; seat count dominates):

| Mode | Seats dispatched | ~Relative cost | The expensive seat |
|---|---|---|---|
| single_chat | 0 (main session) | ~1 | none |
| implementer_only | 1 implementer | ~1-2 | none |
| domain_trio | designer + implementer + verifier | ~13 | designer opus/xhigh (~10) |
| fanout_domain_trio | designer + N impl + verifier | ~15+ | designer opus/xhigh (~10) |
| cross_domain_light | per-domain impl+verify + integration gate | ~16+ | integration-reviewer opus/xhigh (~10) |
| full_cross_domain | contract + trios x domains + gate | ~55-60 | contract + gate + each designer |

The designer (opus/xhigh ~10) is the single costliest seat, so **skipping it** (single_chat / implementer_only) is the biggest lever - far bigger than running any dispatched seat a shade cheaper.

## Step 2 - Task archetypes (confirmed; already the repo's ladder)

| Archetype | Definition | Smallest safe mode |
|---|---|---|
| Small fix | one file/symbol, obvious, no shared-contract impact | `single_chat` or `implementer_only` |
| Single-stack feature | real work in one stack, contract-local | `domain_trio` / `fanout_domain_trio` (= `domain-build`) |
| Cross-domain build | DB + API + UI, auth, migrations, production-critical | `cross_domain_light` -> `full_cross_domain` |
| Logs/incident | why is it broken/failing/flaky/slow - diagnose first | the issue family in `references/issue-investigation.md` |

## Step 3 - Lean flow per archetype

| Archetype | Mode | Seats (model/effort) | Eager skills | Capabilities wired (mechanism) | Par/Seq | Passes | Escalation trigger |
|---|---|---|---|---|---|---|---|
| Small fix | single_chat / implementer_only | 0, or 1 implementer (sonnet/medium) | the one convention skill for the file type | serena (locate, not whole-file read); context7 before any library API; stack LSP inline diagnostics (cuts a fix-loop bounce) | n/a / seq | 1 | ANY of: shared-contract impact, auth/migration/data-loss, deployment-order, security-sensitive, large refactor, unclear legacy -> escalate one step |
| Single-stack feature | domain_trio / fanout_domain_trio | designer opus/xhigh, impl sonnet/medium (xN), verifier sonnet/xhigh | designer+verifier preload the stack skills | designer: serena + context7 + memory recall of prior contract; impl: LSP + context7-before-API + serena + memory read/write (removes a version-guess rework + a whole-file read); verifier: orient from impl memory note + diff, then run gates independently (removes a redundant re-read) | parallel implementers, seq trio | 1 design + <=2 fix rounds then escalate | hidden cross-domain contract impact -> cross_domain_light/full |
| Cross-domain build | cross_domain_light -> full_cross_domain | contract-designer opus/xhigh, per-domain trios, integration-reviewer opus/xhigh | contract-designer + integration-reviewer preload subagent-flow | context7 on every producer/consumer seam; memory carries the frozen contract across seats; security-guidance on auth/data/migration seats; playwright only where a browser is the only proof | domains parallel, each internally seq | per-domain <=2 + one integration punch-list loop | (this IS the top mode) |
| Logs/incident | issue family; diagnose before coding | diagnoser opus (xhigh/high) + evidence-gatherer sonnet/low (parallel, read-only) | diagnoser preloads systematic-debugging + the domain router | diagnoser: serena + memory recall of a matching error-signature->fix + evidence-gatherer for log volume (keeps the log off the opus seat); resolver: LSP + memory recall of the prior fix | evidence parallel, fix seq behind the diagnosis gate | investigation caps at 2 passes; resolver loop bounded | proven cause is cross-domain/contract -> cross_domain_issue_fix; security -> security_issue_fix |

## Step 4 - Gap analysis

**Over-provisioned (fixed):**
- **Capability reuse was not a routing lever at all.** No reference mapped role -> capabilities-wired-in, so a seat could re-derive an architecture, guess a library version (a frequent rework trigger), or re-read a module a sibling already produced - each a silent token (and rework) cost. Fixed by the new `references/capability-reuse.md`.
- **The verifier re-reading implementer output.** The redundant read the prompt names, now removable via the memory note. Was unstated; now stated in `capability-reuse.md` + `token-reduction.md` (with the independence safety floor kept).
- **`execution-modes.md` implied per-seat effort re-tuning** (angular_medium designer `opus-high` vs the static `opus-xhigh` pin) that frontmatter cannot deliver and that `model-routing.md` contradicts. This risked the wrong mental model - "run the designer cheaper" - instead of the real lever, "skip the designer" (single_chat/implementer_only). Reconciled in `execution-modes.md`.
- **evidence-gatherer carried an unused `mcp__context7__*`** - already removed in the same-day agents audit (dim-2 right-size).

**Over-provisioned (deliberately NOT changed):** the per-seat model/effort pins. They are a prior worst-case-audit outcome (recorded), the inventory re-confirms them, and re-tiering a seat to save on the happy path but raise rework probability is the exact false saving the prompt forbids. The designers at opus/xhigh look heavy, but design mistakes are the costliest to unwind, and the mode lever already avoids paying for a designer on small work.

**Under-provisioned:** none material. The small-fix floor (single_chat/implementer_only) exists with a sharp escalation trigger; the risk is a *disguised* big task taken as small, which the guardrails already catch (large-refactor-surface, unclear-legacy, contract-impact all escalate). The one reinforcement: the small-fix escalation is now cross-linked to the capability lever (a 30-second serena scope check before committing to single_chat is cheaper than a wrong single_chat that reworks).

## Step 5 - Edits applied

- **NEW `skills/subagent-flow/references/capability-reuse.md`** - per-role capability wiring (skill/MCP/LSP-plugin), the guess/pass each removes, the cross-cutting disciplines (context7-before-API, superpowers-on-ambiguity, claude-md-management for shared context), and the redundant-read rule (verifier orients from the memory note + diff, runs the gates independently).
- **`references/token-reduction.md`** - added the third lever (eager context + redundant reads), cross-linked to `capability-reuse.md`, no restatement.
- **`references/execution-modes.md`** - reconciliation note: seats run at their static pins; the lever is mode/seat-count, not a re-dialed seat; capability wiring is the mode's other lever.
- **`skills/subagent-flow/SKILL.md`** - added `capability-reuse.md` to the Policies list.
- **`references/model-routing.md`** - reviewed, already consistent (it already frames escalation as heavier-seat/higher-mode, not effort re-tuning); no change.
- **Per-seat `claude/agents/*.md` frontmatter** - 0 model/effort changes, by design (see Step 4).

Gate: `node scripts/lint-skills.js` clean; all frontmatter parses; house voice clean.

## Before/after relative cost per archetype (mechanism for each delta)

The happy-path seat cost per archetype is **unchanged** (per-seat tiers deliberately held). The improvement is in **expected** cost - rework probability and redundant reads - which is what the prompt asks to optimize:

| Archetype | Happy-path cost | Expected-cost delta | Mechanism |
|---|---|---|---|
| Small fix | ~1-2 (unchanged) | down | context7-before-API + LSP inline diagnostics cut the wrong-version rework pass (the most common trigger); clarified mode lever keeps small work off the opus designer |
| Single-stack feature | ~13-15 (unchanged) | down | verifier orients from the memory note + diff instead of re-reading the module (one fewer full read per verify); on a repeat run the impl memory-read recalls a prior related decision instead of re-deriving it |
| Cross-domain build | ~55-60 (unchanged) | down | memory carries the frozen contract across seats, so no seat re-derives the seam the integration gate checks; context7 keeps each seat's own library-API versions right (a separate, per-seat rework the gate would otherwise surface late) |
| Logs/incident | diagnoser + gatherers (unchanged) | down | memory recall of a matching error-signature->fix short-circuits a re-diagnosis; evidence-gatherer keeps the log volume off the opus seat (already in place, now documented as the lever) |

No saving here shifts cost to a rework pass - every delta reduces a guess, a re-derivation, or a redundant read, and the safety floor is untouched.

## Capability reuse per archetype

See the Step 3 matrix "Capabilities wired" column and `references/capability-reuse.md` for the full role table. The guesses/passes removed: a designer re-deriving the repo architecture (serena + memory), an implementer guessing a library version (context7) or eating a fix-loop bounce for an edit-time error (LSP), a verifier re-reading a whole module (memory note + diff), a diagnoser re-slurping a log or re-deriving a known root cause (evidence-gatherer + memory).

## Safety floor - where it blocked a further saving

- **The verifier's independent gate.** The redundant-read saving stops at orientation: the verifier reads the memory note to orient but still runs the build/tests itself. Trusting the note in place of the gate would be cheaper and wrong - not counted.
- **The cross-domain contract freeze + mandatory integration gate.** Never skipped for cost; a wrong seam costs multiples of the gate.
- **Diagnose-before-coding on the bug family.** No cheaper guess-and-fix path was added; a missed guessed fix costs more than the diagnosis.
- **Per-seat tiers.** Not lowered against the recorded audit - a happy-path saving that raises rework is a loss.
