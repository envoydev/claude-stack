# Execution Modes and Routing

The full team is not the default. Classify size, risk, domains, and contract impact, then run the smallest safe mode. Modes are a routing policy, not separate agents - never create an angular-small-task-agent or an aspnet-implementer-high; keep one seat per role and let this policy pick the mode and `references/model-routing.md` pick the effort.

## Feature / change modes

| Mode | Flow | Use when | Token profile |
|---|---|---|---|
| `single_chat` | main session only | tiny, clear, safe, one-domain change | lowest |
| `implementer_only` | main session -> one domain implementer -> main session verifies | small domain-local coding task | low |
| `domain_trio` | domain designer -> one implementer -> domain verifier | medium domain-local feature | medium |
| `fanout_domain_trio` | domain designer -> 2-4 implementers -> domain verifier | large/risky work inside one domain | medium-high |
| `cross_domain_light` | light contract -> per-domain implement + verify -> integration-reviewer | 2+ domains, obvious stable contract | high |
| `full_cross_domain` | contract designer -> domain designers -> implementer fan-out -> domain verifiers -> integration gate | DB + API + UI, security, devops, migrations, auth, or production-critical | highest |

`domain_trio` and `fanout_domain_trio` ARE the `domain-build` skill - route single-stack work to it. cross_domain_light and full_cross_domain are owned here in `subagent-flow`.

## Decision ladder

```text
tiny and one-domain                         -> single_chat
small, one-domain, needs code edits         -> implementer_only
medium, one-domain                          -> domain_trio
large/risky, one-domain                     -> fanout_domain_trio
2+ domains, contract obvious and stable     -> cross_domain_light
DB + Backend + Frontend, security, devops,
  migrations, auth, or production-critical  -> full_cross_domain
```

## Single-chat and implementer-only

`single_chat` - plan lightly, edit, run focused validation, report. For: a typo, a rename, one validation message, one failing unit test, a CSS class, an endpoint response mapping with no contract change.

`implementer_only` - main session dispatches one domain implementer, then runs build/test/review itself. For: a backend-only endpoint tweak, a frontend-only component fix, a DB-only migration correction, a WPF-only ViewModel bug, an Ionic-only permission-wrapper update, a devops-only CI config fix.

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

These values illustrate the per-mode floor and rationale; they are not a per-dispatch dial. A dispatched subagent runs at its static frontmatter effort - effort is fixed per seat, not re-tunable per call - and the orchestrator can vary only the model (dispatch a genuinely small design at a lighter model than its pin). So the primary cost lever is the MODE / seat-count, not a re-dialed seat: `single_chat` and `implementer_only` skip the designer and the verifier entirely, which saves far more than running any dispatched seat a shade cheaper. A heavier need escalates to a higher mode or a heavier seat (task-analyzer -> architecture-analyzer, a domain verifier -> integration-reviewer), per `references/model-routing.md`. Capability wiring - context7 before a library API, a memory note read instead of a re-derivation - is the other lever the mode carries; see `references/capability-reuse.md`.

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
