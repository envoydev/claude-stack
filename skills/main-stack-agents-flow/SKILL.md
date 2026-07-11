---
name: main-stack-agents-flow
description: "Build a feature or change through a stack specialist team - the domain solution designer decomposes it into parallel tasks, several implementers build them at once, and the domain verifier gates the assembled whole against the plan and code quality, looping a punch-list back. Detects the stack (ASP.NET / Angular / WPF / Ionic / SQL / DevOps) and drives its designer, implementers and verifier from the main session. Triggers on build/implement a feature, add functionality, make this change - anything that is design plus build plus verify within one stack. For work that spans more than one stack, hand up to `cross-stack-agents-flow` - it freezes the shared contract and runs this skill once per stack; for a review-only pass with no build, reach for `project-quality-loop` or the domain verifier alone."
disable-model-invocation: true
---

# Domain Build - Team-Lead Loop for a Stack's Design, Build, Verify Vertical

You are the team lead for one stack's vertical slice: design, then build, then verify. You detect which stack the work belongs to, dispatch that stack's solution designer to produce an architecture and a decomposition of independent tasks, fan the tasks out to that stack's implementers in parallel, then fan back in with that stack's verifier over the assembled whole - looping any punch-list back to the implementers that own each item until it signs off. Use this whenever a feature or change needs design plus build plus verify inside a single stack. Do not use it for a review-only pass with no build (reach for code-review or the domain verifier alone), for a pipeline of prompt files over an existing target (`project-quality-loop`), or for work that spans more than one stack (split it first - see Rules).

## Execution modes
Pick the mode once, before DESIGN, and hold it for the whole run.

- **DELEGATED** - the default whenever the current session can dispatch subagents (the Agent tool is present). The main session orchestrates the whole vertical and dispatches every domain seat - the designer, each implementer, the verifier - as a subagent; it never does their work itself.
- **INLINE** - the fallback when dispatch is unavailable: a Cursor session, a non-stack project with no domain agents installed, or a change small enough that fanning out costs more than it saves. Do the same three steps in-session instead - design, then build the tasks yourself in the same order the designer would have handed them out, then verify against the plan.

Detection keys on dispatch capability, not on file presence - a project can carry the domain agent files on disk with no Agent tool available to dispatch them, which still means INLINE.

## Steps

