---
paths: ["**/*.xaml"]
---

Editing WPF XAML - load `dotnet-wpf`: the FIRST action after this rule attaches is that Skill call,
before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own
trigger) - skip the load when it is already in context (some seats preload it); conventions are the
source of truth, not recall. Name the skill you loaded, or say it was already in context - the receipt
is what makes the load happen.

Governs the `.xaml` view + MVVM binding layer; the `.cs` view-models are C#, governed by `csharp`.
Skip one-line tweaks.
