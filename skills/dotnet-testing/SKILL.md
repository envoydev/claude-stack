---
name: dotnet-testing
description: "Personal .NET testing hub - the architecture-neutral approach for unit / integration / E2E tests, not a single library: AAA structure, a test strategy keyed off responsibility, coverage thresholds computed after exclusions, and runner / substitute / assertion library routing (xUnit, NSubstitute, FluentAssertions 7.x as defaults). Floors at .NET 8 / C# 12. Load before writing, modifying, or reviewing .NET tests, auditing test quality / smells, running mutation testing, or configuring coverage - do not rely on recall. Companions: csharp, dotnet-error-handling; Testcontainers, Aspire-orchestrated integration, and Verify/snapshot testing are folded in here as references/. Do NOT load for Angular/Jasmine/Karma/Jest."
---

# .NET Testing Approach

This skill captures the **approach**, not a single library. The principles below apply regardless of which test runner, substitute library, or assertion library a project picks. Library routing is in §Library choices.

**Floor: .NET 8 / C# 12.** Testing classic ASP.NET on .NET Framework 4.8 (in-memory OWIN `TestServer`, `HttpContextBase`) is `references/net-framework-48.md`.

## Test strategy by responsibility (architecture-neutral)

The strategy keys off the *role* a unit plays, not a layer name - so it maps onto whatever architecture the project picked. `dotnet-web-backend` owns the load-exactly-one-architecture rule but mandates no specific one. In a layered (Clean / Onion) project the roles below are the layers; in a vertical-slice / modular project they are the parts of a feature folder (the domain types, the handler / endpoint logic, the infrastructure wiring) - test each part the same way regardless of where it physically lives.

- **Domain / business rules** - pure unit tests, no substitutes. Cover entities, value objects, domain services, domain events, invariants, guard clauses, factory methods, and every branch of a business rule including exception paths. Target ~100%.
- **Use cases / handlers / orchestration** (the application logic of a slice or layer) - unit tests with all ports and abstractions substituted. Cover success paths, validation failures, exception handling, and orchestration branches. Target 95%+.
- **Infrastructure / adapters** - test logic-bearing code only (mappers, parsers, serializers, policy classes, retry/backoff, non-trivial query logic). Use in-memory DB or Testcontainers when query logic is non-trivial (`references/testcontainers.md`). Do not write tests that only assert a substitute was configured.
- **Integration / E2E** - defined per project in project CLAUDE.md. For an Aspire-orchestrated app the harness is `references/aspire-integration-testing.md`.
- **Negative-security paths** - assert the deny paths, not just the happy path: an expired or tampered token returns 401, N failed logins trip 429, and one user reading another's resource id returns 404. Explicit negative-security tests belong in the integration suite, not just the auth unit tests.

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
- **Deterministic**: no real time - the clock seam (inject `TimeProvider`, never call `DateTime.UtcNow` directly) is `csharp`'s baseline rule; the test side is advancing that seam explicitly with `FakeTimeProvider` instead of waiting on the wall clock. No real I/O, no network, no `Thread.Sleep`. Seed any randomness.
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
| **NSubstitute** | Substitutes (`Substitute.For<T>()`); record/replay-free, terse syntax (`x.M(Arg.Any<int>()).Returns(...)`); loose by default - unconfigured members return defaults; `Received()` throws only when an expected call was not made. | Default for new projects. Fluent, readable in AAA. |
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
| **AwesomeAssertions** | Apache-2.0 community fork taken from FluentAssertions' last Apache-licensed release (v7) and developed forward independently. Drop-in choice when you want a permissive license and ongoing fixes without FA v8's commercial terms. |
| **Shouldly** | Project preference. Simpler API; good when FA's surface area feels heavy. |
| **xUnit/NUnit/MSTest built-in `Assert`** | When the project has no FA/Shouldly dependency and stays minimal. |

Snapshot / Verify assertions - approving serialized output instead of hand-written asserts - are `references/snapshot-testing.md`.

### Coverage

- **coverlet** is the default collector (msbuild or runsettings). Combined with `dotnet test --collect:"XPlat Code Coverage"`.
- Reports via `ReportGenerator` for HTML / Cobertura / OpenCover formats.
- Pair with `dotnet-code-quality`'s `references/crap-analysis.md` for CRAP-score risk hotspots.

## Test project conventions

- One test project per production project, mirroring namespace and folder structure.
- Folder layout inside test project mirrors the SUT's folder layout.
- Shared fixtures live in `*.TestSupport` / `*.Testing` projects when reused across multiple test projects; otherwise inline.
- Run the suite at minimal verbosity so the captured output stays lean: `dotnet test -v minimal` (or `--logger "console;verbosity=minimal"`), and read a failure by windowing to the first error / failed assertion, not the whole log - test output is context every seat that runs the gate pays for.

## Cancellation and async

- Every async path under test that accepts `CancellationToken` gets a cancellation test (token already cancelled, token cancelled mid-flight where realistic).
- Async tests return `Task` / `ValueTask` - never `async void`.

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

The rules above are for *writing* tests; reviewing an existing suite is its own lens - a test that passes can still prove nothing. When asked 'are these tests any good?' (or to run mutation testing), load `references/suite-audit.md`: the false-confidence catalog to scan first (assertion-free / always-true, coverage-touching, tautological, missing-await, swallowed-exception, disabled assertions), the assertion-depth and mock-usage passes, and Stryker.NET mutation testing.

## Routing (cross-skill)

- Performance microbenchmarks -> `dotnet-diagnostics` (its `references/microbenchmarking.md`); crash / hang dump capture -> `dotnet-diagnostics` (its `references/dumps.md`).
- Reward-hacking / coverage-gaming check before 'done' -> `dotnet-code-quality`; CRAP-score risk hotspots -> its `references/crap-analysis.md` (paired at §Coverage above).
- Testability refactors, the clock seam, and async-returns-`Task`-not-`void` are baseline rules owned by `csharp`; exception / Result shapes under assertion -> `dotnet-error-handling`. Full .NET index: `dotnet`.
