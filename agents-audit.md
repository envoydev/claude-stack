# Agents audit & improve loop

Durable ledger for the subagent audit (`claude/agents/*.md`, 32 seats). Rubric: 9 dimensions scored 0-10; grade = lowest dim (A = all >=8 AND all four hard requirements met, B = all >=6, C = all >=4). Four hard requirements are gates, not averaged: (1) serena-first navigation, (2) memory MCP handoff, (3) skill delegation, (4) mandatory upfront load. Gates for A: `node scripts/lint-skills.js` clean (checks 13 + 16 cover agents), YAML frontmatter parses and `name` matches file, all four hard reqs met, every dim >=8. Independent adversarial verify after each audit+fix pass; hard cap 5 passes.

Stop reasons: SATISFIED | PLATEAU | OSCILLATION | CAPPED.

Branch: `agents-audit-2026-07`. Started 2026-07-07.

## The standardized memory-handoff contract (the new capability)

The in-run handoff is unchanged: dispatch-prompt-in / structured-report-out (`subagent-flow`'s `references/agent-output-protocol.md`) plus the orchestrator's durable ledger. The memory MCP (`mcp__memory__*`, server `memory` / mcp-memory-service, sqlite_vec) adds a **durable cross-run, cross-project recall layer** on top - it does not replace the dispatch/report path.

Standard added to each seat's `## Conventions` (plus `mcp__memory__*` in `tools`):
- **At start (read):** recall prior memories for this feature/contract from the memory MCP (search by the feature + contract_version tag) - seat-specific: prior frozen contract + decisions / prior findings / prior root-cause for the same signature.
- **At hand-off (write):** store a durable memory tagged with the feature, contract_version, and this seat - seat-specific payload, kept reusable and compact (never a dump of the diff):
  - **designers** (aspnet/angular/data/devops/mobile/wpf-solution-designer, greenfield, cross-stack-contract-designer): the frozen contract + contract_version + key architectural decisions + shared-seam owners.
  - **implementers:** notable cross-cutting findings + contract deviations + decisions made under the contract.
  - **verifiers + integration-reviewer:** the punch-list + sign-off verdict, keyed to contract_version.
  - **diagnosers (issue/ci) + resolvers (build/test):** the root cause + the reusable fix pattern (error signature -> fix).
  - **analyzers/planners (architecture-analyzer, task-analyzer, framework-upgrade-planner, security-auditor):** the durable map / routing / plan / OWASP punch-list.
- **Isolated exception:** `evidence-gatherer` - single-run, reads its one gather-task from the dispatching diagnoser's prompt and returns the digest to that diagnoser directly, produces nothing durable for cross-run recall; the memory MCP is intentionally omitted with a one-line justification in its body.

## Scoreboard

| # | agent | first grade | current grade | passes | stop reason | hard-reqs (4/4) | blocking cons |
|---|-------|-------------|---------------|--------|-------------|-----------------|---------------|
| 1 | angular-implementer | F | **A** | 1 | SATISFIED | 4/4 | none (added memory handoff: findings+deviations payload) |
| 2 | angular-solution-designer | F | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload; +designer verdict vocab in Report) |
| 3 | angular-test-resolver | F | **A** | 1 | SATISFIED | 4/4 | none (memory: failure-sig->fix payload; +status vocab in Report) |
| 4 | angular-verifier | B | **A** | 2 | SATISFIED | 4/4 | none (verifier-flagged con remediated) |
| 5 | architecture-analyzer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: structural-map payload) |
| 6 | aspnet-implementer | F | **A** | 1 | SATISFIED | 4/4 | none (memory: findings+deviations payload) |
| 7 | aspnet-solution-designer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload) |
| 8 | aspnet-verifier | D | **A** | 1 | SATISFIED | 4/4 | none (memory: punch-list+verdict payload; +NEEDS_CONTEXT stop-path) |
| 9 | ci-failure-diagnoser | F | **A** | 1 | SATISFIED | 4/4 | none (memory: root-cause+fix-pattern; +diagnosis-status vocab matching issue-diagnoser) |
| 10 | cross-stack-contract-designer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload; +serena never-whole-Read clause; +PLAN_READY vocab) |
| 11 | data-implementer | F | **A** | 1 | SATISFIED | 4/4 | none (memory: findings+deviations payload) |
| 12 | data-solution-designer | F | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload) |
| 13 | data-verifier | F | **A** | 1 | SATISFIED | 4/4 | none (memory: punch-list+verdict payload) |
| 14 | devops-implementer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: findings+deviations payload) |
| 15 | devops-solution-designer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload) |
| 16 | devops-verifier | D | **A** | 1 | SATISFIED | 4/4 | none (memory: punch-list+verdict payload) |
| 17 | dotnet-build-error-resolver | F | **A** | 1 | SATISFIED | 4/4 | none (memory: error-sig->fix payload; +status vocab in Report) |
| 18 | dotnet-test-failure-resolver | D | **A** | 1 | SATISFIED | 4/4 | none (memory: failure-sig->fix payload; +status vocab; +upfront dotnet-testing) |
| 19 | evidence-gatherer | C | **A** | 1 | SATISFIED | 4/4 | none (ISOLATED: memory omitted w/ justification; also removed unused context7 tool) |
| 20 | framework-upgrade-planner | D | **A** | 1 | SATISFIED | 4/4 | none (memory: upgrade-plan payload) |
| 21 | greenfield-solution-designer | D | **A** | 1 | SATISFIED | 4/4 | none (memory: frozen contract payload) |
| 22 | integration-reviewer | - | pending | - | - | - | - |
| 23 | issue-diagnoser | - | pending | - | - | - | - |
| 24 | mobile-implementer | - | pending | - | - | - | - |
| 25 | mobile-solution-designer | - | pending | - | - | - | - |
| 26 | mobile-verifier | - | pending | - | - | - | - |
| 27 | ng-build-error-resolver | - | pending | - | - | - | - |
| 28 | security-auditor | - | pending | - | - | - | - |
| 29 | task-analyzer | - | pending | - | - | - | - |
| 30 | wpf-implementer | - | pending | - | - | - | - |
| 31 | wpf-solution-designer | - | pending | - | - | - | - |
| 32 | wpf-verifier | - | pending | - | - | - | - |

