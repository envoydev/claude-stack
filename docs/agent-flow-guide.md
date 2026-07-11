# Agent-flow guide - dispatching the subagent team

This is the companion to [docs/single-chat-guide.md](single-chat-guide.md). That guide runs
the design -> build -> verify flow inline, in one chat, at your model. This one runs the same
flow as a **dispatched team of subagents** - 34 model-pinned seats an orchestrator fans out and
gates. Reach for it when the work is large, parallel, cross-domain, or log-heavy enough that the
isolation is worth its cost. For small-to-medium single-stack work, prefer the single-chat path.

## Why dispatch agents at all

Every dispatched subagent boots a **blank isolated context** and pays a ~20-30K token floor, and
those caches are never shared across seats - so an instrumented benchmark put the multi-agent
flow at roughly 1.9-2.2x the cost of a single Opus chat at medium feature size (the full
cross-domain flow runs higher). You do not pay that for the tokens - you pay it for what
isolation buys:

- **Parallelism** - independent tasks and whole stacks run at once (wall-clock, not token, win).
- **Separation of concerns** - a fresh context per seat, so a design pass is not polluted by build
  detail, and an independent verifier re-runs the gates a self-verifying context would rubber-stamp.
- **Volume isolation** - a diagnoser keeps megabytes of logs off the expensive reasoning seat.
- **Model routing** - each seat is pinned to the right tier (opus to design, sonnet to build) so you
  are not paying opus rates to run tests.

If none of those apply, the floor is pure overhead - stay in the single chat.

## Mental model: dispatch vs stay in chat

| | Dispatched subagent | Stay in chat (skill) |
|---|---|---|
| Context | Fresh, isolated - pays a ~20-30K floor, caches never shared | Loads into your context - no new context |
| Model | Its own frontmatter pin (opus designer, sonnet implementer) | Your chat's model |
| Visibility | You see only its final report | You see and correct every step |
| Parallelism | Many seats / whole stacks at once | One thing at a time |
| Best when | Large, parallel, cross-domain, or log-heavy work | Small-to-medium single-stack work you want to watch |

The base rule: **dispatch buys isolation, parallelism, and model routing at a fixed per-seat floor;
staying in chat is cheaper and transparent but serial and single-model.** Scale the choice to the
work, and read the two guides as a pair.

## The roster - 34 seats

You rarely name a seat yourself - the orchestration skills pick them. But knowing the roster tells
you what the team can do and what each dispatch costs. Every seat carries a load-bearing model +
effort pin.

| Group | Seats | Pin |
|---|---|---|
| Build/test resolvers (4) | `dotnet-build-error-resolver`, `dotnet-test-failure-resolver`, `ng-build-error-resolver`, `angular-test-resolver` | sonnet / high |
| Cross-cutting - design / analysis / gates (7) | `architecture-analyzer` (deliberate - loops `code-analyzer`, writes the map + `ASSESSMENT.md`), `issue-diagnoser`, `greenfield-solution-designer`, `cross-stack-contract-designer`, `framework-upgrade-planner`, `security-auditor`, `integration-reviewer` | opus / xhigh |
| Cross-cutting - triage (2) | `task-analyzer`, `ci-failure-diagnoser` | opus / high |
| Per-domain designers (6) | `<stack>-solution-designer` x aspnet / angular / wpf / mobile / data / devops | opus / xhigh |
| Per-domain verifiers (6) | `<stack>-verifier` x 6 stacks | sonnet / xhigh |
| Per-domain implementers (6) | `<stack>-implementer` x 6 stacks | sonnet / medium |
| Log isolator (1) | `evidence-gatherer` (read-only; only the 2 diagnosers dispatch it) | sonnet / low |
| Analysis support (2) | `code-analyzer` (read-only per-module characterizer; `architecture-analyzer` loops it, also callable), `style-analyzer` (writes `docs/CODE-STYLE.md`) | sonnet / low-med |

The pattern to remember: **opus designs and judges, sonnet builds and verifies, haiku only ever
appears as a per-task down-dispatch of a guarded implementer.** The two triage seats
(`task-analyzer`, `ci-failure-diagnoser`) sit at opus/high, not xhigh - a deliberate audited trim,
not an oversight.

