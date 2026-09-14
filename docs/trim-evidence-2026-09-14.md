# Token-trim evidence - 2026-09-14

Six candidate cuts to what the stack loads on every session were A/B tested before any of them shipped.
Every arm ran as a fresh `claude -p` session in a throwaway directory. The main session ran on
`opus[1m]`; the implementer seat ran on its pinned `sonnet`. Prices below are the API-equivalent
`total_cost_usd` Claude Code reports.

## Verdicts

| # | Cut | Verdict | Shipped in 0.2.79 |
|---|---|---|---|
| 1 | Seat skill preloads: `aspnet-implementer` keeps `csharp` + `dotnet-testing`, loads the rest on demand | FAIL - quality regression, ~2% saving | no |
| 2 | Repo `CLAUDE.md` 58,903 -> ~26k chars (history and measurements dropped, instructions kept) | PASS | yes |
| 3 | Skill descriptions, 20 model-visible skills of an ASP.NET + Angular install, 13,875 -> 5,780 chars | PASS | yes |
| 4 | Agent descriptions, 18 agents of that install, 15,541 -> 5,735 chars (cross-stack exclusion lists dropped) | PASS | yes |
| 5 | security-guidance Stop-hook diff review off | NOT MEASURABLE here - left on | no |
| 6 | `guard-answer-length.js` per-message reminder 760 -> 170 chars | FAIL - longer answers | no |

The lint's always-on figure moved from 123,593 to 106,873 chars.

## 1 - seat skill preloads

A .NET 10 minimal-API project (EF Core SQLite, xUnit + WebApplicationFactory, 2 green tests) was cloned
fresh per run. The main session dispatched `aspnet-implementer` with a task card; afterwards hidden
acceptance tests the seat never saw were added and run.

- Task A - `POST /products` + `GET /products?category=` with RFC 9457 validation problems (8 hidden tests;
  X1 checks a malformed JSON body also returns `application/problem+json`, the `AddProblemDetails()`
  convention from the API error-handling skill).
- Task B - a pure `PriceCalculator` (11 hidden tests; no endpoint, no database).

| Run | Hidden | Own tests | Seat tokens (in+cache) | `AddProblemDetails` |
|---|---|---|---|---|
| full-A-r1 | 8/8 | 12 pass | 650,093 | yes |
| full-A-r2 | 8/8 | 11 pass | 821,793 | yes |
| trim-A-r1 | 7/8 (X1) | 12 pass | 699,883 | no |
| trim-A-r2 | 7/8 (X1) | 12 pass | 588,099 | no |
| full-B-r1 | 11/11 | 19 pass | 464,796 | - |
| full-B-r2 | 11/11 | 18 pass | 455,891 | - |
| trim-B-r1 | 11/11 | 18 pass | 457,580 | - |
| trim-B-r2 | 11/11 | 17 pass | 444,138 | - |

The trimmed seat was told, in its body, to load the error-handling, web-backend and data-access skills
before the first edit in that area. It made zero Skill calls in all four runs, so the convention the
preload carried was lost in 2 of 2 API runs. On pure logic the saving was ~2%: the preload is cached,
and the trimmed seat took more turns (19 vs 15 API calls in the r1 pair).

## 2 - repo CLAUDE.md

16 maintenance questions whose answers live in `CLAUDE.md` (retirement lists, env rows, the failed
serena activation routes, stamps, branch and release, cite-by-description, memory MCP, Sentry-Bearer,
raw fetches, the budget, account-level env expansion, `claude mcp add` exit 0, `allowed-tools`, hook
timeout, router skill vs command, serena memory vs architecture docs). Tools disabled, answers graded by
hand.

| Arm | Correct | Input tokens per session |
|---|---|---|
| full (58,903 chars) | 16/16 | 83,840 |
| trimmed (25,887 chars) | 16/16 | 77,284 |

## 3 + 4 - skill and agent descriptions

The install's 29 skills and 18 agents, current vs trimmed descriptions. A PreToolUse hook recorded and
denied every Skill / Agent call. 10 prompts that should load a named skill, 1 that should load none, 6
that should dispatch a named agent - none naming the target.

| Arm | Picks matching the expected target | Tokens per run |
|---|---|---|
| current | 15/17 | 57,807 |
| trimmed | 15/17 | 42,187 |

Both arms made the same choice on all 17 prompts; the two misses were identical (an Angular security
review went to `security-auditor`, an Angular test request to a general-purpose agent).

Two corrections surfaced: 10 of the 29 skills carry `disable-model-invocation`, so their descriptions
never reach the model although check 33 counts them (9,254 chars across the repo); and a 200k-window
debug run showed no skill-listing overflow for this install size.

## 5 - security-guidance Stop review

Local plugin logs, 2026-09-04 to 09-14: 59 Stop-hook diff reviews, 0 findings, 18.6s each in the
background. Its token spend is emitted to Claude Code as hook metrics and not persisted, and in print
mode the review skips itself (`LLM review disabled or no API credentials`), so its cost could not be
measured without handling the account's credential.

## 6 - answer-length reminder

11 prompts that invite a long answer (one explicitly asks for detail), 2 reps per arm, the rule plus
only the UserPromptSubmit reminder wired (no Stop block).

| Arm | Median prose chars | Over 900 | Over 1800 | Em-dashes | Detail prompt |
|---|---|---|---|---|---|
| full reminder | 1,158 | 16/20 | 0 | 0 | 4,724 / 5,033 |
| one-line reminder | 1,266 | 18/20 | 0 | 0 | 4,500 / 4,151 |

The ~150 tokens per message the short reminder saves are offset by longer answers, and budget
compliance got worse.

## Limits

One model family, N=1 (routing, CLAUDE.md) or N=2 (seat, reminder) per cell, one install shape
(ASP.NET + Angular). The untested 58 skill and 25 agent descriptions keep their current text until a
routing pass covers their stacks.
