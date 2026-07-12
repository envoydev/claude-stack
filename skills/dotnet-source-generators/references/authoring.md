# Authoring a source generator - pipeline mechanics

Loaded from `dotnet-source-generators` when actually writing or reviewing generator code. The non-negotiable rules live in the skill body; this file is the mechanics that satisfy them.

## Project file and packaging

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

## The trigger pipeline

Drive the pipeline from a marker attribute and select nodes with `ForAttributeWithMetadataName`. It is the fast path: Roslyn maintains an index of attribute usages, so the predicate only sees the handful of nodes that actually carry the attribute.

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

Mark the lambdas `static` so they cannot accidentally capture state. Drop to the raw `CreateSyntaxProvider` only when the trigger genuinely is not an attribute.

## Models that keep the cache alive

The pipeline caches each step's output and skips downstream work when the new output `Equals` the cached one, so everything flowing between steps must have correct value equality and be cheap to compare:

- Project into small `record` / `record struct` models holding only primitives, strings, and equatable collections. Records give you structural equality for free.
- Pull the strings and flags you need inside `transform`, then let the symbol go - `Compilation`, `ISymbol`, `SyntaxNode`, and `SyntaxTree` are reference-equal, mutable, and enormous.
- Wrap collections in an equatable type (an `EquatableArray<T>`, or a record holding an `ImmutableArray<T>` with a custom `Equals`) so two structurally-identical models actually compare equal - a plain array field compares by reference and silently breaks caching.

Get this right and an edit elsewhere in the file produces an identical model, the cache hits, and `RegisterSourceOutput` never re-runs. Get it wrong and the generator re-emits on every keystroke - correct output, terrible editor.

## Diagnostics

Validate inside the pipeline and surface every problem as a `Diagnostic` built from a `DiagnosticDescriptor` (stable id, category, severity) with a real `Location` so the squiggle lands on the offending code. Reserve exceptions for genuine bugs in the generator itself.

## Emitting output

- Build source text with raw string literals (`"""..."""`); they keep generated braces and interpolation readable without escape noise.
- Mark every generated type or member `partial` so it composes with the user's own declaration.
- Stamp generated types with `[GeneratedCode("MyGenerator", version)]` and, where it helps, `[ExcludeFromCodeCoverage]`, so analyzers and coverage tools treat the output as machine-written.
- Add the file via `spc.AddSource("SomeType.g.cs", source)` with a stable, collision-free hint name.
- Emit fixed scaffolding (the marker attribute itself, shared base types) through `RegisterPostInitializationOutput`, which runs once and independently of any user input.
