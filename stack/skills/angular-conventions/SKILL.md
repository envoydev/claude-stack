---
name: angular-conventions
description: "Angular conventions from v17 up - standalone everything, signals as the default state primitive, OnPush and zoneless, block control flow, signal inputs and outputs, deferred loading, RxJS only where streams earn it, forms, routing, SSR and hydration, accessibility, harness testing, banned patterns, reward-hacking shortcuts to reject. Load when creating or editing a component, service, directive, or template; refactoring to signals; or reviewing Angular code. Companions: typescript, angular-material, angular-styling, angular-security, frontend, mobile. Not for React, Vue, Svelte, Solid, plain DOM, or non-Angular TypeScript."
---

# Angular conventions

These are house rules for Angular, floored at v17 and reaching forward to whatever the workspace is actually on (v20, v21, v22). When a newer idiom exists, prefer it - but only adopt one the installed version ships. The language underneath (strict TypeScript, type modeling, modules, async, error handling, lint and format) is owned by `typescript`; load it next to this skill and assume everything here is purely Angular. Material components and the CDK are `angular-material`; the broader web index is `frontend`; Ionic and Capacitor are `mobile`. This file is opinion, not reference: it states the choices the team has settled on and the divergences kept on purpose. For any API surface not pinned down here, reach for the Angular CLI MCP or angular.dev rather than memory. Version specifics live in per-version delta files - load only the one your workspace is on: `references/v22.md`, `v21.md`, `v20.md`, or `v19.md` (fact-checked against angular.dev). Each states what is stable versus still experimental in that version, its version-specific API spellings and deprecations, and its Node.js/TypeScript requirement; the rest of this file applies across all of v19-v22.

**The enforceable config and the v20+ file-naming rules live in `references/angular-style.md`** - the angular-eslint + Prettier flat config, the drop-suffix file names, and modern-vs-legacy examples. Above these general conventions, a project's own config (`eslint.config.js`, `angular.json`, `.prettierrc`, `.editorconfig`) and its `<docs-path>/PROJECT-CODE-STYLE.md` are higher priority: follow the project where it diverges.

## Standalone is the only module model
- Every component, directive, and pipe is `standalone` - the implicit default from v19, declared explicitly before that. `NgModule` does not appear in new code; the bootstrap is `bootstrapApplication` with an `ApplicationConfig`.
- A component pulls in exactly what its template uses via `imports`. No grab-bag shared module re-exporting half the framework.
- File names follow the v20 style guide: **drop the type suffix** for components, directives, services, and pipes. `OrderList` lives in `order-list.ts` (not `order-list.component.ts`), with `order-list.html` / `order-list.css` sharing the base name; guards, resolvers, interceptors, and modules keep a role word on the class but hyphenate the file (`auth-guard.ts`, not `auth.guard.ts`). v19 and earlier keep the classic `.component`/`.service` suffix, so a workspace on v19 stays on it and `ng update` preserves suffix generation - migrate organically, do not mass-rename. Full naming table in `references/angular-style.md`.
- One responsibility per file. Template and styles live beside the class in the same folder; inline them only for genuinely trivial components. How those styles are scoped and architected - `ViewEncapsulation`, `:host`, design tokens, responsive, a11y styling - is `angular-styling`.
- Selectors are kebab-case with the project prefix - `app-order-list`, never a bare `order-list` that risks colliding with a third-party tag.
- Keep the container-versus-presentational split honest: containers own data fetching and state, presentational components take inputs and emit outputs and hold no service of their own.

## Signals are the default state primitive
- Local component state is a `signal`; anything derived is a `computed`; side effects that must react to state run in an `effect`. Reach for this before any other mechanism in new code.
- Any state a `computed` or an `effect` reads must itself be a `signal`. A plain class property that feeds a derived value is the reactivity bug to hunt: the `computed` reads it once at creation and never recomputes when the property later changes, so a filter/derived view silently stops updating until some unrelated change happens to trigger change detection. If a `computed` depends on it, it is a `signal` - no exceptions; a filter field, a selected id, a search term that narrows a list all qualify.

