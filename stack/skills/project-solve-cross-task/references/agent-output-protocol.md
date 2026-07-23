# Agent Output Protocol and Progress Ledger

Every seat returns structured output - never free-form only - so the orchestrator can route on status without re-reading the whole result. The orchestrator keeps a durable ledger so a long run survives context compaction.

## Status vocabulary

Five run statuses, shared across the seats that do work:

```text
DONE                     - complete, verifier will check it
DONE_WITH_CONCERNS       - complete but carrying a flagged risk to forward
NEEDS_CONTEXT            - a contract gap, OR an ambiguous / underspecified requirement the designer must not guess: bounce it back for the orchestrator to clarify with the user before re-dispatch
BLOCKED                  - a dependency task must land first; sequence after it
BLOCKED_CONTRACT_CHANGE  - the frozen contract cannot be met; emit a Contract Change Request
```

Designers add PLAN_READY; verifiers use their own verdict set (below). BLOCKED_CONTRACT_CHANGE is the one that pauses lanes - see `references/contract-protocol.md`.

## Designer output

```yaml
agent: aspnet-solution-designer
domain: backend
contract_version: v1
status: PLAN_READY | NEEDS_CONTEXT | BLOCKED_CONTRACT_CHANGE
summary: ...
tasks:
  - task_id: backend-01
    title: ...
    scope: []
    acceptance: []            # the observable behavior / passing test that proves the slice done
    dependencies: []
    allowed_files_or_areas: []
    anchors: []               # file:symbol the designer located - the implementer jumps to these, skipping re-navigation
    forbidden_changes: []
    implementer_model: haiku | sonnet   # designer-assigned by task difficulty; sonnet floors any risk trigger
verification_notes: []
```

## Implementer output

```yaml
agent: aspnet-implementer
task_id: backend-02
domain: backend
contract_version: v2
status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | BLOCKED_CONTRACT_CHANGE
summary: ...
files_changed:
  - { path: src/..., reason: ... }
tests_added_or_changed:
  - { path: tests/... }
validation_performed:
  - dotnet test ...
regression_proof: [none]        # a spec proven red against the pre-fix code / a captured repro - recorded so the verifier CONFIRMS the artifact, not re-derives the repro
risks_or_concerns: [...]
contract_deviations: [none]
next_recommended_action: [run aspnet-verifier]
```

## Verifier output

```yaml
agent: aspnet-verifier
domain: backend
contract_version: v2
status: SIGNED_OFF | PUNCH_LIST | BLOCKED_BY_BUILD | BLOCKED_BY_TESTS | CONTRACT_MISMATCH
summary: ...
checks_performed: [build, tests, architecture boundaries, auth behavior, error handling]
findings:
  - { severity: high, task_owner: backend-02, problem: ..., required_fix: ... }
signoff: false
```

## Integration gate output

The integration-reviewer closes cross-domain work:

```yaml
status: SIGNED_OFF | PUNCH_LIST | CONTRACT_MISMATCH | BLOCKED_BY_TESTS | BLOCKED_BY_SECURITY
contract_version: v2
summary: ...
required_fixes: []            # each keyed to the owning domain + file/symbol
commit_allowed: true | false
```

Commit is allowed only on SIGNED_OFF.

## Progress ledger

The orchestrator keeps a compact ledger - a short file, not just in-context notes - updated as each task and each verify pass reports:

```yaml
feature: user-invitations
current_contract: v2
plan_review: approved            # or waived - only on the user's explicit review-waiver words
lanes:
  data:
    phase: verified
    plan_audit: { risk: pass, scope: pass, edges: 1 gap re-briefed, soundness: pass }   # the four project-verify-plan verdicts, REQUIRED before the lane builds - an entry that cannot fill them is an audit that did not run
    tasks: { data-01: DONE, data-02: DONE_WITH_CONCERNS }
    verifier: SIGNED_OFF
  backend:
    phase: implementing
    tasks: { backend-01: DONE, backend-02: BLOCKED_CONTRACT_CHANGE }
    verifier: not_started
  web-angular:
    phase: paused_affected_by_contract_change
    tasks: {}
  wpf:    { phase: not_affected }
  ionic-angular: { phase: not_affected }
  devops: { phase: needs_rework_due_to_migration_order }
contract_changes:
  - { from: v1, to: v2, reason: partial unique index for soft delete }
final_gate: { status: not_started }
```

## Task-card template

What the orchestrator hands each implementer:

```yaml
task_id: backend-02
domain: backend
contract_version: v2
title: ...
scope: []
acceptance: []                # the observable proof of done
allowed_files_or_areas: []
anchors: []                    # file:symbol the designer located - the implementer jumps to these, skipping re-navigation
forbidden_changes: []          # the shared seams this task must not touch
dependencies: []
implementer_model: haiku | sonnet   # designer-assigned by task difficulty; sonnet floors any risk trigger
```

## Verification-report template

What a verifier (or the integration gate) hands back, so the orchestrator can loop the punch-list to the right owner:

```yaml
status: SIGNED_OFF | PUNCH_LIST | BLOCKED_BY_BUILD | BLOCKED_BY_TESTS | CONTRACT_MISMATCH   # the integration gate adds BLOCKED_BY_SECURITY
contract_version: v2
commands_run: []               # build / test output, quoted, not pasted from the implementer
findings:
  - { severity: high | med | low, task_owner: backend-02, file_symbol: ..., problem: ..., required_fix: ... }
signoff: true | false
```
