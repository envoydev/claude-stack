---
name: main-stack-agents-flow
description: "Build a feature or change through a stack specialist team - the domain solution designer decomposes it into parallel tasks, several implementers build them at once, and the domain verifier gates the assembled whole, looping a punch-list back. Detects the stack (ASP.NET / Angular / WPF / console-worker / Ionic / SQL / DevOps) and drives its seats from the main session. Triggers on build/implement a feature, add functionality, make this change - anything that is design plus build plus verify within one stack. Work that spans stacks hands up to `project-task-flow`; a review-only pass with no build is `project-quality-loop` or the domain verifier alone."
disable-model-invocation: true
---

# Domain Build - Team-Lead Loop for a Stack's Design, Build, Verify Vertical

You are the team lead for one stack's vertical slice: design, then build, then verify. You detect which stack the work belongs to, dispatch that stack's solution designer to produce an architecture and a decomposition of independent tasks, fan the tasks out to that stack's implementers in parallel, then fan back in with that stack's verifier over the assembled whole - looping any punch-list back to the implementers that own each item until it signs off. Use this whenever a feature or change needs design plus build plus verify inside a single stack. Do not use it for a review-only pass with no build (reach for code-review or the domain verifier alone), for a pipeline of prompt files over an existing target (`project-quality-loop`), or for work that spans more than one stack (split it first - see Rules).

## Execution modes
DELEGATED vs INLINE - and why detection keys on dispatch capability, not file presence - is the shared policy `project-task-flow` owns. Pick the mode once, before DESIGN, hold it for the run, and apply it to this vertical:

- **DELEGATED** (dispatch available) - the main session orchestrates the whole vertical and dispatches every domain seat - the designer, each implementer, the verifier - never doing their work itself.
- **INLINE** (no dispatch: a Cursor session, a non-stack project, or a change too small to fan out) - do the same three steps in-session: design, then build the tasks yourself in the order the designer would have handed them out, then verify against the plan.

## Steps

