# Single-chat guide - the build/diagnose flow without dispatching agents

This stack ships the same engineering flow in two forms: a team of **subagents** you
dispatch (isolated contexts, model-pinned seats, parallel fan-out), and a set of **skills**
that reproduce each seat's behaviour **inside your current chat**. This guide is the tutorial
for the second form - how to run design -> build -> verify, and the diagnosis loops, in one
chat where you see and check every step - plus when to reach back for a real agent instead. The
companion guide for the first form - dispatching the 34-seat subagent team via `main-stack-agents-flow` /
`cross-stack-agents-flow` - is [agent-flow-guide.md](agent-flow-guide.md).

## Why a single-chat path exists

An instrumented benchmark put the multi-agent flow at roughly 1.9-2.2x the cost of a single
Opus chat at medium feature size, because every subagent re-creates its own ~20-30K context
and those caches are never shared. For small-to-medium, single-stack work you often want the
opposite trade: everything in one visible context, at your model, checkpointed by you. That is
what the twin skills give you. The agent team still wins for large, parallel, or cross-domain
work (see the last section).

## Mental model: agent vs skill

| | Subagent (dispatch) | Skill (load in-chat) |
|---|---|---|
| Context | Separate, isolated - boots blank, pays a ~20-30K floor | Loads into your current context - no new context |
| Model | Its own frontmatter pin (opus designer, sonnet implementer, ...) | Your chat's model (pick opus for hard work) |
| Visibility | You see only its final report | You see every step and can correct it |
| Parallelism | Several seats at once | One thing at a time, sequenced by you |
| Best when | Isolation, fan-out, or keeping log/context volume off your thread | Seeing and controlling each step cheaply |

The base rule: **skill = loads guidance into the chat you are already in; agent = spins up a
fresh isolated worker.** A skill is cheaper and transparent; an agent is isolated and parallel.

## The seat -> single-chat skill map

| Agent seat | Load this in a single chat |
|---|---|
| `<stack>-solution-designer` | `solution-design` skill |
| verifier (before building) | `verify-plan` skill |
| `<stack>-implementer` | just code - conventions auto-load on file touch |
| verifier (after building) | `/code-review` + superpowers `verification-before-completion` |
| `issue-diagnoser` | superpowers `systematic-debugging` + `failure-signatures` |
| `ci-failure-diagnoser` | `ci-triage` |
| `evidence-gatherer` | not applicable - it exists only to isolate log volume; in one chat you read the log yourself |
| `architecture-analyzer` (deliberate; or `/architecture-quality-loop`), `code-analyzer`, `style-analyzer`, `security-auditor` | keep as agents - no single-chat twin (`/security-review` covers the quick security pass inline) |

There is no `implementer` or `verifier` twin skill by design: the implementer's conventions
already auto-load when you touch a file, and the verifier's job is `verify-plan` (before) plus
`/code-review` (after) - both already exist.

## Tutorial: the trio flow inline

Run it as four steps with a checkpoint (:stop:) after each - the checkpoints are the whole
point. You drive the sequence; the skills do not auto-chain.

### Step 1 - Design

```
using solution-design, plan how to add <feature>
```

It reads `docs/architecture/ARCHITECTURE.md` and `docs/CODE-STYLE.md`, loads your stack's house
skill for its real traps, judges where the change belongs (extend an existing seam, refactor
first, or isolate a new boundary), and returns an ordered task plan with `file:symbol` anchors.

:stop: Read the fit verdict and the task breakdown. Wrong shape, missing a boundary, over-built?
Correct it now - it is far cheaper here than after code exists.

### Step 2 - Gate the plan

```
using verify-plan, review this plan
```

A risk-coverage audit: does the plan name the stack's non-obvious traps, match the requirement's
scope exactly, cover the edge and safety cases, and stay minimal?

:stop: Fix the **plan** against the punch-list before writing any code. This is the single
cheapest place to catch a design error.

### Step 3 - Build, task by task

Implement each task in the plan's order. You do **not** load an implementer skill - touching a
`.cs` / `.ts` / `.xaml` auto-attaches its convention rule (the house traps), and you already
hold the design in context. Write the code **and** its tests for each task.

:stop: After each task, run the build and its tests, read the diff, then move to the next task.
Stay inside the task's scope - no drift into the next one's files.

### Step 4 - Verify

```
/code-review
```

Held to `verification-before-completion`. Treat the output as a punch-list: fix findings,
re-review, repeat until clean.

:stop: Only call the change done when the review is clean and the tests are green - stated
plainly, with the output, not asserted.

## Worked example - add `GET /api/tasks/{id}/summary`

Feature: return a small projection of one task (id, title, status, tag count), 404 if it does
not exist, with tests. ASP.NET Core + EF Core.

