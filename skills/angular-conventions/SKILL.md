---
name: angular-conventions
description: "Personal Angular conventions from v17 up - standalone everything, signals as the default state primitive, OnPush, block control flow (at-if / at-for / at-switch), signal inputs and outputs, deferred loading, RxJS only where streams earn it, HTTP, reactive or signal forms, routing with input binding, accessibility, component-harness testing, and banned patterns. Load before writing or editing any Angular file so the agent commits to current idioms, not recalled ones. Companions: typescript for the language baseline (strict typing, modules, async, errors), angular-material for Material and CDK, frontend for the web index, mobile for Ionic and Capacitor. Do NOT load for React, Vue, Svelte, Solid, plain DOM, or any non-Angular TypeScript."
---

# Angular conventions

These are house rules for Angular, floored at v17 and reaching forward to whatever the workspace is actually on (v20, v21). When a newer idiom exists, prefer it - but only adopt one the installed version ships. The language underneath (strict TypeScript, type modeling, modules, async, error handling, lint and format) is owned by `typescript`; load it next to this skill and assume everything here is purely Angular. Material components and the CDK are `angular-material`; the broader web index is `frontend`; Ionic and Capacitor are `mobile`. This file is opinion, not reference: it states the choices the team has settled on and the divergences kept on purpose. For any API surface not pinned down here, reach for the Angular CLI MCP or angular.dev rather than memory.

## Standalone is the only module model
- Every component, directive, and pipe is `standalone` - the implicit default from v19, declared explicitly before that. `NgModule` does not appear in new code; the bootstrap is `bootstrapApplication` with an `ApplicationConfig`.
- A component pulls in exactly what its template uses via `imports`. No grab-bag shared module re-exporting half the framework.
- File names carry a type suffix the team keeps on purpose: `order-list.component.ts`, `pricing.service.ts`, `autofocus.directive.ts`, `currency.pipe.ts`. Recent style-guide guidance (around v20) leans toward dropping the `.component`/`.service` suffix; this codebase keeps it regardless, so do not strip suffixes to look modern. Confirm the current style-guide stance via angular.dev before citing it as the reason either way.
- One responsibility per file. Template and styles live beside the class in the same folder; inline them only for genuinely trivial components. How those styles are scoped and architected - `ViewEncapsulation`, `:host`, design tokens, responsive, a11y styling - is `angular-styling`.
- Selectors are kebab-case with the project prefix - `app-order-list`, never a bare `order-list` that risks colliding with a third-party tag.
- Keep the container-versus-presentational split honest: containers own data fetching and state, presentational components take inputs and emit outputs and hold no service of their own.

## Signals are the default state primitive
- Local component state is a `signal`; anything derived is a `computed`; side effects that must react to state run in an `effect`. Reach for this before any other mechanism in new code.
- `linkedSignal` (v19+) is writable state derived from a source that should reset when the source moves. Use its `source` and `computation` object form when a user's selection must survive a source change as long as it stays valid.
- `resource` and `rxResource` (v19+) lift async work into signals: give them a `params` signal and a `loader` that respects its `abortSignal`, then read `value()`, `hasValue()`, and `status()` instead of hand-managing loading and error booleans.
- Treat stores (NgRx, NGXS, or a signal-based store) as a last resort, reserved for state that truly spans many unrelated features. Most state is local and stays in component signals.

## State management: which tier, and when a store is warranted
The default is the smallest thing that holds the state, escalating only when the current tier stops fitting. The rule is one line: local signal -> signal service -> SignalStore -> full NgRx. Climb a tier only when the one below cannot express the need, never to look enterprise.
- **Local signal / computed.** State owned by one component. The first answer for almost everything; do not reach past it because state feels important.
- **A plain signal service** (`providedIn: 'root'` or provided at a route) when two or more components share the same state and nothing more. Hold private `signal`s, expose them as `readonly` (via `.asReadonly()` or `computed`), and mutate only through methods on the service. This covers most cross-component state with zero library weight - prefer it over any store until the service itself turns into a sprawl of ad-hoc methods and derived flags.
- **@ngrx/signals SignalStore** when that shared state grows real structure - derived slices, coordinated updates, a managed collection - and you want it declared rather than hand-wired. This is the recommended modern store: it is signal-native, so it drops straight into `OnPush` and the rest of this file with no observable bridge. Compose it from `signalStore()` with `withState` for the slices, `withComputed` for derived signals (the selector equivalent), `withMethods` for state changes and side effects, and `withEntities` (from `@ngrx/signals/entities`) for id-keyed collections. Feature order matters - declare `withMethods` before any `withHooks` that calls into it. Reach here before classic NgRx whenever the app is signal-first.
- **Classic NgRx Store + Effects** only for a large redux-style app that genuinely wants the full ceremony: a serialized action log for time-travel and replay, strict event-sourcing, or an established team contract already built on actions, reducers, and effects. The cost is real (boilerplate, an RxJS-centric mental model that fights the signals default), so justify it by those needs, not by scale alone. New signal-first apps should land on SignalStore instead.

