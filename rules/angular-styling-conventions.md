---
paths: ["**/*.component.scss", "**/*.component.css", "**/src/styles.scss", "**/src/styles.css", "**/src/global.scss", "**/src/theme/**/*.scss", "**/src/app/**/*.scss", "**/src/app/**/*.css", "**/src/lib/**/*.scss", "**/src/lib/**/*.css"]
---

Editing stylesheets in an Angular / Ionic workspace - load `angular-styling` before the edit - skip the load when it is already in context (some seats preload it);
conventions are the source of truth, not recall. Governs `.scss`/`.css` component-scoped styling,
Material or not. Skip one-line tweaks.
