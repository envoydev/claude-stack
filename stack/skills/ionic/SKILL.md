---
name: ionic
description: "Ionic / Capacitor mobile + hybrid app conventions - house rules for Ionic Angular UI (standalone + signals, IonRouterOutlet, page-caching view lifecycle, CSS-variable theming), Capacitor lifecycle + platform guards, runtime permissions, and Capacitor plugin sourcing (official -> Capawesome -> capacitor-community) + typed-service wrapping. Targets Ionic 8 / Angular 17+ / Capacitor 6+ (8 current). Load before building or editing an Ionic/Capacitor app - anywhere ionic.config.json or capacitor.config.* lives. Companions: angular-conventions, typescript. Do NOT load for plain web Angular with no native shell."
---

# Ionic / Capacitor Conventions

An Ionic app is an Angular app in a native (Capacitor) shell: the framework rules live in `angular-conventions` and the language baseline in `typescript` - load both. This skill is the Ionic/Capacitor-specific layer of house policy. In-app navigation and the page lifecycle are owned here in `references/navigation-and-lifecycle.md`; broader Ionic UI mechanics (component APIs, theming) are fetched live via context7 or the Ionic docs, not vendored. Per-plugin install/config is fetched live (context7 or the plugin's README); the durable plugin-sourcing and typed-service-wrapping guidance is here in this skill. Cutting a release - the build, signing, store submission, OTA, and release CI - is `capacitor-release`. Security-hardening the native surface - Keychain/Keystore secret storage, permission least-privilege, cleartext and WebView lockdown, deep-link input trust - is `mobile-security`. Version floors, the per-major deltas that bite, and the Ionic + Capacitor upgrade paths live in `references/versions.md`.

## Components and structure
- Standalone components + signals, OnPush, new control flow - same as `angular-conventions`. Ionic components (`IonContent`, `IonList`, ...) are standalone imports, not a shared module.
- Theme through Ionic CSS variables and `color` / `mode`, not hardcoded colors; keep design tokens in one place. Respect the system light/dark setting.
- Handle safe-area / edge-to-edge insets with the CSS `env(safe-area-inset-*)` variables (Ionic's `--ion-safe-area-*`), never fixed padding - Capacitor 8 draws content under the status and navigation bars by default (it dropped `adjustMarginsForEdgeToEdge` for a System Bars core plugin plus these CSS variables), so pad it back with the insets; the System Bars plugin API is fetched live.
- Dark mode is a palette you opt into, not per-component overrides: import Ionic's dark palette and choose the strategy - follow the OS (system) or an app toggle (the ion-palette-dark class on the root). Theme off the palette's CSS variables; never hand-roll dark colours per component. The v8 import files and the step-token split are in `references/versions.md`.
- Respect the OS accessibility settings: Ionic scales type to the device Dynamic Type / font-size setting by default (the `--ion-dynamic-font` token) - size with relative units and check large-text layouts, never fixed `px` that clips. Keep touch targets >= 44px and give every interactive control an accessible name.
- Keep page components thin: data + state in services/stores, presentation in the page.
- Import Ionic UI components from `@ionic/angular/standalone` and bootstrap with `provideIonicAngular()`, never the `@ionic/angular` barrel - the barrel path pulls in lazy-loaded code that defeats tree-shaking.

## Form controls - the modern syntax
- Label and validation live on the control, not slotted into `IonItem`: `IonInput` / `IonTextarea` / `IonSelect` carry `label`, `labelPlacement`, `fill` (`outline` / `solid`), `helperText`, `errorText`, and `counter` directly. Ionic 8 removed the legacy `IonItem`-wrapped form pattern and the `legacy` property - never author it or paste it from an old sample.
- The control's `label` (or an `[aria-label]` when it is visually labelled elsewhere) IS its accessible name - a field with neither fails the a11y gate. Build forms with typed reactive `FormGroup`s and surface validation through one shared `errorText` path, not a per-field `@if` error wall. That holds even where `angular-conventions` prefers Signal Forms (v21+): Ionic's controls are documented and tested against the reactive-forms path, so Signal Forms waits on Ionic surfaces until Ionic documents support - the same treat-as-unsupported stance as zoneless below.

## Overlays - modal, popover, toast, alert, action-sheet, loading
- Prefer the inline component with `[isOpen]` bound to a signal and `(didDismiss)` handled over the imperative `*Controller` - overlay state stays in the component and tears down cleanly. Reach for the controller only for a genuinely fire-and-forget prompt.
- Always read the dismissal: handle the backdrop tap, the hardware back, and the returned `role` on `didDismiss` - an overlay whose result you never read is a dropped user decision. Per-overlay component options are fetched live.

## Change detection and zoneless
- OnPush everywhere except the shell: never put OnPush on a component that hosts `IonRouterOutlet` or `IonNav`. It stops lifecycle hooks such as `ngOnInit` from firing and breaks async rendering (Ionic's own docs). Keep those shell components on the default strategy; apply OnPush only to leaf pages and presentational components.
- Do not go zoneless. Ionic keeps Zone.js as a peer dependency and is not officially zoneless-compatible, so stripping it out risks Ionic's own web components and buys no bundle saving while Zone.js stays required. Signals are fine in your Angular layer and leaf components - they just don't make Ionic's components zoneless. Treat zoneless as unsupported until Ionic ships official support.

## Navigation
- Route with the Angular router inside an `IonRouterOutlet`; lazy-load every feature route via `loadComponent` / `loadChildren`. Tabs use `IonTabs` with their own outlet.
- Don't mix Ionic's imperative nav controllers with the Angular router in one app - pick the router and stay with it.

## Ionic page lifecycle
- Ionic caches pages in the DOM, so `ngOnInit` / `ngOnDestroy` fire only on create/pop, not on every revisit - route refresh-on-entry work onto `ionViewWillEnter`, deferred heavy work onto `ionViewDidEnter`. The full hook schedule and which hook owns which work are in `references/navigation-and-lifecycle.md`.
- Control navigation with Angular route guards (`CanActivate` / `CanDeactivate`) - they replaced the old `ionViewCanEnter` / `ionViewCanLeave`.

## Large lists
- Ionic's own virtual-scroll component was removed in v7 - for long lists use Angular CDK virtual scroll (`CdkVirtualScrollViewport` with `*cdkVirtualFor`) inside `IonContent`: set `[scrollY]="false"` on the `IonContent` and add the ion-content-scroll-host class to the viewport so Ionic's pull-to-refresh and infinite scroll keep working. CDK handles fixed-height rows well; variable-height rows can jank.

## Platform detection - pick the right check for the question
Three different questions, three different calls - don't conflate them:
- 'Is there a native bridge at all?' -> `Capacitor.isNativePlatform()` (true on iOS and Android, false in a browser / PWA). This is the gate for any code that calls a native plugin path.
- 'Which OS?' -> `Capacitor.getPlatform()` returns `'ios' | 'android' | 'web'`. Branch on it only for genuinely platform-specific behavior (a status-bar inset, an iOS-only API), never as a substitute for the native check above.
- 'What can the app do right now?' -> Ionic's `Platform` service: `platform.is('ios' | 'mobile' | 'pwa' | 'desktop' | 'capacitor')` plus `platform.ready()`. Prefer `Platform` inside Angular components because it injects cleanly and is mockable in tests; reserve the static `Capacitor.*` calls for plain functions and services with no injection context.
- Resolve platform once in a typed service and expose signals, rather than calling `getPlatform()` ad hoc across the tree.

## Capacitor lifecycle
- Plugin lifecycle is asymmetric: register listeners (`App.addListener('appStateChange', ...)`, `'backButton'`, `'appUrlOpen'`, `'resume'`, `'pause'`) once at app start, capture the returned handle, and remove it on teardown - a leaked native listener survives the Angular component that created it. Wrap registration in an app-level service whose `ngOnDestroy` (or `DestroyRef`) calls `removeAllListeners()`.
- The `App` plugin's `addListener` is async (returns a `Promise<PluginListenerHandle>`); await the handle before you rely on the listener being live, and store it for removal.
- Own pause/resume, hardware back, and deep links (`appUrlOpen`) in that one service, not scattered across pages. On resume, re-read any state that may have gone stale in the background (auth token, geolocation) rather than trusting the pre-pause snapshot.

## The Angular zone boundary - wrap every listener callback
Capacitor plugin listener callbacks fire outside Angular's `NgZone`, so any state they mutate escapes change detection and the UI silently goes stale - the single most common Angular+Capacitor bug. Wrap the body of every listener callback that touches template-bound state - `appStateChange`, `backButton`, `appUrlOpen`, `networkStatusChange`, the push events - in `NgZone.run()`; inject `NgZone` rather than reaching for `setTimeout` or `ApplicationRef.tick()`. Registration and teardown follow the lifecycle rule above: register in the app-level service, capture the handle, remove on destroy.

Broken - the template never updates:
```typescript
this.handle = await Network.addListener('networkStatusChange', (status) => {
  this.online.set(status.connected);          // runs outside the zone
});
```

Correct - run the mutation inside the zone:
```typescript
private zone = inject(NgZone);
this.handle = await Network.addListener('networkStatusChange', (status) => {
  this.zone.run(() => this.online.set(status.connected));
});
```

The same wrap is what makes the deep-link `Router.navigateByUrl` mapping and the push-tap routing actually repaint - both run inside a listener callback.

### Android hardware back button
Own the `backButton` listener in that same app-level service and branch on `canGoBack` - pop when there is history, exit only when there is none. Never call `App.exitApp()` unconditionally; it closes the app mid-stack.
```typescript
App.addListener('backButton', ({ canGoBack }) =>
  this.zone.run(() => (canGoBack ? this.location.back() : App.exitApp())));
```

## Native-vs-web fallbacks - degrade, never crash
- Every native call needs a defined web path so the PWA and `ionic serve` dev build still run.
- Three fallback shapes, in order of preference: (1) a real web implementation when the plugin ships web support (Capacitor's official plugins mostly do - Camera falls back to file input, Preferences to localStorage); (2) a degraded-but-functional stand-in (share via the Web Share API, or copy-link when even that is absent); (3) an explicit, typed 'unavailable' result the UI can render as a disabled affordance. Prefer the highest one the plugin and target support - a silent no-op is the one outcome to avoid, because it looks like a bug.
- Feature-detect, don't assume: gate on `Capacitor.isPluginAvailable('Camera')` and the platform, not on a try/catch that swallows everything.

## Permissions - check, explain, request, handle the no
Run the full cycle, in order, for any permission-gated API (camera, geolocation, notifications, contacts):
- Check first with the plugin's `checkPermissions()`; only call `requestPermissions()` when the status is `'prompt'` / `'prompt-with-rationale'`. Never request blind on app start.
- Request at the point of use, right after a UI affordance that explains why - the OS prompt is one-shot on iOS, so a denial you triggered before the user understood the value is effectively permanent.
- Handle every terminal state explicitly: `'granted'`, `'denied'`, and the partial states that matter (iOS `'limited'` photo access, coarse-vs-fine location). A denial is a `Result` the UI renders (a disabled control plus a deep-link to system settings via the App plugin), never an unhandled throw.
- Re-check on resume - the user may have changed the grant in system settings while backgrounded.

## Capacitor plugins - sourcing
Preference order when you need a plugin:
1. **Official** `@capacitor/*` core plugins first (Camera, Geolocation, Preferences, Filesystem, ...).
2. **Capawesome** `@capawesome/capacitor-*` (github.com/capawesome-team/capacitor-plugins) - well-maintained, tracks the current Capacitor major.
3. **capacitor-community** `@capacitor-community/*` (the capacitor-community org) for community-maintained needs.
4. Vetted community / CapGo only if nothing above fits - never an unmaintained one-off npm package.

Before adopting any third-party plugin: confirm its latest major matches your Capacitor version, check recent releases / commits (maintenance), and verify iOS / Android / web platform support. Per-plugin install and config is fetched live - context7 or the plugin's own README, since it drifts per release; the durable sourcing and typed-wrapping policy is here.

## Wrapping - the typed-service contract
- Call a plugin only through a typed Angular service - never the plugin API scattered across components. The service is the single owner of the whole native seam: the permission check, the web-fallback branch, the listener lifecycle, and error mapping (a denied permission or missing capability is a `Result` the UI renders, not an unhandled throw).
- The cross-cutting native features nearly every production app hits - push notifications, deep links / universal links, offline-first sync - are each built as one of these services; their house shapes (token lifecycle, URL-to-route mapping, queue-and-drain) live in `references/native-features.md`.

## Testing the native seams
- Unit-test the wrapping service, not the device: with the plugin mocked (the runner's spy - `jest.fn()` or `jasmine.createSpyObj`, per `angular-conventions`), assert the web-fallback branch and the permission-denied path return the typed `Result` the UI renders. These run in jsdom with no device or emulator.
- Do not try to drive real native plugin behavior in a jsdom unit test - the bridge is not there, so a test that 'exercises' the native path is only exercising your mock. Keep those tests honest about that boundary.
- Reserve appium-mcp (opt-in, heavy - needs Xcode/Android SDK + Java) for true device/E2E smoke of the few native-critical flows (push tap -> route, deep-link cold start, an offline-then-reconnect drain). Smoke the handful that would silently break in production, not the whole surface.

<!-- House Ionic/Capacitor conventions; in-app navigation + page lifecycle owned in references/navigation-and-lifecycle.md, the push/deep-link/offline shapes in references/native-features.md; component APIs / theming fetched live via context7 / the Ionic docs. -->
