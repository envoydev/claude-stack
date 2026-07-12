---
name: mobile
description: "Router and index for Ionic / Capacitor mobile + hybrid app work - maps a mobile area (Ionic Angular UI, Capacitor app structure, native plugins, release + signing, security hardening) to the focused skill: ionic (conventions + plugins - the default for day-to-day feature work), capacitor-release (release + signing), mobile-security (hardening). Load when starting mobile work and unsure which of those applies, or orienting in a mobile codebase; go straight to the leaf skill when the area is known. Companions: angular-conventions, typescript. For plain web frontend see frontend; for .NET backend see dotnet."
---

# mobile (Ionic / Capacitor router)

Index mapping an Ionic/Capacitor mobile work area to the skill to load. Routes, does not restate. An Ionic/Capacitor app is an Angular + TypeScript app in a native shell - `angular-conventions` and `typescript` still apply underneath; this router adds the mobile-specific layer. Most day-to-day feature work lands on `ionic` - this router earns its load only when the area is genuinely unclear (conventions vs release vs hardening).

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
- Native Swift / Kotlin platform code and custom-plugin authoring are deliberately out of scope here - Capacitor generates the native shell, so reach for the platform native docs for that, not this router.
- Backend / .NET work routes through `dotnet`.