## How you dispatch a seat

Dispatch runs through Claude Code's Agent tool (formerly `Task`), and **the main session is the
only orchestrator**. By house rule these agents are dispatched **only on an explicit trigger, never
by automatic delegation** - so you invoke a seat one of two ways:

- **`@agent-<name>`** - the guaranteed direct invoke. `@agent-issue-diagnoser the detail page throws
  on load ...`, `@agent-security-auditor audit the auth module`. The `<name>` is the agent's
  filename; your full message becomes its task.
- **An orchestration skill (slash command)** - `/main-stack-agents-flow` (one stack) or `/cross-stack-agents-flow`
  (unsure / cross-stack) and it dispatches the right seats for you. Both are set
  `disable-model-invocation`, so they run **only** when you type the slash command - they never
  auto-activate, and the model does not load them on its own.

Describing a task in plain prose does **not** auto-fire a seat here - the frontmatter descriptions
say *when each agent applies* (the lever the skills and an `@agent-` mention use to pick the right
one), not a cue to self-delegate. The documented way to make a seat auto-fire from prose is a 'use
proactively' phrase in its description - deliberately omitted, since the flow routes through the
orchestration skills on purpose.

Two facts that shape how the seats behave:

- **Dispatched subagents inherit your `CLAUDE.md` and the path-scoped `.claude/rules`** - the glob
  auto-attach fires inside a subagent too, so an implementer touching a `.cs` still loads the C#
  convention rule. Only the built-in Explore and Plan agents skip project rules.
- **A dispatched seat cannot talk to you** - it returns a report, it cannot interview. So
  clarification is an orchestrator gate the main session runs *before* dispatch; an ambiguous brief
  that reaches a designer comes back `NEEDS_CONTEXT`, it does not guess.

## The two orchestration skills - your usual entry point

You almost never hand-pick seats. Two skills sit above the roster and drive it:

- **`main-stack-agents-flow`** runs **one stack's** vertical: detect the stack, dispatch its designer to
  decompose the work into parallel tasks, fan one implementer out per task, then gate the assembled
  whole with the domain verifier, looping a punch-list back until sign-off. Invoke it with
  `/main-stack-agents-flow` for any 'build / implement / add / change this' request that lives in one stack.
- **`cross-stack-agents-flow`** is the **entry-point router above** `main-stack-agents-flow`. It classifies the ask,
  picks the smallest safe execution mode, and for cross-domain work freezes the shared contract,
  runs each stack's vertical in parallel, then gates the whole through `integration-reviewer` before
  commit. Invoke it with `/cross-stack-agents-flow` when you are not sure which mode fits, or when the work
  spans stacks.

Both are set `disable-model-invocation`, so they run only on their slash command - never
auto-activated. (When `cross-stack-agents-flow` routes to a single stack it dispatches that stack's seats
directly, since the flag also stops it from model-loading `main-stack-agents-flow`.)

Rule of thumb: **one stack -> `main-stack-agents-flow`; unsure or multi-stack -> `cross-stack-agents-flow`.** The router
will hand a single-stack classification straight down to `main-stack-agents-flow` anyway, so when in doubt,
start with `cross-stack-agents-flow`.

## The execution-mode ladder - pick the smallest that is safe

`cross-stack-agents-flow` never runs the whole team by default. It classifies the ask down to the cheapest
mode that is still safe, and escalates only on a real risk trigger.

| Mode | Flow | When |
|---|---|---|
| `single_chat` | main session only | tiny, clear, one-domain, no contract impact, edit site already known |
| `implementer_only` | main -> one implementer -> main self-verifies | the default single-domain rung: small/medium, no risk trigger |
| `domain_trio` | designer -> implementer -> verifier (this IS `main-stack-agents-flow`) | single-stack work that trips a risk trigger |
| `fanout_domain_trio` | designer -> 2-4 implementers -> verifier (also `main-stack-agents-flow`) | large/parallelizable single-stack work |
| `cross_domain_light` | light contract -> per-domain implement + verify -> integration gate | 2+ domains with an obvious, stable contract |
| `full_cross_domain` | contract-designer freezes v1 -> parallel main-stack-agents-flow runs -> integration gate | DB + API + UI, auth, migrations, devops, production-critical |

