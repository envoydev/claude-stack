---
name: frontend
description: "Router and index for web frontend work - maps a frontend area (Angular framework code, TypeScript/JavaScript language, Material/CDK components, CSS/SCSS styling, client-side security, library docs) to the focused skill to load, plus the in-skill Design quality bar. Load when starting web UI work where the right skill is not yet obvious - a feature spanning components, styles, and security, or orienting in an unfamiliar frontend codebase. Do NOT load when the leaf skill is already known - go straight to it (typescript is always the companion for TS/JS). For Ionic/Capacitor mobile see mobile; for .NET backend see dotnet."
---

# frontend (web frontend router)

Index mapping a web-frontend work area to the skill to load. It routes rather than copies - load the named skill for the actual guidance; the one deliberate exception is the Design quality section below, which lives in-skill (it replaced the removed frontend-design plugin). If you already know the leaf skill, go straight to it and skip this router. The .NET backend has its own index (`dotnet`); this is the web-frontend side.

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

House guidance for UI that looks intentional, not generic-AI-default. Apply it on greenfield or visual work, and skip it when you are reproducing a fixed design or Figma handoff faithfully. It owns the *taste*; the mechanism routes to `angular-styling` (CSS, tokens, responsive) and `angular-material` (theming).

- **A real design system, not defaults.** Commit to a deliberate type scale, a spacing rhythm, and a genuine color system (surfaces, accents, states) - not the framework's out-of-the-box palette and default margins.
- **Layout with intent.** Build hierarchy from scale, weight, and whitespace; align to a grid; give content room. Avoid the evenly-spaced, center-everything, single-column default.
- **Motion with purpose.** Transitions and micro-interactions that clarify a state change, not decoration - and respect prefers-reduced-motion.
- **Design every state.** Empty, loading, error, and success are part of the UI, not afterthoughts.
- **Responsive by construction, accessible by default.** Contrast, focus-visible, and keyboard paths are not optional; the a11y rules themselves stay in `angular-conventions` / `angular-styling`.

## Notes
- Angular is the house web framework, and a path-scoped convention rule already auto-attaches `typescript` + `angular-conventions` on `.ts` edits (soft guidance) - this router is for navigation, not enforcement.
- Not every route target is a skill: context7 is an MCP server and the Design quality section is in-skill; the rest of the column are skills.
- No separate a11y row: `angular-conventions` owns the a11y rules (and ships the `axe-core` / `jest-axe` checks), `angular-styling` the styling-side a11y. Cross-framework state management is intentionally unrouted - no house skill owns it.
- `frontend` and `mobile` stay split on purpose: an Ionic/Capacitor app pulls a distinct native layer (Capacitor lifecycle, plugins, permissions) that plain web work never touches.
