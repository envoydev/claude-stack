# Skill usage report: project-solution-design / project-implementer / project-verify-plan

Source: session transcript `681ea6f9-4d99-421a-86d8-42fc339d0a2f.jsonl` (this project's Claude Code
session directory), analyzed with `claude-stack`'s `scripts/analyze-usage.js`
(https://github.com/envoydev/claude-stack, cloned to a scratch dir for this report and removed after).

## Environment

- **Claude Code version:** 2.1.209
- **Models used:** Claude Opus 4.8 (manually selected for the solution-design run) and Claude Sonnet 5
  (default for everything else, including both implementer runs). The tester ran `/model` to switch to
  Opus 4.8 immediately before invoking `/project-solution-design`, then switched back to Sonnet 5 partway
  through that same run (07:28:26Z) - the solution-design window is a mixed-model run, not pure Opus.
- **OS:** Windows (session `cwd` = `D:\Projects\Agiliway\SpeechDirect`).
- **Project stack:** .NET 8 / C# 12 WPF desktop app (`SpeechDirect`), modular monolith.
- **Session file coverage:** all three tested skills ran inside the *same* session file,
  `681ea6f9-4d99-421a-86d8-42fc339d0a2f.jsonl`. That file spans 24h30m total and contains substantial
  work beyond these three runs (a later sleep/wake bug investigation, and the meta-work of producing this
  report itself) - the whole-session analyzer rollup is **not** representative of just these three runs,
  so all numbers below are recomputed from line-ranged windows around the actual command invocations, not
  taken from the whole-file report.
- **project-verify-plan was never invoked** in this session (or in any other session transcript for this
  project - checked all four). Every text match on "project-verify-plan" in the transcripts is either a
  reference inside `project-solution-design`'s own skill body (it names verify-plan as the next step) or
  a mention in an unrelated `/project-capabilities` setup session. The skill exists on disk
  (`.claude/skills/project-verify-plan/`) but has zero recorded runs. Section 3 below reports this as
  "not run" rather than fabricating numbers.

| Skill | Session file | Real invocation(s) | Wall-clock |
|---|---|---|---|
| project-solution-design | `681ea6f9-...` | 1 run, 07:21:45Z - 07:33:11Z | 11m26s |
| project-implementer | `681ea6f9-...` | 2 runs: "Implement the plan above" (07:33:34Z start) and "Implement second stage of plan" (08:24:59Z start) | stage 1: 51m16s; stage 2 + its own finish-protocol code-review: 2h53m50s raw, but ~2h9m of that was an idle gap waiting out a session usage-limit reset (08:55:54Z - 11:04:34Z) - **effective active time ~45m** |
| project-verify-plan | - | 0 runs | n/a |

No `subagents/` folder is relevant to solution-design or implementer-stage-1 (neither dispatched
anything). The session's `subagents/` folder holds 15 transcripts, and every one of them belongs to
implementer-stage-2's own finish-protocol `/code-review` fan-out (see 2.2).

**Instrumentation hook:** `.claude/hooks/instrument-tool-usage.js` exists but is fetched, not wired -
its `PreToolUse` matcher is empty in `claude-stack.ps1`'s registration, and the script itself is a
no-op unless `STACK_INSTRUMENT=1` is set (`if (!process.env.STACK_INSTRUMENT) process.exit(0);`). No
`tool-usage.*.jsonl` ledger exists anywhere under `.claude/` for any session. `--hook-log` was skipped
for all three runs below - there is no who-fired-what identity data to join, only the transcript's own
tool_use/tool_result pairs and `attributionSkill` stamps.

---

## Per skill run

### project-solution-design

**Brief:** the AuthenticationMiddleware god-object investigation/decomposition (Phase 1-3 brief passed
as `--command-args`).

**Tokens** (1 run, mixed Opus 4.8 -> Sonnet 5 mid-run):

| Model | Input | Cache write | Cache read | Output | Msgs |
|---|---|---|---|---|---|
| claude-opus-4-8 | 1,331 | 118.9k | 1.59M | 19.9k | 15 |
| claude-sonnet-5 | 6 | 126.3k | 332.2k | 9.4k | 3 |
| **Total** | **1,337** | **245.2k** | **1.92M** | **29.3k** | **18** |

**Tool calls:**

| Tool | Calls | Result ~tok | Errors |
|---|---|---|---|
| Read | 13 | 4.7k | 1 |
| mcp\_\_serena\_\_find_referencing_symbols | 3 | 3.5k | 0 |
| mcp\_\_serena\_\_find_symbol | 7 | 2.9k | 0 |
| Grep | 7 | 1.6k | 0 |
| Glob | 2 | 1.1k | 0 |
| AskUserQuestion | 1 | 0.2k | 1 |

**Top 10 most expensive tool results:**

| Tool | Target | ~tokens |
|---|---|---|
| Read | `SpeechDirect.Startup/App.xaml.cs` | 1,683 |
| mcp\_\_serena\_\_find_referencing_symbols | `IMiddleware/UnregisterAsync` | 1,478 |
| mcp\_\_serena\_\_find_referencing_symbols | `IAuthenticationMiddleware/StartAuthenticationProcessAsync` | 1,335 |
| Glob | `SpeechDirect.Middlewares/**/*.cs` | 974 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/ConnectToSocketAsync` | 832 |
| Read | `docs/architecture/references/test-coverage.md` | 709 |
| mcp\_\_serena\_\_find_referencing_symbols | `IAuthenticationMiddleware` | 666 |
| Read | `SpeechDirect.Core/Services/Implementations/ApplicationService.cs` | 565 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/DisposeAsync` | 532 |
| Grep | `IViewFactory\|ShowViewAsync\|ShowDialogViewAsync\|IsClosed` | 528 |

**Context-growth spikes** (top, this window only):

- +12.2k -> 150.2k ctx, 07:28:45Z - no tool_result large enough to explain it; lands right after the
  `/model` switch back to Sonnet 5, consistent with the model-switch itself re-priming context rather
  than any single tool result.
- +9.8k -> 138.0k ctx, 07:28:24Z - attributed to a 212-token `AskUserQuestion` result; the jump is ~46x
  the attributed cause, so the real driver is untracked (likely the accumulated conversation re-sent to
  the newly-selected model, not a tool result at all).
- +6.4k -> 157.3k ctx, 07:30:54Z - a single 709-token `Read` (`test-coverage.md`) "causing" a 6.4k jump -
  same pattern, disproportionate to its stated cause.

None of this window's spikes are explained by oversized tool output; they cluster around the two
`/model` switches, which is the more plausible driver.

**Skills/plugins attributed:** none. `project-solution-design`'s own step 2 says "Load the house skill
for the stack you're in, for its real trap list" - no `Skill` tool call happened anywhere in this window
(or anywhere earlier in the session), so `csharp` / `dotnet-wpf` were never loaded during design. See
Protocol check.

**Subagent dispatches:** zero. Correct - solution-design is single-chat and stayed that way.

### project-implementer (2 runs: stage 1 + stage 2)

**Brief:** stage 1 = "Implement the plan above"; stage 2 = "Implement second stage of plan" (both refer
to the plan `project-solution-design` produced in the prior run).

#### Stage 1 (07:33:34Z - 08:24:50Z)

**Tokens** (Sonnet 5 only):

| Model | Input | Cache write | Cache read | Output | Msgs |
|---|---|---|---|---|---|
| claude-sonnet-5 | 521 | 390.6k | 20.25M | 84.9k | 82 |

**Tool calls:**

| Tool | Calls | Result ~tok | Errors |
|---|---|---|---|
| Read | 23 | 15.6k | 1 |
| Bash | 22 | 3.9k | 4 |
| mcp\_\_serena\_\_find_symbol | 3 | 1.6k | 0 |
| Grep | 11 | 0.8k | 0 |
| TaskOutput | 6 | 0.5k | 0 |
| Edit | 8 | 0.4k | 0 |
| TaskStop | 2 | 0.3k | 0 |
| mcp\_\_serena\_\_get_symbols_overview | 2 | 52 | 0 |
| Write | 1 | 50 | 0 |
| Glob | 2 | 42 | 0 |
| Skill | 1 | 5 | 0 |

**Top 10 most expensive tool results:**

| Tool | Target | ~tokens |
|---|---|---|
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 3,833 |
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 1,669 |
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 1,504 |
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 1,330 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/LoadCommandBuilderDataAsync` | 1,287 |
| Bash | `dotnet build Tests/SpeechDirect.UnitTests/...csproj -c Debug \| tail -100` | 1,229 |
| Read | `Tests/.../ForegroundProcessCheckMiddlewareTests.cs` | 1,016 |
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 971 |
| Read | `SpeechDirect.Core.Contracts/Services/ICommandBuilderStorageService.cs` | 798 |
| Read | `SpeechDirect.Middlewares/BackgroundServices/CommonWorkBackgroundService.cs` | 666 |

**Skills attributed:** `csharp`, loaded once at 07:34:01Z (right at the start) - correct, matches the
csharp skill's own trigger ("load before editing any .cs file").

**Subagent dispatches:** zero.

#### Stage 2 + its own finish-protocol code-review (08:24:59Z - 11:18:49Z, ~45m active)

**Tokens, main session** (Sonnet 5 only):

| Model | Input | Cache write | Cache read | Output | Msgs |
|---|---|---|---|---|---|
| claude-sonnet-5 | 245 | 1.54M | 26.28M | 161.0k | 123 |

**Tokens, the 15 dispatched subagents** (all `general-purpose`, all attributable to this stage's own
`/code-review` step - see Protocol check):

| Scope | Cache write | Cache read | Output | Msgs |
|---|---|---|---|---|
| 15 subagents combined | 1.46M | 15.09M | 112.1k | 182 |

**Grand total, stage 2 (main + subagents):** cache write 3.00M, cache read 41.37M, output 273.1k,
490 msgs across 138 API calls (16 main-scope + 122 main-scope... see note) - the two scopes are additive,
not nested; main session and subagents bill separately.

**Tool calls, main session:**

| Tool | Calls | Result ~tok | Errors |
|---|---|---|---|
| mcp\_\_serena\_\_find_symbol | 41 | 30.7k | 0 |
| Bash | 35 | 18.5k | 0 |
| Read | 8 | 4.0k | 1 |
| Agent | 17 | 3.8k | 2 |
| Grep | 18 | 2.4k | 0 |
| Edit | 19 | 1.0k | 0 |
| Write | 14 | 0.7k | 0 |
| mcp\_\_serena\_\_get_symbols_overview | 2 | 0.6k | 0 |
| TaskCreate | 1 | 0.4k | 1 |
| ScheduleWakeup | 6 | 0.2k | 0 |
| Glob | 1 | 0.2k | 0 |
| Skill | 1 | 7 | 0 |
| ReportFindings | 1 | 5 | 0 |

**Top 10 most expensive tool results, main session:**

| Tool | Target | ~tokens |
|---|---|---|
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/StartAuthenticationProcessAsync` | 3,700 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/StartAuthenticationProcessAsync` (duplicate) | 3,700 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware` (whole-class overview) | 2,149 |
| Bash | `dotnet test Tests/SpeechDirect.UnitTests/bin/Debug/...` | 1,892 |
| Read | `SpeechDirect.Middlewares/Implementations/AuthenticationMiddleware.cs` | 1,477 |
| Bash | `dotnet build Tests/SpeechDirect.UnitTests/...csproj -c Debug \| tail -40` | 1,345 |
| Bash | `dotnet build SpeechDirect.Middlewares/...csproj -c Debug \| tail -40` | 1,301 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/LoadCommandBuilderDataAsync` | 1,287 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/SetUserDataAsync` | 1,257 |
| mcp\_\_serena\_\_find_symbol | `AuthenticationMiddleware/AuthenticationMiddleware` (ctor) | 1,183 |

**Context-growth spikes, this window:**

- +26.7k -> 351.9k ctx, 08:29:37Z, after `mcp__serena__find_symbol`×13 (~10.3k tok) - the biggest single
  jump of all three runs; a burst of 13 symbol lookups in one turn.
- +19.6k -> 141.1k ctx, 08:38:28Z, after `mcp__serena__find_symbol`×13 (~8.3k tok) - same pattern
  repeating.
- +16.5k -> 165.9k ctx, 08:41:13Z, attributed to a 51-token `Write` result - disproportionate; the real
  driver is untracked context (likely a large system-reminder or skill re-injection that doesn't surface
  as a tool_result).
- +14.9k -> 325.2k ctx, 08:27:14Z, after `mcp__serena__find_symbol`×11 (~6.7k tok).
- +14.4k -> 366.3k ctx, 08:29:48Z, attributed to a 46-token `Write` - same untracked-driver pattern as
  above.

**Skills attributed:** `code-review`, loaded once at 08:52:07Z - this is implementer's own finish step
("run the full suite once, then `/code-review` over the assembled diff") firing correctly.

**Subagent dispatches: 15, all `general-purpose`, all from `/code-review`'s 8-angle fan-out** (Line-by-line,
Removed-behavior, Cross-file tracer, Reuse, Simplification, Efficiency, Altitude, Conventions). This is
flagged below - see Protocol check and Waste analysis. The fan-out actually ran twice: 9 agents launched
first at 08:52-08:54 (one retry after a transient classifier error), all 9 lost to a session usage-limit
hit at 08:55:54Z, then all 8 angles were fully re-launched from scratch at 11:11:10Z after the limit
reset at 11:04Z. 17 `Agent` tool_use calls total, 15 that produced a usable subagent transcript.