```ts
// BUG - plain field: the computed never recomputes when filter changes
filter = '';
readonly visible = computed(() => this.items().filter((i) => i.name.includes(this.filter)));

// FIX - anything a computed reads is itself a signal
readonly filter = signal('');
readonly visible = computed(() => this.items().filter((i) => i.name.includes(this.filter())));
```
- `linkedSignal` (v19+) is writable state derived from a source that should reset when the source moves. Use its `source` and `computation` object form when a user's selection must survive a source change as long as it stays valid.
- `resource` and `rxResource` (v19+) lift async work into signals: give them a `params` signal and a `loader` that respects its `abortSignal`, then read `value()`, `hasValue()`, and `status()` instead of hand-managing loading and error booleans.
- Treat stores (NgRx, NGXS, or a signal-based store) as a last resort, reserved for state that truly spans many unrelated features. Most state is local and stays in component signals.

## State management: which tier, and when a store is warranted
The default is the smallest thing that holds the state, escalating only when the current tier stops fitting. The rule is one line: local signal -> signal service -> SignalStore -> full NgRx. Climb a tier only when the one below cannot express the need, never to look enterprise. What each tier is for - the plain signal-service shape, the @ngrx/signals SignalStore composition, and the narrow case where classic NgRx still earns its ceremony - is `references/state-tiers.md`; load it when shared state outgrows a local signal.

## Server state is not client state
Data that lives on the server (a fetched list, a record by id) is a cache of something you do not own - do not copy it into a signal service or a store and then babysit it. Keep it in a dedicated async read primitive and let that own loading, error, and freshness. Mirroring it into client state is the bug this section exists to prevent: two sources of truth that drift.
- **Hand-rolled `resource` / `rxResource` / `httpResource`** for declarative reads. `httpResource` is the lean default - `httpResource(() => \`/api/order/${id()}\`)` re-fetches when the signal moves, cancels the in-flight request, and exposes `value()`, `hasValue()`, `isLoading()`, and `error()` as signals, killing the manual loading/error booleans. Use `resource` for non-HTTP async and `rxResource` when the loader is an Observable. The family's experimental-vs-stable status and its API renames shift across v19-v22 - check your version's delta file under `references/` before leaning on them, and version-tag any snippet.
- These primitives are per-instance reactive fetching with no cross-instance cache (the only built-in sharing is SSR `TransferState` via an `id`). So they fit a screen that reads its own data and discards it. When several views must share one server cache, you hand-roll dedup and a shared signal cache - and once you are writing background refetch, staleness, and cross-view invalidation by hand, the library has earned its place.
- **@tanstack/angular-query** (the angular-query adapter, `injectQuery` / `injectMutation`) for a real server-cache: request dedup, background refetch, window-focus revalidation, garbage collection, and mutations with invalidation - all wired for you. Recommend it the moment server state is shared across views and mutated, because that is exactly the layer you would otherwise reinvent badly on top of `resource`.
- **Invalidation strategy, either way.** Treat reads as cached with a staleness window, not as live truth. After a mutation, invalidate then refetch the affected reads - `queryClient.invalidateQueries({ queryKey })` under angular-query, or re-trigger the params signal / call `reload()` on a hand-rolled resource. Do not optimistically write the server's shape into a client store and skip the refetch; the cache, not a mirror, stays authoritative. Offline-first apps invert this - there the local store is the source of truth with a write-queue drained on reconnect; that shape is the `ionic` skill's.

## RxJS only where a stream earns it
- Observables are for genuine streams: HTTP responses, debounced input, event buses across components. Never wrap a plain synchronous value in an observable.
- At a template-only boundary, convert with `toSignal` so the view consumes a signal and you avoid the async pipe's subscription bookkeeping.
- Always tear down. Inside a component use `takeUntilDestroyed` (v16+) or the `DestroyRef` it reads from; a manual `Subject` plus `takeUntil` is only acceptable in a class with no injection context.
- Never nest a `subscribe` inside another `subscribe`. Flatten with the higher-order operator whose semantics you actually want - `switchMap` to cancel the previous, `concatMap` to queue, `mergeMap` to run in parallel, `exhaustMap` to ignore while busy - and say why in review when it is not obvious.
- Keep `map` pure. Side effects belong in `tap`.
- Cache a shared stream with `shareReplay({ bufferSize: 1, refCount: true })` so late subscribers get the last value and the source unsubscribes when the audience empties.