## Notes

- **Batch 1** (2026-07-07): 7/7 reached A, all 4/4 hard reqs, lint clean, house voice clean. Dominant change was the net-new memory handoff (none had it): all 7 gained `mcp__memory__*` + a seat-specific Conventions bullet - designer payload (frozen contract + decisions + seam owners), implementer payload (findings + deviations), resolver payload (failure-signature -> fix), analyzer payload (structural map). A couple also gained the structured status vocabulary in ## Report. First-pass grades F/D/B reflect how each auditor scored the missing-memory gate. No fabrications, no renames. 7 files changed.
- **Batch 2** (2026-07-07): 7/7 reached A, all 4/4 hard reqs, lint clean, house voice clean, all confirmed on first verify (no remediation). Memory handoff added to all 7 with the right per-seat payload. Bonus consistency fixes the audit surfaced: ci-failure-diagnoser gained a diagnosis-status vocabulary matching issue-diagnoser; aspnet-verifier gained a NEEDS_CONTEXT stop-and-report path; cross-stack-contract-designer gained the missing never-whole-file-Read clause + PLAN_READY vocab. No fabrications, no renames. 7 files changed.
- **Batch 3** (2026-07-07): 7/7 reached A, all 4/4 hard reqs, lint clean, house voice clean, all confirmed on first verify. The isolated exception `evidence-gatherer` was handled correctly: memory MCP omitted with an explicit one-line justification (single-run, diagnoser owns the handoff), hard req 2 satisfied by justification. The audit also right-sized it - removed a declared-but-unused `mcp__context7__*` tool (dim 2) and filled the house-form skill-preload slot with a 'no house skill' note. The two resolvers gained memory (error/failure-signature -> fix) + the structured status vocabulary. No fabrications, no renames. 7 files changed.
