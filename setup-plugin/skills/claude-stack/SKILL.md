---
name: claude-stack
description: "Route to the right claude-stack action when unsure which fits - inspects the install state and answers with the exact command to run: /claude-stack:setup (fresh install from scratch), /claude-stack:update (no-questions refresh + prune of upstream removals), /claude-stack:configure (adjust an existing install - add or drop), /claude-stack:validate (reconcile an install against THIS project - prune what its frameworks do not use and add the detected stacks' missing artifacts). Trigger by invoking /claude-stack."
disable-model-invocation: true
---

# /claude-stack - the router

Route by install state, then hand the user the ONE command to run. The four actions are
manual-only commands - the user stays at the wheel, so you answer with the command, never run
the flow yourself:

- Nothing installed here (no populated `.claude/skills` / `.claude/agents`, and no global install
  to target) -> `/claude-stack:setup` (fresh install from scratch).
- The stack is installed and the ask is a plain refresh (no items named) -> `/claude-stack:update`
  (refresh everything installed + prune what upstream removed).
- The stack is installed and the user wants to adjust it (add or drop items, change the
  selection) -> `/claude-stack:configure`.
- The stack is installed and the user wants it reconciled TO THIS PROJECT - prune what the
  project's frameworks do not use (WPF artifacts in a web-only repo, the data vertical with no SQL)
  AND add the detected stacks' artifacts that are missing -> `/claude-stack:validate` (project mode
  only).

Answer with the command plus one line naming the state you found (for example: 'no `.claude/skills`
here - run `/claude-stack:setup`'). When more than one reading is plausible, ask the user which
they want instead of guessing.
