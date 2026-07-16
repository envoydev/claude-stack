---
description: Install or update the Claude Code stack (routes to the setup, update, or configure skill).
disable-model-invocation: true
---

Route by state, then follow the chosen skill exactly - never skip its selection-review or prerequisite gates:

- Nothing installed here (no populated `.claude/skills` / `.claude/agents`, and no global install to target) -> invoke the `setup` skill (fresh install from scratch).
- The stack is installed and the ask is a plain refresh (no items named) -> invoke the `update` skill (refresh everything installed + prune what upstream removed).
- The stack is installed and the user wants to adjust it (add or drop items, change the selection) -> invoke the `configure` skill.

When more than one reading is plausible, ask the user which they want instead of guessing.
