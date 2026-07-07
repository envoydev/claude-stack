---
name: ilspy-decompile
description: "Decompile a compiled .NET assembly to read its real implementation - see how a framework or NuGet API actually works, view source you do not ship, or confirm behavior before a framework upgrade. Uses ilspycmd (via dnx or a pinned global tool). Load when you need ground truth from a .dll instead of guessing at an API, not for source you already have (that is serena / the LSP). Companions: `dotnet-migrate` (upgrade investigation), `csharp`."
metadata:
  type: reference
  sources: "Distilled 2026-07 from aaronontheweb/dotnet-skills (ilspy-decompile). Kept the command recipes and the assembly-location map; trimmed the SDK-locator verbosity and the legal boilerplate to a single line."
---

# ilspy-decompile

Decompile a compiled assembly when you need the real implementation - a framework internal, a NuGet package you have no source for, or the exact behavior of a method before you upgrade across it. For source you already have, navigate with serena / the LSP instead; this is only for compiled `.dll` you cannot open otherwise.

## Tool

`ilspycmd`, via either form (pick whichever the environment has):

```bash
dnx ilspycmd -h                       # needs the .NET 10 SDK
dotnet tool install --global ilspycmd # or pin per-repo in .config/dotnet-tools.json
```

Flags vary by version - confirm with `ilspycmd -h`.

## Locate the assembly

- NuGet package: `~/.nuget/packages/<package-name>/<version>/lib/<tfm>/`
- Build output: `./bin/Debug/net8.0/<AssemblyName>.dll` (or `Release/.../publish/`)
- Runtime libraries: the shared-framework folder under the SDK (`dotnet --list-runtimes` shows the paths). Reference assemblies hold no implementation - decompile the runtime `.dll`, not the ref.

## Commands

```bash
ilspycmd MyLibrary.dll                       # whole assembly to stdout
ilspycmd -o ./decompiled MyLibrary.dll       # to a folder
ilspycmd -p -o ./project MyLibrary.dll       # reconstruct a .csproj
ilspycmd -t Namespace.ClassName MyLibrary.dll # one type only (fastest)
ilspycmd -il MyLibrary.dll                   # raw IL
```

Workflow: identify what you want to understand, locate the assembly, decompile the one type (`-t`) rather than the whole thing.

## Modern-build caveats

ReadyToRun images, trimmed builds, and NativeAOT all reduce or omit decompilable code - prefer a non-trimmed Debug/Release build when you have the choice. Decompiling third-party code may be license-restricted; use it to understand, not to redistribute.
