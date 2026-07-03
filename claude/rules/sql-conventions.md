---
paths: ["**/*.sql"]
---

Editing hand-written SQL - load `database-conventions` before the edit; conventions are the source of truth, not recall. Hand-written `.sql` only; ORM / EF query logic lives in a `.cs` file and routes through `csharp` and the data skills instead. Skip one-line tweaks.
