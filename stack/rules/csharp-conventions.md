---
paths: ["**/*.cs"]
---

Editing C# - the FIRST action after this rule attaches is the `csharp` Skill call, before the edit lands - even when the `.cs` touch is incidental to the session's main thread (measured: two sessions edited `.cs` files with this rule attached and never loaded it; the sessions whose focus WAS the C# work loaded it on cue). Skip the load only when it is already in context this session (some seats preload it); conventions are the source of truth, not recall. Writing or changing a TEST file loads `dotnet-testing` in the same action (measured: new test methods shipped with no testing skill loaded). This is the C# baseline for every `.cs` file, backend or desktop - a WPF view-model is still C#, so it loads here too, while WPF's .xaml view layer is governed separately. Skip one-line tweaks.
