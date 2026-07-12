---
description: House baseline - skill loading and subagent dispatch policy. Always-on (no paths), installer-managed - update overwrites local edits.
---

# Skills, agents, hooks and MCPs

- Load a skill for the work at hand - a file you're about to edit, a command you're about to run, a diff you're about to show - never to answer a question. Over-loading a simple turn is the failure to avoid.
- One home per rule: route in the project's `CLAUDE.md` only what an auto-injected description does not already cover. Path-scoped rules (`.claude/rules/`) own per-file-type routing; hooks (`.claude/hooks/`) own deterministic gates and announce their own blocks - add a new gate as a hook, not prose.
- Subagent dispatch is explicit, never automatic: a user `@agent-<name>` mention, or an orchestration skill routing to it. Never self-delegate off a description match; the descriptions say when each agent applies, for the explicit paths to use.
- The orchestration skills are slash-invoked only and invisible to you until run (`disable-model-invocation`): `/main-stack-agents-flow` (one stack's design -> build -> verify vertical), `/cross-stack-agents-flow` (routes multi-stack work, freezes the shared contract; home of the shared subagent policies), `/project-scaffold`, `/project-quality-loop`, `/architecture-quality-loop`. Suggest the matching one when the task calls for multi-agent work.
