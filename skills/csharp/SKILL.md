---
name: csharp
description: Personal C# conventions - style/structure (file layout, naming, member/ctor ordering, methods, types, visibility, design-pattern (GoF) awareness, modern C# 11/12/13 syntax, forbidden patterns, XML doc) and runtime behavior (DateTime/IClock, async, dispose, exceptions + Result, structured logging, secrets/config, LINQ, System.Text.Json, decoupling + DI lifetimes). Load before creating or editing any `.cs` file - writing, reviewing, or refactoring C#; do not lean on recalled conventions.
---

# C# Conventions

Personal C# style, structure, and runtime conventions in one place: how code is shaped (naming, layout, syntax) and how it behaves (async, I/O, exceptions, logging, DI). Style is enforced by `.editorconfig` (Allman braces, 120-char line limit, file-scoped namespaces) and `EnforceCodeStyleInBuild=true`.

**Floor: .NET 8 / C# 12.** Every rule below assumes at least this target - `TimeProvider`, `UnsafeAccessorAttribute`, the static argument throw-helpers, and the C# 12 collection expressions / primary constructors are all in. Where a convention names a newer feature (C# 13 `System.Threading.Lock`, the `field` keyword), it flags the version inline; treat those as opt-in once the project's target moves up.

Specialized concerns route through the `dotnet` router - one table mapping each area (concurrency, performance / memory layout, design patterns, serialization, DI registration, config binding, DDD, architecture, packaging) to its focused skill. Load the skill the router names; this file stays the style and runtime baseline only.

---

# Style and Structure

## File structure
- Max 300 lines per file. Split by extracting cohesive groups of methods into new classes.
- Max 120 chars per line in `.cs` files. Count visible characters before committing. Markdown, JSON, config files exempt.
- Partial classes only for generated code (EF migrations, designer files) or extending a generated class.
- One top-level type per file. File name must match the type name exactly.
- File-scoped namespaces: `namespace MyApp.Services;` - never the braced form.

## Naming
- `_camelCase` for private instance fields and `private static readonly` fields.
- `PascalCase` for public members, types, events, and every `const` regardless of accessibility. A `private const` is `PascalCase`; a `const` inside a method body is also `PascalCase`.
- `camelCase` for non-`const` local variables and method parameters.
- Prefix interfaces with `I`: `IOrderService`, not `OrderService`.
- Suffix async methods with `Async`: `GetOrderAsync`.
- No abbreviations unless universally accepted (`Id`, `Dto`, `Url`, `Http`).
- Boolean members read as a statement: `isReady`, `hasItems`, `canExecute` - not `flag`, `status`, `enabled`.

**Naming intent - apply four tests to every name:**
1. **Domain-aligned** - use vocabulary from the project domain. Avoid `Manager`, `Helper`, `Data`, `Info`, `Item`, or vague verbs like `Process` / `Handle` when a domain-specific term exists.
2. **Intent-revealing** - the name explains what the member does without reading the implementation.
3. **DDD-consistent** - value objects model concepts, not primitives. Don't suffix entity types with `Entity` or `Aggregate`. Do suffix repositories and services.
4. **Free of misleading names** - a method named `Save` must persist; a `Validate` method must not also mutate state.

## Class member ordering

Enforced by `.editorconfig`. Order: private constants/statics, private readonly, private fields, protected/public properties, constructors, public/protected/private methods. Public properties before the constructor.

## Constructor parameter ordering

Private readonly fields, constructor parameters, and constructor body assignments must follow the same order. Primary constructor parameter lists follow the same group order.

**Group order:**
1. `ILogger` / `ILogger<T>` - always first.
2. Other interfaces.
3. Classes (including sealed records, delegates such as `Func<>`, concrete service types).
4. Structs (value types).

Within each group, order by scope, broadest first. Required before optional - all defaulted params trail required ones.

## Blank lines

Enforced by `.editorconfig` / formatter. The non-mechanical rule: one blank line before control-transfer statements (`return`, `throw`, `break`, etc.) when preceded by another statement - so the exit visually separates from preceding logic.