## Change detection is always OnPush
- `ChangeDetectionStrategy.OnPush` on every component in new code; the default strategy is treated as a bug. The one sanctioned carve-out is a component a library's own docs require to stay on Default change detection - keep it Default and cite that requirement in an inline comment.
- Feed components immutable data through signal inputs - `input()` and `input.required<T>()` - emit with `output()`, and bind two-way state with `model()` (v17.2+). The decorator `@Input` and `@Output` survive only in code predating 17.1; never mix the two styles in one component.
- Drive the view with signals or observables, not a hand-placed `markForCheck`. If you are reaching for `ChangeDetectorRef`, the state shape is wrong.
- Finish the move off decorators for queries and host bindings too: `viewChild()` and `contentChild()` (add `.required` when the target is guaranteed present) replace `@ViewChild` and `@ContentChild`, and the `host` metadata object replaces `@HostBinding` and `@HostListener`.
- OnPush is the stepping stone to zoneless, not the destination. Where the installed version ships stable zoneless change detection (stable from v20.2, the default for new apps from v21) AND every framework layer in the app supports it (a layer that still requires `zone.js` keeps it - that framework's skill owns the call), drop `zone.js` from the polyfills and bootstrap with `provideZonelessChangeDetection()` alongside `provideBrowserGlobalErrorListeners()`. Without a zone, `setTimeout`, `setInterval`, and bare promise callbacks no longer trigger a render - every update must flow through a signal or `AsyncPipe`, which an all-OnPush, signal-driven codebase already satisfies. Turn it on in development first to flush out any code that silently leaned on the zone.

## Templates carry no logic
- A template holds simple expressions only. Push any real computation into a `computed` signal; never call a method from the template, since it re-runs every change-detection pass.
- Use block control flow - `@if`, `@for`, `@switch` - in place of the old structural directives. Give every `@for` over an object collection a `track` expression keyed on a stable identity.
- Defer below-the-fold and non-critical content with `@defer`. Pick the trigger on purpose - `on viewport`, `on idle`, `on interaction` - and always supply a `@placeholder` so nothing reflows when the block resolves.
- Static images go through `NgOptimizedImage`; mark the above-the-fold hero `priority` so the LCP image preloads and its box is reserved, killing layout shift.
- The replacement for the `@angular/animations` DSL is now concrete, not just in flux: the package is deprecated and Angular ships native `animate.enter` / `animate.leave` template bindings alongside plain CSS transitions. Prefer those in new code and plan existing DSL animations off it. For route transitions use the View Transitions API through `withViewTransitions()` - except inside an Ionic `IonRouterOutlet`, whose own stack transitions it fights (the `ionic` skill owns page transitions there).

## SSR and hydration
Web targets only - a Capacitor WebView has no server render, so skip this whole section in an Ionic native app.
Server-render, then hydrate so the client reuses the server-painted DOM instead of re-rendering it from scratch. The model is three stages: SSR paints the pixels, hydration wires up the event handlers, incremental hydration delays that wiring until a block is actually needed.
- Enable full hydration with `provideClientHydration()`. Incremental hydration is stable from v20, but its opt-in/opt-out wiring changed across v20-v22 - see your version's delta file under `references/` for the exact call; either way it auto-enables event replay, so do not also add `withEventReplay()`. Drive it from `@defer` with `hydrate` triggers - `hydrate on idle|immediate|timer|viewport|interaction|hover`, `hydrate when`, `hydrate never` - which lets you defer even above-the-fold content a plain `@defer` could not.
- Do not lean on the HTTP transfer cache for authenticated responses - it skips credentialed (`withCredentials`) requests, so a response you thought was cached re-fetches on the client. Verify SSR behavior through E2E, not the deprecated `@angular/platform-server/testing`.
- Never touch `window`, `document`, or `localStorage` in a `constructor`, field initializer, or `ngOnInit` that runs during server render - reach browser-only APIs through `isPlatformBrowser` or `afterNextRender`, and seed shared state server-safe (no browser API in a signal or store initializer).
- Render deterministically on the server: no `Date.now()` / `Math.random()`-derived output in a server-rendered template - a relative '3m ago' timestamp is the classic case - render a stable value during SSR and swap to the live form after hydration, or the client/server DOM mismatch throws the server paint away.

## Services and dependency injection
- App-wide singletons declare `providedIn: 'root'` so they tree-shake when unused and need no module registration.
- Pick `inject()` or constructor injection and hold to it per project; `inject()` is the recommendation in new code because it composes cleanly in functions, guards, and base classes.
- Depend on an interface or an injection token, not a concrete class, so a feature can be tested and re-provided without editing its consumers.

## HTTP, routing, and forms
- Keep endpoint URLs in one config service or environment file, never scattered as string literals.
- Cross-cutting HTTP concerns - auth headers, retry, error normalization - live in functional interceptors registered with `withInterceptors`, not in each call site.
- For new forms on v21+, prefer Signal Forms (`form()` from `@angular/forms/signals`) - signal-driven, model-based, and type-safe end to end - and never type or default a field as `null`. Below v21, and for existing reactive code, typed reactive forms (`FormGroup<T>`) remain the default; template-driven forms are only for trivial throwaway inputs.
- Lazy-load feature routes with `loadComponent` for standalone targets, falling back to `loadChildren` only where legacy modules remain.
- Bind route params and `data` straight into component `input()`s with `withComponentInputBinding()` instead of injecting `ActivatedRoute` and reading snapshots.
- Resolve a route's critical data ahead of activation with a thin `resolve` guard that delegates to a service, so the component renders without a request waterfall. Not in an Ionic app: cached pages do not re-activate on revisit, so a resolver never re-runs and ships stale data - refresh-on-entry belongs on `ionViewWillEnter` there (the `ionic` skill's ground).

