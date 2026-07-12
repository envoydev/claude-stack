---
name: dotnet-project-setup
description: "Set up a new .NET solution's build spine - the canonical src / tests / .config layout, .slnx solution files, Directory.Build.props shared build properties, global.json SDK pinning + rollForward, central package management via Directory.Packages.props, and pinning a dotnet tool in .config/dotnet-tools.json. Load to set up a new .NET solution, add a NuGet package, add a project, or pin a dotnet tool; trigger files .slnx, Directory.Build.props, Directory.Packages.props, global.json, .config/dotnet-tools.json. Companions: `dotnet` (router / parent), `dotnet-code-quality`, `devops`; schema and version migrations are `dotnet-migrate`. Do NOT load for analyzers / TreatWarningsAsErrors / .editorconfig (`dotnet-code-quality`) or CI workflows / packaging / SourceLink (`devops`)."
---

# dotnet-project-setup (build spine)

The files that configure every project in a solution at once - the layout, `.slnx`, `Directory.Build.props`, and `global.json`. This spine holds only the layout and the shared build properties; everything else points out and is stated once elsewhere:

- Central package management (`Directory.Packages.props`) -> `references/central-package-management.md`.
- Local tool pinning (`.config/dotnet-tools.json`) -> `references/local-tools.md`.
- .NET Framework 4.8 project config (`packages.config` -> `PackageReference`, `<LangVersion>` pin, Server GC) -> `references/net-framework-48.md`.
- Analyzers, `TreatWarningsAsErrors`, `.editorconfig`, the CI quality gate -> `dotnet-code-quality`. Do not put these in `Directory.Build.props` here.
- CI workflows, container / `dotnet pack` packaging, SourceLink -> `devops`.
- The dotnet-ef tool's migration workflow (add / apply migrations) -> `dotnet-migrate`.
- Every other .NET work area -> the `dotnet` router (parent).

## Canonical layout

```
MySolution/
├── .config/
│   └── dotnet-tools.json        # pinned CLI tools    -> references/local-tools.md
├── src/
│   ├── MyApp/MyApp.csproj
│   └── MyApp.Core/MyApp.Core.csproj
├── tests/
│   └── MyApp.Tests/MyApp.Tests.csproj
├── Directory.Build.props        # shared build props  (below)
├── Directory.Packages.props     # central versions    -> references/central-package-management.md
├── global.json                  # SDK pin             (below)
└── MySolution.slnx              # solution file       (below)
```

## What goes where

- Production code under `src/`, one project per library or deployable; tests mirror it under `tests/`, one test project per source project.
- A setting that must hold for every project -> `Directory.Build.props`, never copy-pasted per csproj.
- A package version -> `Directory.Packages.props`, never inline in a csproj (see the reference).
- A pinned CLI tool -> `.config/dotnet-tools.json` (see the reference).
- Anything CI or pipeline (`.github/workflows`) -> `devops`, not here.

## Solution file - .slnx

`.slnx` is the XML solution format: the default from `dotnet new sln` on .NET 10, and opt-in on SDK 9.0.200+ with `--format slnx`. Prefer it - it diffs and merges without the GUID churn of a `.sln`, and any editor can read it. Keep exactly one solution file: after `dotnet sln migrate`, delete the old `.sln` so solution auto-detection stays unambiguous.

```bash
dotnet new sln --format slnx --name MySolution   # .NET 10 defaults to .slnx
dotnet sln add src/MyApp/MyApp.csproj
dotnet sln migrate                               # convert an existing .sln, then delete it
```

```xml
<Solution>
  <Folder Name="/build/">
    <File Path="Directory.Build.props" />
    <File Path="Directory.Packages.props" />
    <File Path="global.json" />
  </Folder>
  <Folder Name="/src/">
    <Project Path="src/MyApp/MyApp.csproj" />
    <Project Path="src/MyApp.Core/MyApp.Core.csproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/MyApp.Tests/MyApp.Tests.csproj" />
  </Folder>
</Solution>
```

## Directory.Build.props - configure every project once

Placed at the solution root, MSBuild auto-imports it into every project below. Keep it to the language baseline, reusable target-framework properties, and genuinely project-wide global usings. The boundary: analyzer and warnings-as-errors props go to `dotnet-code-quality`; package metadata, packaging, and SourceLink go to `devops` - not here.

```xml
<Project>
  <!-- language baseline -->
  <PropertyGroup>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <!-- target frameworks defined once, referenced by each csproj -->
  <PropertyGroup>
    <NetLibVersion>net8.0</NetLibVersion>
    <NetTestVersion>net8.0</NetTestVersion>
  </PropertyGroup>

  <!-- usings every project gets - keep to truly project-wide ones -->
  <ItemGroup>
    <Using Include="System.Collections.Immutable" />
  </ItemGroup>
</Project>
```

A csproj then references the shared property instead of hard-coding the framework:

```xml
<PropertyGroup>
  <TargetFramework>$(NetLibVersion)</TargetFramework>
</PropertyGroup>
```

A nested `Directory.Build.props` in a subfolder overrides the root one and must `<Import>` it to keep both - keep a single file at the root unless you have a concrete reason to split.

## global.json - pin the SDK

Pin the SDK so every machine and CI runner builds with the same toolchain. Projects can still target `net8.0`; the SDK version and the project framework are independent (9.0.200+ is what unlocks `.slnx`).

```json
{
  "sdk": {
    "version": "9.0.200",
    "rollForward": "latestFeature"
  }
}
```

`rollForward` decides how far a machine may drift when the exact `version` is absent:

| Policy | Picks when the exact version is absent |
|---|---|
| `disable` | nothing - the exact `version` is required, else fail |
| `patch` | latest patch of the pinned feature band |
| `feature` | latest patch in the pinned feature band, else the next higher band |
| `latestFeature` | highest feature band + patch within the same major.minor (recommended) |
| `latestMinor` | highest minor within the same major |
| `latestMajor` | highest SDK installed on the machine |

Recommend `latestFeature` - pins the toolchain for reproducible builds, yet won't fail on a box that only has a slightly newer patch. In CI, point setup-dotnet at the file with `global-json-file: global.json` (see `devops`).