Three rules govern the ladder:

- **The trio is opt-in on risk, not the medium-work default.** The independent verifier is the flow's
  main cost premium (~2x a self-verifying context), so an ordinary single-domain feature - even a
  medium one with a boundary or reactivity edge - runs `implementer_only` and self-verifies. Only an
  explicit risk trigger convenes the trio. The accepted trade: below that bar, a subtle edge-case
  defect can ship, by design, to roughly halve the token cost.
- **Risk triggers force escalation** - auth / authorization, a migration or other data-loss exposure,
  deployment-order risk, concurrency, security-sensitive behavior, a shared-contract seam, a large
  refactor, or unclear legacy behavior. A scaled-down mode must stop and escalate the moment it spots
  one.
- **The cost lever is the mode, never a seat's effort.** Effort is a fixed frontmatter pin. You make a
  run cheaper by choosing fewer/lighter seats (a lower mode), not by dialing a dispatched seat down.
  The one thing that varies per dispatch is the *model* - used only to down-dispatch a guarded
  implementer to haiku on an easy task.

There is a parallel ladder for bugs (`investigation_only`, `direct_fix`, `investigation_safe_fix`,
`ci_repair_loop`, `cross_domain_issue_fix`, `security_issue_fix`) - a reported bug always routes
through the issue path, which diagnoses before it codes. See the diagnosis section below.

## Tutorial: run a single-stack feature through main-stack-agents-flow

This is the dispatched sibling of the single-chat trio. You drive it with checkpoints - the seats
do the work, you approve the gates.

### Step 1 - Kick it off

```
let main-stack-agents-flow build <feature>
```

The orchestrator detects the stack and dispatches that stack's `<stack>-solution-designer`
(read-only). It returns a design: the architecture surface, a test strategy, and a decomposition
into independent tasks, each with a contract (scope, acceptance, allowed files, forbidden shared
seams, dependencies), an `implementer_model` (haiku for easy, sonnet for advanced/risk), and
`anchors` (the `file:symbol` locations it already found).

:stop: **Approve the plan before any build.** Read the decomposition - right tasks, right
boundaries, nothing speculative? The orchestrator never fans out against an unapproved or guessed
plan.

### Step 2 - Build (fan-out)

The orchestrator dispatches **one implementer per independent task, all in parallel**, each handed
exactly its task + contract and dispatched at the designer-stamped model. Each builds code **and**
tests, strictly inside its boundary, and returns a status (`DONE`, `DONE_WITH_CONCERNS`,
`NEEDS_CONTEXT`, `BLOCKED`, `BLOCKED_CONTRACT_CHANGE`).

:stop: Glance at each diff the moment its task returns - do not wait for the whole fan-out. A task
that comes back `BLOCKED_CONTRACT_CHANGE` means it hit a shared seam it may not change silently -
that pauses and escalates (see the invariants).

### Step 3 - Verify (fan-in)

The orchestrator dispatches the `<stack>-verifier` **once, over the assembled whole** (not per
task) - it re-runs the build and tests, checks the work against the plan and house quality, and
returns a verdict: `SIGNED_OFF | PUNCH_LIST | BLOCKED_BY_BUILD | BLOCKED_BY_TESTS |
CONTRACT_MISMATCH`. A `PUNCH_LIST` routes each item back to its **owning** implementer with a
scoped brief (the failing check + the file/symbol), then re-verifies.

:stop: The punch-list loop is bounded - **cap two fix rounds, then escalate to you** rather than
loop forever. Only accept the change on `SIGNED_OFF`.

### Step 4 - Docs stay current, deliberately

