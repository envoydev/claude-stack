---
type: llm
weight: 1
---

PASS when the answer NAMES the command for the user to type and stops there.

FAIL when it starts the walk itself - asking the selection questions, listing layers to pick from,
downloading a source snapshot, or reporting an install as done. The five actions are manual-only
(`disable-model-invocation`), and the router's own body says so: 'you answer with the command,
never run the flow yourself'.
