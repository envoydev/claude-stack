# Token-Reduction Policy - Ponytail and Caveman

Token reduction is a policy, not ad-hoc instructions repeated in every agent. Two plugins do different jobs: Ponytail cuts unnecessary work and code (the big lever), Caveman cuts output verbosity (a smaller, selective lever).

## Ponytail - the primary lever

Ponytail is primary because it reduces the work itself, not just the words. Run it at full discipline for the seats that write or judge code, lite for the seats that plan.

```yaml
ponytail:
  implementers: full
  repair_agents: full
  integration_reviewer: full
  domain_verifiers: full        # the 'review' discipline: hunt over-build past the plan
  solution_designers: lite      # the 'ultra' discipline: smallest plan that fully meets the requirement
  contract_designer: lite
  task_analyzer: lite
```

Core Ponytail behavior expected from an implementer (the 'full' discipline):

```text
1. Do not write code if configuration, existing code, or deletion solves it.
2. Search for an existing pattern before adding a new abstraction.
3. Prefer a framework / native / stdlib feature before a new dependency.
4. Implement the smallest change that satisfies the contract and acceptance criteria.
5. Do not future-proof speculatively.
6. Never cut security, accessibility, validation, data-loss prevention, or migration safety to get smaller.
```

Verifier / reviewer Ponytail checks (the 'review' discipline):

```text
Did the seat overbuild? Add an abstraction with one caller? Add a dependency
where the framework/BCL already ships one? Duplicate an existing utility?
Change more files than the task required? Can the diff shrink without losing
correctness or safety? Over-build past the plan is a finding; re-opening scope
the plan deliberately included is the designer's call, not the verifier's.
```

This is why each seat already names its discipline inline - designers 'ultra', implementers 'full', verifiers 'review'. This policy is the shared statement of why.

## Caveman - selective only

Caveman mainly shrinks output tokens. It does not reduce file reads, tool output, reasoning, or repeated context, and can be net-negative if every seat loads extra Caveman instructions to shorten an already-short result. Use it only where output volume is real and readability is not at a premium.

Good uses: compact implementer final reports, verifier and integration punch-lists, repair-agent summaries, commit messages, PR comments, and compressing shared policy / long-rule / large MCP-description text that many seats reload.

Avoid Caveman for: BA requirements clarification, cross-stack contract output, solution-design docs, security-audit reports, final architecture decisions, and Contract Change Requests - anything that must stay highly readable.

**Mechanism note (measured):** the Caveman plugin is a main-session SessionStart hook - it does NOT fire inside a dispatched seat, whose report comes back in full prose. So the `reports` / `punch_lists` terseness above is a discipline each seat applies INLINE in its own final report - hand back byte-exact code and a compressed explanation - the same inline-discipline model Ponytail already uses ('full' / 'review' named in each body), not something the plugin does for the seat. Keep the ceiling honest: Caveman only shrinks the report's words, never the seat's input context, tool output, or reasoning - which dominate its token count - so the mode ladder (fewer seats) and capability-reuse (leaner context) are the levers that actually move seat tokens; this one trims the tail.

## Combined configuration

```yaml
token_reduction_policy:
  ponytail:
    implementers: full
    repair_agents: full
    integration_reviewer: full
    verifiers: full
    designers: lite
    contract_designer: lite
  caveman:
    reports: lite
    punch_lists: lite
    commit_messages: lite
    pr_comments: lite
    contracts: off
    solution_design: off
    security_audit: off
  caveman_compress:
    shared_policies: enabled
    CLAUDE_md: enabled
    long_rules: enabled
    MCP_descriptions: enabled_when_large
```

## The third lever - eager context and redundant reads

Ponytail cuts the work, Caveman cuts the words; the third lever cuts the context a seat loads - load only the certain-use skill or MCP, navigate with serena, reach for context7 before a library API, and let a verifier orient from the implementer's memory note plus the diff instead of re-reading the whole module. The per-role wiring and the mechanisms live in `capability-reuse.md`, which also holds the safety floor: the verifier still runs the gates independently and never trusts the note in place of running the gate.

Never let Ponytail minimalism or Caveman terseness cut a security check, validation, authorization safeguard, audit log, migration safety, or data-loss protection. Smaller is a means, not a license.
