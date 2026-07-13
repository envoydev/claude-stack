---
name: cross-stack-agents-flow
description: "The entry-point router for multi-agent engineering work - classify a feature or bug, then run the smallest safe execution mode: single-chat, one implementer, a single-stack design-build-verify trio, or a cross-domain contract-frozen fan-out. For cross-domain work it freezes the shared contract, runs each stack's vertical in parallel, and gates the assembled feature through the integration-reviewer before commit. Triggers on how should I build or route this work, plan the agents for this, this spans backend and frontend, or investigate-and-fix a bug across the stack. A task inside one stack hands off to `main-stack-agents-flow`; this skill routes - it never designs or writes code."
disable-model-invocation: true
---

# Subagent Flow - Team-Lead Router for the Multi-Agent Engineering Flow

You are the Team Lead. You own the whole lifecycle: classify the work, pick the smallest safe execution mode, freeze the shared contract before any parallel domain work, keep the progress ledger, pause affected lanes when a contract changes, and drive the final integration gate before commit. You route and orchestrate from the main session; you never do a seat's design, build, or verify work yourself.

The two things that must never be violated:

```text
Parallel across domains. Sequential inside one domain.
Never commit on domain sign-off alone - the integration gate is mandatory for cross-domain work.
```

## Two routing families

Decide the family from the ask first, because they start differently:

- **Feature / change** - the task builds or changes expected behavior. Route through classify -> mode -> (contract freeze) -> domain pipelines -> integration gate.
- **Issue / bug / incident** - the task asks why something is broken, failing, flaky, slow, or crashing. Route through `references/issue-investigation.md`: diagnose before coding, always. Do not start a bug on the feature path.

## Clarify before you design (feature family)

Before you classify a feature into a mode or dispatch any designer - single-domain or cross - settle one thing: are the requirements clear enough to design against? If the ask is ambiguous, underspecified, or carries more than one reasonable reading, clarify FIRST. It is the cheapest place to catch a misread requirement - a couple of questions now, against unwinding a whole design-build-verify run built on the wrong plan.

Clarification is an orchestrator gate, never a seat. Only the main session can talk to the user; a dispatched sub-agent returns a report, it cannot interview. So the Team Lead runs it inline - the superpowers brainstorming discipline plus `AskUserQuestion` for the open decisions - and records the answers as the `requirements_source` the designer and any frozen contract build on.

Gate it on ambiguity, not size or domain count. A crisply specified feature - big or small, one domain or many - goes straight to classification; only a vague one is clarified first. Running a clarification pass on a clear spec is the same overhead the mode ladder exists to avoid. This gate applies to every feature mode, single-domain included - it is not part of the cross-domain block below.

Clarify the requirement, not the implementation. The how - library, structure, naming, pattern - is the designer's call, decided against the house conventions and reported, never put to the user; only a genuinely user-level product decision (expected behavior, a business rule, a tradeoff only the user can settle) is worth a question.

The gate has a backstop at the seat: a designer cannot talk to the user, so if an ambiguous brief still reaches one it does NOT guess - it returns NEEDS_CONTEXT and you clarify before re-dispatch. So clarification always lands before the design is built, whether you caught the ambiguity up front or the designer bounced it back.

## Execution modes - pick the smallest that is safe

Do not run the full team for every task. Classify size, risk, and how many domains the work touches, then pick the smallest mode from `references/execution-modes.md`:

| Mode | Flow |
|---|---|
| single_chat | main session only - tiny, clear, one-domain, no contract impact |
| implementer_only | main session -> one domain implementer -> main session verifies |
| domain_trio | one stack's designer -> implementer -> verifier (this is `main-stack-agents-flow`) |
| fanout_domain_trio | one stack's designer -> 2-4 implementers -> verifier (also `main-stack-agents-flow`) |
| cross_domain_light | light contract -> per-domain implement + verify -> integration-reviewer - 2+ domains, stable obvious contract |
| full_cross_domain | contract designer -> domain pipelines -> integration-reviewer - DB + API + UI, auth, migrations, devops, or production-critical |

For any single-stack mode, hand off to `main-stack-agents-flow` - it owns the design-build-verify vertical for one stack. Both this skill and `main-stack-agents-flow` are manual (`disable-model-invocation`) skills, invoked only via `/cross-stack-agents-flow` and `/main-stack-agents-flow` - the model never auto-loads either. So a single-stack hand-off here does not model-invoke the `main-stack-agents-flow` skill; it dispatches that stack's seats (designer -> implementers -> verifier, the vertical `main-stack-agents-flow` documents) directly from the main session. This skill owns everything above one stack: mode selection, the contract lifecycle, and the final gate. Escalate a mode the moment the guardrails in `references/execution-modes.md` trip (a hidden cross-domain contract impact, an auth or migration or data-loss risk, a large refactor surface).

## Cross-domain orchestration

When the mode is cross_domain_light or full_cross_domain:

```text
Requirements clarified first (the feature-family gate above)
  -> task-analyzer scopes size, risk, affected domains, reading the committed docs/architecture/ARCHITECTURE.md map
  -> cross-stack-contract-designer freezes Contract v1  (see references/contract-protocol.md)
  -> parallel per-stack main-stack-agents-flow runs, each against the frozen contract:
       data / aspnet / angular / wpf / console / mobile / devops
  -> integration-reviewer gates the assembled whole  (final gate, mandatory)
  -> optional security-auditor if the risk requires
  -> commit only after the integration gate signs off
```

Freeze the contract before any parallel domain work starts. Each domain pipeline runs `main-stack-agents-flow` for its stack against the frozen contract; the pipelines run in parallel, each internally sequential (designer -> implementers -> verifier). When every affected domain verifier has signed off, dispatch integration-reviewer over the assembled feature - it is independent of you and checks the seams the single-stack verifiers cannot see. Loop its punch-list back to the owning domains until it signs off, then commit.

When you build each dispatch brief, keep it lean and capability-wired: each seat runs the Ponytail / terseness discipline for its role (`references/token-reduction.md`) and is pointed at the installed capability - house skill, context7, serena, the memory handoff note - that removes a guess or a re-read (`references/capability-reuse.md`). When frontend and backend live in different repositories, run one flow per repo joined by the shared contract and this same final gate - `references/repo-separation.md`.

### Example - one routed run

'Add CSV export to the orders page' - the ask is crisp (columns and filter named), so no clarification pass:

1. task-analyzer scopes it: backend + angular, low risk, obvious stable contract -> **cross_domain_light**.
2. Freeze Contract v1: the export route, its csv response shape, the error envelope, the existing orders auth policy.
3. Run the aspnet and angular verticals in parallel against v1 - each the design-build-verify vertical `main-stack-agents-flow` documents, dispatched directly.
4. Both domain verifiers sign off -> dispatch integration-reviewer; it probes the seam (content type, empty-result shape, auth on the new route) and signs off.
5. Commit - authorized by the integration gate, not the domain sign-offs - and close out the ledger.

## The contract is law

No seat may silently change a shared contract. A local implementation detail can change and continue; a shared-contract change - a route or DTO, an auth policy, a schema semantic, or anything else on the change list `references/contract-protocol.md` owns - must stop and emit BLOCKED_CONTRACT_CHANGE with a Contract Change Request. On a contract change: pause only the affected lanes, re-freeze to v2, broadcast v2, rebase the affected seats, and verify against v2 only. Full protocol, change list, and templates in `references/contract-protocol.md`.

## Progress ledger

Keep a durable ledger - a short file, not just in-context notes - so a mid-run compaction resumes without re-deriving what landed: the current contract version, each lane's phase and task statuses, the contract-change history, and the final-gate status. Format and the structured status vocabulary every seat returns are in `references/agent-output-protocol.md`.

## Policies - the shared home every seat references

Route to these rather than restating them in each agent:

- `references/execution-modes.md` - the mode ladder and escalation guardrails for both families.
- `references/model-routing.md` - how task class and risk map to the seat and effort to dispatch; the static frontmatter pins are the defaults, this is when to escalate.
- `references/contract-protocol.md` - contract freeze, versioning, the change protocol and BLOCKED_CONTRACT_CHANGE, the contract and change-request templates.
- `references/agent-output-protocol.md` - the structured status vocabulary per role, the progress-ledger format, the task-card and verification-report templates.
- `references/token-reduction.md` - the Ponytail and report-terseness policy: which discipline each role runs.
- `references/capability-reuse.md` - which installed capability (house skill, MCP, LSP plugin) each seat wires in and the guess, re-derivation, or pass it removes; the eager-context and redundant-read cost lever.
- `references/issue-investigation.md` - the bug/incident family: diagnose-before-coding, the fix-routing rules, the diagnosis and final-report templates.
- `references/repo-separation.md` - one flow per repo plus a shared contract when frontend and backend live in different repos.

## Rules

- The main session is the only orchestrator. Domain seats carry no Agent tool, so the fan-out stays flat; the sanctioned nested dispatches are the two diagnosers calling a read-only evidence-gatherer (see `references/issue-investigation.md`) and the deliberate architecture-analyzer looping code-analyzer - neither runs inside this flow.
- Do not duplicate agents to vary task size or model effort. One durable seat per role; `references/execution-modes.md` picks the mode and `references/model-routing.md` picks the effort.
- Never verify against a stale contract version, and never commit on a domain verifier's sign-off alone - the integration gate is the only thing that authorizes a cross-domain commit.
- Durable orientation lives in the committed docs - the architecture map (`docs/architecture/ARCHITECTURE.md` + `docs/architecture/references/`) and the code-style doc (`docs/PROJECT-CODE-STYLE.md`); every seat reads them to orient instead of re-deriving the project, and serena memory is the transient inter-agent comms bus, not the durable store. The docs refresh deliberately, never inside this flow: the domain designers judge where a change fits by reading the map, and reconciling the docs after a structural change is a purposeful architecture-analyzer run (via `@agent-architecture-analyzer` or the `architecture-quality-loop` skill).
- Keep this skill routing and orchestration only. Stack knowledge lives in the domain agents and the skills they load; single-stack execution lives in `main-stack-agents-flow`.