### project-verify-plan

**Not run.** No `/project-verify-plan` command, no `Skill` tool call with `skill: "project-verify-plan"`,
and no `attributionSkill: "project-verify-plan"` stamp anywhere in any of the four session transcripts
for this project. Zero tokens, zero tool calls, zero subagent dispatches - there is nothing to report
because nothing executed. `project-implementer` was invoked directly on the un-audited
`project-solution-design` output both times, skipping the audit step the pipeline's own docs describe
("gate the plan with `project-verify-plan` before building").

---

## Waste analysis

Ranked by tokens wasted, worst first:

1. **~7.4k tokens: the entire `/code-review` fan-out ran twice.** The first 9-agent batch
   (08:52:43Z-08:54:52Z) was fully lost to a session usage-limit hit before any finder agent could report
   back - none of that batch's `cache_read`/`output` tokens produced usable output. The full 8-angle
   fan-out was then re-run from scratch at 11:11:10Z. This is not implementer's fault (external session
   limit), but it doubles the finish-protocol's subagent cost for stage 2 - roughly half of the 112.1k
   subagent output tokens and 15.1M subagent cache-read tokens bought nothing.
2. **Duplicate `find_symbol` call for the same symbol, same window (~3.7k tokens).** Stage 2 called
   `mcp__serena__find_symbol` on `AuthenticationMiddleware/StartAuthenticationProcessAsync` twice,
   14,801 chars each time, back to back - a straight re-fetch of a symbol already in context.
