---
name: angular-material
description: "Personal Angular Material and CDK conventions - import only the component modules a standalone component uses (no shared barrel), theme through the M3 mat.theme API and its generated CSS custom properties rather than hand-edited .mat-* rules, reach for CDK primitives (Overlay, drag-drop, virtual scroll, FocusTrap, LiveAnnouncer) before rolling your own, and test through the official harnesses, not DOM queries on internals. Targets @angular/material 17+. Load when building UI with @angular/material or @angular/cdk. Companions: angular-conventions for the framework, typescript for the language. Separate from material-3, which is generic Material Design 3 and NOT this library. Skip for PrimeNG, Spartan UI, Ionic, or apps not using Angular Material."
---

# Angular Material and CDK

This is the component-library layer: `@angular/material` (the Material 3 components) sitting on top of `@angular/cdk` (the unstyled behavior primitives). The framework itself - signals, change detection, standalone components, the testing setup - belongs to `angular-conventions`, and the language to `typescript`; load both alongside this. The general CSS/styling layer that holds Material or not - `ViewEncapsulation`, `:host`, the `::ng-deep` ways out, the app's own design tokens, responsive strategy - is `angular-styling`; this skill owns only the Material-specific `mat.theme` and `--mat-sys-*` token work. Do not confuse this with `material-3`, which covers generic Material Design 3 tokens and the maintenance-mode `@material/web` web components - that is a different skill for a different library.

Floor is `@angular/material` 17+ (standalone components are the default, the M3 theming API is stable). Anything that landed later is flagged as optional.

## Import what you use, nothing more

Each Material component ships as its own NgModule. Import them directly into the standalone component that renders them:

```ts
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  // ...
})
export class ToolbarComponent {}
```

Do not create a shared module that re-exports every Material module and import that everywhere. The barrel is the single most common Angular Material mistake: it pulls dozens of components the component never touches into the dependency graph, defeats tree-shaking, and inflates the bundle. One import line per component the template actually uses - the cost of being explicit is a few lines; the payoff is a lean build.

## Theme through the M3 API, never hand-edited internals

Define the theme once in Sass with `mat.theme`, driving color, typography, and density from the system input map:

```scss
@use '@angular/material' as mat;

html {
  @include mat.theme((
    color: (
      primary: mat.$azure-palette,
      tertiary: mat.$blue-palette,
    ),
    typography: Roboto,
    density: 0,
  ));
}
```

`mat.theme` emits CSS custom properties (the `--mat-sys-*` system tokens). Read those tokens when a component needs a themed color - `color: var(--mat-sys-primary)` - so the value tracks the active theme automatically.

Two rules hold the theming together:

- Never reach into a component's internal DOM with a `.mat-*` selector to repaint it (`.mat-mdc-button { background: #1976d2; }`). Those class names are private implementation detail. The override breaks the moment dark mode, a density change, or a Material version bump moves the markup, and it silently ignores the theme system. Style through the system tokens or the component's documented theming mixins instead.
- Keep exactly one theme definition and let it respond to the OS preference. Wrap the dark overrides in a media query or a `.dark` class that re-runs `mat.theme` with a dark color scheme - do not fork the whole stylesheet per mode.

Density and typography are part of the same call, not separate hacks - set `density: -2` for a compact table view rather than overriding heights component by component.

When the system tokens are not enough and one component needs a specific change, use its overrides mixin - `mat.<component>-overrides` (`mat.button-overrides`, `mat.card-overrides`, ...) - inside the selector you want it scoped to. This is the sanctioned, upgrade-safe form of 'documented theming mixins': it writes the component's own tokens, so it survives a version bump where a `.mat-mdc-*` selector would shatter.

```scss
.checkout-cta {
  @include mat.button-overrides((
    container-color: var(--mat-sys-tertiary),
    label-text-color: var(--mat-sys-on-tertiary),
  ));
}
```

Bind the overrides mixin or a `--mat-sys-*` system token - never a raw per-component custom property by hand. (v20 renamed those raw properties from the old `--mdc-*` prefix to `--mat-*`, e.g. `--mdc-outlined-card-container-shape` became `--mat-card-outlined-container-shape`; run `ng generate @angular/material:token-rename` when upgrading.)

## Reach for CDK primitives before hand-rolling

