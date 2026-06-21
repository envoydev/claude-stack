---
name: dotnet-testing
description: "Personal .NET testing hub - the architecture-neutral approach for unit / integration / E2E tests, not a single library: AAA structure, a test strategy keyed off responsibility that maps onto whatever architecture the project picked (layered, vertical-slice, modular), coverage thresholds computed after exclusions, and library routing (xUnit/NUnit/MSTest, NSubstitute/Moq/FakeItEasy, FluentAssertions/AwesomeAssertions/Shouldly, coverlet). Floors at .NET 8 / C# 12 - TimeProvider plus FakeTimeProvider are the time seam. Load before writing, modifying, or reviewing .NET tests, auditing test quality / smells, running mutation testing, or configuring coverage - do not rely on recall. Companions: csharp (testability, clock, async-returns-Task baseline), dotnet-error-handling (Result/exception shapes under assertion); routes onward to testcontainers-integration-tests, aspire-integration-testing, and snapshot-testing. Do NOT load for Angular/Jasmine/Karma/Jest."
---

# .NET Testing Approach

This skill captures the **approach**, not a single library. The principles below apply regardless of which test runner, substitute library, or assertion library a project picks. Library routing is in §Library choices.

**Floor: .NET 8 / C# 12.** The time seam is `TimeProvider` advanced via `FakeTimeProvider`; only fall back to a hand-rolled `IClock` on a pre-.NET-8 target.

## Test strategy by responsibility (architecture-neutral)

The strategy keys off the *role* a unit plays, not a layer name - so it maps onto whatever architecture the project picked. `dotnet-web-backend` owns the load-exactly-one-architecture rule but mandates no specific one. In a layered (Clean / Onion) project the roles below are the layers; in a vertical-slice / modular project they are the parts of a feature folder (the domain types, the handler / endpoint logic, the infrastructure wiring) - test each part the same way regardless of where it physically lives.

- **Domain / business rules** - pure unit tests, no substitutes. Cover entities, value objects, domain services, domain events, invariants, guard clauses, factory methods, and every branch of a business rule including exception paths. Target ~100%.
- **Use cases / handlers / orchestration** (the application logic of a slice or layer) - unit tests with all ports and abstractions substituted. Cover success paths, validation failures, exception handling, and orchestration branches. Target 95%+.
- **Infrastructure / adapters** - test logic-bearing code only (mappers, parsers, serializers, policy classes, retry/backoff, non-trivial query logic). Use in-memory DB or Testcontainers when query logic is non-trivial. Do not write tests that only assert a substitute was configured.
- **Integration / E2E** - defined per project in project CLAUDE.md.

## Coverage

- Default threshold: 90% line + branch across logic assemblies. Project CLAUDE.md may override.
- Coverage is computed after exclusions so the threshold reflects real logic coverage, not padding.

## Standard exclusions (via `[ExcludeFromCodeCoverage]` or coverlet filters)

- `Program.cs`, `Main`, generic host bootstrap
- DI registration extensions
- Pure DTOs / records / POCOs with no behavior; plain auto-properties
- EF Core migrations and `DbContext.OnModelCreating`
- Generated code and framework configuration

## Test quality rules (framework-agnostic)

- **AAA structure** (Arrange / Act / Assert). One logical behavior per test.
- Every test asserts on **observable behavior or state** - no assertion-free or coverage-padding tests.
- Cover edge cases: nulls, empty / boundary values, cancellation tokens, concurrency where relevant, and every thrown-exception path.
- **Deterministic**: no real time (abstract `DateTime.UtcNow` via a clock; do not call it directly), no real I/O, no network, no `Thread.Sleep`. Seed any randomness. Inject `TimeProvider` - the .NET 8 abstraction (advance it in tests via `FakeTimeProvider`); only fall back to a hand-rolled `IClock` on a pre-.NET-8 floor.
- **Parameterized tests** for branch and boundary matrices instead of duplicated single-case tests.
- **Test naming**: `Do_Something_When_Condition` (PascalCase with underscores) regardless of runner.
- If production code is **untestable** (hidden statics, sealed deps, no seams, hidden side effects), refactor for testability (extract interface, constructor injection) rather than writing a bad test. Flag these explicitly.
- **Substitute behavior, not implementation.** Verify the call your code makes to its collaborator (the boundary), not the internal sequence of calls. Avoid asserting on private methods or implementation details.

