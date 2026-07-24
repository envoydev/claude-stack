---
name: angular-testing
description: "Angular testing hub - practices and tooling only, no coverage numbers (the % bar is user-set via project-test-coverage-analyzer): TestBed + component-harness patterns for standalone components, a test strategy keyed off role (component / service / store / pipe), runner routing (whichever the workspace already runs - Karma/Jasmine, Jest, or Vitest - detect, never install), HttpTestingController, fakeAsync vs real-async timing, and the Angular exclusion catalog. Ionic/Capacitor apps share it. Load before writing, modifying, or reviewing Angular tests, auditing suite quality, or configuring Angular coverage - do not rely on recall. Do NOT load for .NET (dotnet-testing)."
---

# Angular Testing

Practices and tooling for Angular tests. This skill sets NO coverage percentage - the % bar is
the user's, owned and recorded by the `project-test-coverage-analyzer` capture; what lives here
is how to write tests worth counting and which code coverage cannot meaningfully claim.

Ionic/Capacitor apps share everything here; their extra layer - testing the native seams (the
plugin's typed wrapper mocked, the web-fallback and permission-denied paths asserted, the honest
jsdom boundary) - lives in the `ionic` skill's 'Testing the native seams' section, and real-device
E2E is the appium MCP's job, not a unit suite's.

## Runner routing

Use whichever the workspace already runs - `angular.json` / `package.json` name it (Karma/Jasmine
the long-lived default, Jest or Vitest where configured). Detect, never install or migrate a
runner inside a task; a migration is its own user-approved change.

## Test strategy by role

- **Components** - DOM-driven through the fixture (and a harness where one exists): render, poke
  inputs/events, assert rendered output and emitted events - not private fields. Standalone
  components: `TestBed.configureTestingModule({ imports: [TheComponent] })` plus provider
  overrides for its injected services. OnPush: drive change detection explicitly
  (`fixture.detectChanges()` after signal/input changes) rather than loosening the strategy.
- **Services** - plain injection tests; HTTP ones through `provideHttpClientTesting` +
  `HttpTestingController`: assert request shape AND flush both success and error paths -
  `expectOne` leaves no unmatched or unflushed requests (`httpMock.verify()` in afterEach).
- **Signal stores / state services** - through their public methods: call the mutation, assert
  the signal/computed values; never reach into private writable signals from a test.
- **Pipes / directives / guards** - pure pipes as plain functions; directives and guards through
  a minimal host component or `TestBed.runInInjectionContext`.

## Timing and async

`fakeAsync` + `tick()` for timer/debounce logic; `await fixture.whenStable()` for real promises;
never a raw `setTimeout` wait in a spec. A spec that passes only with an arbitrary sleep is a
bug in the spec.

## The TestBed-masking trap (house lesson, measured twice)

TestBed provides its own environment, so a broken REAL bootstrap ships with a green suite - a
missing `provideHttpClient()` in `app.config.ts` left the live app dead while every spec passed,
in two independent benchmark runs. The bootstrap config is code: keep one smoke spec that builds
the app from the REAL `appConfig` providers (`TestBed.configureTestingModule({ providers:
appConfig.providers })` + instantiate the root component), so a provider missing in production
fails a spec, not the browser.

## Coverage

- The % bar is the USER's, owned and recorded by the `project-test-coverage-analyzer` capture -
  this skill sets no number.
- What this skill owns is the mechanics: coverage is computed after exclusions so the number
  reflects real logic coverage, not padding - the catalog below is that list for Angular.

## Standard exclusions

- `main.ts` and bootstrap wiring, `app.config.ts` provider lists (covered by the smoke spec
  above, not by line coverage), environment files
- Route table files that only map paths to components (`*.routes.ts` with no guard/resolver logic)
- Generated code and vendored assets (`dist/`, `.angular/`, generated API clients)
- Barrel files (`index.ts` re-exports)

## Suite quality

Every spec asserts observable behavior - rendered DOM, emitted events, store state, HTTP
traffic; no assertion-free or coverage-padding specs, no `expect(true)`. When reviewing an
existing suite, hunt the same false-confidence catalog as the .NET side (`dotnet-testing`
`references/suite-audit.md` - the lenses are language-neutral): assertion-free, tautological,
missing-await, swallowed-error, disabled assertions.
