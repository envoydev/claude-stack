---
name: project-task-flow
description: "The entry-point router for multi-agent engineering work - scope the task IN-SESSION (the generated awareness rules + a bounded serena pass; deep reads go to a code-analyzer digest), then run the smallest safe execution mode: single-chat, one implementer, a single-stack design-build-verify trio, or a producer-first cross-domain run ordered by the dependency direction. For cross-domain work the producer designer's interface IS the contract; consumer seats build against it and the integration-reviewer gates the assembled feature before commit. Triggers on how should I build or route this work, plan the agents for this, this spans backend and frontend, or investigate-and-fix a bug across the stack. A task inside one stack hands off to `main-stack-agents-flow`; this skill scopes and routes - it never designs or writes code."
disable-model-invocation: true
---

# Subagent Flow - Team-Lead Router for the Multi-Agent Engineering Flow

You are the Team Lead. You own the whole lifecycle: scope the work in-session, pick the smallest safe execution mode, order the domain runs by dependency direction, keep the progress ledger, pause affected lanes when the seam interface changes, and drive the final integration gate before commit. You route and orchestrate from the main session; you never do a seat's design, build, or verify work yourself.

The two things that must never be violated:

```text
Producer before consumer across domains. Sequential inside one domain.
Never commit on domain sign-off alone - the integration gate is mandatory for cross-domain work.
```

## Two routing families

Decide the family from the ask first, because they start differently:

- **Feature / change** - the task builds or changes expected behavior. Route through clarify -> scope -> mode -> ordered domain pipelines -> integration gate.
- **Issue / bug / incident** - the task asks why something is broken, failing, flaky, slow, or crashing. Route through `references/issue-investigation.md`: diagnose before coding, always. Do not start a bug on the feature path.

## Clarify before you design (feature family)

Before you scope a feature or dispatch any designer, settle one thing: are the requirements clear enough to design against? If the ask is ambiguous, underspecified, or carries more than one reasonable reading, clarify FIRST. It is the cheapest place to catch a misread requirement - a couple of questions now, against unwinding a whole design-build-verify run built on the wrong plan.

Clarification is an orchestrator gate, never a seat. Only the main session can talk to the user; a dispatched sub-agent returns a report, it cannot interview. So the Team Lead runs it inline - the superpowers brainstorming discipline plus `AskUserQuestion` for the open decisions - and records the answers as the `requirements_source` the designers build on.

Gate it on ambiguity, not size or domain count. A crisply specified feature goes straight to scoping; only a vague one is clarified first. Clarify the requirement, not the implementation - the how (library, structure, naming, pattern) is the designer's call. The gate has a backstop at the seat: a designer that receives an ambiguous brief does NOT guess - it returns NEEDS_CONTEXT and you clarify before re-dispatch.

## Scope in-session - before any dispatch

Scoping is yours, not a seat's. Establish the task's true blast radius from what is already in context, plus a bounded look at the code:

1. **Read what is pre-loaded.** The generated awareness rules carry the map: `baseline-project-architecture` (project type, style, modules) and `baseline-project-related-context` (the sibling/sub-project entries with `relation` and `seam` - the dependency directions). Follow into `docs/architecture/ARCHITECTURE.md` for the area the task names.
2. **Locate, bounded.** Verify the touched symbols and their one-level callers with serena - **hard cap: 2 locating passes**. When a module's picture needs more than that, dispatch code-analyzer (sonnet/low) for a digest instead of reading on - the cheap seat absorbs the reads, you keep the judgment.
3. **Walk the seam catalog.** `references/seam-catalog.md` lists the stack-keyed traps that turn a 'local' task into a cross-domain one (a shared DTO edit, a migration, a `providedIn: 'root'` service, an event contract). A discovered shared-interface edit is itself the cross-domain signal, not just an obviously multi-stack ask.
4. **State the verdict:** the affected domains, the dependency direction between them (who produces, who consumes - from the related-context entries or the map), the risks the plan must absorb, and any open questions (back to the clarify gate).

## Execution modes - pick the smallest that is safe

Do not run the full team for every task. From the scoping verdict, pick the smallest mode in `references/execution-modes.md`:

| Mode | Flow |
|---|---|
| single_chat | main session only - tiny, clear, one-domain, no seam impact |
| implementer_only | main session -> one domain implementer -> main session verifies |
| domain_trio | one stack's designer -> implementer -> verifier (this is `main-stack-agents-flow`) |
| fanout_domain_trio | one stack's designer -> 2-4 implementers -> verifier (also `main-stack-agents-flow`) |
| cross_domain_light | producer designer -> producer + consumer implement/verify -> integration-reviewer - 2+ domains, routine seam |
| full_cross_domain | producer designer -> consumer designer validates the seam -> domain pipelines -> integration-reviewer - novel or risky seam: new public/versioned API, streaming or eventing, auth, migrations, deployment order |

For any single-stack mode, hand off to `main-stack-agents-flow` - it owns the design-build-verify vertical for one stack. Both skills are manual (`disable-model-invocation`), so a single-stack hand-off dispatches that stack's seats directly from the main session rather than model-invoking the skill. This skill owns everything above one stack: scoping, mode selection, the seam lifecycle, and the final gate. Escalate a mode the moment the guardrails in `references/execution-modes.md` trip.

## Cross-domain orchestration - producer first

When the mode is cross_domain_light or full_cross_domain:

```text
Requirements clarified, scope + dependency direction established (above)
  -> PRODUCER designer runs first (the upstream side per the dependency direction);
     the interface section of its plan IS the contract - record it in the ledger
  -> full_cross_domain only: CONSUMER designer validates the seam against its side's needs
     BEFORE anything is built - a misfit loops back to the producer designer at design cost
  -> producer + consumer verticals build (each internally sequential: implementers -> verifier;
     consumer implementers are briefed from the recorded interface)
  -> integration-reviewer gates the assembled whole  (final gate, mandatory)
  -> optional security-auditor if the risk requires
  -> commit only after the integration gate signs off
```

The producer designer's interface is recorded in the ledger before any consumer seat is briefed - routes, DTOs, error envelope, auth policy, whatever the seam carries. In light mode you brief the consumer implementers from it directly; in full mode the consumer designer checks it first. Either way the seam is written down once and every brief cites it.

When you build each dispatch brief, keep it lean and capability-wired: each seat runs the Ponytail / terseness discipline for its role (`references/token-reduction.md`) and is pointed at the installed capability - house skill, context7, serena, the memory handoff note - that removes a guess or a re-read (`references/capability-reuse.md`). When frontend and backend live in different repositories, run one flow per repo joined by the same recorded interface and this same final gate - `references/repo-separation.md`.

### Example - one routed run

'Add CSV export to the orders page' - the ask is crisp (columns and filter named), so no clarification pass:

1. Scope in-session: the related-context entries say the Angular client consumes the ASP.NET API; the export touches both -> backend produces, frontend consumes, routine seam -> **cross_domain_light**.
2. Dispatch aspnet-solution-designer (producer). Its plan's interface section - the export route, csv response shape, error envelope, existing orders auth policy - is recorded in the ledger as the seam.
3. Run the aspnet vertical; brief the angular implementer(s) from the recorded interface and run the angular vertical (implementers -> verifier).
4. Both domain verifiers sign off -> dispatch integration-reviewer; it probes the seam (content type, empty-result shape, auth on the new route) and signs off.
5. Commit - authorized by the integration gate, not the domain sign-offs - and close out the ledger.

## The seam is law

No seat may silently change the recorded interface. A local implementation detail can change and continue; a seam change - a route or DTO, an auth policy, a schema semantic, anything on the change list `references/contract-protocol.md` owns - must stop and emit BLOCKED_CONTRACT_CHANGE with a change request. On a seam change: pause only the affected lanes, revise the interface with the producer designer (or in-session when the delta is trivial), record v2 in the ledger, re-brief the affected seats, and verify against v2 only. Full protocol in `references/contract-protocol.md`.

## Progress ledger

Keep a durable ledger - a short file, not just in-context notes - so a mid-run compaction resumes without re-deriving what landed: the recorded interface and its version, each lane's phase and task statuses, the change history, and the final-gate status. Format and the structured status vocabulary every seat returns are in `references/agent-output-protocol.md`.

## Policies - the shared home every seat references

Route to these rather than restating them in each agent:

- `references/execution-modes.md` - the mode ladder and escalation guardrails for both families.
- `references/model-routing.md` - how task class and risk map to the seat and effort to dispatch; the static frontmatter pins are the defaults, this is when to escalate.
- `references/seam-catalog.md` - the stack-keyed traps the scoping pass walks: what turns a 'local' task cross-domain.
- `references/contract-protocol.md` - the recorded interface, versioning, the change protocol and BLOCKED_CONTRACT_CHANGE.
- `references/agent-output-protocol.md` - the structured status vocabulary per role, the progress-ledger format, the task-card and verification-report templates.
- `references/token-reduction.md` - the Ponytail and report-terseness policy: which discipline each role runs.
- `references/capability-reuse.md` - which installed capability (house skill, MCP, LSP plugin) each seat wires in and the guess, re-derivation, or pass it removes; the eager-context and redundant-read cost lever.
- `references/issue-investigation.md` - the bug/incident family: diagnose-before-coding, the fix-routing rules, the diagnosis and final-report templates.
- `references/repo-separation.md` - one flow per repo plus the shared recorded interface when frontend and backend live in different repos.

## Rules

- The main session is the only orchestrator. Domain seats carry no Agent tool, so the fan-out stays flat; the sanctioned nested dispatch is the two diagnosers calling a read-only evidence-gatherer - and it does not run inside this flow.
- Scoping stays bounded: 2 locating passes in-session, then a code-analyzer digest - never a whole-module read in the orchestrator context.
- Do not duplicate agents to vary task size or model effort. One durable seat per role; `references/execution-modes.md` picks the mode and `references/model-routing.md` picks the effort.
- Never verify against a stale interface version, and never commit on a domain verifier's sign-off alone - the integration gate is the only thing that authorizes a cross-domain commit.
- Durable orientation lives in the committed docs - the architecture map (`docs/architecture/ARCHITECTURE.md` + `docs/architecture/references/`) and the code-style doc (`docs/PROJECT-CODE-STYLE.md`); every seat reads them to orient instead of re-deriving the project, and serena memory is the transient inter-agent comms bus, not the durable store. The docs refresh deliberately, never inside this flow: the domain designers judge where a change fits by reading the map, and reconciling the docs after a structural change is a purposeful capture run (via the `project-architecture-analyzer` skill or the `project-architecture-quality-loop`).
- Keep this skill scoping, routing, and orchestration only. Stack knowledge lives in the domain agents and the skills they load; single-stack execution lives in `main-stack-agents-flow`.
