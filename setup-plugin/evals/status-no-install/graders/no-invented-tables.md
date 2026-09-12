---
type: regex
weight: 1
target: last_message
pattern: "total: [0-9]"
match: not_contains
---

Every area table in `commands/status.md` ends in a `total: N` line. There is nothing installed
here, so a table is a fabrication - the failure this grader exists to catch is the command
rendering its fixed shapes from the command body instead of from disk.