1. **DESIGN** - detect the stack from the work and the touched files. If the feature request is ambiguous or underspecified, clarify it with the user before designing - only the orchestrator can interview, so resolve a vague ask up front (the clarification gate in `cross-stack-agents-flow`) and never fan a designer out against a guessed requirement; a crisply specified request skips straight to design. For a feature or change, dispatch its solution designer (aspnet-solution-designer / angular-solution-designer / wpf-solution-designer / mobile-solution-designer / data-solution-designer / devops-solution-designer - see Per-stack seats). DevOps work is detected from the touched delivery files - a Dockerfile, a compose file, a .github/workflows pipeline, a deploy script, or the Aspire AppHost. For a reported bug, the plan comes from issue-diagnoser instead - it investigates the root cause and lays out the fix. Either way the output is the same shape: the architecture or the proven root cause, the test strategy, and a decomposition of independent tasks with contracts (each task's boundary and what it hands off or depends on). Get the user's approval before building - never fan out against an unapproved plan.
2. **BUILD (fan-out)** - once approved, dispatch one implementer per independent task, all in parallel, from the main session (aspnet-implementer / angular-implementer / ... - the same stack's seat). Fan out every task the designer marked independent, not a token two - the runtime bounds real concurrency, your job is to expose all of it. Hand each implementer exactly one task plus its contract; it never touches anything outside its boundary, which is what keeps the parallel runs collision-free. Dispatch each implementer with the `implementer_model` the designer stamped on that task card (haiku for the easy tasks, sonnet for the advanced or risk-bearing ones), passed as the per-dispatch model override; the sonnet frontmatter pin is the fallback if a card carries none. Full rule in `cross-stack-agents-flow` `references/model-routing.md`.
3. **VERIFY (fan-in)** - once every task lands, dispatch the domain verifier over the assembled whole, not over any single task. If it returns a punch-list, route each item back to the implementer that owns it, **resumed with a scoped brief** - the failing assertion or check plus the file and symbol to touch, not a fresh full-context re-brief - so the fix round patches the gap without re-navigating the whole task (a full re-dispatch roughly doubles the cell's cost for a one-line fix); then re-dispatch the verifier. The verifier's own independent checks - build, the test suite, the contract-seam probe - are parallelizable; run them concurrently rather than serially where the seat supports it. Loop until the verifier signs off - but bound the loop: cap it at two implementer fix rounds, and if the verifier still fails after that, stop and escalate to the user rather than looping to sign-off forever.

## Per-stack seats

| Stack | designer | implementer | verifier |
|---|---|---|---|
| aspnet | aspnet-solution-designer | aspnet-implementer | aspnet-verifier |
| angular | angular-solution-designer | angular-implementer | angular-verifier |
| wpf | wpf-solution-designer | wpf-implementer | wpf-verifier |
| mobile | mobile-solution-designer | mobile-implementer | mobile-verifier |
| data | data-solution-designer | data-implementer | data-verifier |
| devops | devops-solution-designer | devops-implementer | devops-verifier |

## Bookkeeping

The lead carries the run's state so a long build survives compaction and stays auditable.

- **Progress ledger.** Keep a durable record of every task and its status across the run - a short file, not just in-context notes - so a mid-run compaction can resume without re-deriving what already landed. Update it as each task and each verify pass reports; when the run sits under a frozen cross-domain contract, record its contract_version so a stale-contract result never slips through.
- **File hand-off.** Give each implementer its task and contract as a written brief and take back a written report; review each task's diff as it lands, not pasted prose. Parallel runs stay auditable and the lead's context stays lean.
- **Per-task review, not serialized.** Glance at each implementer's diff the moment that task returns - do not wait for the whole fan-out, and do not serialize the implementers to do it. The verifier still runs once over the assembled whole; this early glance only catches a contract breach before it compounds.
- **Status vocabulary.** Each implementer ends with one status and the lead routes on it: DONE (the verifier will check it), DONE_WITH_CONCERNS (carry the flag forward to the verifier), NEEDS_CONTEXT (a contract gap the designer must close before re-dispatch), BLOCKED (a dependency task must land first - sequence it after the blocker), BLOCKED_CONTRACT_CHANGE (a shared-contract change the seat may not make silently - pause the affected work and escalate to `cross-stack-agents-flow`'s contract-change protocol). Status handling lives here, not in the seats; the full status set and the structured-output shape live in `cross-stack-agents-flow`'s `references/agent-output-protocol.md`.
- **Memory hygiene.** The serena handoff notes (`<feature>__<contract_version>__<seat>`) live in the gitignored `.serena/memories/`, so they outlive a branch switch or a reset - a seat must read only the note whose `<feature>__<contract_version>` matches the task in hand, never a stale note from a prior contract or an unrelated feature. At feature completion (after the verifier signs off), purge this run's handoff notes - serena `delete_memory` on each `<feature>__*` - so they do not bleed into a later run that reuses the same workspace.

## Rules

- The main session is the only orchestrator, for the whole vertical. Never instruct a dispatched seat to dispatch another - the domain seats this skill fans out (designer, implementers, verifier) carry no Agent tool, so the fan-out stays flat. Nested dispatch exists in the stack but never inside this build flow: the two diagnosers call a read-only evidence-gatherer, and the deliberate architecture-analyzer loops code-analyzer - neither runs here, and no domain seat nests.
- Fan out only the tasks the designer marked independent. Respect the contracts it drew between them - two implementers touching the same boundary is what makes the parallel runs collide.
- A feature that spans more than one stack is not this skill's job alone: `cross-stack-agents-flow` is the entry-point router that owns the cross-domain flow - it freezes the shared contract first, runs this skill once per stack in parallel against its slice, then gates the assembled whole through the integration-reviewer before commit. Hand cross-stack work up to it; this skill executes one stack's vertical.
- The architecture docs are not refreshed by this flow. Where a change belongs (the extend / refactor first / isolate fit verdict) is the solution designer's call now - it reads `docs/architecture/ARCHITECTURE.md` and judges the fit as part of DESIGN. Reconciling the docs after a structural change is deliberate: run `@agent-architecture-analyzer` or the `architecture-quality-loop` skill on purpose, not as a step here.
- Keep this skill routing and orchestration only. The stack knowledge - conventions, patterns, what a good design or a passing verify looks like - lives in the agents and the skills they load, not here.
