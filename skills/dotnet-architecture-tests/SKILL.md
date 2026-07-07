---
name: dotnet-architecture-tests
description: "Personal .NET conventions for architecture fitness tests - encoding layer/dependency/naming/isolation rules as tests that fail the build on a violation, so the structure dotnet-architecture prescribes cannot erode silently. Covers NetArchTest.Rules (the lightweight fluent default) versus ArchUnitNET (richer modeling: slices, cycles, custom predicates), the rules worth enforcing (dependency direction, no layer-skipping, slice isolation, naming/placement, no cycles), a dedicated test project resolved by type marker, and actionable failures. Floors at .NET 8 / C# 12. Load when adding or reviewing architecture / fitness tests or enforcing layer/dependency rules, or when the user names NetArchTest, ArchUnitNET, fitness function, architecture test, or dependency rule. Companions: dotnet-testing (the test-suite host), dotnet-architecture (the boundaries enforced), dotnet-code-quality (the analyzer/style counterpart). Do NOT load for runtime behavior tests (dotnet-testing) or analyzer/formatter config (dotnet-code-quality)."
---

# .NET architecture tests - fitness functions

`dotnet-architecture` decides *what* the structure should be (clean, vertical-slice, DDD, modular, microservices); this skill makes a test *prove* it, and fail the build the moment a boundary is crossed. Without that, a layering rule lives only in a diagram and a reviewer's memory, so it erodes silently - one stray `using` at a time - until the next big refactor. This is the enforcement counterpart to those concept skills, exactly as `dotnet-code-quality` enforces the `csharp` style rules. Baseline is .NET 8 / C# 12. This is not behavioral testing (`dotnet-testing`) or analyzer/formatter config (`dotnet-code-quality`).

## Pick the library: NetArchTest by default

Default to **NetArchTest.Rules**: lightweight, fluent, fast, and zero-ceremony - assertions over namespaces, dependencies, and layering that read cleanly in a normal test.

```csharp
[Fact]
public void Domain_depends_on_nothing_outside_itself()
{
    var result = Types.InAssembly(typeof(Order).Assembly)
        .That().ResideInNamespace("Shop.Domain")
        .ShouldNot().HaveDependencyOnAny("Microsoft.EntityFrameworkCore", "Shop.Infrastructure", "Microsoft.AspNetCore")
        .GetResult();

    result.IsSuccessful.Should().BeTrue(
        because: $"domain must stay pure; offenders: {string.Join(", ", result.FailingTypeNames)}");
}
```

Reach for **ArchUnitNET** only when NetArchTest's model is too thin - it offers richer modeling (slice analysis, namespace/assembly cycle detection, custom conditions and predicates) at the cost of a heavier API. Pick one per solution; do not run both.

## The rules worth enforcing

In priority order - start at the top, add lower rows as conventions actually stabilize:

- **Dependency direction** (the highest-value rule). Domain depends on nothing; Application depends on abstractions, not Infrastructure / EF / ASP.NET; the web layer talks to Application, never reaching past it into `DbContext` directly (no layer-skipping). In a layered project these are the layers; in a vertical-slice project they are the parts of a feature - the rule is the same.
- **Slice / module isolation**. A feature namespace must not reference another feature's internals - the property that keeps vertical slices independent.
- **Naming, sealing, placement**. Conventions the team relies on: handlers end in `Handler` and are `sealed`, abstractions live in the abstractions namespace, nothing is `public` that was meant to be `internal`.
- **No cycles** between namespaces or modules.
- **No leftover debug output**. Fail the build when a production assembly depends on `Console.WriteLine`, `Debug.WriteLine`, or `Debugger.Break` - a `ShouldNot().HaveDependencyOn` over those types, so a stray trace statement left in mid-debug can never ship.

## Wire it as a real test

- A **dedicated test project** (e.g. `Architecture.Tests`) referencing the assemblies under test, one test per rule, each named for the rule it guards. It runs inside the normal `dotnet test` / CI pass - it is not a separate manual gate that gets skipped under pressure.
- **Resolve assemblies by a type marker** (`typeof(Order).Assembly`), never by loading an assembly by string name - a rename silently turns a string-named rule into a no-op that passes forever.
- **Make the failure actionable.** Assert on the result *and* surface the offending type names in the message, so a red test names the class that broke the rule instead of just saying `false`.

## Keep them honest

- One rule per test, like any test, so a failure pinpoints the exact violation.
- These are *structural* rules - they complement, never replace, the behavioral tests in `dotnet-testing`.
- Encode only rules the team has actually agreed to. A wall of brittle naming rules nobody signed up for becomes noise people disable - at which point the suite enforces nothing.

## Anti-patterns

- Architecture that lives only in prose and diagrams, enforced by no one - the exact gap this skill closes.
- Resolving assemblies by string name instead of a type marker, so a rename quietly disables the rule.
- A rule test that computes a result but never asserts on it (or discards it) - it passes vacuously; this is the false-confidence smell `dotnet-testing`'s audit hunts for.
- Over-specifying: dozens of fragile naming rules that outpace the team's real conventions, so the architecture suite gets switched off.
- Hiding the rules in a separate manual step instead of the normal test run, so they are skipped exactly when a deadline makes boundaries most likely to slip.
