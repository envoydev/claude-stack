# Auditing an existing test suite

Loaded from `dotnet-testing` when reviewing test quality ('are these tests any good?') or running mutation testing. A test that passes can still prove nothing - scan for the false-confidence anti-patterns first, because they are the ones that read as coverage while verifying nothing.

## False-confidence anti-patterns

- **No assertions / always-true** - runs code but never asserts (no `Assert.*` / `Should` / `Received()`), or asserts a constant (`Assert.True(true)`, `Assert.Equal(x, x)`). A mock verification (`Received()` / `Verify()` / `MustHaveHappened()`) does count as an assertion.
- **Coverage-touching** - a *systematic* sweep calling every public member with no real assertion (or only a null check), to inflate the coverage number. The tell is the surface-area sweep, not a single missing assert.
- **Tautological / self-referential assertion** - asserts an identity round-trip (`Assert.Equal(input, Parse(input.ToString()))`) or a field against itself (`Assert.Equal(dto.Name, dto.Name)`). It can only fail if the round-trip breaks; it never proves a transformation happened.
- **Missing `await` on an async assertion** - an `async Task` test calling `Assert.ThrowsAsync(...)` (or a `.resolves`-style assertion) without `await`; it passes silently even when the assertion would fail.
- **Swallowed exception / assert-only-in-catch** - `try { Act(); } catch { }`, or `catch (Exception ex) { Assert.Fail(ex.Message); }`; both pass when no exception is thrown even if the result is wrong. Use `Assert.Throws` / `Assert.ThrowsAsync`.
- **Commented-out or disabled assertions** - the test still runs and 'passes', giving the illusion of coverage. (This is coverage-gaming; reject it in review - see the reward-hacking list in `dotnet-code-quality`.)

## Two deeper passes

Beyond the catalog: judge **assertion depth** (do the tests verify different facets of correctness, or restate one shallow check), and run a **mock-usage audit** - trace each substitute setup through the production path for that test's inputs and classify it *used* (reached), *unreachable* (a guard/throw/branch skips it), *unused* (production never calls it on any input), or *redundant* (the same setup duplicated across tests instead of shared). Delete unreachable and unused setups; share redundant ones. Mocking stable framework types (`ILogger`, `IOptions<T>`) is usually over-mocking - prefer the real instance.

## Mutation testing - do the tests catch faults

Coverage proves a line *ran*; it does not prove a test would *fail* if that line were wrong. Mutation testing closes that gap: **Stryker.NET** mutates the production code (flips a `>` to `>=`, a `+` to `-`, removes a statement) and reruns the tests - a mutant the suite kills is a fault the tests would catch, a *surviving* mutant is a real blind spot a high coverage number hid.

- **Scope it** - run on critical / high-risk projects, never blindly across the whole solution. It is expensive and amplifies flaky or slow suites, so keep it off the fast PR path and stabilize the suite first.
- Install as a local tool (`dotnet new tool-manifest`; `dotnet tool install dotnet-stryker`) for local-and-CI parity, then `dotnet stryker` on the target project.
- Read the mutation score as a *test-quality* signal interpreted with judgment, not a vanity metric. It complements line/branch coverage (the skill's §Coverage) and the risk hotspots in `dotnet-code-quality` (its `references/crap-analysis.md`) - all three answer different questions.