The CDK packages the behaviors that are deceptively hard to get right - the edge cases, keyboard handling, and accessibility you would otherwise reimplement and ship with bugs. Prefer the primitive over a bespoke version every time:

- Long lists: `CdkVirtualScrollViewport` with `*cdkVirtualFor` recycles DOM nodes so a 10,000-row list renders a screenful. No manual scroll math, no windowing library.
- Floating UI: the `Overlay` service positions menus, tooltips, popovers, and custom dropdowns against a connected element, handling viewport flipping and scroll repositioning. This is also what Material's own menu and select build on.
- Drag and drop: `cdkDrag` and `cdkDropList` give reorderable lists and cross-container transfers with the pointer and keyboard handling already done.
- Clipboard: `cdkCopyToClipboard` copies a string on click without touching the Clipboard API directly.
- Accessibility: `FocusTrap` (`cdkTrapFocus`) keeps keyboard focus inside a dialog or panel, and `LiveAnnouncer` pushes polite messages to screen readers for state changes the user cannot see. Use `FocusKeyManager` / `ListKeyManager` for arrow-key navigation inside a custom listbox or menu. Prefer the `cdkTrapFocus` directive; if you construct a trap programmatically, note v21 made the injector parameter required on the `FocusTrap` / `ConfigurableFocusTrap` constructors and replaced `ConfigurableFocusTrapFactory.create`'s boolean argument with a config object.

A hand-written overlay, virtual scroller, or focus trap is almost always missing a case the CDK already handles - that is the reason to default to the primitive.

## Test through harnesses, not DOM internals

Drive every Material component in tests through its component test harness, loaded via a `HarnessLoader`:

```ts
const loader = TestbedHarnessEnvironment.loader(fixture);
const select = await loader.getHarness(MatSelectHarness);
await select.open();
await select.clickOptions({ text: 'Berlin' });
expect(await select.getValueText()).toBe('Berlin');
```

Harnesses (`MatSelectHarness`, `MatInputHarness`, `MatButtonHarness`, ...) are maintained by the Angular team and expose a stable, intent-level API - open the select, click the option, read the value - independent of the internal markup. Query the harness; never assert against `.mat-mdc-*` classes or the component's private DOM, because those tests shatter on the next Material release. The broader testing discipline (TestBed setup, fixtures, async handling) lives in `angular-conventions`; this is only the Material-specific harness rule.

## Newer versions (v20 / v21, optional)

Floor is v17; reach for these where the installed version ships them.
- **Button directive (v20):** the `mat-button` family is now the `matButton` attribute - bare `matButton` for text, and `matButton="elevated" | "filled" | "outlined" | "tonal"`. The M3 `tonal` variant sits between filled and outlined; `matIconButton` gains `filled` / `tonal` too, and cards take `appearance="filled"`. Update the old `mat-raised-button` / `mat-flat-button` / `mat-stroked-button` selectors when you touch them.
- **Reduced motion (v20):** Material honors the prefers-reduced-motion media query on its own animations - do not hand-gate motion you got from a component.
- **FocusTrap (v21, breaking):** the programmatic constructor / factory changed (see the CDK accessibility note); the `cdkTrapFocus` directive is unaffected, so prefer it.
- **Angular Aria (v21, developer preview):** `@angular/aria` is a new headless, unstyled a11y primitive set (Accordion, Combobox, Listbox, Menu, Tabs, Tree) that overlaps parts of the CDK; combobox graduated to a stable un-prefixed component. Name it, but stay on the CDK / Material components until it leaves preview rather than building on a moving API.
- **CDK overlays (v21):** the `Overlay` service now builds on the browser-native Popover API with per-side viewport margins; the service API you call is unchanged.

## Anti-patterns

- A shared 'material module' barrel re-exporting every component - import per component instead.
- Hand-edited `.mat-*` color or layout overrides - theme through `mat.theme` and the system CSS custom properties.
- A second, forked stylesheet for dark mode instead of one theme that responds to the color scheme.
- Raw DOM queries on Material internals in tests - use the harness.
- A hand-rolled overlay, virtual scroll, drag-drop, or focus trap where the CDK already ships one.

<!-- Some conventions here were mined from alfredoperez/angular-best-practices (MIT) - see Credits in README.md. -->

