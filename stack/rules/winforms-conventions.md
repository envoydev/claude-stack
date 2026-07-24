---
paths: ["**/*.Designer.cs"]
---

Editing a WinForms designer file - load `dotnet-winforms` before the edit - skip the load when it is already in context (some seats preload it); conventions are the source of truth, not recall. Governs the Form/UserControl designer surface (control serialization, resx-backed strings) - and when the session's edit is the form's hand-written behavior (code-behind, presenter, binding, disposal), load `dotnet-winforms` for that too; the plain C# layer stays governed by `csharp`. A `Resources.Designer.cs` / `Settings.Designer.cs` (generated wrappers, any .NET project) is not WinForms - skip. Skip one-line tweaks.