3. **`AuthenticationMiddleware.cs` read as a whole file 4 times across the two implementer stages**
   (3,833 / 1,669 / 1,504 / 1,330 tokens = ~8.3k combined), instead of the file being read once and then
   navigated via `find_symbol`/`find_referencing_symbols` per the project's own navigation rule
   ("Locate symbols... with serena... before any whole-file Read"). Given the file was under active
   rewrite in this same session, some re-reads reflect legitimate re-checks after edits landed - but four
   whole-file reads of the one file everyone knew was the target is more than that pattern explains.
4. **`App.xaml.cs` read twice back-to-back in solution-design** (07:23:09Z and 07:23:10Z, 1 second apart,
   6,733 + 1,689 chars) - a same-turn duplicate read with no edit or state change between them.
5. **Five of the eight `dotnet build`/`dotnet test` Bash calls across the two implementer stages piped
   through `tail -40`/`tail -100` and still landed 1.0k-1.9k tokens each** (~7k tokens total) - reasonable
   for build/test output, but three of the five builds are the same project
   (`SpeechDirect.Middlewares.csproj`) rebuilt in immediate succession without an intervening edit
   visible in the tool-call list, suggesting at least one rebuild reconfirmed a build that hadn't changed.
6. **Context spikes not explained by any tracked tool result** (the `Write`-attributed 16.5k and 14.4k
   jumps in stage 2, the `AskUserQuestion`-attributed 9.8k jump in solution-design). These aren't
   necessarily waste - they're most likely the skill-doc/system-reminder injection that lands in the same
   turn as an unrelated small tool call, which the transcript's `tool_result` accounting doesn't
   attribute correctly - but they're worth flagging because they mean the "Top 10 tool results" tables
   above under-count the actual per-turn context growth by a material margin in a few turns.