## Methods
- Max 20 lines per method body. Refactor if exceeded.
- Max 3 parameters. Use a parameter object (record or class) for more.
- Methods do one thing. If 'and' appears in a method name, split it.
- No `out` or `ref` parameters - return a tuple or result object instead.
- Every `switch` case body wrapped in its own `{ }` block - even when one statement, even when no variable is declared. Brace any half-braced switch you edit. Example:

```csharp
switch (x)
{
    case A:
    {
        DoA();

        break;
    }
    case B:
    {
        var y = Compute();
        Use(y);

        return;
    }
    default:
    {
        return;
    }
}
```

Per-case braces give each case its own scope (no accidental variable leak); blank line before `break` / `return` when preceded by another statement; no blank line when the transfer is the only statement after `{` (the `default` above).

## Types and variables
- Use `var` only when the type is obvious from the right-hand side: `var order = new Order();` OK; `var result = GetResult();` not OK.
- Nullable reference types enabled project-wide; treat nullable warnings as errors.
- Prefer `record` for immutable DTOs, value-like data, and types defined by their values. Prefer `class` when the type has identity, mutable state, inheritance, or behavior beyond data.
- Value objects: model as small immutable types - typically `readonly record struct` - validate in the constructor (trust everywhere after), and expose explicit conversions / factory methods only, never an `implicit operator` (it silently defeats the type safety it exists to provide). Add a `TypeConverter` when the value object must bind from configuration.
- Member signatures expose the narrowest useful shape: accept `IEnumerable<T>` / `IReadOnlyCollection<T>` / `IReadOnlyList<T>` (or `ReadOnlySpan<T>` on hot paths), and return a read-only collection type (`IReadOnlyList<T>`, `IReadOnlyDictionary<,>`); return a `List<T>` / array only when the caller is meant to mutate it.
- No magic numbers or magic strings - use named constants or enums.
- Enums: explicit underlying values for any enum persisted to a database or sent over the wire. Use `[Flags]` only when bitwise combination is intended.
- Expression-bodied members only for single-expression getters and trivial methods.
- No public mutable fields - use properties.
- String comparison: always specify `StringComparison.Ordinal` for non-linguistic comparisons (identifiers, keys, file paths), `StringComparison.OrdinalIgnoreCase` for case-insensitive. Never rely on culture-default comparison.

## Visibility and sealing
- Default to the lowest visibility that works: `private` for class members, `internal` for assembly-scoped types, `public` only for cross-assembly API.
- Mark new classes `sealed` unless inheritance is part of the design. Sealed classes enable JIT devirtualization and signal intent.
- Mark methods `virtual` or `abstract` only when overriding is genuinely required. Prefer composition over inheritance.
- Static classes only for pure utilities (no state, no I/O, no DI dependencies). For anything else, use a regular class with DI.
- Static fields only for true constants or thread-safe caches. Mutable static state is forbidden.

## Design patterns (GoF awareness)
- Know the Gang of Four patterns, but reach for the framework-native construct before hand-rolling one: the DI container is your Factory / Abstract Factory / Singleton; `Func<T>` and `Lazy<T>` cover deferred creation; events, `IObservable<T>`, or an in-process event bus are your Observer; `IEnumerable<T>` + `yield` is your Iterator; a switch expression usually beats a State / Strategy class hierarchy.
- Prefer composition: model Strategy as an injected interface (`IStrategy`), not a base class with `virtual` hooks. Template Method (a sealed algorithm on a base type with `protected abstract` steps) is the rare case where inheritance earns its place - use it only when subclasses fill fixed steps of an invariant flow.
- Add a pattern only when the variation it absorbs already exists. A method, a `delegate`, or a small `record` beats a five-class Visitor for a simple problem; forcing a catalog pattern to look 'enterprise' is a smell.
- Don't name a type after its pattern unless the pattern is the point: `OrderFactory` only when it truly manufactures, never `OrderStrategyManager`. Pattern nouns must not crowd out domain vocabulary (see Naming intent).
- This section is the awareness baseline only. To choose, implement, compare, or refactor toward a specific pattern, load `csharp-design-patterns` - full 23-pattern catalog with modern .NET forms, selection table, and anti-pattern checks.

