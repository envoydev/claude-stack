# Model Routing

The Team Lead does not pick arbitrary model names. It classifies the task; this policy maps task class and risk to the seat and effort. In this stack every seat already carries a static model/effort pin in its frontmatter; the table below is the floor and the rationale behind those pins, several of which sit a shade above their floor (reconciled in the note after the table). This policy is the guide for when the orchestrator escalates, by choosing a heavier seat (task-analyzer -> architecture-analyzer, a domain verifier -> integration-reviewer) or by classifying the work into a higher mode.

Team Lead output stays compact:

```yaml
task_class: medium_feature
risk: [auth, database_migration]
domains: [data, backend]
routing:
  contract_designer: opus-xhigh
  solution_designer: opus-high
  implementer: sonnet-medium
  verifier: sonnet-xhigh
  final_reviewer: opus-xhigh
```

## Default routing table

| Role | Default | Escalate when |
|---|---|---|
| BA / requirements clarification | sonnet high | opus high for very ambiguous product logic or a regulated domain |
| Team Lead / orchestrator | sonnet high | opus high/xhigh for large cross-stack decomposition |
| Task Analyzer | sonnet high | opus high/xhigh for large / ambiguous / refactor / security-critical work |
| Cross-stack Contract Designer | opus xhigh | keep opus xhigh for cross-domain feature work |
| Domain Solution Designer | opus high | opus xhigh for backend / data / devops / security / major architecture risk |
| Implementer | sonnet medium | sonnet high for auth, migrations, concurrency, messaging, devops, security-sensitive code, large refactors, legacy unknowns |
| Domain Verifier | sonnet high | sonnet xhigh for auth, data, devops, security, contract-sensitive work |
| Integration Reviewer | sonnet xhigh | opus xhigh for cross-domain contract changes, production-critical, or security-sensitive features |
| Repair Agents | sonnet high | opus only for hard root-cause diagnosis, not routine compile/test failures |
| Evidence Gatherer | haiku or sonnet low | sonnet medium when evidence collection needs repo understanding |

The house pins land a shade above several of these floors where the seat's job justifies it: the domain designers are opus/xhigh (design mistakes are the most expensive to unwind), the domain verifiers sonnet/xhigh, the implementers sonnet/medium, the task-analyzer opus/high, the integration-reviewer opus/xhigh (the last gate before a cross-domain commit), and the evidence-gatherer sonnet/low.

One caveat on the Escalate-when column: an entry that raises the MODEL is applied per dispatch (the Team Lead overrides the model when it dispatches the seat - a per-dispatch model override is verified to fire in a headless flow run and to beat the seat's frontmatter pin, so this is a real lever, not just a contract promise); an entry that raises the EFFORT is not - effort is fixed at the seat's frontmatter pin and is not re-tunable per call. The cascading seats are already pinned at their escalated effort (designers/verifiers/integration-reviewer at xhigh), so they always run there. Where a seat is pinned below its escalate effort - the implementer at medium, the evidence-gatherer at low - that risk is carried by escalating the MODE (fanout_domain_trio, a mandatory verifier pass) and by the loaded skill, not by a per-dispatch effort bump the seat cannot receive. The same asymmetry runs downward: a trivial blast radius - a presentational leaf, a diagnoser-localized one-liner - cannot be made cheaper by dialing a seat's effort down; it is made cheaper by choosing a lighter MODE (fewer seats), per `references/execution-modes.md`.

**Guarded down-dispatch to Haiku (implementer only).** The implementer stays PINNED sonnet/medium - that pin is the safe default that keeps `implementer_only` and `single_chat` protected. Inside a guarded mode (`domain_trio` / `fanout_domain_trio`, where an opus/xhigh designer front-loads the judgment AND an independent sonnet/xhigh verifier re-runs the gates from scratch), the orchestrator MAY down-dispatch the implementer to `model: haiku` per call: the design carries the decisions, Haiku executes them faithfully, the verifier catches any slip. MEASURED green twice (B4 angular, B5 cross-project - both independently test-verified, correct signal reactivity and contract adhered), and the per-dispatch override is verified to fire headless and beat the pin. Two hard limits: never in `implementer_only` / `single_chat` (no separate designer or verifier - the lone implementer must stay sonnet), and never as a static frontmatter pin (a global Haiku pin would silently strip the guardrail from the unguarded modes). It is a per-dispatch override, applied only where the mode guarantees the brackets - and it pays most on implementer-heavy single-stack work (the implement layer is ~3x cheaper; design + verify still dominate the total), least on cross-domain.

## Strict cost rules

Use `max` rarely - only for very ambiguous requirements, a critical architecture decision, a large refactor across many projects, a security-sensitive redesign, a production-incident root cause, or a framework upgrade with many breaking changes.

Do not use opus for ordinary implementers by default. Do not use sonnet low for serious implementation by default. Do not duplicate a seat just to vary effort - the pin plus this escalation table covers it.
