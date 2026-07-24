---
paths: ["**/angular.json", "**/*.component.ts", "**/*.component.html", "**/*.service.ts", "**/*.directive.ts", "**/*.pipe.ts", "**/*.guard.ts", "**/*.resolver.ts", "**/*.module.ts", "**/*.routes.ts", "**/src/app/**/*.ts", "**/src/app/**/*.html", "**/src/lib/**/*.ts", "**/src/lib/**/*.html"]
---

Editing Angular / Ionic framework code - load `angular-conventions` (on top of the `typescript`
baseline) before the edit - skip the load when it is already in context (some seats preload it);
conventions are the source of truth, not recall.
Covers components, services, directives, pipes, guards, resolvers, modules, routes, and templates -
an Ionic/Capacitor app shares the same conventions (a bespoke layout outside `src/app` / `src/lib`:
load the skill yourself). In an Ionic/Capacitor workspace (`ionic.config.json` /
`capacitor.config.*` present) also load `ionic` - it overrides where Ionic diverges (shell change
detection, zoneless, forms, transitions, refresh-on-entry). Skip one-line tweaks.

<!-- Maintainer note: the src/app / src/lib directory globs exist to catch the v20 suffix-less file names the type-suffix globs miss. -->
