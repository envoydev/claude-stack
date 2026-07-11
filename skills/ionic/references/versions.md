# Ionic + Capacitor version notes

The hub (`SKILL.md`) stays version-agnostic. This file is the orientation map for the two version axes the skill spans - **Ionic Framework** (the UI toolkit) and **Capacitor** (the native runtime), which version independently and must not be conflated. It carries the floors, the per-major deltas that actually bite, and where to fetch the full migration guide - fetch the linked guide live for the exhaustive list; this is the index, not a vendored changelog.

## Ionic Framework

Floor: Ionic 7. Current: Ionic 8 (needs Angular 16+; the house floor is Angular 17+). Prefer the 8 path.

- **7 -> 8** (fetch <https://ionicframework.com/docs/updating/8-0>):
  - Legacy form syntax removed - `label` / `fill` / `helperText` / `errorText` / `counter` live on `IonInput` / `IonTextarea` / `IonSelect`, never slotted in `IonItem`; the `legacy` property is gone. (Hub: Form controls.)
  - Dark mode: import the dark palette via `dark.always.css` / `dark.class.css` / `dark.system.css`; palettes target `:root`, not `body`. Light defaults now import from `core.css`.
  - Step tokens split: `--ion-color-step-N` became `--ion-background-color-step-N` + `--ion-text-color-step-N`.
  - `--ion-default-dynamic-font` renamed `--ion-dynamic-font` (Dynamic Type, on by default).
  - `IonPicker` is now the inline component; the old one is `IonPickerLegacy` (deprecated). `Nav.getLength()` returns a `Promise`. `IonBackButtonDelegate` import became `IonBackButton`.
- **6 -> 7** (fetch <https://ionicframework.com/docs/updating/7-0>): Angular 16+, adopt the built-in control-flow, and the old virtual-scroll component was removed - use Angular CDK virtual scroll (Hub: Large lists).

## Capacitor

Floor: Capacitor 6 (a live v6 project is in scope). Current: Capacitor 8. Prefer the 8 path. Majors cannot be skipped - upgrade 6 -> 7 -> 8 in steps, and `npx cap migrate` automates most of each hop.

- **6 -> 7** (fetch <https://capacitorjs.com/docs/updating/7-0>): Node 20+, Xcode 16, iOS target 14, Android Studio Ladybug + JDK 21, Kotlin 1.9.25, minSdk 23 / targetSdk 35; removed `bundledWebRuntime` and `cordova.staticPlugins`.
- **7 -> 8** (fetch <https://capacitorjs.com/docs/updating/8-0>): Node 22+, Xcode 26, iOS target 15, Swift Package Manager is the default iOS dependency manager (CocoaPods via `--packagemanager CocoaPods`), Android Studio Otter + Kotlin 2.2.20, minSdk 24 / compile+target 36, edge-to-edge via the System Bars plugin + CSS `env()` (Hub: Components; `capacitor-release` owns the SPM iOS-build change).
- Support policy - which majors are still maintained, the signal for when to raise the floor: <https://capacitorjs.com/docs/main/reference/support-policy>