## Modern C# syntax preferences (11+/12+/13)
- **Primary constructors** - default for constructor injection and simple parameter capture: `public sealed class OrderService(IOrderRepository repository, ILogger<OrderService> logger)`. Reference captured parameters directly (`camelCase`, no underscore); do not mirror them into `_fields` unless the value is transformed first or needs `readonly` protection on a mutation-prone type. Fall back to an explicit ctor when construction has logic (guard clauses beyond `?? throw`, validation, multiple constructors, conditional base calls).
- **Collection expressions `[a, b, c]`, spread `[..first, last]`** - default for literal construction. Use `new List<T>()` only when items are added conditionally. Do not write `new[] { ... }` in new code.
- **`params ReadOnlySpan<T>`** - default for new internal APIs (zero-alloc). Use `params T[]` only when the caller already owns an array.
- **Raw strings `"""..."""` / `$$"""..."""`** - use for multi-line literals and for any string containing `"`. Drop `@"..."` for new code unless single-line and short.
- **`required` members** (C# 11) - use for properties that must be set during initialization but cannot be enforced by a constructor (e.g. records or DTOs with many properties).
- **`field` keyword in accessors** (preview in C# 13, stable in C# 14) - allowed only for trivial guards. Anything richer keeps an explicit backing field.
- **`System.Threading.Lock`** (C# 13) - use for new lock objects. Do not retrofit existing `lock(object)` sites.
- **Switch expression vs switch statement** - prefer switch expression for value-returning code. Use switch statement only when arms have side effects (DI registration, channel writes, logging).

Performance concerns (sealing, readonly structs, `Span<T>` / `Memory<T>` / `ArrayPool<T>`, collection choice) belong with the `type-design-performance` skill.

## Forbidden patterns
- No `#region` blocks.
- No `using static` for non-utility classes.
- No commented-out code - delete it.
- No `TODO` without an associated ticket reference.
- No reflection in business or hot-path code; use source generators or compile-time alternatives. No object-mapping libraries (AutoMapper / Mapster / ExpressMapper) - write explicit mapping methods (compile-time checked, debuggable, refactor-safe). Reflection is acceptable only in serialization, the DI container, ORM / EF, test infrastructure, or one-time bootstrap - never for DTO / domain mapping. When you must reach a private member (serializer, test helper), use `UnsafeAccessorAttribute` (.NET 8), not `System.Reflection`.

When a convention here drives a package change - adding, removing, or swapping one (e.g. dropping a banned mapper, replacing Newtonsoft with System.Text.Json) - the install itself follows `package-management`: use the `dotnet` CLI, never hand-edit `Directory.Packages.props`.
- No `dynamic` - use `object` + pattern matching or a typed interface.
- No top-level statements outside `Program.cs`.

## Documentation
- Every public API surface has XML doc comments covering parameters, return values, thrown exceptions, and remarks for non-obvious behavior.

---

# Runtime and Behavior

Behavior, I/O, and composition rules.

## DateTime and timezones
- Store and pass `DateTimeOffset`, not `DateTime`, for any value crossing process or DB boundaries.
- All persisted timestamps in UTC. Convert to local only at the presentation boundary.
- Never call `DateTime.Now` or `DateTime.UtcNow` directly in business logic. Inject an `IClock` / `ISystemClock` abstraction (or `TimeProvider` on .NET 8+).
- Never call `DateTime.Now` for measurements - use `Stopwatch`.

## Async
- Async all the way. No `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` in async code paths.
- Return `Task`, not `void`, for async methods (except event handlers).
- Always pass and forward `CancellationToken` for I/O-bound or long-running operations.
- No `async void` except event handlers; mark those clearly.
- Use `ConfigureAwait(false)` in library code; ignore it in ASP.NET Core application code (no sync context).
- Use `ValueTask` / `ValueTask<T>` only on hot paths where synchronous completion is common and benchmarks show allocation pressure. Default to `Task`.
- Return `IAsyncEnumerable<T>` for streaming results (paged DB reads, long-running enumerations). Annotate the `CancellationToken` parameter with `[EnumeratorCancellation]`.

## Dispose pattern
- Use `using` declarations (`using var x = ...;`) over `using` blocks where scope allows.
- Implement `IAsyncDisposable` for types holding async resources. Implement both `IDisposable` and `IAsyncDisposable` when both sync and async disposal paths are realistic.
- Never call `Dispose()` on injected dependencies - the DI container owns their lifetime.
- Use the full Dispose pattern (`protected virtual Dispose(bool disposing)`) only for unmanaged resources or when inheritance is in play. Otherwise a simple `Dispose()` is enough.

## Exception handling and Result pattern
- Distinguish expected outcomes from exceptional failures. Validation, not-found, and business-rule failures are expected - return a result type rather than throwing. Prefer a domain-specific result (a sealed record with `Success` / `Failed` factory methods and an error-code enum, e.g. `CreateOrderResult`) over a generic `Result<T>` / `OneOf<,>` when the operation's failure modes are known.
- Exceptions for unexpected failures only (I/O errors, programming errors, contract violations).
- Catch specific exceptions; never bare `catch (Exception)` in business logic unless logging and re-throwing.
- Do not use exceptions for control flow.
- Re-throw with `throw;` not `throw ex;` (preserves stack trace).
- Validate arguments at the top of public methods. Prefer the static throw-helpers over hand-written guards: `ArgumentNullException.ThrowIfNull(x)`, `ArgumentException.ThrowIfNullOrWhiteSpace(s)`, `ArgumentOutOfRangeException.ThrowIfNegative` / `ThrowIfGreaterThan(...)` (.NET 8).
- Mapping a Result to an HTTP response and the `ProblemDetails` contract are the web surface - route via `dotnet` to `dotnet-error-handling`; don't shape HTTP errors in business code.

## Logging
- Structured logging via `ILogger<T>`. Use templates with named placeholders: `_logger.LogInformation('Order {OrderId} placed for {UserId}', orderId, userId)`. Never use string interpolation in log calls.
- Log levels: `Trace` (diagnostic noise), `Debug` (dev), `Information` (business events), `Warning` (recoverable issue), `Error` (operation failed), `Critical` (system unusable).
- Log exceptions with the exception object as the first arg: `_logger.LogError(ex, 'Failed to {Action}', actionName)`. Never `.ToString()` an exception into the message.
- Never log: passwords, tokens, secrets, full payment data, PII beyond what is operationally needed. For healthcare and e-commerce projects, treat full identifiers as PII.
- One log statement per logical event. Avoid log spam in tight loops.

## Secrets and configuration sources
- Where secrets live (dev vs prod placement) is owned by `dotnet-security`; reach for it rather than restating the rule here.
- Configuration layering: `appsettings.json` (defaults) -> `appsettings.{Environment}.json` -> environment variables -> command-line args. Later layers override earlier.
- Hashing / encryption primitives route via `dotnet` to `dotnet-cryptography`; the secret-leak / OWASP hardening boundary is `dotnet-security`.

Typed options binding (`IOptions<T>` / `IOptionsSnapshot<T>` / `IOptionsMonitor<T>`) and startup validation (`ValidateOnStart`, `IValidateOptions<T>`, data-annotation validation) live in `microsoft-extensions-configuration` - consult it for those, do not restate here.

## LINQ
- Method syntax (`Where`, `Select`, `GroupBy`), not query syntax, unless query syntax is materially clearer (e.g. multi-join queries).
- No more than 4-5 chained operators without an intermediate variable with a descriptive name.
- Materialize queries (`ToList`, `ToArray`) before returning from a method that owns the DbContext or connection lifetime.

## JSON serialization
- `System.Text.Json` is the default. Newtonsoft.Json only for legacy compatibility or features missing from STJ (e.g. polymorphic serialization in older runtimes).
- Configure `JsonSerializerOptions` once and reuse - never construct per call.
- Naming policy: `JsonNamingPolicy.CamelCase` for external APIs unless a contract requires otherwise.
- Use source-generated `JsonSerializerContext` for hot paths and AOT compatibility.
- Never deserialize untrusted JSON without size and depth limits.

## Decoupling and DI lifetimes
- Never call `new` on service-layer or infrastructure types inside a class body - use factories or DI.
- No circular dependencies between namespaces.
- Never inject a shorter-lifetime service into a longer-lifetime one (captive dependency). Use `IServiceScopeFactory` or a `Func<T>` factory for cross-lifetime access.