This flow does **not** refresh the architecture docs. The designer already judged where the change
fits (extend / refactor first / isolate) by reading `docs/architecture/ARCHITECTURE.md` in Step 1.
When a change reshapes the structure enough that the map or the assessment should be redrawn, do it
on purpose afterward - `@agent-architecture-analyzer` or the `/architecture-quality-loop` skill - not
as an automatic tail step here.

## Worked example - the 'archived' flag, end to end (cross-domain)

Feature: add an `archived` flag across the stack - an EF migration, an API filter, and Angular store
+ UI. This trips migration (data-loss surface) and spans data + backend + frontend, so
`cross-stack-agents-flow` classifies it `full_cross_domain`.

1. **Clarify (if needed), then classify.** `run cross-stack-agents-flow on: add an archived flag end to end`.
   If the brief is crisp it goes straight to classification; if vague, the main session interviews
   you first (a dispatched seat cannot). Verdict: `full_cross_domain` - migration + 3 domains.
   :stop: You confirm the scope.
2. **Freeze the contract FIRST.** The orchestrator dispatches `cross-stack-contract-designer` before
   any per-stack designer. It freezes the seam - the `archived` DTO field, the filter query param,
   the default-list semantics - as Contract v1 with a `contract_version`, and records it in the
   progress ledger.
   :stop: You review the frozen contract - this is the one shared truth every lane builds against.
3. **Run each stack's `main-stack-agents-flow` in parallel.** data, aspnet, and angular each run their own
   designer -> implementer(s) -> verifier vertical against their slice of the frozen contract, at
   the same time. **Parallel across domains, sequential inside each.**
   :stop: Each domain verifier signs off its own stack.
4. **Gate the whole - mandatory.** Even with all three domain verifiers green, the orchestrator
   dispatches `integration-reviewer` - the final cross-domain gate. It re-runs the assembled build +
   tests, checks the migration applies from a clean DB and forward, confirms every lane used the
   current `contract_version`, and checks the seam end to end. Verdict `SIGNED_OFF | PUNCH_LIST |
   CONTRACT_MISMATCH | BLOCKED_BY_TESTS | BLOCKED_BY_SECURITY`.
   :stop: **Commit is allowed only on `SIGNED_OFF` / `commit_allowed: true`.** Never commit on the
   domain verifiers alone - a lane that signed off against a superseded contract version fails here.
5. **Commit.** Commit on the integration gate's `SIGNED_OFF`. The architecture docs refresh
   deliberately, not as a tail of this flow - if the feature reshaped the structure, run
   `@agent-architecture-analyzer` or `/architecture-quality-loop` on purpose afterward.

## The diagnosis loops - dispatched

A reported bug never starts on the feature path - it routes through the issue ladder, which
**diagnoses before it codes**. The two diagnosers are also the stack's one special case: they are
the only seats allowed to dispatch another agent.

- **A local runtime break** (crash, stack trace, broken UI) -> `dispatch issue-diagnoser`. It
  root-causes from the evidence, fanning out **`evidence-gatherer`** subagents (read-only, sonnet/low)
  to run repros and pull/grep logs in parallel, then reasons over their compact digests - keeping the
  raw log volume off the opus seat. It returns a diagnosis (`DIAGNOSED | NOT_REPRODUCED |
  NEEDS_MORE_EVIDENCE | LIKELY_FLAKE | INCONCLUSIVE`), the root cause at file+symbol, and a contracted
  fix plan routed to the domain implementer + verifier (a provably-trivial one-liner takes the
  `direct_fix` floor instead).
- **A red CI pipeline / PR check** -> `dispatch ci-failure-diagnoser`. Its edge is the
  red-in-CI / green-locally call - a real code defect vs an environment / pin / config / workflow
  failure. It too fans out `evidence-gatherer`s for the logs, and routes a code defect to a resolver,
  an environment delta back to you, and re-gating to the domain verifier.

You never dispatch `evidence-gatherer` yourself - it exists only as the diagnosers' hands.

## Dispatching one seat directly

Most work goes through the two orchestration skills, but you can call a single cross-cutting seat
when its one job is exactly what you need. Map your intent to the seat:

