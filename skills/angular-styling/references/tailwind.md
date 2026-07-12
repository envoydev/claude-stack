# Tailwind in an Angular workspace - the opt-in path

`SKILL.md` owns the house decision (scoped component SCSS by default; Tailwind only on an explicit team opt-in). This file is the integration mechanics for a project that did opt in.

Install it the Angular way - `ng add tailwindcss` (Angular ships an official integration) - which wires PostCSS and adds a single `@import "tailwindcss";` to `styles.css`, or `@use "tailwindcss";` if the global entry is `styles.scss` (the guide sanctions both). Tailwind v4 is CSS-first, so keep that one import at the global entry rather than threading its utilities through per-component Sass.

Utilities are global by nature, so they coexist with emulated component styles but bypass scoping - treat them as the global layer, and keep genuinely component-local one-offs in the scoped sheet.
