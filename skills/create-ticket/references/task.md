# Task Ticket

Task-type templates, task-specific rules, and examples. The shared rules (Language, Tracker dialect, Filing, Tone, Assumptions, Format / delivery) and the Title format live in `SKILL.md`.

A technical task is work that is not a bug or a user-facing feature. Supports the following task types - detect from context:
- **Refactor** - code quality, structure, or design improvements without behavior change
- **Performance** - profiling, optimization, or scaling work
- **Investigation / Spike** - research or exploration with a time-box and a deliverable (findings, decision, PoC)
- **Migration** - moving data, infrastructure, or code between systems
- **Upgrade** - dependency, framework, or platform version bumps
- **Cleanup / Tech Debt** - removing dead code, fixing inconsistencies, paying down known debt

## Title

Phrase as an action or goal.

Examples:
- `[OrderService] Refactor order processing pipeline to use strategy pattern`
- `[API] Investigate high p99 latency on GET /products endpoint`
- `[DB] Migrate user data from MS SQL to PostgreSQL`
- `[Auth] Upgrade IdentityServer from v6 to v7`

## Description templates

Adapt the structure based on task type. Use the relevant template below.

### Refactor / Cleanup / Upgrade / Migration

```
## Goal

[1-3 sentences. What is being changed and why. Focus on the technical motivation -
 performance, maintainability, correctness, consistency, or risk reduction.]

## Scope

[What is included. Be specific - files, modules, services, APIs affected.
 Call out what is explicitly OUT of scope to prevent scope creep.]

## Acceptance Criteria

- [ ] [Criterion 1 - specific and verifiable]
- [ ] [Criterion 2]
- [ ] No behavior change for end users (add if applicable)
- [ ] Existing tests pass; new tests added where logic changed

## Notes

[Optional. Risks, dependencies, rollback plan, related tickets. Skip if nothing relevant.]
```

### Performance

```
## Goal

[What is slow, under what conditions, and what the impact is.
 Include baseline metrics if known (e.g., "p99 = 3.2s under 500 concurrent users").]

## Baseline / Target

| Metric       | Current | Target  |
|-------------|---------|---------|
| [Metric 1]  | [value] | [value] |
| [Metric 2]  | [value] | [value] |

## Scope

[What areas are in scope for investigation/optimization. What is out of scope.]

## Acceptance Criteria

- [ ] Target metrics achieved under [defined load/conditions]
- [ ] No regression in correctness or other performance metrics
- [ ] Changes are covered by benchmarks or load test results

## Notes

[Optional. Profiling tools to use, environments, known suspects, related tickets.]
```

### Investigation / Spike

```
## Goal

[What question needs to be answered or what decision needs to be made.
 Be specific - vague spikes waste time.]

## Time-box

[Maximum time to spend: e.g., "2 days", "1 sprint". Work stops when time-box ends.]

## Questions to Answer

1. [Specific question]
2. [Specific question]
3. [Specific question]

## Deliverable

[What the output looks like: a written summary, a PoC branch, a decision in the ticket comments, an ADR, etc.]

## Notes

[Optional. Constraints, prior research, links to relevant docs or tickets.]
```

## Task-specific rules

- **Task type detection**: Infer the type from the user's description. If ambiguous, pick the closest match and note the assumption in Notes.
- **Acceptance Criteria**: For refactor/cleanup/upgrade/migration - always include. For perf - include with metrics. For spikes - replace with Deliverable instead.
- **Specificity**: Be technical and concrete. No vague goals like "improve performance" without numbers, conditions, or a defined target.

## Examples

**Input (from user):**
> Need to refactor the payment service, it's a mess - everything is in one giant class.

**Output:**

**Title:**
`[PaymentService] Refactor monolithic PaymentService class into focused components`

**Description:**
```
## Goal

The current PaymentService class handles provider integration, validation, retry logic, and logging in a single class (~800 lines).
This makes it difficult to test, extend, or change providers independently.
Goal is to split responsibilities into focused, testable components without changing external behavior.

## Scope

**In scope:**
- `PaymentService.cs` and direct dependencies
- Extraction of: provider adapter(s), retry policy, validation logic
- Unit test coverage for extracted components

**Out of scope:**
- Changing payment provider integrations
- UI or API contract changes

## Acceptance Criteria

- [ ] No single class exceeds ~200 lines of meaningful logic
- [ ] Each extracted component has its own unit tests
- [ ] All existing integration tests pass without modification
- [ ] No behavior change observable from the API layer

## Notes

- Coordinate with QA before merging - payment flow regression tests should be run manually.
```

**Input (from user):**
> Let's investigate why the product search is so slow. Users are complaining.

**Output:**

**Title:**
`[Search] Investigate high latency on product search endpoint`

**Description:**
```
## Goal

Users are reporting slow product search. The root cause is unknown - needs profiling and analysis
before any optimization work begins.

## Baseline / Target

| Metric   | Current        | Target   |
|----------|---------------|----------|
| p95      | Unknown        | < 500ms  |
| p99      | Unknown        | < 1s     |

Baseline to be established during investigation.

## Scope

**In scope:** GET /api/products/search endpoint and its dependencies (DB queries, filters, caching layer)
**Out of scope:** UI-side changes, other endpoints

## Acceptance Criteria

- [ ] Baseline metrics captured under realistic load
- [ ] Root cause(s) identified and documented
- [ ] Recommendations written up with estimated impact per fix

## Notes

- Check for missing indexes on product search columns first - low-effort, high-impact candidate.
- Use Application Insights / slow query log for initial profiling.
```

The worked example above is illustrative, not a default stack - the same stack-agnostic rule as `bug.md`: adapt tool and stack names to the project the ticket is for.
