---
name: ionic
description: "Personal Ionic / Capacitor mobile + hybrid app conventions - house rules for Ionic Angular UI (standalone + signals, IonRouterOutlet, lazy routes, page-caching view lifecycle, CSS-variable theming), Capacitor lifecycle + platform guards, runtime permissions, and Capacitor plugin sourcing (official -> Capawesome -> capacitor-community) + typed-service wrapping. Targets Angular 17+ / Capacitor 6+ (8 current). Load before building or editing an Ionic/Capacitor app. Companions: angular-conventions (the Angular framework), typescript (the language); per-plugin install/config is fetched live (context7 / the plugin README), the sourcing + typed-wrapping guidance is here. Do NOT load for plain web Angular with no native shell."
---

# Ionic / Capacitor Conventions

An Ionic app is an Angular app in a native (Capacitor) shell: the framework rules live in `angular-conventions` and the language baseline in `typescript` - load both. This skill is the Ionic/Capacitor-specific layer of house policy. In-app navigation and the page lifecycle are owned here in `references/navigation-and-lifecycle.md`; broader Ionic UI mechanics (component APIs, theming) are fetched live via context7 or the Ionic docs, not vendored. Per-plugin install/config is fetched live (context7 or the plugin's README); the durable plugin-sourcing and typed-service-wrapping guidance is here in this skill. Cutting a release - the build, signing, store submission, OTA, and release CI - is `capacitor-release`. Security-hardening the native surface - Keychain/Keystore secret storage, permission least-privilege, cleartext and WebView lockdown, deep-link input trust - is `mobile-security`.

## Components and structure
- Standalone components + signals, OnPush, new control flow - same as `angular-conventions`. Ionic components (`IonContent`, `IonList`, ...) are standalone imports, not a shared module.
- Theme through Ionic CSS variables and `color` / `mode`, not hardcoded colors; keep design tokens in one place. Respect the system light/dark setting.
- Keep page components thin: data + state in services/stores, presentation in the page.
- Import Ionic UI components from `@ionic/angular/standalone` and bootstrap with `provideIonicAngular()`, never the `@ionic/angular` barrel - the barrel path pulls in lazy-loaded code that defeats tree-shaking.

## Change detection and zoneless
- OnPush everywhere except the shell: never put OnPush on a component that hosts `IonRouterOutlet` or `IonNav`. It stops lifecycle hooks such as `ngOnInit` from firing and breaks async rendering (Ionic's own docs). Keep those shell components on the default strategy; apply OnPush only to leaf pages and presentational components.
- Do not go zoneless. Ionic keeps Zone.js as a peer dependency and is not officially zoneless-compatible, so stripping it out risks Ionic's own web components and buys no bundle saving while Zone.js stays required. Signals are fine in your Angular layer and leaf components - they just don't make Ionic's components zoneless. Treat zoneless as unsupported until Ionic ships official support.

## Navigation
- Route with the Angular router inside an `IonRouterOutlet`; lazy-load every feature route via `loadComponent` / `loadChildren`. Tabs use `IonTabs` with their own outlet.
- Don't mix Ionic's imperative nav controllers with the Angular router in one app - pick the router and stay with it.

## Ionic page lifecycle
- Ionic caches pages in the DOM, so `ngOnInit` / `ngOnDestroy` fire only when a page is created or popped, not on every revisit - a tab switch re-shows a cached page without re-running `ngOnInit`. Use `ionViewWillEnter` for data that must refresh on each entry and `ionViewDidEnter` for heavy work you want deferred until the page-transition animation finishes. These hooks fire only on router-mapped page components, not their children.
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
- Every native call needs a defined web path so the PWA and `ionic serve` dev build still run. The branch lives in the wrapping service, not the component.
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

## Wrapping
- Call a plugin only through a typed Angular service - never the plugin API scattered across components. The service owns the permission check, the web fallback, and error mapping (a denied permission or missing capability is a `Result`, not an unhandled throw).

## Native-feature architecture
The typed wrapping service is the unit for these too: each owns its permission check, its web fallback, its listener lifecycle, and its error-to-`Result` mapping. The three cases below are the cross-cutting ones nearly every production app hits. Per-plugin install and API mechanics are fetched live (context7 or the plugin README); what follows is the house shape that sits on top.

### Push notifications
- Permission then register, never the reverse: run the `checkPermissions()` -> `requestPermissions()` cycle (same order as any permission-gated API), and only call `PushNotifications.register()` once the status is `'granted'`. `register()` itself does not prompt - it triggers the `'registration'` event with the token, or `'registrationError'`. On Android 12 and below the permission is always granted; on iOS the first check prompts, so still gate it behind a UI affordance that explains why.
- Token-to-server lifecycle is the service's job, not the page's: on `'registration'`, POST the token to your backend keyed to the current user/device; treat the token as rotating - re-register on app start and on resume, and re-send when it changes, because a stale token silently drops delivery. On logout, unregister (which deletes the FCM token / unregisters APNS) and tell the server to forget it.
- Two delivery seams, handled distinctly: `'pushNotificationReceived'` fires while the app is foregrounded (decide in-app banner vs silent state update; on iOS use `presentationOptions` to control whether the OS also shows it), while `'pushNotificationActionPerformed'` fires when the user taps a notification from the background/tray - route that one onto the Angular Router from the payload, reusing the deep-link mapping below. Register both listeners once in the app-level service and tear them down via `removeAllListeners()`, per the lifecycle rule above.
- Web fallback: push is native-only - the service exposes a typed `'unavailable'` on web rather than throwing, so the PWA build still runs.

### Deep links / universal links
- One `App.addListener('appUrlOpen', ...)` in the app-level service maps the incoming URL onto the Angular Router - parse the path off the URL and hand it to `Router.navigateByUrl`. Strip the scheme/host to a router-relative path (split on your domain and take the tail) rather than passing the raw URL; guard unmatched paths to a fallback route instead of navigating blindly. This is the same listener push-tap routing feeds into, so keep one mapping function both call.
- The native side this depends on is config, not code, and ships only when set up: iOS needs an associated-domains entry (`applinks:yourdomain.com`) in Signing and Capabilities plus the matching apple-app-site-association file served from the site's well-known path; Android needs an intent-filter with `android:autoVerify="true"` on the activity and the assetlinks.json (carrying the signing-cert SHA256) likewise served. Flag both as prerequisites - the listener is a no-op until the two-way site association verifies.
- Register the listener early (it can deliver the launch URL), capture the handle, and remove it on teardown like every other `App` listener.

### Offline-first sync
- Local store is the source of truth, the network is an optimization: the UI reads from and writes to the local store and never blocks on connectivity. Pick by data shape - Preferences for small key/value (flags, last-synced cursor, the queue head), SQLite for real relational/list data; do not abuse Preferences as a database.
- Queue writes, drain on reconnect: a mutation writes locally and enqueues a pending operation; a `Network.addListener('networkStatusChange', ...)` (seeded by an initial `getStatus()`) drains the queue when `connected` flips true, reconciles server responses back into the local store, and surfaces conflicts as a typed `Result` rather than a throw. Keep the queue and the drain in the wrapping service so pages stay connectivity-agnostic.
- Re-read connectivity on resume (it may have changed while backgrounded) and trigger a drain there too, tying into the existing resume handler.

## Testing the native seams
- Unit-test the wrapping service, not the device: with the plugin mocked (the runner's spy - `jest.fn()` or `jasmine.createSpyObj`, per `angular-conventions`), assert the web-fallback branch and the permission-denied path return the typed `Result` the UI renders. These run in jsdom with no device or emulator.
- Do not try to drive real native plugin behavior in a jsdom unit test - the bridge is not there, so a test that 'exercises' the native path is only exercising your mock. Keep those tests honest about that boundary.
- Reserve appium-mcp (opt-in, heavy - needs Xcode/Android SDK + Java) for true device/E2E smoke of the few native-critical flows (push tap -> route, deep-link cold start, an offline-then-reconnect drain). Smoke the handful that would silently break in production, not the whole surface.

## Anti-patterns
- A native plugin call with no web fallback (breaks the dev / PWA build); permissions requested up front; raw plugin APIs in components; an unmaintained one-off plugin where an official / Capawesome / community one exists; hardcoded theme colors instead of Ionic CSS variables.

<!-- House Ionic/Capacitor conventions; in-app navigation + page lifecycle owned in references/navigation-and-lifecycle.md; component APIs / theming fetched live via context7 / the Ionic docs. -->
