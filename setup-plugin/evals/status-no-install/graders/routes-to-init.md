---
type: regex
weight: 2
target: last_message
pattern: "/claude-stack:init"
---

An empty working directory has no install to show. `commands/status.md` step 1 says: nothing
installed in either place -> say so and route to `/claude-stack:init`. The answer must hand back
that command.
