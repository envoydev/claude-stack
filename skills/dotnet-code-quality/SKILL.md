---
name: dotnet-code-quality
description: "House .NET conventions for mechanically enforcing code quality - making the house style a build gate, not a review opinion. Floors at .NET 8 / C# 12. Load when setting up or fixing formatting, analyzers, .editorconfig, warnings-as-errors, or a CI quality gate, or when the user names CSharpier, dotnet format, Roslynator, editorconfig, analyzer, AnalysisLevel, or NoWarn. Companions: csharp (the conventions this enforces), dotnet-project-setup (Directory.Build.props), dotnet-security (CA3xxx/CA5xxx rules), dotnet-migrate (analyzer churn on upgrades). Do NOT load for authoring Roslyn analyzers/source generators (dotnet-source-generators) or test-suite quality (dotnet-testing)."
---

# .NET code quality - enforcement, not opinion

The `csharp` skill says *what* good C# looks like; this skill makes a build *prove* it. The goal is that style and correctness rules are a gate the compiler and CI enforce, so they never depend on a reviewer noticing. Baseline is .NET 8 / C# 12. This is about configuring the tools - authoring your own Roslyn analyzers is `dotnet-source-generators`, and judging whether the *tests* are any good is `dotnet-testing`.

## Two owners, one boundary: formatting vs rules

Split the space cleanly so two tools never fight over the same bytes:

- **A formatter owns layout** - whitespace, wrapping, brace placement. Pick **CSharpier**: it is opinionated and effectively zero-config, which ends the formatting debate instead of relocating it into `.editorconfig` knobs. The alternative, `dotnet format`, drives whitespace from `.editorconfig` style rules - fine if a repo has already standardized on it, but do not run both as formatters.
- **`.editorconfig` + analyzers own rules** - naming, usings, severity, the CA/IDE diagnostics. Formatting style rules effectively defer to the formatter.

