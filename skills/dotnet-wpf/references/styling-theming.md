# WPF styling and theming

The View-side resource discipline for the MVVM architecture in `SKILL.md`: styles, templates, resource dictionaries, theming, and the .NET 9+ Fluent theme. Styling is the same view-only line as MVVM - a ViewModel exposes state, the View decides how that state paints - kept declarative and centralized so a theme or a look changes without touching a code-behind file. XAML formatting and naming style is `references/xaml-style.md`.

## Styles and templates

- **`BasedOn` for style inheritance.** Build a variant from a shared base rather than repeating
  setters: `<Style x:Key="DangerButton" TargetType="Button" BasedOn="{StaticResource PrimaryButton}">`
  overrides only what differs. A conflicting setter on the derived style wins over the base.
- **Implicit vs keyed styles.** An implicit style (`TargetType` only, no `x:Key`) applies to every
  control of that type in scope - reserve it for the one true baseline. A keyed style
  (`x:Key="PrimaryButton"`, applied with `Style="{StaticResource PrimaryButton}"`) is an opt-in
  named variant that coexists with the baseline. Do not key the baseline itself - that silently
  un-styles any control that forgot to opt in.
- **`ControlTemplate` vs `DataTemplate` - different ownership.** A `ControlTemplate` replaces a
  control's own visual tree (a `Button`'s chrome and parts) and lives in a `Style`'s `Template`
  setter - a View-only concern with zero ViewModel awareness. A `DataTemplate` maps a data object
  (a ViewModel or POCO) to the visuals that render it, and is how `ItemsControl`, `ContentControl`,
  and `DataTemplateSelector` bridge data to visuals without the data knowing about the View. Reach
  for a `DataTemplate` to render a shape of data, a `ControlTemplate` to restyle a control's chrome.
- **Visual states over triggers where cleaner.** `VisualStateManager` groups mutually exclusive
  states (`Normal`, `MouseOver`, `Pressed`, `Disabled`) into named `VisualState`s with their own
  storyboards, which reads more clearly than several independent `Trigger`/`MultiTrigger` setters
  fighting over the same properties. Reach for a trigger for one independent condition; reach for
  `VisualStateManager` once two or more states are mutually exclusive or animate.

## Resources and theming

- **ResourceDictionary organization.** One dictionary per control or concern -
  `Buttons.xaml`, `TextBoxes.xaml`, `Colors.xaml`, `Typography.xaml` - merged once into `App.xaml`
  via `MergedDictionaries`. Never grow a single monolithic dictionary mixing every control's styles;
  it turns a one-control change into a full-file diff.
- **`DynamicResource` vs `StaticResource`.** `StaticResource` resolves once at load time - use it
  for values that never change at runtime (a fixed corner radius, a font family). `DynamicResource`
  re-resolves whenever the resource entry changes - use it for anything theme-dependent (brushes,
  theme-sensitive thicknesses) so a runtime theme swap actually repaints. Defaulting everything to
  `StaticResource` is the most common reason a theme switch only updates half the UI.
- **Dark mode via swapped theme dictionaries.** Keep one dictionary per theme (`Themes/Light.xaml`,
  `Themes/Dark.xaml`) declaring the same keys with different values, and swap the merged dictionary
  at the application level to switch - replace the entry in `Application.Current.Resources.MergedDictionaries`,
  or use the built-in `ThemeMode` on .NET 9+ (below) where it covers the need. Every themed value
  must be reached through `DynamicResource` or the swap has nothing to repaint.
- **Design tokens, not literals.** Centralize the palette and spacing scale once - named brushes
  (`Brush.Primary`, `Brush.Surface`) and named thicknesses (`Thickness.CardPadding`) - and reference
  the token everywhere instead of a literal `Color` or `Thickness` inline in a template. A hardcoded
  `#FF3366` three templates deep is a color theming can never reach.

## Fluent theming (.NET 9+)

- On .NET 9+, prefer the built-in Fluent theme over a hand-rolled dark palette: set `ThemeMode`
  (`System`, `Light`, `Dark`) on `Application` or a `Window` for Windows 11 styling with automatic
  system light/dark switching. Reference theme-sensitive brushes with `DynamicResource` so they
  track the active mode.
- `ThemeMode` is still experimental through .NET 10: setting it from code needs the `WPF0001` diagnostic suppressed, while opting in via the `Fluent.xaml` merged dictionary avoids that. Either way Fluent ships as merged resource dictionaries, not a true theme assembly, so custom implicit styles and triggers can resolve against it in surprising ways - when customizing a Fluent-themed control, override the specific Fluent resource keys or start from a copied Fluent template rather than assuming a clean, overridable theme layer.

## Don't

- Repeat the same inline `Style` block across multiple views - promote it to a resource dictionary
  the moment a second view needs it.
- Reference a theme brush with `x:Static` - it resolves at compile/load time and cannot see a
  runtime theme swap; use `DynamicResource` for anything theme-dependent instead.
