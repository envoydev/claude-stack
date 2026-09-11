---
paths: ["**/*.Designer.cs"]
---

Editing a WinForms designer file - load `dotnet-winforms`: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - skip the load when it is already in context (some seats preload it); conventions are the source of truth, not recall. Name the skill you loaded, or say it was already in context - the receipt is what makes the load happen. Governs the Form/UserControl designer surface (control serialization, resx-backed strings) - and when the session's edit is the form's hand-written behavior (code-behind, presenter, binding, disposal), load `dotnet-winforms` for that too; the plain C# layer stays governed by `csharp`. A `Resources.Designer.cs` / `Settings.Designer.cs` (generated wrappers, any .NET project) is not WinForms - skip. Skip one-line tweaks.
