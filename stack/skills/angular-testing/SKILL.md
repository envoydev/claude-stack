---
name: angular-testing
description: "Angular testing hub - practices and tooling only, no coverage numbers (the % bar is user-set via project-test-coverage-analyzer): TestBed + component-harness patterns for standalone components, a test strategy keyed off role (component / service / store / pipe), runner routing (whichever the workspace already runs - Karma/Jasmine, Jest, or Vitest - detect, never install), HttpTestingController, fakeAsync vs real-async timing, and the Angular exclusion catalog. Ionic/Capacitor apps share it. Load before writing, modifying, or reviewing Angular tests, auditing suite quality, running mutation testing, or configuring Angular coverage - do not rely on recall. Do NOT load for .NET (dotnet-testing) or plain TS/JS outside a framework harness (ts-js-testing)."
---

# Angular Testing

Practices and tooling for Angular tests. This skill sets NO coverage percentage - the % bar is
the user's, owned and recorded by the `project-test-coverage-analyzer` capture; what lives here
is how to write tests worth counting and which code coverage cannot meaningfully claim.

Ionic/Capacitor apps share everything here; their extra layer - testing the native seams (the
plugin's typed wrapper mocked, the web-fallback and permission-denied paths asserted, the honest
jsdom boundary) - lives in the `ionic` skill's 'Testing the native seams' section, and real-device
E2E belongs to the MCP that drives the native mobile shell, not a unit suite - with no such server
registered, report those flows as UNVERIFIED rather than faking them in jsdom.

## Runner routing

Use whichever the workspace already runs - `angular.json` / `package.json` name it (Karma/Jasmine
the long-lived default, Jest or Vitest where configured). Detect, never install or migrate a
runner inside a task; a migration is its own user-approved change. A NEW workspace with no
runner yet reaches for Vitest - Karma is deprecated and Vitest is the CLI default (the
`@angular/build:unit-test` builder; jsdom or happy-dom, browser mode via Playwright when a real
DOM is needed). Mock collaborators with the workspace's runner - `jasmine.createSpyObj` under
Karma, `jest.fn()` under Jest, `vi.fn()` under Vitest - and do not mix them.

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
- **Signals** - read them directly and flush effects with `TestBed.tick()`; wire inputs and
  outputs through `inputBinding()` / `outputBinding()` / `twoWayBinding()` on `createComponent`
  rather than reaching into the instance. Under zoneless, an error thrown in an event listener
  surfaces to the error handler instead of being swallowed - expect some previously-silent
  specs to start failing honestly.

## Timing and async

`fakeAsync` + `tick()` for timer/debounce logic under Karma or Jest (Zone.js - Angular's docs say the fakeAsync family cannot be used under the Vitest runner; there, `vi.useFakeTimers()` + `vi.advanceTimersByTime()`); `await fixture.whenStable()` for real promises;
never a raw `setTimeout` wait in a spec. A spec that passes only with an arbitrary sleep is a
bug in the spec.

## The TestBed-masking trap (house lesson, measured twice)

TestBed provides its own environment, so a broken REAL bootstrap ships with a green suite - a
missing `provideHttpClient()` in `app.config.ts` left the live app dead while every spec passed,
in two independent benchmark runs. The bootstrap config is code: keep one smoke spec that builds
the app from the REAL `appConfig` providers, so a provider missing in production fails a spec,
not the browser:

```ts
it('boots from the real appConfig', () => {
  TestBed.configureTestingModule({ providers: appConfig.providers, imports: [AppComponent] });
  expect(() => TestBed.createComponent(AppComponent)).not.toThrow();
  expect(TestBed.inject(HttpClient)).toBeTruthy(); // dies here if provideHttpClient() is missing
});
```

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
traffic; no assertion-free or coverage-padding specs, no `expect(true)`.

- Cover comparison and boundary logic - date/overdue thresholds, sort direction, off-by-one
  ranges - with a regression test that pins the *direction*, not just that a list renders: a
  task due yesterday is overdue and one due tomorrow is not. An inverted comparison (`>` for
  `<`) passes every 'renders the list' test; only a directional assertion catches it.
- Build fixtures with factory or object-mother helpers so the same literal is not copy-pasted
  across specs.

When reviewing an existing suite (or running mutation testing), load this skill's own
`references/suite-audit.md` - the false-confidence catalog, the assertion-depth and mock-usage
passes, and StrykerJS mutation testing. The catalog:
assertion-free / always-true, coverage-touching, tautological, missing-await,
swallowed-exception, disabled assertions.

## E2E

Select by role, label, or test-id - never a CSS class - and never a fixed `waitForTimeout`:
lean on auto-waiting web-first assertions and `waitForResponse`. Trace retain-on-failure,
retries only in CI, and keep Page Objects assertion-free with locators as lazy getters.
