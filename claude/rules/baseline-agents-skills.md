---
description: House baseline - skill loading and subagent dispatch policy. Always-on (no paths), installer-managed - update overwrites local edits. The per-project INVENTORY (which orchestration skills, seats, and MCPs this project actually has) lives in the generated baseline-project-capabilities.md, not here.
---

# Skills, agents, hooks and MCPs

- Load a skill for the work at hand - a file you're about to edit, a command you're about to run, a diff you're about to show - never to answer a question. Over-loading a simple turn is the failure to avoid.
- One home per rule: route in the project's `CLAUDE.md` only what an auto-injected description does not already cover. Path-scoped rules (`.claude/rules/`) own per-file-type routing; hooks (`.claude/hooks/`) own deterministic gates and announce their own blocks - add a new gate as a hook, not prose.
- Subagent dispatch is explicit, never automatic: a user `@agent-<name>` mention, an orchestration skill routing to it, or a path-scoped repair-loop rule naming its resolver. Never self-delegate off a description match; the descriptions say when each agent applies, for the explicit paths to use.
- What THIS project actually has - its slash-only orchestration skills, its installed seats, its MCP routing - is the generated `baseline-project-capabilities.md` (written by `/project-capabilities`; re-run it after an install, an update, or a manifest trim). Suggest the matching orchestration skill from that inventory when a task calls for multi-agent work - never one this project does not carry.
