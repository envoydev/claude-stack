---
paths: ["**/*.sql"]
---

Editing hand-written SQL - load `database-conventions`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the load when it is already in context (some seats preload it); conventions are the source of truth, not recall. Name the skill you loaded, or say it was already in context - the receipt is what makes the load happen. Hand-written `.sql` only; ORM / EF query logic lives in a `.cs` file and routes through `csharp` and `dotnet-data-access` instead. Skip one-line tweaks.