No overlong prose was found in the skills' own final reports within these windows - the implementer's
stage-2 close-out and the code-review summary text were both proportionate to what they reported.

---

## Protocol check

**project-solution-design** - partial compliance.
- Step 1 ("orient from the committed docs, don't re-derive them... read `docs/architecture/ARCHITECTURE.md`")
  was **not followed**: the run globbed `docs/architecture/**/*.md` at 07:22:03Z but only ever opened two
  reference docs (`document-integrations.md`, `test-coverage.md`) - `ARCHITECTURE.md` itself, the doc the
  skill names explicitly, was never read in this window or earlier in the session.
- Step 2 ("load the house skill for the stack you're in") was **not followed**: no `Skill` tool call
  happened anywhere before or during this run, so `csharp`/`dotnet-wpf` were never loaded going into the
  design.
- Step 3/4 (judge the fit, decompose into an ordered plan): the run did navigate the real call graph
  (`AuthenticationMiddleware` contracts, `IViewFactory`, `ApplicationService`, `IManageView`) via
  `find_symbol`/`find_referencing_symbols` and produced task output that stage 1 and stage 2 both
  reference as "the plan" - consistent with an ordered plan having been produced, though the plan text
  itself isn't in the windowed tool-call evidence (it's in the assistant's own response text, out of
  scope for this token/tool report).

