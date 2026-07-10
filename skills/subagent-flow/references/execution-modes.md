# Execution Modes and Routing

The full team is not the default. Classify size, risk, domains, and contract impact, then run the smallest safe mode. Modes are a routing policy, not separate agents - never create an angular-small-task-agent or an aspnet-implementer-high; keep one seat per role and let this policy pick the mode and `references/model-routing.md` pick the effort.

## Feature / change modes

| Mode | Flow | Use when | Token profile |
|---|---|---|---|
| `single_chat` | main session only | tiny, clear, safe, one-domain change | lowest |
| `implementer_only` | main session -> one domain implementer -> main session verifies | the DEFAULT single-domain rung: small OR medium work with no risk trigger - the main session self-verifies (build / test / review) | low |
| `domain_trio` | domain designer -> one implementer -> domain verifier | single-domain work that trips a risk trigger - auth, migration, data-loss, concurrency, security, or a large refactor (opt-in on risk, NOT the medium-work default) | medium |
| `fanout_domain_trio` | domain designer -> 2-4 implementers -> domain verifier | large/risky work inside one domain | medium-high |
| `cross_domain_light` | light contract -> per-domain implement + verify -> integration-reviewer | 2+ domains, obvious stable contract | high |
| `full_cross_domain` | contract designer -> domain designers -> implementer fan-out -> domain verifiers -> integration gate | DB + API + UI, security, devops, migrations, auth, or production-critical | highest |

`domain_trio` and `fanout_domain_trio` ARE the `domain-build` skill - route single-stack work to it. cross_domain_light and full_cross_domain are owned here in `subagent-flow`.

## Decision ladder

```text
tiny and one-domain                                 -> single_chat
small OR medium, one-domain, no risk trigger        -> implementer_only   (the default rung)
one-domain WITH a risk trigger (auth / migration /
  data-loss / concurrency / security / big refactor) -> domain_trio
large/risky, one-domain                             -> fanout_domain_trio
2+ domains, contract obvious and stable     -> cross_domain_light
DB + Backend + Frontend, security, devops,
  migrations, auth, or production-critical  -> full_cross_domain
```

## Single-chat and implementer-only

`single_chat` - plan lightly, edit, run focused validation, report. For: a typo, a rename, one validation message, one failing unit test, a CSS class, an endpoint response mapping with no contract change.

`implementer_only` - main session dispatches one domain implementer, then runs build/test/review itself. For: a backend-only endpoint tweak, a frontend-only component fix, a DB-only migration correction, a WPF-only ViewModel bug, an Ionic-only permission-wrapper update, a devops-only CI config fix.

The line between them is **discovery**: when the edit site is already known - a named file, a 1-2 line change the request or a diagnosis has already localized - `single_chat` does it in the main session at zero seat cost. Reserve `implementer_only` for when the seat must first *find* where to edit, or the change touches several files in the domain. Spinning a full seat for a known one-liner is the trivial-blast-radius overuse the modes exist to avoid. (The issue-flow sibling of this rung is `direct_fix` in `references/issue-investigation.md` - a diagnoser-localized trivial fix the main session applies without a separate implementer + verifier.)