## Server state is not client state
Data that lives on the server (a fetched list, a record by id) is a cache of something you do not own - do not copy it into a signal service or a store and then babysit it. Keep it in a dedicated async read primitive and let that own loading, error, and freshness. Mirroring it into client state is the bug this section exists to prevent: two sources of truth that drift.
- **Hand-rolled `resource` / `rxResource` / `httpResource`** for declarative reads. `httpResource` (stable from v19.2) is the lean default - `httpResource(() => \`/api/order/${id()}\`)` re-fetches when the signal moves, cancels the in-flight request, and exposes `value()`, `hasValue()`, `isLoading()`, and `error()` as signals, killing the manual loading/error booleans. Use `resource` for non-HTTP async and `rxResource` when the loader is an Observable (note: on v20 its loader was renamed `stream`, and rxResources stream values from v19.2 - version-tag any snippet). These are still experimental in v20 (httpResource excepted); pin to the installed version before leaning on them.
- These primitives are per-instance reactive fetching with no cross-instance cache (the only built-in sharing is SSR `TransferState` via an `id`). So they fit a screen that reads its own data and discards it. When several views must share one server cache, you hand-roll dedup and a shared signal cache - and once you are writing background refetch, staleness, and cross-view invalidation by hand, the library has earned its place.
- **@tanstack/angular-query** (the angular-query adapter, `injectQuery` / `injectMutation`) for a real server-cache: request dedup, background refetch, window-focus revalidation, garbage collection, and mutations with invalidation - all wired for you. Recommend it the moment server state is shared across views and mutated, because that is exactly the layer you would otherwise reinvent badly on top of `resource`.
- **Invalidation strategy, either way.** Treat reads as cached with a staleness window, not as live truth. After a mutation, invalidate then refetch the affected reads - `queryClient.invalidateQueries({ queryKey })` under angular-query, or re-trigger the params signal / call `reload()` on a hand-rolled resource. Do not optimistically write the server's shape into a client store and skip the refetch; the cache, not a mirror, stays authoritative.

## RxJS only where a stream earns it
- Observables are for genuine streams: HTTP responses, debounced input, event buses across components. Never wrap a plain synchronous value in an observable.
- At a template-only boundary, convert with `toSignal` so the view consumes a signal and you avoid the async pipe's subscription bookkeeping.
- Always tear down. Inside a component use `takeUntilDestroyed` (v16+) or the `DestroyRef` it reads from; a manual `Subject` plus `takeUntil` is only acceptable in a class with no injection context.
- Never nest a `subscribe` inside another `subscribe`. Flatten with the higher-order operator whose semantics you actually want - `switchMap` to cancel the previous, `concatMap` to queue, `mergeMap` to run in parallel, `exhaustMap` to ignore while busy - and say why in review when it is not obvious.
- Keep `map` pure. Side effects belong in `tap`.
- Cache a shared stream with `shareReplay({ bufferSize: 1, refCount: true })` so late subscribers get the last value and the source unsubscribes when the audience empties.

## Change detection is always OnPush
- `ChangeDetectionStrategy.OnPush` on every component, no exceptions in new code. The default strategy is treated as a bug.
- Feed components immutable data through signal inputs - `input()` and `input.required<T>()` - emit with `output()`, and bind two-way state with `model()` (v17.1+). The decorator `@Input` and `@Output` survive only in code predating 17.1; never mix the two styles in one component.
- Drive the view with signals or observables, not a hand-placed `markForCheck`. If you are reaching for `ChangeDetectorRef`, the state shape is wrong.
- Finish the move off decorators for queries and host bindings too: `viewChild()` and `contentChild()` (add `.required` when the target is guaranteed present) replace `@ViewChild` and `@ContentChild`, and the `host` metadata object replaces `@HostBinding` and `@HostListener`.

## Templates carry no logic
- A template holds simple expressions only. Push any real computation into a `computed` signal; never call a method from the template, since it re-runs every change-detection pass.
- Use block control flow - `@if`, `@for`, `@switch` - in place of the old structural directives. Give every `@for` over an object collection a `track` expression keyed on a stable identity.
- Defer below-the-fold and non-critical content with `@defer`. Pick the trigger on purpose - `on viewport`, `on idle`, `on interaction` - and always supply a `@placeholder` so nothing reflows when the block resolves.
- Static images go through `NgOptimizedImage`; mark the above-the-fold hero `priority` so the LCP image preloads and its box is reserved, killing layout shift.
- Prefer native CSS transitions and animations over the `@angular/animations` DSL; recent Angular versions have been steering away from it (treat its long-term status as in flux and check angular.dev before leaning on the DSL in new code). For route transitions use the View Transitions API through `withViewTransitions()`.

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
- Resolve a route's critical data ahead of activation with a thin `resolve` guard that delegates to a service, so the component renders without a request waterfall.