## Library choices

Runner, substitute library, and assertion library are project-level decisions. Pick one per category and stay consistent across the test project.

### Test runners

| Runner | When to pick |
|---|---|
| **xUnit** | Default for new projects. `[Fact]` / `[Theory]` + `[InlineData]` / `[MemberData]` / `[ClassData]`. No `[SetUp]` / `[TearDown]` - use constructor + `IDisposable` / `IAsyncLifetime`. Parallel by default. |
| **NUnit** | When the project already uses it, or for parameterized-test ergonomics (`[TestCase]`, `[TestCaseSource]`, `[Values]`, `[ValueSource]`). |
| **MSTest** | When the project ships with it (Visual Studio templates, internal Microsoft tooling). `[TestClass]` / `[TestMethod]` / `[DataRow]` / `[DynamicData]`. |

Do not mix runners in one project. Migrate, don't blend.

### Substitute / mock libraries

| Library | API style | When to pick |
|---|---|---|
| **NSubstitute** | Substitutes (`Substitute.For<T>()`); record/replay-free, terse syntax (`x.M(Arg.Any<int>()).Returns(...)`); strict by default for `Returns`/`Received`. | Default for new projects. Fluent, readable in AAA. |
| **Moq** | Mocks (`new Mock<T>()`); `.Setup(...).Returns(...)`, `.Verify(...)`. Loose by default; `MockBehavior.Strict` opts into strict. | When project already uses Moq, or when tooling/team familiarity argues for it. |
| **FakeItEasy** | Fakes (`A.Fake<T>()`); `A.CallTo(() => fake.M(...)).Returns(...)`, `A.CallTo(...).MustHaveHappened()`. | Project preference; mature alternative with natural English DSL. |

Same project = one substitute library. Don't half-port.

Common rules regardless of library:
- Substitute only what you cannot construct (external services, ports, infrastructure). Prefer real instances for value objects, records, simple aggregates.
- Default to loose / non-strict; only assert calls that are part of the contract under test.
- Do not call `Received()` / `Verify()` / `MustHaveHappened()` on every interaction - verify the boundary that matters, leave the rest implicit.

### Assertion libraries

| Library | When to pick |
|---|---|
| **FluentAssertions 7.x** | Default. Rich diff output, structural equality, async support. Stay on 7.x: v8+ moved to a paid commercial license - upgrading a client project is a licensing decision, not a routine bump. |
| **AwesomeAssertions** | Apache-2.0 community fork taken from FluentAssertions' last Apache-licensed release (v7) and developed forward independently. Drop-in choice when you want a permissive licence and ongoing fixes without FA v8's commercial terms. |
| **Shouldly** | Project preference. Simpler API; good when FA's surface area feels heavy. |
| **xUnit/NUnit/MSTest built-in `Assert`** | When the project has no FA/Shouldly dependency and stays minimal. |

### Coverage

- **coverlet** is the default collector (msbuild or runsettings). Combined with `dotnet test --collect:"XPlat Code Coverage"`.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- Pair with `crap-analysis` skill for CRAP-score risk hotspots.

## Test project conventions

- One test project per production project, mirroring namespace and folder structure.
- Folder layout inside test project mirrors the SUT's folder layout.
- Shared fixtures live in `*.TestSupport` / `*.Testing` projects when reused across multiple test projects; otherwise inline.

## Cancellation, async, time

- Every async path under test that accepts `CancellationToken` gets a cancellation test (token already cancelled, token cancelled mid-flight where realistic).
- Async tests return `Task` / `ValueTask` - never `async void`.
- Time-dependent code uses an injected clock. In tests, advance the clock explicitly; do not `Thread.Sleep` or rely on wall-clock.

## Isolation and shared state

- Tests must pass regardless of order. No reliance on side effects from earlier tests, no mutable static state.
- Per-test fresh fixture by default (xUnit constructor, NUnit `[SetUp]`, MSTest `[TestInitialize]`). Reuse only for expensive resources (Testcontainers, web factory) via `IClassFixture` / `ICollectionFixture` and only when the resource is read-only or reset between tests.
- Database integration tests: each test gets its own transaction or schema, rolled back at teardown. Never assume row IDs.
- Test data via one canonical builder per aggregate, not literal-soup constructors. Prefer a `record` builder with `init` defaults; when the type under test is itself a `record`, derive case variations with a `with` expression from a canonical instance (`var large = baseOrder with { Total = new(1500m, "USD") };`) instead of re-running setup. Use a fluent `OrderBuilder().WithCustomer(...).Build()` only when a setter needs computation or validation.

