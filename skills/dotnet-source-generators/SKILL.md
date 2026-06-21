---
name: dotnet-source-generators
description: "Personal Roslyn source-generator conventions, both sides of the line - reaching first for the framework generators that exist (GeneratedRegex, LoggerMessage, the System.Text.Json context) and authoring your own only when none fits. Authoring rules: IIncrementalGenerator always, package as a netstandard2.0 analyzer, trigger with ForAttributeWithMetadataName, carry value-equatable record models so the incremental cache holds, report a Diagnostic instead of throwing, emit via raw string literals, snapshot-test the output. Floors at .NET 8 / C# 12. Load when writing or reviewing a generator, or weighing compile-time codegen against reflection. Companions: csharp for the generator's language style, dotnet-testing for test setup. Do NOT load for ordinary code that ships no generator."
---

# .NET source generators

A source generator is a compiler plugin: it runs during the build, reads the code being compiled, and adds *new* C# to that same compilation. It cannot mutate what you wrote - it only appends partial members, new types, or attributes. The payoff is moving work that would otherwise happen with runtime reflection (or by hand) to compile time, where it is faster, AOT-safe, and visible to the IDE. Baseline is .NET 8 / C# 12; the generator's own language conventions follow `csharp`.

## First question: does a framework generator already do this?

Most teams never need to write a generator. The .NET BCL ships several, and each replaces a reflection-heavy pattern with generated, trim-friendly code. Reach for these before authoring anything:

- **`[GeneratedRegex]`** - a `partial` method returning `Regex`, compiled at build time. Use it over `new Regex(pattern)` for any pattern that lives in source. The generated `Regex` skips the interpreter and the static-cache lookup, and the pattern is validated at build, not on first call.
- **`[LoggerMessage]`** - a `partial` logging method that emits the `ILogger` call with zero boxing and no message-template parsing at runtime. Use it for hot or structured log paths instead of `logger.LogInformation("...", a, b)`.
- **The `System.Text.Json` context** - a `partial class : JsonSerializerContext` annotated with `[JsonSerializable(typeof(T))]`, passed to serialize/deserialize. This removes the reflection metadata walk and is what makes JSON work under Native AOT and trimming.

These are configuration, not engineering. Add the attribute, mark the member or type `partial`, and the compiler fills in the body. Write a custom generator only when no built-in covers the shape you need.

## Authoring: the non-negotiable foundation

If you do author one, the rules below are not stylistic - violating them produces a generator that is slow in the IDE, breaks in CI, or silently caches stale output.

### Implement `IIncrementalGenerator`, never `ISourceGenerator`

The legacy `ISourceGenerator` re-runs whole-hog on every keystroke and has been effectively deprecated since the incremental API arrived. `IIncrementalGenerator` models the work as a pipeline of cached steps: a node only re-executes when its specific input changed. In a large solution that is the difference between a responsive editor and one that stutters on every edit. There is no reason to write a new `ISourceGenerator`.

### Package it as a `netstandard2.0` analyzer

The generator assembly is loaded into the compiler, so it must target `netstandard2.0` (what Roslyn runs on) regardless of what the consuming project targets. The project file:

```xml
<PropertyGroup>
  <TargetFramework>netstandard2.0</TargetFramework>
  <LangVersion>latest</LangVersion>
  <Nullable>enable</Nullable>
  <IsRoslynComponent>true</IsRoslynComponent>
  <EnforceExtendedAnalyzerRules>true</EnforceExtendedAnalyzerRules>
</PropertyGroup>

<ItemGroup>
  <PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="..." PrivateAssets="all" />
</ItemGroup>
```

`LangVersion=latest` lets the generator's own code use modern C# even though it targets the old TFM. `PrivateAssets=all` keeps the Roslyn dependency out of consumers' transitive graph. When packing for NuGet, the analyzer DLL goes under `analyzers/dotnet/cs`, not `lib`. A project consuming the generator from source references it with `OutputItemType="Analyzer" ReferenceOutputAssembly="false"`.

### Trigger with `ForAttributeWithMetadataName`

