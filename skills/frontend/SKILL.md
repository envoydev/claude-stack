---
name: frontend
description: "Router and index for web frontend work - maps a frontend area (Angular framework code, TypeScript/JavaScript language, component/design-system UI, distinctive production UI, library docs) to the focused skill to load. Routes per area, does not restate. Companion: typescript (always, for any TS/JS). Load when starting or navigating web frontend work. For Ionic/Capacitor mobile see mobile; for .NET backend see dotnet."
---

# frontend (web frontend router)

Index mapping a web-frontend work area to the skill to load. It routes, it does not restate - load the named skill for the guidance. The .NET backend has its own index (`dotnet`); this is the web-frontend side.

**Companion, not optional:** load `typescript` for any TS/JS - strict typing, type modeling, modules, async, errors. Every row below is in addition to that language baseline.

## Area -> skill

| You are about to... | Load |
|---|---|
| write or edit Angular components, services, signals, templates, routing, forms, a11y | `angular-conventions` |
| write any TypeScript / JavaScript (the framework-agnostic language baseline) | `typescript` (always) |
| build distinctive, production-grade UI that avoids generic AI aesthetics | the frontend-design plugin |
| build UI with Angular Material (`@angular/material`) + CDK components | `angular-material` |
| write or edit CSS / SCSS in an Angular app - scoping, ViewEncapsulation, design tokens, responsive, a11y styling | `angular-styling` |
| implement Material Design 3 for Jetpack Compose / Flutter / @material/web (NOT Angular Material) | `material-3` |
| build an Ionic / Capacitor mobile or hybrid app | `mobile` |
| look up current framework / library API docs | the context7 MCP |

## Notes
- Router, not a copy: load the named skill for the actual guidance; this file only points.
- Angular is the house web framework: `angular-conventions` owns the framework rules, `typescript` the language. The convention gate already force-loads both on `.ts` edits, so this router is for *navigation*, not enforcement.
- Not every route target is a skill: the frontend-design plugin is a Claude plugin and context7 is an MCP server (load via the plugin / MCP, not `npx skills add`); the rest of the column are skills.
- `material-3` is an external sibling installed live from hamen, not this repo - a dangling name here is that external skill, available only once the full installer has run.
- Angular CSS/styling architecture has its own skill now (`angular-styling`); cross-framework state management is still intentionally out of scope - no house skill, so this router routes only what it owns. Web accessibility is not a separate row because `angular-conventions` owns the a11y rules (and ships the `axe-core` / `jest-axe` checks) while `angular-styling` carries the styling-side a11y (focus-visible, prefers-reduced-motion, contrast); for non-Angular a11y reach for the framework's own docs via context7.
- Two routers on purpose: `frontend` and `mobile` stay split because an Ionic/Capacitor app pulls a distinct native layer (Capacitor lifecycle, plugins, permissions) that plain web work never touches - folding them would bury the mobile rows behind web ones.
- Backend / .NET work routes through `dotnet`, not here.