## What NOT to test

- Auto-properties with no logic.
- Generated code, EF migrations, framework-provided types.
- DI registration extension methods (cover via integration test, not unit test).
- Pure DTOs / records used only as data carriers.
- Other people's libraries - assume `FluentValidation`, `Polly`, `EF Core` work. Test your wiring of them, not them.

## Auditing an existing suite

The rules above are for *writing* tests; this is the *review* lens - when asked "are these tests any good?", a test that passes can still prove nothing. Scan for the false-confidence anti-patterns first, because they are the ones that read as coverage while verifying nothing:

- **No assertions / always-true** - runs code but never asserts (no `Assert.*` / `Should` / `Received()`), or asserts a constant (`Assert.True(true)`, `Assert.Equal(x, x)`). A mock verification (`Received()` / `Verify()` / `MustHaveHappened()`) does count as an assertion.
- **Coverage-touching** - a *systematic* sweep calling every public member with no real assertion (or only a null check), to inflate the coverage number. The tell is the surface-area sweep, not a single missing assert.
- **Tautological / self-referential assertion** - asserts an identity round-trip (`Assert.Equal(input, Parse(input.ToString()))`) or a field against itself (`Assert.Equal(dto.Name, dto.Name)`). It can only fail if the round-trip breaks; it never proves a transformation happened.
- **Missing `await` on an async assertion** - an `async Task` test calling `Assert.ThrowsAsync(...)` (or a `.resolves`-style assertion) without `await`; it passes silently even when the assertion would fail.
- **Swallowed exception / assert-only-in-catch** - `try { Act(); } catch { }`, or `catch (Exception ex) { Assert.Fail(ex.Message); }`; both pass when no exception is thrown even if the result is wrong. Use `Assert.Throws` / `Assert.ThrowsAsync`.
- **Commented-out or disabled assertions** - the test still runs and "passes", giving the illusion of coverage. (This is also what `dotnet-slopwatch` catches in a diff.)

Beyond the catalog, two deeper passes: judge **assertion depth** (do the tests verify different facets of correctness, or restate one shallow check), and run a **mock-usage audit** - trace each substitute setup through the production path for that test's inputs and classify it *used* (reached), *unreachable* (a guard/throw/branch skips it), *unused* (production never calls it on any input), or *redundant* (the same setup duplicated across tests instead of shared). Delete unreachable and unused setups; share redundant ones. Mocking stable framework types (`ILogger`, `IOptions<T>`) is usually over-mocking - prefer the real instance.

## Mutation testing - do the tests catch faults

Coverage proves a line *ran*; it does not prove a test would *fail* if that line were wrong. Mutation testing closes that gap: **Stryker.NET** mutates the production code (flips a `>` to `>=`, a `+` to `-`, removes a statement) and reruns the tests - a mutant the suite kills is a fault the tests would catch, a *surviving* mutant is a real blind spot a high coverage number hid.

- **Scope it** - run on critical / high-risk projects, never blindly across the whole solution. It is expensive and amplifies flaky or slow suites, so keep it off the fast PR path and stabilise the suite first.
- Install as a local tool (`dotnet new tool-manifest`; `dotnet tool install dotnet-stryker`) for local-and-CI parity, then `dotnet stryker` on the target project.
- Read the mutation score as a *test-quality* signal interpreted with judgement, not a vanity metric. It complements line/branch coverage (§Coverage) and `crap-analysis`'s risk hotspots - all three answer different questions.

## Routing

- Snapshot / Verify assertions -> `snapshot-testing`; container-backed integration -> `testcontainers-integration-tests`; Aspire-orchestrated integration / E2E -> `aspire-integration-testing`.
- Performance microbenchmarks -> `microbenchmarking`; crash / hang dump capture -> `dump-collect`; CRAP-score risk hotspots -> `crap-analysis`; reward-hacking / coverage-gaming check before "done" -> `dotnet-slopwatch`.
- Testability refactors, the clock (`TimeProvider` / `IClock`), and async-returns-`Task`-not-`void` are baseline rules owned by `csharp`; exception / Result shapes under test -> `dotnet-error-handling`. Full .NET index: `dotnet`.