1. **Design** - `using solution-design, plan the tasks/{id}/summary endpoint`. It reads the
   architecture map, loads `dotnet-web-backend` + `dotnet-data-access` for the traps, verdicts
   'extend - the tasks group already owns this seam', and decomposes into: (a) the summary DTO +
   the projection query (anchor: `TaskStore.FindAsync`), (b) the endpoint + 404 mapping (anchor:
   `Program.cs` MapGroup), (c) the tests.
   :stop: You confirm the projection avoids loading the whole entity and the 404 path is a task.
2. **Gate** - `using verify-plan, review this plan`. It flags 'name the AsNoTracking read path
   and the tag-count projection, so the summary does not track or N+1'. You fold that into task (a).
   :stop: Plan now names the trap.
3. **Build** - implement (a): touching the data-access file auto-loads the EF conventions; you
   add `dotnet-testing` for the test task. Project straight to the DTO, `AsNoTracking`, tag count
   via a projected `Count()`. Then (b) the endpoint returning `TypedResults.Ok`/`NotFound`, then
   (c) the WebApplicationFactory test for 200 and 404.
   :stop: `dotnet build` + `dotnet test` green after each task.
4. **Verify** - `/code-review`. Clean -> done.

## The diagnosis loops

When something breaks mid-flow, branch into the matching loop, then feed the fix back into
step 1 (if it needs a redesign) or step 3 (if it is a targeted change).

- **Crash on your own machine** (an exception, a hang, a broken screen):
  `using failure-signatures` on the `systematic-debugging` method. Match the evidence to a
  signature (null-reference, DI resolution, async deadlock, disposed-lifecycle, config drift,
  boundary, database contention, HTTP status) and isolate where the signature points - usually
  not the line that threw.
- **Red CI or PR check**: `using ci-triage`. Make the red-in-CI / green-locally call - a real
  code defect CI surfaced first vs an environment / pin / config / workflow failure - and route
  it. Do not route a config or runner failure to a code fix.

## Loading convention and specialist skills

- **Base conventions load themselves on file touch.** Editing a `.cs` auto-attaches `csharp`;
  a `.ts` attaches `angular-conventions`; a `.xaml` attaches `dotnet-wpf`. During **build** you
  do not hand-load these - they are already firing (this holds inside dispatched subagents too;
  only the built-in Explore and Plan agents skip project rules).
- **Specialists you load deliberately** for the surface the task touches - `dotnet-data-access`,
  `dotnet-minimal-api`, `dotnet-error-handling`, `dotnet-testing`, `ionic`, `angular-material`,
  `angular-security`, `database-conventions`, and the rest. These never auto-load.
- **Routers are the menu.** Load `dotnet`, `frontend`, or `mobile` when you are unsure which
  specialist applies - each maps its family to its specialists.
- **During design you load explicitly** because no file is touched yet - `solution-design`
  front-loads the stack skill for you at that point.

Short version: **base = automatic on touch; specialists + routers = you load them; design-time
loading is `solution-design`'s job.**

## Dispatching a real agent from a single chat

You can still call any of the subagents from a single chat when the isolation is worth the
floor - the twin skills do not replace them:

- A gnarly runtime bug with large logs -> dispatch `issue-diagnoser` (it fans out
  `evidence-gatherer` subagents to keep the log volume off your context, and reasons over the
  digests).
- A red pipeline with a big CI dump -> dispatch `ci-failure-diagnoser` (same log-isolation win).
- A dedicated cross-stack security posture audit -> dispatch `security-auditor` (or run
  `/security-review` inline for a quick diff pass).
- Document, assess, or improve the architecture (the structure map + a reasoned pros/cons
  assessment) -> `@agent-architecture-analyzer`, or the `/architecture-quality-loop` skill to also
  apply the fixes by tier.
- A whole feature you want built with parallel fan-out -> let `cross-stack-agents-flow` / `main-stack-agents-flow`
  drive the full vertical.

The trade is the same each time: an agent pays the ~20-30K context floor and returns only its
report; a skill stays in your context, visible, at your model. Use the skill for small-to-medium
work you want to watch; dispatch the agent when you need isolation, parallelism, or to keep
volume off your thread.

## When to use which

| Situation | Use |
|---|---|
| Small-to-medium, single-stack feature you want to control step by step | Single-chat trio (skills) |
| A quick design sanity pass before you build | `solution-design` then `verify-plan` |
| A local crash or a red CI check you want to triage yourself | `failure-signatures` / `ci-triage` |
| Large feature, or parallel work across many tasks | `main-stack-agents-flow` (dispatch the vertical) |
| Cross-domain feature (backend + frontend contract) | `cross-stack-agents-flow` (contract freeze + integration gate) |
| A bug or pipeline with heavy log volume | Dispatch the diagnoser agent (log isolation) |
| A dedicated security posture audit | `security-auditor` agent, or `/security-review` inline |
| Document / assess / improve the architecture | `@agent-architecture-analyzer` or `/architecture-quality-loop` |
| A code-quality polish pass to a bar | `/project-quality-loop` |