**project-implementer** - ran, but not exactly to its own task-card model.
- The skill's protocol is explicit: "Take exactly one task... per task" and "Close the task honestly...
  then the next task" - one invocation per task card. In practice this pipeline was invoked twice with
  coarse-grained args ("Implement the plan above", "Implement second stage of plan"), not once per task
  card, so it's not verifiable from the transcript alone whether "stage 1"/"stage 2" map 1:1 to the
  plan's task boundaries or each covers multiple tasks compressed into one pass.
- Build/test gating **was followed**: both stages ran `dotnet build` and `dotnet test` via Bash
  (stage 1: 3 build/test Bash calls; stage 2: multiple build/test calls, see tool tables above) rather
  than deferring verification to the end.
- The finish step ("run the full suite once, then `/code-review` over the assembled diff... then the
  done-gate") **was followed** in stage 2 - `code-review` loaded at 08:52:07Z, immediately followed by
  the 8-angle subagent fan-out, and a `ReportFindings` call closing it out at the end of the window.
  Stage 1 shows no equivalent close-out - consistent with stage 1 being an intermediate step, not the
  plan's final task.

**project-verify-plan** - **not run**, so there is no pass to check. The pipeline as executed was
design -> implement (twice) -> code-review, skipping the audit gate the design skill itself names as the
next step after planning.

---

## Verdict

| Skill | Worked as intended | Biggest strength | Biggest waste source | Suggestion |
|---|---|---|---|---|
| project-solution-design | Partial | Real symbol-graph navigation via serena (`find_referencing_symbols`/`find_symbol`) instead of guessing at the call graph | Skipped its own step 1 (never read `ARCHITECTURE.md`) and step 2 (never loaded a stack skill) | Add a hard check at the start of the skill's method that fails loudly if `ARCHITECTURE.md` hasn't been read and no stack skill is active before design output is produced |
| project-implementer | Yes, functionally | Consistent build+test gating per stage, and a real finish-protocol code-review pass with `ReportFindings` closing it out | The `/code-review` fan-out's first 9-agent batch was entirely lost to a session usage-limit hit and had to be fully re-run, roughly doubling stage 2's subagent cost | Wire `STACK_INSTRUMENT=1` for future measured runs so this class of loss shows up as attributed cost per agent instead of being inferred after the fact from timestamps |
| project-verify-plan | No - never executed | n/a | n/a (zero cost, because it never ran) | If the intent is genuinely audit-then-build, invoke `/project-verify-plan` between design and implementer; right now the pipeline silently skips the one skill whose entire job is to catch a bad plan before code gets written on top of it |

---

## Appendix: raw analyzer output

Machine dump: `docs/skill-usage-report.681ea6f9.json` (same directory as this report).

### `node analyze-usage.js <session-dir>` - one-line rollup (confirms which sessions matter)

```
  session                                start          output  cache-read   msgs agents agent-out
  681ea6f9-4d99-421a-86d8-42fc339d0a2f   2026-07-15     342.6k       56.8M    293     15    112.1k
  ff516efa-228e-4960-b1ee-9b1b6414e79f   2026-07-15     227.9k       66.6M    298      0         0
  2f9724ab-268e-49e4-9fc5-aa29fed86bc3   2026-07-14     126.3k       31.7M    177      0         0
  afff26ab-68be-4d2a-af97-f9d347a89b99   2026-07-13     193.5k       29.9M    176     15     76.4k
  TOTAL                                                   1.1M      204.6M   1271
```

### `node analyze-usage.js 681ea6f9-4d99-421a-86d8-42fc339d0a2f.jsonl` - full report

**Caveat:** this is the whole-session report (24h30m, all work in the file), not scoped to just the
three skill runs - included here per the task instructions as the literal analyzer output; the
per-skill numbers in the sections above are the ones scoped correctly to each run's actual line range.

```
Session 681ea6f9-4d99-421a-86d8-42fc339d0a2f  2026-07-15T06:30:08.911Z → 2026-07-16T06:59:44.787Z (24h 30m)
user prompts 47 · API messages 294 · compactions 6 · API errors 4

TOKENS (deduped per API message)
  scope / model             input cache-write  cache-read   output   msgs
  main session               2.5k        2.9M       56.9M   342.9k    294
    claude-sonnet-5          1.1k        2.8M       55.3M   323.0k    279
    claude-opus-4-8          1.3k      118.9k        1.6M    19.9k     15
  subagents (15)              887        1.5M       15.1M   112.1k    182
  TOTAL                      3.3k        4.4M       72.0M   454.9k    476

SUBAGENTS (exact per-dispatch cost, grouped by agent type)
  agent type                     n   output  cache-read  msgs    wall  top tools
  general-purpose               15   112.1k       15.1M   182     37m  Read×97 Grep×67 mcp__serena__find_symbol×36
                               e.g. "Removed-behavior auditor (Angle B)", "Cross-file tracer (Angle C)"

SKILLS (calls = Skill tool invocations; attributed = API msgs stamped while the skill was active - the real cost signal)
  skill                                        calls    result attr msgs  attr out
  code-review                                      1        ~7        66     52.2k
  csharp                                           1        ~6        49     63.8k
  project-implementer                              0        ~0        98    129.6k
  project-solution-design                          0        ~0        15     19.9k

MCP (main + subagents; results measured in chars, shown as ~tokens)
  server             calls   results errors  top tools
  serena               139    ~76.1k     15  find_symbol×102 get_symbols_overview×34 find_referencing_symbols×3

TOOLS (main + subagents; result volume = what lands back in context)
  tool                         calls   results errors
  Read                           154   ~614.5k     24
  mcp__serena__find_symbol       102    ~68.8k     15
  Bash                           101    ~31.9k      6
  Grep                           115    ~28.6k      1
  Glob                            19     ~4.0k      0
  mcp__serena__get_symbols_overview    34     ~3.8k      0
  Agent                           17     ~3.8k      2
  mcp__serena__find_referencing_symbols     3     ~3.5k      0
  Edit                            29     ~1.5k      0
  Write                           15      ~735      0
  TaskOutput                       6      ~494      0
  ScheduleWakeup                  10      ~431      0
  AskUserQuestion                  2      ~384      1
  TaskCreate                       1      ~356      1
  ToolSearch                      12      ~343      0

CONTEXT SPIKES (main session - biggest single-turn context jumps and what landed before them)
  +  26.7k → 351.9k ctx  2026-07-15T08:29:37.745Z  after: mcp__serena__find_symbol×13 (~10.3k tok)
  +  25.5k → 367.9k ctx  2026-07-15T13:00:23.086Z  after: Read×1 (~11.5k tok)
  +  25.2k → 123.9k ctx  2026-07-15T14:04:08.177Z  after: Read×1 (~7.9k tok)
  +  19.6k → 141.1k ctx  2026-07-15T08:38:28.529Z  after: mcp__serena__find_symbol×13 (~8.3k tok)
  +  16.5k → 165.9k ctx  2026-07-15T08:41:13.712Z  after: Write×1 (~52 tok)
```

Note: the two spikes at 13:00:23Z and 14:04:08Z belong to the later sleep/wake bug investigation, not
any of the three tested skills - excluded from the per-skill spike lists above, kept here only because
this block is the literal, unedited analyzer output as requested.

`--hook-log` was not used for this run - no instrumentation ledger exists (see Environment).