## Forms validation strategy
Validation is a layer, not a pile of one-off checks: declare it on the model, keep custom rules reusable (a pure named `ValidatorFn`, unit-tested in isolation), put cross-field rules on the group, make async validators debounce and cancel, and render every error through ONE shared mechanism - never a per-template error wall. The full strategy - including how it carries over to Signal Forms (v21+) and Standard Schema validation - is `references/forms-validation.md`; load it when building any non-trivial form.

## Accessibility
- Every interactive element is reachable by keyboard and shows a visible focus indicator.
- Reach for semantic HTML first - `<button>`, `<nav>`, `<main>`, `<header>` - and add ARIA only when no native element expresses the intent.
- For custom widgets (accordion, listbox, combobox, menu, tabs, and more), build on the headless `@angular/aria` directives (developer preview in v21, stable from v22): they own the keyboard, focus, and ARIA state machine, and you supply only the markup and styles, hanging CSS off the aria-expanded, aria-selected, and aria-current attributes they manage. The pattern set grows each release, so check `angular.dev/guide/aria` for what ships rather than assuming a fixed roster. Do not reimplement that logic.
- Text contrast meets WCAG AA - exact ratios are `angular-styling`'s to state.

## Feature boundaries
- Features may depend on `shared/` and `core/` but never on one another. No import from `features/billing` reaches into `features/orders`. (How barrels and deep imports are policed is `typescript`.)
- Anything two features must share crosses through a service in `core/` or a state store, never a direct component reference.

## Performance budgets
These are gates for the web/PWA target - a Capacitor binary loads its bundle from disk and has no SEO, so in an Ionic app apply them only to the web build.
- Hold the initial bundle under 500 KB gzipped; lazy-load whatever would push past it.
- Encode the ceiling as `budgets` in `angular.json` so a regression fails the build rather than slipping through review.
- Clear Lighthouse 90+ on Performance, Accessibility, Best Practices, and SEO before any production release.

