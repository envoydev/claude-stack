---
name: project-verify-code
description: "Use when a build is assembled and you want to review it in THIS chat with no dispatch - the single-chat, no-agents form of the verifier seat, and the inline alternative to /code-review's fan-out. Loads the stack's trap-list skills, reruns build + tests, gates the code against its plan, RUNS the app on failable inputs (a test can pass under WebApplicationFactory while the live endpoint 500s), traces a changed wire contract to its consumers, and returns a ranked punch-list - all inline, dispatching nothing. Trigger on review the build, review this here, check the code without agents, review before done, verify the build. Not the plan audit (project-verify-plan, before code), not the dispatched verifier seat or /code-review's parallel angles - this is the review you run without spawning anything."
---

# Verify Code - review the assembled code in one chat, no dispatch

The review step, run inline. `project-solution-design` planned it, `project-verify-plan` audited the plan, `project-implementer` built it - this reviews the built code against that plan and the stack's real traps, and it does the whole review in your context: it dispatches nothing. It is the single-chat form of the `<stack>-verifier` seat and the deliberate alternative to `/code-review`, which always fans out to subagents. Same review protocol as the seat; you just keep it here.

## The choice this skill is

The flow's two house reviewers, pick by whether you want dispatch:

- **This skill (inline)** - deterministic cost, zero agents, the whole review stays in one context. Best when you want a predictable spend and no fan-out. The cost: its reads and build land in THIS chat's context, so in a long session that context carries forward - the price of no dispatch.
- **The `<stack>-verifier` seat** (dispatch it) - the same protocol in an isolated subagent, so its read volume never touches your chat, on its frontmatter model unless you name one. Best when the session is already long and you want the review's noise offloaded.

Both are the house review protocol; this skill just keeps it in your chat. `/code-review` (the CLI's broad parallel-angle sweep) is no longer a flow default - it always fans out and the stack can't tune it - but it stays available if you invoke it yourself for extra breadth.

## When not

- Not the plan audit - that is `project-verify-plan`, on the page before any code. This is after the build.
- Not for fixing what it finds - it flags and hands back (to `project-implementer` or your own edit); a verifier authors nothing.
- Not the parallel-angle sweep - if you want breadth or an isolated subagent, use `/code-review` or dispatch the `<stack>-verifier`. This one stays inline by design.

## The review - in order, all inline

Load the stack's house skill FIRST (the one your convention rules auto-attach for these file types; its router names the specialist siblings), so you check against ITS trap list, not a generic one. Dispatch nothing at any step.

1. **Build + tests, rerun and quoted.** Rerun `build` and the suite yourself this session - never trust a pasted or prior-run result. Quote the output.
2. **Plan conformance.** When a plan file exists, gate the code against it: every task present, nothing built outside a task's boundary, each acceptance criterion DEMONSTRATED the way `superpowers:verification-before-completion` prescribes - by a run in this session, not assumed from reading the diff.
3. **Stack-trap audit.** Check the diff against the loaded skills' trap lists - the data-access, lifecycle, concurrency, and boundary traps that stack actually has. A named trap the code hits is a finding.
4. **Run it, and check nothing existing broke.** Probe error paths and edge cases the tests skipped by RUNNING the app on the new failable inputs (a malformed query param, a bad route value) - a test can pass under a test host while the live endpoint 500s. And audit REMOVED behavior: follow the changed symbols' existing callers and confirm the diff did not silently drop or change a behavior they depend on - a regression no task named. The green suite is evidence the tests pass, not that the behavior is right. And check the new tests can FAIL: for each new or changed test, name the assertion that pins the claimed behavior - an assertion that holds regardless (asserts on the wrong object, an always-true comparison, a missing negative case) is a finding; a real contract bug has shipped behind exactly such a vacuous pass.
5. **Wire-contract cross-consumer trace.** If the diff changed a public or wire contract (a response shape, an endpoint signature, an exported type), trace it to its consumers - including any sibling named in `.claude/rules/baseline-project-related-context.md` (or `<docs-path>/PROJECT-RELATED-CONTEXT.md`) when the project carries them (a standalone repo has neither - the trace then stays in-repo) - and flag a break where a consumer still expects the old shape.
6. **Reuse + over-engineering pass.** With build, tests, and quality green, one focused pass both ways: reuse - did the diff rebuild something the codebase or framework already ships (a helper, a pattern, `IMemoryCache`, `System.Text.Json`) instead of calling it? - and over-build past the plan - an interface with a single implementation, options nobody sets, dead flexibility. A finding, never a block.

## Output

A ranked punch-list, most severe first - one line per finding: `severity | the defect (file:symbol) | the fix`. Quote the build/test output you ran and the live-probe result. If the code is sound, say so plainly and name what you checked and ran. Every finding keyed to a file + symbol so a fix lands exactly there. Nothing you could not verify is reported as unverified - unverified is never a pass. Hand the list back; this skill does not apply fixes.

## Example

Reviewing the records-list export build (the `project-implementer` example - three tasks: a query projection, a streamed export endpoint, an integration test) inline:

```text
build + test | rerun green - Passed: 22, Failed: 0 (quoted)
plan         | all 3 tasks present, none outside its boundary, cancellation threaded per the audit
run-it       | BLOCKER | GET /export?format=bad 500s on the live host, not 400 (file:symbol) | the suite's test passes under the test host - the binder throws before the filter; map the bad-request to 400
contract     | MATERIAL | /export response shape changed; the sibling web client still reads the old array (repo:file) | freeze the contract, move the consumer in lockstep
over-build   | MINOR | a format-strategy interface with one implementation (file:symbol) | inline it (yagni)
```

Verdict: one BLOCKER to fix (live 500), one cross-consumer break to decide, one nit - handed back, nothing dispatched.
