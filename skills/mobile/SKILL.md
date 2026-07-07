---
name: mobile
description: "Router and index for Ionic / Capacitor mobile + hybrid app work - maps a mobile area (Ionic Angular UI, Capacitor app structure, native plugins, release + signing, security hardening) to the focused skill to load. Routes per area, does not restate. Companions: angular-conventions (the Angular framework), typescript (the language). Primary routes: ionic (conventions + plugins), capacitor-release (release + signing), mobile-security (hardening). Load when building an Ionic/Capacitor app. For plain web frontend see frontend; for .NET backend see dotnet."
---

# mobile (Ionic / Capacitor router)

Index mapping an Ionic/Capacitor mobile work area to the skill to load. Routes, does not restate. An Ionic/Capacitor app is an Angular + TypeScript app in a native shell - load those baselines too.

## Area -> skill

| You are about to... | Load |
|---|---|
| follow house Ionic/Capacitor conventions - structure, lifecycle, permissions, plugin sourcing + wrapping | `ionic` |
| build Ionic navigation or page lifecycle | `ionic` (its `references/navigation-and-lifecycle.md`); component APIs / theming fetched live |
| wire the Angular+Capacitor bridge - lifecycle listeners, zone glue, back button, deep links | `ionic` |
| install / configure a Capacitor plugin (official, Capawesome, community, CapGo) | `ionic` for sourcing + wrapping; per-plugin config fetched live (context7 / plugin README) |
| build / sign / submit a release, wire OTA + the release CI pipeline | `capacitor-release` |
| harden or security-review an Ionic/Capacitor feature - secret storage, deep-link input, native permissions, cleartext + WebView hardening | `mobile-security` |
| write the Angular framework code underneath | `angular-conventions` |
| write the TypeScript / JavaScript baseline | `typescript` |
| build plain (non-mobile) web frontend | `frontend` |

## Notes
- Ionic/Capacitor apps are Angular apps in a native shell: the framework rules (`angular-conventions`) and language baseline (`typescript`) still apply - this router adds the mobile-specific layer on top.
- Ionic in-app navigation and the page lifecycle are house-owned in `ionic` (its `references/navigation-and-lifecycle.md`); broader Ionic component APIs and theming are fetched live (context7 / the Ionic docs). Per-plugin install/config is fetched live; the house plugin-sourcing and wrapping guidance lives in `ionic`.
- Security hardening (secret storage, deep-link input, native permissions, cleartext + WebView) is house-owned in `mobile-security` and not restated here; the security-auditor loads it when sweeping the mobile stack.
- Native Swift / Kotlin platform code and custom-plugin authoring are deliberately out of scope here - Capacitor generates the native shell, so reach for the platform native docs for that, not this router.
- Backend / .NET work routes through `dotnet`.