De-escalation runs the same way, a step DOWN the ladder. A pure presentational leaf - a component with no interaction, RxJS, routing, API, or shared-state surface (a property the designer's verdict already carries) - drops from `domain_trio` to `implementer_only` plus a main-session check, rather than paying an opus designer and an xhigh verifier for a labelled span. The lever is the lighter MODE, not a lighter verify effort: a seat's effort is a fixed frontmatter pin, so a trivial blast radius is made cheaper by choosing fewer / lighter seats, never by dialing a dispatched seat's effort down (see `references/model-routing.md`).

## Route by risk, not size - what the verifier is worth

The independent verifier (`domain_trio`+) is the flow's main cost premium: a fresh seat that re-runs the gates and catches a defect the implementer missed - but at roughly double the tokens of one self-verifying context. So it is **opt-in on risk, not the default**. Convene it only when the work trips an explicit **risk trigger**: auth, a migration or other data-loss exposure, concurrency, security-sensitive behavior, a shared contract seam, or a large refactor. Ordinary single-domain features - even medium ones that carry a boundary, overflow, or reactivity edge - do NOT convene it; they run in `implementer_only`, where the main session builds and self-verifies.

So the trio's trigger is an explicit risk (the escalation-guardrail set below), not task size and not a merely non-obvious edge. **The deliberate trade:** below that bar a medium feature is self-verified by the one context that wrote it, so a subtle edge-case defect - an int32 overflow on an unbounded page, a reactivity slip - CAN ship, because no independent seat re-derives it. That is accepted on purpose: it roughly halves the token cost of ordinary single-domain work, and the risk triggers still force the mode UP the instant real, costly risk (auth, migration, data-loss, cross-domain, security, large refactor, unclear legacy) appears - so the independent gate is spent where a bug is expensive, not on every medium feature. A convened trio still runs a guarded Haiku implementer (`references/model-routing.md`). Fewer seats is the token lever that dominates all per-seat tuning; this rung is how you pull it.

## Escalation guardrails

A scaled-down mode must stop and escalate the moment it detects any of:

```text
cross-domain contract impact      auth / authorization risk
migration or data-loss risk       deployment-order risk
security-sensitive behavior       large refactor surface
unclear legacy behavior
```

Escalate one step:

```text
single_chat        -> implementer_only or domain_trio
implementer_only   -> domain_trio
one-domain mode    -> cross_domain_light or full_cross_domain
```

## Per-mode model, by example

The mode carries the effort; the seat is the same. Angular, three sizes:

```yaml
angular_small:   # one component/file, no API/auth/state change
  flow: single_chat or angular-implementer only
  model: { implementer: sonnet-medium }
angular_medium:  # new page, local state or API service, tests, contract unchanged
  flow: [angular-solution-designer, angular-implementer, angular-verifier]
  model: { designer: opus-high, implementer: sonnet-medium, verifier: sonnet-high }
angular_large:   # multiple areas, auth-sensitive UI, complex state, or a cross-domain API change
  flow: [angular-solution-designer, angular-implementer x N, angular-verifier]
  model: { designer: opus-xhigh, implementers: sonnet-medium, verifier: sonnet-xhigh }
```

These values illustrate the per-mode floor and rationale; they are not a per-dispatch dial. A dispatched subagent runs at its static frontmatter effort - effort is fixed per seat, not re-tunable per call - and the orchestrator can vary only the model (dispatch a genuinely small design at a lighter model than its pin; the one model-vary the stack actively recommends is down-dispatching a GUARDED implementer - one bracketed by an opus designer and an independent verifier - to Haiku, never an unguarded one, per `references/model-routing.md`). So the primary cost lever is the MODE / seat-count, not a re-dialed seat: `single_chat` and `implementer_only` skip the designer and the verifier entirely, which saves far more than running any dispatched seat a shade cheaper. A heavier need escalates to a higher mode or a heavier seat (task-analyzer -> architecture-analyzer, a domain verifier -> integration-reviewer), per `references/model-routing.md`. Capability wiring - context7 before a library API, a memory note read instead of a re-derivation - is the other lever the mode carries; see `references/capability-reuse.md`.

## Team Lead routing output

Emit compact metadata, not repeated prompts:

```yaml
task_id: ANG-042
domain: angular
classification: medium
risk_level: medium
flow: domain_trio
agents: [angular-solution-designer, angular-implementer, angular-verifier]
contract_version: none
reason: [adds a routed page, form validation, needs tests, no backend contract change]
```

## Issue / bug modes

For a bug, incident, CI failure, flaky test, or unclear behavior, do not use the feature modes - route through `references/issue-investigation.md`, which defines `investigation_only`, `investigation_safe_fix`, `ci_repair_loop`, `cross_domain_issue_fix`, and `security_issue_fix`. The rule is: diagnose before coding.

## Cost rules

```text
Do not run full_cross_domain by default. Use single_chat for tiny tasks,
implementer_only for small domain-local ones, domain_trio for medium.
Use full_cross_domain only when cross-domain coordination risk justifies the cost.
The full flow costs 2x-5x the tokens of a single chat - parallelism buys wall-clock
and separation of concerns, not tokens.
```
