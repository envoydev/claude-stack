---
name: mobile
description: "Router and index for Ionic / Capacitor mobile + hybrid app work - maps a mobile area (Ionic Angular UI, Capacitor app structure, native plugins) to the focused skill to load. Routes per area, does not restate. Companions: angular-conventions (the Angular framework), typescript (the language). Load when building an Ionic/Capacitor app. For plain web frontend see frontend; for .NET backend see dotnet."
---

# mobile (Ionic / Capacitor router)

Index mapping an Ionic/Capacitor mobile work area to the skill to load. Routes, does not restate. An Ionic/Capacitor app is an Angular + TypeScript app in a native shell - load those baselines too.

## Area -> skill

| You are about to... | Load |
|---|---|
| follow house Ionic/Capacitor conventions - structure, lifecycle, permissions, plugin sourcing + wrapping | `ionic` |
| build Ionic Angular UI - components, theming, navigation | `ionic-angular` |
| structure a Capacitor app - lifecycle, config, the native bridge | `capacitor-angular` |
| install / configure / use a Capacitor plugin (official, Capawesome, community, CapGo) | `capacitor-plugins` |
| build / sign / submit a release, wire OTA + the release CI pipeline | `capacitor-release` |
| write the Angular framework code underneath | `angular-conventions` |
| write the TypeScript / JavaScript baseline | `typescript` |
| build plain (non-mobile) web frontend | `frontend` |

## Notes
- Ionic/Capacitor apps are Angular apps in a native shell: the framework rules (`angular-conventions`) and language baseline (`typescript`) still apply - this router adds the mobile-specific layer on top.
- `ionic-angular`, `capacitor-angular`, and `capacitor-plugins` are external siblings installed live from capawesome-team/skills, not this repo - a dangling name here is that external skill, available only once the full installer has run.
- Native Swift / Kotlin platform code and custom-plugin authoring are deliberately out of scope here - Capacitor generates the native shell, so reach for the platform native docs for that, not this router.
- Backend / .NET work routes through `dotnet`.