## Forms validation strategy
Validation is a layer, not a pile of one-off checks: declare it on the model, keep custom rules reusable, and render errors through one shared mechanism so no template hand-rolls its own. The shape below holds on typed reactive forms today and carries over to Signal Forms where the workspace is on v21+.
- **Built-in before custom.** Use the framework validators (`Validators.required`, `email`, `min`, `pattern`) for the common cases. Write a custom `ValidatorFn` only for genuine domain rules; keep it a pure named function returning `ValidationErrors | null` (with a stable error key and any params the message needs), exported and unit-tested in isolation, never an inline arrow buried in a control.
- **Cross-field rules sit on the group.** A rule that compares two controls (password-confirm, end-after-start) is a validator on the parent `FormGroup`, not on either child, so it reads both values. Surface the error where it makes sense for display - hang it off the group, or set it onto the relevant control so the message lands next to the field the user must fix.
- **Async validators are debounced and cancel.** For server checks (username taken, code valid) write an `AsyncValidatorFn` that debounces, switches to cancel the stale request, and resolves to `ValidationErrors | null`. Run it on blur or otherwise rate-limit it so it does not fire per keystroke, and drive a pending indicator off the control's `pending` state.
- **One error-display mechanism.** Do not scatter `@if (control.errors?.required)` across templates. Build one reusable error component or directive that reads a control's state and renders the right message only once the field is `touched` or `dirty` (and, for async, after `pending` clears), mapping each error key to copy from a single dictionary. Every field shows errors the same way, on the same trigger, with messages defined in one place.
- **Signal Forms (v21+) move the same strategy onto the model.** Where the workspace ships Signal Forms (`form()` from `@angular/forms/signals`), validation is declared in the schema rather than attached to controls: synchronous rules via `validate` (cross-field rules read another field with `valueOf(path)`, so they no longer need a group wrapper), and async rules via `validateAsync` / `validateHttp` with a `pending()` signal per field. The principles are unchanged - reusable rules, group/tree-level cross-field checks, one consistent error surface reading touched/dirty/pending - only the wiring moves from `FormGroup` plumbing to schema declarations. Version-tag any Signal Forms snippet and only use it on v21+.

## Accessibility
- Every interactive element is reachable by keyboard and shows a visible focus indicator.
- Reach for semantic HTML first - `<button>`, `<nav>`, `<main>`, `<header>` - and add ARIA only when no native element expresses the intent.
- For custom widgets (accordion, listbox, combobox, menu, tabs), build on the headless `@angular/aria` directives (experimental, v20+): they own the keyboard, focus, and ARIA state machine, and you supply only the markup and styles, hanging CSS off the aria-expanded, aria-selected, and aria-current attributes they manage. Do not reimplement that logic.
- Text contrast meets WCAG AA: at least 4.5:1 normally, 3:1 for large text.

## Feature boundaries
- Features may depend on `shared/` and `core/` but never on one another. No import from `features/billing` reaches into `features/orders`. (How barrels and deep imports are policed is `typescript`.)
- Anything two features must share crosses through a service in `core/` or a state store, never a direct component reference.

## Performance budgets
- Hold the initial bundle under 500 KB gzipped; lazy-load whatever would push past it.
- Encode the ceiling as `budgets` in `angular.json` so a regression fails the build rather than slipping through review.
- Clear Lighthouse 90+ on Performance, Accessibility, Best Practices, and SEO before any production release.

## Testing
- Drive component tests through the CDK component-test harnesses rather than raw DOM queries - a harness keeps passing across internal template churn that would shatter a brittle selector.
- Assert observable behaviour: signal and state transitions and what actually renders, never a private method or an implementation detail.
- Build fixtures with factory or object-mother helpers so the same literal is not copy-pasted across specs.
- Mock collaborators with the workspace's runner - `jasmine.createSpyObj` under Karma, `jest.fn()` under Jest - and do not mix the two.
- Bake automated accessibility checks into component specs with `axe-core` and `jest-axe`.

## Banned patterns
- No `setTimeout` poked in to coax change detection into noticing a change. Fix the signal or input flow instead.
- No direct DOM mutation outside a directive; go through `Renderer2`.
- No method calls or `null` field defaults in template-bound forms; no decorator queries or host bindings in new code.

(The language baseline - strict typing and no `any`, modules and barrels, async, error handling, JSDoc, ESLint, Prettier, `tsc`, and `npm audit` - lives in `typescript`.)

<!-- Some conventions here were mined from alfredoperez/angular-best-practices (MIT) and the official angular/skills (MIT, (c) 2026 Google LLC) - see Credits in README.md. -->