Drive the pipeline from a marker attribute and select nodes with `ForAttributeWithMetadataName`. It is the fast path: Roslyn maintains an index of attribute usages, so the predicate only sees the handful of nodes that actually carry the attribute, instead of you filtering every `SyntaxNode` in the compilation.

```csharp
[Generator]
public sealed class MyGenerator : IIncrementalGenerator
{
    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        IncrementalValuesProvider<Model> models = context.SyntaxProvider
            .ForAttributeWithMetadataName(
                "MyLib.MyMarkerAttribute",
                predicate: static (node, _) => node is ClassDeclarationSyntax,
                transform: static (ctx, ct) => Extract(ctx));

        context.RegisterSourceOutput(models, static (spc, model) => Emit(spc, model));
    }
}
```

Mark the lambdas `static` so they cannot accidentally capture state. Drop the raw `CreateSyntaxProvider` only when the trigger genuinely is not an attribute.

### Carry value-equatable models through the pipeline

This is the rule that decides whether incremental caching works at all. The pipeline caches each step's output and skips downstream work when the new output `Equals` the cached one. So everything you flow between steps must have correct value equality and must be cheap to compare.

- Project into small `record` / `record struct` models holding only primitives, strings, and equatable collections. Records give you structural equality for free.
- Never let `Compilation`, `ISymbol`, `SyntaxNode`, or `SyntaxTree` past the `transform` step. They are reference-equal, mutable, and enormous - holding one defeats caching and pins compiler memory across edits. Pull the strings and flags you need inside `transform`, then let the symbol go.
- A plain array as a record field breaks this, because arrays compare by reference. Wrap collections in an equatable type (an `EquatableArray<T>`, or a record holding an `ImmutableArray<T>` with a custom `Equals`) so two structurally-identical models actually compare equal.

Get this right and an edit elsewhere in the file produces an identical model, the cache hits, and `RegisterSourceOutput` never re-runs. Get it wrong and the generator re-emits on every keystroke - correct output, terrible editor.

### Report diagnostics; do not throw

A generator that throws crashes the generation pass and surfaces as an opaque build warning - awful to diagnose. Validate inside the pipeline and surface every problem as a `Diagnostic` built from a `DiagnosticDescriptor` (stable id, category, severity) with a real `Location` so the squiggle lands on the offending code. Reserve exceptions for genuine bugs in the generator itself, the same throw-vs-report split `csharp` draws for application code.

### Emit clean, attributable output

- Build source text with raw string literals (`"""..."""`); they keep generated braces and interpolation readable without escape noise.
- Mark every generated type or member `partial` so it composes with the user's own declaration.
- Stamp generated types with `[GeneratedCode("MyGenerator", version)]` and, where it helps, `[ExcludeFromCodeCoverage]`, so analyzers and coverage tools treat the output as machine-written.
- Add the file via `spc.AddSource("SomeType.g.cs", source)` with a stable, collision-free hint name.
- Emit fixed scaffolding (the marker attribute itself, shared base types) through `RegisterPostInitializationOutput`, which runs once and independently of any user input.

## Testing

Snapshot-test the generator: it is the only way to see exactly what it emits and to catch drift. Run it over a known input with `CSharpGeneratorDriver`, then verify both the generated sources and the reported diagnostics - Verify.SourceGenerators makes the result a reviewable `.verified.cs` file that fails the test on any change. Assert diagnostics explicitly, including the case where the generator should stay silent. The broader test-project setup is `dotnet-testing`.

## Anti-patterns

- Authoring a generator for something `[GeneratedRegex]`, `[LoggerMessage]`, or the JSON context already produces.
- Writing a new `ISourceGenerator`.
- Flowing `Compilation`, `ISymbol`, or `SyntaxNode` down the pipeline - it kills the incremental cache.
- A record model with a bare array field, which compares by reference and silently breaks caching.
- Throwing from a generator instead of reporting a `Diagnostic` with a `Location`.
- Filtering every `SyntaxNode` by hand where `ForAttributeWithMetadataName` would do.