1. **DESIGN** - detect the stack from the work and the touched files. If the feature request is ambiguous or underspecified, clarify it with the user before designing - only the orchestrator can interview, so resolve a vague ask up front (the clarification gate in `project-task-flow`) and never fan a designer out against a guessed requirement; a crisply specified request skips straight to design. For a feature or change, dispatch its solution designer (aspnet-solution-designer / angular-solution-designer / wpf-solution-designer / console-solution-designer / mobile-solution-designer / data-solution-designer / devops-solution-designer - see Per-stack seats). The C# stacks split by surface: a web/API host is aspnet, a XAML desktop app is wpf, and a headless Generic-Host worker, bot, daemon, or one-shot CLI (a `Program.cs` with `Host.CreateApplicationBuilder`, a `BackgroundService`/`IHostedService`, an `<OutputType>Exe</OutputType>` project with no web or desktop surface) is console. DevOps work is detected from the touched delivery files - a Dockerfile, a compose file, a .github/workflows pipeline, a deploy script, or the Aspire AppHost. For a reported bug, the plan comes from issue-diagnoser instead - it investigates the root cause and lays out the fix. Either way the output is the same shape: the architecture or the proven root cause, the test strategy, and a decomposition of independent tasks with contracts (each task's boundary and what it hands off or depends on). Gate the returned plan before anything builds: run `project-verify-plan`'s four audit passes on it in-session (mandatory at fan-out scale; a failed pass is a scoped re-brief to the designer - the policy lives in `project-task-flow`). Then get the user's approval - never fan out against an unapproved or unaudited plan.
2. **BUILD (fan-out)** - once approved, dispatch one implementer per independent task, all in parallel, from the main session (aspnet-implementer / angular-implementer / ... - the same stack's seat). Fan out every task the designer marked independent, not a token two - the runtime bounds real concurrency, your job is to expose all of it. Hand each implementer exactly one task plus its contract; it never touches anything outside its boundary, which is what keeps the parallel runs collision-free. Dispatch each implementer with the `implementer_model` the designer stamped on that task card (haiku for the easy tasks, sonnet for the advanced or risk-bearing ones), passed as the per-dispatch model override; the sonnet frontmatter pin is the fallback if a card carries none. Full rule in `project-task-flow`'s model-routing reference.
3. **VERIFY (fan-in)** - once every task lands, dispatch the domain verifier over the assembled whole, not over any single task. If it returns a punch-list, route each item back to the implementer that owns it, **resumed with a scoped brief** - the failing assertion or check plus the file and symbol to touch, not a fresh full-context re-brief - so the fix round patches the gap without re-navigating the whole task (a full re-dispatch roughly doubles the cell's cost for a one-line fix); then re-dispatch the verifier. The verifier's own independent checks - build, the test suite, the contract-seam probe - are parallelizable; run them concurrently rather than serially where the seat supports it. Loop until the verifier signs off - but bound the loop: cap it at two implementer fix rounds, and if the verifier still fails after that, stop and escalate to the user rather than looping to sign-off forever.

## Per-stack seats

| Stack | designer | implementer | verifier |
|---|---|---|---|
| aspnet | aspnet-solution-designer | aspnet-implementer | aspnet-verifier |
| angular | angular-solution-designer | angular-implementer | angular-verifier |
| wpf | wpf-solution-designer | wpf-implementer | wpf-verifier |
| console | console-solution-designer | console-implementer | console-verifier |
| mobile | mobile-solution-designer | mobile-implementer | mobile-verifier |
| data | data-solution-designer | data-implementer | data-verifier |
| devops | devops-solution-designer | devops-implementer | devops-verifier |

## Example

DELEGATED, aspnet stack - 'add CSV export to the orders API':
1. **DESIGN** - dispatch aspnet-solution-designer; it returns 3 independent tasks (query projection, endpoint, integration test) with contracts, each stamped an implementer_model. Get the user's approval.
2. **BUILD** - fan out 3 aspnet-implementers in parallel, one task + contract each; glance at each diff as it lands.
3. **VERIFY** - dispatch aspnet-verifier over the assembled whole. It flags one item (the export streams unbounded); route it back to the owning implementer with a scoped brief, re-dispatch the verifier, it signs off. Purge the run's serena handoff notes.

## Bookkeeping

The lead carries the run's state so a long build survives compaction and stays auditable.

- **Progress ledger.** Keep a durable record of every task and its status across the run - a short file, not just in-context notes - so a mid-run compaction can resume without re-deriving what already landed. Update it as each task and each verify pass reports; when the run sits under a frozen cross-domain contract, record its contract_version so a stale-contract result never slips through. This is all it needs:

  ```text
  feature: orders-csv-export   contract_version: v1
  tasks: { 1-projection: DONE, 2-endpoint: DONE_WITH_CONCERNS, 3-test: DONE }
  verify: pass 1 -> punch-list (1 item, owner: 2-endpoint) -> pass 2 -> signed off
  ```
- **File hand-off.** Give each implementer its task and contract as a written brief and take back a written report; review each task's diff as it lands, not pasted prose. Parallel runs stay auditable and the lead's context stays lean.
- **Per-task review, not serialized.** Glance at each implementer's diff the moment that task returns - do not wait for the whole fan-out, and do not serialize the implementers to do it. The verifier still runs once over the assembled whole; this early glance only catches a contract breach before it compounds.
- **Status vocabulary.** Each implementer ends with one status and the lead routes on it: DONE -> hand to the verifier; DONE_WITH_CONCERNS -> carry the flag to the verifier; NEEDS_CONTEXT -> close the gap via the designer, then re-dispatch; BLOCKED -> sequence after the blocking task; BLOCKED_CONTRACT_CHANGE -> pause the affected work and escalate to `project-task-flow`'s contract-change protocol. Routing lives here, not in the seats; the status definitions and the structured-output shapes are that skill's agent-output-protocol reference.
- **Memory hygiene.** The serena handoff notes (`<feature>__<contract_version>__<seat>`) live in the gitignored `.serena/memories/`, so they outlive a branch switch or a reset - a seat must read only the note whose `<feature>__<contract_version>` matches the task in hand, never a stale note from a prior contract or an unrelated feature. At feature completion (after the verifier signs off), purge this run's handoff notes - serena `delete_memory` on each `<feature>__*` - so they do not bleed into a later run that reuses the same workspace.

## Rules

- The main session is the only orchestrator, for the whole vertical. Never instruct a dispatched seat to dispatch another - the domain seats this skill fans out (designer, implementers, verifier) carry no Agent tool, so the fan-out stays flat. Nested dispatch exists in the stack but never inside this build flow: the two diagnosers call a read-only evidence-gatherer - it does not run here, and no domain seat nests.
- Fan out only the tasks the designer marked independent. Respect the contracts it drew between them - two implementers touching the same boundary is what makes the parallel runs collide.
- A feature that spans more than one stack is not this skill's job alone: `project-task-flow` is the entry-point router that owns the cross-domain flow - it freezes the shared contract first, runs this skill once per stack in parallel against its slice, then gates the assembled whole through the integration-reviewer before commit. Hand cross-stack work up to it; this skill executes one stack's vertical.
- The architecture docs are not refreshed by this flow. Where a change belongs (the extend / refactor first / isolate fit verdict) is the solution designer's call now - it reads `docs/architecture/ARCHITECTURE.md` and judges the fit as part of DESIGN. Reconciling the docs after a structural change is deliberate: run the `project-architecture-analyzer` skill or the `project-architecture-quality-loop` on purpose, not as a step here.
- Keep this skill routing and orchestration only. The stack knowledge - conventions, patterns, what a good design or a passing verify looks like - lives in the agents and the skills they load, not here.