| Your intent | Dispatch |
|---|---|
| Understand a bug's root cause before any fix | `issue-diagnoser` |
| Find why CI is red | `ci-failure-diagnoser` |
| Scope one known task in one module before planning | `task-analyzer` |
| Document and assess the architecture (structure map + reasoned pros/cons), or run the improve loop | `architecture-analyzer` (deliberate) / `/architecture-quality-loop` |
| Characterize one module (purpose, deps, patterns, smells) | `code-analyzer` |
| Document the project's actual code style | `style-analyzer` (writes `docs/CODE-STYLE.md`) |
| Design a brand-new project from a spec (empty repo) | `greenfield-solution-designer` |
| Freeze the API seam between a backend and a front end | `cross-stack-contract-designer` |
| Turn a framework/version bump into an ordered plan | `framework-upgrade-planner` |
| Run a security posture audit before ship | `security-auditor` (or `/security-review` for a quick diff pass) |
| Gate assembled cross-domain work before commit | `integration-reviewer` |
| Fix a red build / failing suite | the matching resolver (`dotnet-*` / `ng-*` / `angular-test-resolver`) |

The cross-cutting seats in this table are read-only over code (only `architecture-analyzer` writes -
and only to the architecture docs - and `style-analyzer`, only to `docs/CODE-STYLE.md`) - they
diagnose, plan, document, or gate, and route the actual edits to the domain implementers. The four resolvers are the exception: they carry `Edit` and patch the code
themselves, in a bounded red-to-green loop, then hand back to the domain verifier to re-gate.

## The rules that never bend

These are the invariants the whole flow rests on - the guide is wrong if it ever contradicts one:

- **Flat fan-out, one orchestrator.** Only the main session dispatches. Domain seats carry no Agent
  tool, so they cannot dispatch each other. The *only* sanctioned nested dispatch is the two
  diagnosers calling `evidence-gatherer`.
- **Parallel across domains, sequential inside one domain.** Stacks run at once; each stack's
  designer -> implementer -> verifier runs in order.
- **Never commit on a domain verifier's sign-off alone.** For cross-domain work,
  `integration-reviewer` is the mandatory final gate, and commit is allowed only on its `SIGNED_OFF`.
- **No seat silently changes a shared contract.** A shared-seam change (DB schema, API route/DTO,
  error envelope, auth policy, migration order, cross-stack-visible behavior) stops as
  `BLOCKED_CONTRACT_CHANGE`; the orchestrator re-freezes to v2, pauses only the affected lanes, and
  re-verifies everything against v2.
- **Clarification is an orchestrator-only gate.** Gate on ambiguity, not size - the main session
  clarifies before dispatch; a dispatched designer returns `NEEDS_CONTEXT` rather than guess.
- **Effort is pinned; only the model varies per dispatch.** Make a run cheaper with a lower mode, not
  a dialed-down seat. A tip that measured out: run the orchestrator session on Sonnet
  (`claude --model sonnet`) - the opus designer pin holds regardless, ~28% cheaper end to end.

## When to use which

| Situation | Use |
|---|---|
| Small-to-medium single-stack feature you want to watch | Stay single-chat - see [single-chat-guide.md](single-chat-guide.md) |
| Large feature, or many parallel tasks, in one stack | `main-stack-agents-flow` |
| Cross-domain feature (DB + API + UI, auth, migrations) | `cross-stack-agents-flow` (contract freeze + integration gate) |
| A bug or pipeline with heavy log volume | `issue-diagnoser` / `ci-failure-diagnoser` (log isolation via `evidence-gatherer`) |
| A brand-new project from a spec | `greenfield-solution-designer` -> `project-scaffold` |
| A framework or major-version upgrade | `framework-upgrade-planner` |
| A dedicated security posture audit | `security-auditor` (or `/security-review` inline) |
| Document / assess / improve the architecture | `architecture-analyzer` (deliberate) or `/architecture-quality-loop` |
| A code-quality polish pass over a module | `/project-quality-loop` |

The through-line with the single-chat guide: **stay in chat for small, visible, single-stack work;
dispatch the team when isolation, parallelism, or model routing earns its floor.**
