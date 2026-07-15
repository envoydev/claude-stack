---
paths: ["**/*.sql"]
---

Editing hand-written SQL - load `database-conventions` before the edit - skip the load when it is already in context (some seats preload it); conventions are the source of truth, not recall. Hand-written `.sql` only; ORM / EF query logic lives in a `.cs` file and routes through `csharp` and `dotnet-data-access` instead. Skip one-line tweaks.