Document which tool owns formatting once (in the repo's `CLAUDE.md` / `AGENTS.md`) so an agent never reformats under the wrong engine.

Install CSharpier as a **local tool** for reproducible local-and-CI runs, not globally:

```bash
dotnet new tool-manifest          # if .config/dotnet-tools.json is missing
dotnet tool install csharpier
dotnet csharpier check .          # CI: fails on unformatted code (use 'format' to write)
```

Add a `.csharpierignore` for generated or vendored trees. Tool pinning in `.config/dotnet-tools.json` is `dotnet-project-setup`.

## First-party SDK analyzers before any third-party pack

Turn on the analyzers that ship with the SDK first - they cost nothing and catch real defects. Set them once in `Directory.Build.props` (not per-project; layout is `dotnet-project-setup`):

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>              <!-- version knob: latest analyzer wave -->
  <AnalysisMode>Recommended</AnalysisMode>           <!-- strictness knob: All for the strictest bar -->
</PropertyGroup>
```

Only reach for a third-party pack (Roslynator, StyleCop, Meziantou) once the SDK baseline is in place and you have a concrete rule the SDK lacks - and give it an explicit severity plan so packs do not enforce contradictory versions of the same rule. **Roslynator** is the first add: prefer the `Roslynator.Analyzers` NuGet package (build-enforced) over the CLI; the CLI (`roslynator.dotnet.cli`) earns its place only for one-off analyze / fix / find-unused sweeps, and treat any auto-`fix` as a controlled change - run it on a bounded target, rebuild, rerun the tests.

A **per-method complexity ceiling** is the archetypal rule the SDK lacks - gate on cyclomatic or cognitive complexity, not just a line-count cap, because a 20-line method can still hide a branch thicket the length rule never catches. The SDK analyzers ship no complexity rule; Roslynator (or Sonar) supplies one, promoted to a build-failing severity like any other. To rank *existing* methods by change risk - cyclomatic complexity weighed against test coverage, so tests land where they pay - see `references/crap-analysis.md`.

## One root `.editorconfig` is the single source of severity

- Exactly **one** repo-root `.editorconfig` with `root = true`. Per-rule severity lives here, in version control - never in IDE-only settings that silently override repo policy.
- Add a **nested** `.editorconfig` only when a subtree genuinely needs different policy (looser rules for `*.Tests`, relaxed docs for generated code). Reserve `.globalconfig` for the exceptional case, not the normal setup.
- Keep **bulk MSBuild switches** (`EnableNETAnalyzers`, `AnalysisLevel`) in `Directory.Build.props`; keep **per-rule severity** (`dotnet_diagnostic.CA2007.severity = warning`) in `.editorconfig`. Do not split one rule's config across both.
- Write real EditorConfig - lowercase filename, forward-slash globs.

## Warnings as errors - and the rule you must not break

A clean build means zero warnings, enforced. For a **new** project, set the bar on day one:

```xml
<TreatWarningsAsErrors>true</TreatWarningsAsErrors>
```

The non-negotiable, because it is the exact reward-hack an agent reaches for: **when a warning-as-error breaks the build, fix the code - never silence the signal.** Specifically, do not

- remove, set `false`, or condition away `TreatWarningsAsErrors` / `WarningsAsErrors`,
- add `<NoWarn>` or `#pragma warning disable` for a promoted warning,
- downgrade a rule's severity in `.editorconfig` (`error` -> `warning`/`none`) to go green.

If the fix is genuinely too large, surface the warning ID and count and ask whether to defer that one - do not unilaterally drop the policy. (See the reward-hacking shortcuts list below; enforce it up front rather than catch it after the fact.)

## Legacy backlog: promote in batches, never all at once

Flipping `TreatWarningsAsErrors=true` on an existing codebase yields hundreds of errors and floods the context; fix quality collapses. Promote a curated set of IDs via `WarningsAsErrors`, in waves, building green between each:

1. **Trivial hygiene first** - mechanical, near-zero-risk: `CS8019` (unnecessary using), `CS0219`/`CS0168` (unused variable), `CS1591` (missing XML doc on public API), `CS0612`/`CS0618` (obsolete member). Add `CS8019;CS0219;CS0168` to `WarningsAsErrors`, fix all, commit.
2. **Code-quality CA rules next, by category, with the user choosing order** - `CA2000` (dispose before scope loss), `CA1062` (validate public args), `CA2007` (`ConfigureAwait`), `CA1822` (mark static), `CA1860`/`CA1861` (LINQ/array perf).
3. **Promote security rules to error** - the `CA3xxx` (injection) and `CA5xxx` (crypto/TLS) families belong at `error` in `.editorconfig`; which rules and why is `dotnet-security`.

## The gate is `dotnet build`

Analyzer enforcement is not a separate CI step - `dotnet build` runs the analyzers and, with warnings-as-errors, fails on a violation. So the same gate developers run locally is the CI gate. Add the formatter check (`dotnet csharpier check .`) and the build (warnings-as-errors on) to CI; both must be reproducible from a clean checkout with no machine-global state.

## Reward-hacking shortcuts to reject

The recurring ways a change fakes a green build instead of earning it - reject each in review, whoever wrote it. Most are gated above or in a sibling skill; this is the one consolidated list to check a diff against before claiming done.

| Shortcut | Instead |
|---|---|
| Disabled or skipped test (`[Fact(Skip=...)]`, `[Ignore]`, `#if false`, or deleting a failing test) | fix the defect the test caught (`dotnet-testing`) |
| Weakened assertion, `[ExcludeFromCodeCoverage]`, or a lowered coverage threshold | fix the code, keep the bar (`dotnet-testing`) |
| `#pragma warning disable`, `<NoWarn>`, or an `.editorconfig` severity downgrade to clear a promoted warning | fix the code, or defer the ID explicitly (above) |
| Empty or exception-swallowing `catch` | handle it or let it propagate (`csharp`) |
| `Task.Delay` / `Thread.Sleep` to mask a race or flaky timing | inject the clock, await the real signal (`csharp`, `dotnet-testing`) |
| Inline `Version=` / `VersionOverride` bypassing central package management, or downgrading a package to dodge a conflict | keep versions central, fix the conflict (`dotnet-project-setup`) |

The build gate above catches the warning-suppression rows automatically; the rest are a review discipline. A check that only notices them after merge has already paid for the slop.
