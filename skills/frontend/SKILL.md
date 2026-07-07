---
name: frontend
description: "Router and index for web frontend work - maps a frontend area (Angular framework code, TypeScript/JavaScript language, Material/CDK components, CSS/SCSS styling, client-side security, distinctive production UI, library docs) to the focused skill to load. Routes per area, does not restate. Companion: typescript (always, for any TS/JS). Load when starting or navigating web frontend work. For Ionic/Capacitor mobile see mobile; for .NET backend see dotnet."
---

# frontend (web frontend router)

Index mapping a web-frontend work area to the skill to load. It routes, it does not restate - load the named skill for the guidance. The .NET backend has its own index (`dotnet`); this is the web-frontend side.

**Companion, not optional:** load `typescript` for any TS/JS - strict typing, type modeling, modules, async, errors. Every row below is in addition to that language baseline.

## Area -> skill

| You are about to... | Load |
|---|---|
| write or edit Angular components, services, signals, templates, routing, forms, a11y | `angular-conventions` |
| write any TypeScript / JavaScript (the framework-agnostic language baseline) | `typescript` (always) |
| build distinctive, production-grade UI that avoids generic AI aesthetics | the Design quality notes below (in-skill) |
| build UI with Angular Material (`@angular/material`) + CDK components | `angular-material` |
| write or edit CSS / SCSS in an Angular app - scoping, ViewEncapsulation, design tokens, responsive, a11y styling | `angular-styling` |
| harden or review an Angular feature - XSS, sanitization, CSP, CSRF, auth-token storage, SSR/TransferState leaks | `angular-security` |
| build an Ionic / Capacitor mobile or hybrid app | `mobile` |
| look up current framework / library API docs | the context7 MCP |

## Design quality (distinctive, production-grade UI)

House guidance for UI that looks intentional, not generic-AI-default. This lives in-skill now (it was a separate plugin before); apply it on greenfield or visual work, and skip it when you are reproducing a fixed design or Figma handoff faithfully. It owns the *taste*; the mechanism routes to `angular-styling` (CSS, tokens, responsive) and `angular-material` (theming).

- **A real design system, not defaults.** Commit to a deliberate type scale, a spacing rhythm, and a genuine color system (surfaces, accents, states) - not the framework's out-of-the-box palette and default margins.
- **Layout with intent.** Build hierarchy from scale, weight, and whitespace; align to a grid; give content room. Avoid the evenly-spaced, center-everything, single-column default.
- **Motion with purpose.** Transitions and micro-interactions that clarify a state change, not decoration - and respect prefers-reduced-motion.
- **Design every state.** Empty, loading, error, and success are part of the UI, not afterthoughts.
- **Responsive by construction, accessible by default.** Contrast, focus-visible, and keyboard paths are not optional; the a11y rules themselves stay in `angular-conventions` / `angular-styling`.

## Notes
- Router, not a copy: load the named skill for the actual guidance; this file only points.
- Angular is the house web framework: `angular-conventions` owns the framework rules, `typescript` the language. The web-conventions rule auto-attaches `typescript` + `angular-conventions` on `.ts` edits (soft guidance), so this router is for *navigation*.
- Not every route target is a skill: context7 is an MCP server (load via the MCP, not `npx skills add`) and the Design quality notes below are in-skill guidance; the rest of the column are skills.
- Angular CSS/styling architecture has its own skill now (`angular-styling`); cross-framework state management is still intentionally out of scope - no house skill, so this router routes only what it owns. Web accessibility is not a separate row because `angular-conventions` owns the a11y rules (and ships the `axe-core` / `jest-axe` checks) while `angular-styling` carries the styling-side a11y (focus-visible, prefers-reduced-motion, contrast); for non-Angular a11y reach for the framework's own docs via context7.
- Two routers on purpose: `frontend` and `mobile` stay split because an Ionic/Capacitor app pulls a distinct native layer (Capacitor lifecycle, plugins, permissions) that plain web work never touches - folding them would bury the mobile rows behind web ones.
- Backend / .NET work routes through `dotnet`, not here.