## Testing
- Drive component tests through the CDK component-test harnesses rather than raw DOM queries - a harness keeps passing across internal template churn that would shatter a brittle selector.
- Assert observable behavior: signal and state transitions and what actually renders, never a private method or an implementation detail.
- Cover comparison and boundary logic - date/overdue thresholds, sort direction, off-by-one ranges - with a regression test that pins the *direction*, not just that a list renders: a task due yesterday is overdue and one due tomorrow is not, the newest sorts first, the last partial page returns its remainder. An inverted comparison (`>` for `<`) passes every 'renders the list' test and only a directional assertion catches it.
- Build fixtures with factory or object-mother helpers so the same literal is not copy-pasted across specs.
- Mock collaborators with the workspace's runner - `jasmine.createSpyObj` under Karma, `jest.fn()` under Jest - and do not mix the two.
- Bake automated accessibility checks into component specs with `axe-core` and `jest-axe`.
- Vitest is the runner to reach for in new suites - Karma is deprecated and Vitest is the CLI default (via the `@angular/build:unit-test` builder, jsdom or happy-dom, browser mode through Playwright when a real DOM is needed). Existing Karma or Jest suites keep working, so do not force a rewrite.
- Test signals by reading them directly and flushing effects with `TestBed.tick()`; wire inputs and outputs through `inputBinding()` / `outputBinding()` / `twoWayBinding()` on `createComponent` rather than reaching into the instance. Under zoneless, an error thrown in an event listener surfaces to the error handler instead of being swallowed, so expect some previously-silent tests to start failing honestly.
- E2E: select by role, label, or test-id, never a CSS class, and never a fixed `waitForTimeout` - lean on auto-waiting web-first assertions and `waitForResponse`. Set trace retain-on-failure, retries only in CI, and keep Page Objects assertion-free with locators as lazy getters.

## Banned patterns
- No `setTimeout` poked in to coax change detection into noticing a change - it only 'works' because zone.js patches timers to trigger a render, so it papers over a broken signal/input flow and silently stops working under zoneless. Fix the flow instead.
- No direct DOM mutation outside a directive - the server has no browser DOM and a hand-mutated node is the classic hydration-mismatch error, and a raw `innerHTML` write skips Angular's sanitizer; go through `Renderer2`.
- No method calls in template expressions - they re-run on every change-detection pass; bind a `computed` instead.
- No `null` field defaults in forms - a `null` default widens the typed control to `T | null` and leaks null checks into every consumer.
- No decorator queries or host bindings in new code - `viewChild()`/`contentChild()` return signals that compose with `computed` and `effect`, and the `host` object replaces `@HostBinding`/`@HostListener`, which Angular keeps only for backwards compatibility.

## Reward-hacking shortcuts to reject
The recurring ways a change fakes a green build or suite instead of earning it - reject each in review, whoever wrote it. This is the one consolidated list to check a diff against before claiming done; the language-level bans (`any`, `@ts-ignore`, non-null `!`) live in `typescript`.

| Shortcut | Instead |
|---|---|
| `xit`/`xdescribe`, an `fdescribe` that narrows the run, or deleting a failing spec | fix the defect the spec caught; delete only a genuinely obsolete spec, with the reason stated |
| Weakened assertion, or a spec rewritten to assert less than the behavior | fix the code, keep the bar (Testing above) |
| Disabling an ESLint rule, loosening `strictTemplates`/`fullTemplateTypeCheck`, or `"aot": false` to clear an error | fix the type or template the compiler is pointing at |
| `$any()` or `CUSTOM_ELEMENTS_SCHEMA`/`NO_ERRORS_SCHEMA` to mute a template error | import the declarable, fix the binding type |
| Raising an `angular.json` budget or padding `allowedCommonJsDependencies` to clear a threshold | shrink the bundle honestly - defer, lazy-load, drop the dependency (Performance budgets above) |
| Package downgrade to dodge a peer conflict | resolve the conflict at the current version |
| Real time, real HTTP, or `tick(99999)` to mask flaky async | fix the async handling - `fakeAsync` with an honest `tick`, the HTTP testing controller |

(The language baseline - strict typing and no `any`, modules and barrels, async, error handling, JSDoc, ESLint, Prettier, `tsc`, and `npm audit` - lives in `typescript`.)

