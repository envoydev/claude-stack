---
name: dotnet-wpf
description: "Personal WPF conventions - strict MVVM with a one-way View-knows-ViewModel dependency, paired naming, explicit binding modes and update triggers, CommunityToolkit.Mvvm source generators over hand-rolled INotifyPropertyChanged, INotifyDataErrorInfo validation, async commands carrying a CancellationToken, dependency vs attached properties, commands over routed events, behaviors over code-behind wiring, generic-host app composition, off-UI-thread work via IProgress, list virtualization, plain-CLR tests, resource dictionaries with the .NET 9 Fluent ThemeMode, and resx localization. Floors at .NET 8 / C# 12. Load before editing any XAML, code-behind, or ViewModel. Do NOT load for WinForms, UWP, WinUI 3, MAUI, Avalonia, or Uno - different frameworks; orchestration routes to csharp-design-patterns, tests to dotnet-testing, a paired Windows-Service worker to dotnet-hosted-services."
---

# WPF conventions

WPF is a retained-mode XAML UI on the data-binding engine. The whole discipline below exists to keep
view concerns (visuals, the visual tree, the dispatcher) on one side of a line and application state
on the other, so the state side stays a plain testable C# object. Floor is .NET 8 / C# 12.

## MVVM is the architecture, not a suggestion

Three layers, with a deliberately one-directional dependency:

- **View** - the `.xaml` plus a code-behind file that holds only view-only mechanics (nothing the
  ViewModel could own).
- **ViewModel** - observable state plus `ICommand`s. A plain CLR object.
- **Model** - the domain. Knows nothing about either layer above it.

The dependency points one way: the View references its ViewModel, the ViewModel never references the
View. The concrete test is types - if a ViewModel mentions `Window`, `UserControl`, `Dispatcher`,
`Visibility`, or any visual-tree element, the line has been crossed. State leaves the ViewModel as
bindable properties and commands; the binding engine does the rest.

Set the binding context by convention (a ViewModel-locator or DI-resolved `DataContext`), not with
`new SomeViewModel()` in code-behind, so the ViewModel's dependencies stay injectable.

## App composition and startup

Compose the app through the .NET generic host, not hand-rolled service location or `new` in code-behind.

- Build a `Microsoft.Extensions.Hosting` host in `App.xaml.cs`, register windows, ViewModels, and services on it, resolve the main window from the container in `OnStartup`, and drop `StartupUri` - the window's dependencies then inject through its constructor.
- Turn on `ValidateScopes` and `ValidateOnBuild` so captive-dependency and disposed-scope mistakes fail at startup instead of at runtime.
- Never call `BuildServiceProvider` inside registration to pull a service early - it stands up a second container and leaks a duplicate set of singletons.

## Pairing with a Windows Service

A WPF desktop is often the front for a Windows Service companion - a tray or dashboard UI over a background daemon. Build the service half as a worker, not WPF code: its host composition, the SCM lifetime, `AppContext.BaseDirectory` path resolution, and least-privilege service account are `dotnet-hosted-services`' domain - load that skill for the service process. The two share only a contract - a named pipe, a local socket, a file or database, an IPC channel - never a UI thread or a `Dispatcher`; a service-pushed update crosses into the app as data and marshals onto the UI thread like any other off-thread work.

## Naming and pairing

- View: `OrderListView.xaml` and `OrderListView.xaml.cs`.
- ViewModel: `OrderListViewModel.cs`.
- The pair lives in the same feature folder. Folder-per-feature beats type-per-folder (`Views/`,
  `ViewModels/`) once a screen has more than a couple of files.

## Observable state with the toolkit, not by hand

Use `CommunityToolkit.Mvvm`. Derive the ViewModel from `ObservableObject`, declare backing fields
with `[ObservableProperty]`, and let the source generator emit the property, the `PropertyChanged`
raise, and partial change hooks. Hand-writing `INotifyPropertyChanged` with `SetField` /
`CallerMemberName` boilerplate is wasted code and a place for bugs.

- `[NotifyPropertyChangedFor(nameof(FullName))]` keeps a derived property in sync without a manual
  raise.
- `[NotifyCanExecuteChangedFor(nameof(SaveCommand))]` re-queries a command's `CanExecute` when its
  input changes - cleaner than calling `NotifyCanExecuteChanged()` from a setter.

## Commands, not Click handlers

- Buttons, menu items, and key gestures bind `Command` (an `ICommand`); they do not wire `Click` in
  code-behind. Declare commands with `[RelayCommand]` - the generator produces the `IRelayCommand`
  property and threads `CanExecute` from a named predicate.
- Pass command parameters through `CommandParameter` and a typed `[RelayCommand]` method argument,
  not by reaching into the View.
- Deeper command orchestration - undo/redo stacks, command queues, snapshot/restore - is plain C#
  (Command, Memento, Observer) and routes to `csharp-design-patterns`, not into the ViewModel.

## Async commands carry a token and own their faults

- An async command is a `Task`-returning method under `[RelayCommand]` (which produces an
  `AsyncRelayCommand`), or `AsyncRelayCommand` directly. Never wrap async work behind a synchronous
  `ICommand` and block on `.Result` / `.Wait()` - that deadlocks against the UI `SynchronizationContext`.
- Bind the generated `IsRunning` to button enable-state and a busy indicator. Do not maintain a
  parallel hand-rolled `bool` busy flag.
- Take a `CancellationToken` as the last command parameter (the toolkit supplies one) so long work
  can be cancelled; cancel it on view teardown.
- A faulting `Task` inside a command is silent by default. Catch inside the command and surface the
  failure through an injected `IDialogService` or an error property - never let the `Task` fault
  unobserved. The throw-vs-return baseline and the async rules (`ConfigureAwait`, no blocking) are
  the `csharp` skill's; they apply unchanged here.
- `AsyncRelayCommand` has two fault models - pick one deliberately. The default awaits and rethrows on the UI `SynchronizationContext`, so a try/catch inside the command sees the fault; setting `FlowExceptionsToTaskScheduler` instead routes it to `TaskScheduler.UnobservedTaskException`. Prefer the default and catch locally so the failure reaches the user through your dialog or error surface; reach for the flow option only when a deliberate global handler owns it.

## Routed events vs commands

Commands are the default for intent. Routed events are for the low-level interactions commands cannot
express - drag-drop, mouse capture, manipulation. When a routed-event handler is unavoidable in
code-behind, it does one thing: forward to a ViewModel method through a thin private wrapper. No
branching, no domain logic, no state in the handler.

## Clipboard and drag-drop payloads

- Custom types no longer ride onto the clipboard or a drag payload through `BinaryFormatter` - it was removed in .NET 9, so `Clipboard.SetData`, `SetDataObject`, `DoDragDrop`, and navigation-journal state throw `PlatformNotSupportedException` for any non-intrinsic type.
- Put a serializable shape across the boundary instead: a string, an intrinsic type, or your object serialized to JSON or a `byte[]` you re-hydrate yourself. The `System.Runtime.Serialization.Formatters` compatibility shim is a migration bridge, not a destination.

## Bindings: explicit and direct

- Always state `Mode` (`OneWay`, `TwoWay`, `OneTime`, `OneWayToSource`). Relying on a property's
  default binding mode is a silent foot-gun when the property's default later changes.
- `UpdateSourceTrigger=PropertyChanged` for inputs that validate per keystroke; otherwise leave the
  text-box default of `LostFocus`.
- Reach other elements with `ElementName` or `RelativeSource` (`Self`, `FindAncestor`), not by
  walking `VisualTreeHelper` from code-behind.
- WPF binds with `{Binding}`. Compiled bindings (`x:Bind`) are a UWP/WinUI feature that WPF does not
  have - do not reach for it. Set `x:DataType` only where a tooling analyzer you use consumes it.

## Dependency properties vs ViewModel state

These solve different problems; do not confuse them.

- Register a `DependencyProperty` only on a **control** and only when the value must participate in
  the WPF property system - styling, animation, templating, inheritance, or being set from XAML.
  Give it a default and metadata through `PropertyMetadata`; coerce or reject values with
  `CoerceValueCallback` / `ValidateValueCallback` when an invariant must hold.
- ViewModel state is **never** a `DependencyProperty`. It is an `[ObservableProperty]` raising
  `INotifyPropertyChanged`. A ViewModel that inherits `DependencyObject` has the architecture
  inverted.

## Attached properties

- Use an attached property to bolt behavior or data onto an existing control without subclassing
  (`Grid.Row`, `Validation.HasError`, your own `behaviors:Focus.IsFocused`).
- Each is a `DependencyProperty.RegisterAttached` plus a static `GetX` / `SetX` pair.
- Any side effect (subscribing an event, mutating the visual tree) lives in the property-changed
  callback and is undone symmetrically when the value clears or the element unloads. An attached
  property that subscribes without unsubscribing is a leak.

## Behaviors over code-behind wiring

- Reach for `Microsoft.Xaml.Behaviors.Wpf` for cross-cutting interaction - drag-drop, focus
  management, data-triggered animation, event-to-command glue.
- One behavior per concern; compose several on one element rather than building one omni-behavior.
- This replaces `Loaded` / `Unloaded` subscriptions in code-behind for cross-cutting work. If you
  find yourself adding plumbing in code-behind to react to interaction, a behavior is the home.

## Validation lives on the ViewModel

- Implement `INotifyDataErrorInfo` on the ViewModel. The toolkit's `ObservableValidator` base plus
  data-annotation attributes (`[Required]`, `[Range]`, custom `ValidationAttribute`) gives it for
  free; call `ValidateProperty` / `ValidateAllProperties` to drive it. `IDataErrorInfo` is the
  legacy interface - touch it only to extend a screen already built on it.
- Validation logic is C# on the ViewModel, not `ValidationRule` subclasses declared in XAML - XAML
  rules cannot be unit-tested and entangle view and logic.
- Surface errors with a `Validation.ErrorTemplate` on the control. Never concatenate error strings
  into the bound value itself.
- Validate on set for immediate feedback; revalidate the whole aggregate on submit so cross-field
  rules fire.

## Threading: off the UI thread, marshalled back cleanly

- Long work runs off the UI thread - `await` an I/O `Task` directly, or `Task.Run` for CPU-bound
  work. The UI thread stays free to render.
- Report progress with `IProgress<T>` (`Progress<T>` captures the UI `SynchronizationContext` and
  marshals callbacks for you). Reach for `Dispatcher.Invoke` only when there is genuinely no other
  way - it is the escape hatch, not the tool.
- A ViewModel never touches `Application.Current.Dispatcher`. If it truly needs to marshal, inject a
  dispatcher abstraction so the ViewModel stays testable.
- `ObservableCollection<T>` must be mutated on the UI thread - it raises `CollectionChanged`
  synchronously and the binding engine assumes the UI thread. For high-frequency updates, batch into
  a backing list and replace once, or use a collection type built for cross-thread updates, rather
  than firing thousands of per-item notifications.

## Large lists need virtualization

- `ItemsControl` does **not** virtualize by default. For any sizeable collection use `ListView`,
  `ListBox`, or `DataGrid`, which do.
- Keep `VirtualizingStackPanel.IsVirtualizing="True"`,
  `VirtualizingStackPanel.VirtualizationMode="Recycling"`, and
  `ScrollViewer.CanContentScroll="True"`. Recycling reuses containers instead of rebuilding them.
- Do not swap in a `Grid`, `WrapPanel`, or `StackPanel` as the `ItemsPanel` for big lists - they
  measure every child and defeat virtualization.
- For tens of thousands of rows, `DataGrid` with `EnableRowVirtualization` and
  `EnableColumnVirtualization` both true.

## ViewModels are unit tests waiting to happen

- Because a ViewModel is a plain CLR object with no `Window` or `Dispatcher` dependency, it tests
  directly - no UI host. The mechanics (framework, fakes, assertions) are the `dotnet-testing`
  skill's; the WPF-specific points are below.
- Assert change notification by subscribing to `PropertyChanged` and checking the property name
  fired.
- Test a command by calling `Execute(...)` and asserting resulting state or a mocked side effect;
  assert `CanExecute(...)` separately from execution.
- Inject every collaborator - `INavigationService`, `IDialogService`, repositories - so the test
  substitutes them. Navigation runs through an `INavigationService`; a ViewModel never does
  `new Window().Show()`.

## Fluent theming (.NET 9+)

The resource-dictionary and style discipline this rests on lives in Styling and theming below; this
section is only the built-in Fluent theme.

- On .NET 9+, prefer the built-in Fluent theme over a hand-rolled dark palette: set `ThemeMode`
  (`System`, `Light`, `Dark`) on `Application` or a `Window` for Windows 11 styling with automatic
  system light/dark switching. Reference theme-sensitive brushes with `DynamicResource` so they
  track the active mode.
- `ThemeMode` is still experimental through .NET 10: setting it from code needs the `WPF0001` diagnostic suppressed, while opting in via the `Fluent.xaml` merged dictionary avoids that. Either way Fluent ships as merged resource dictionaries, not a true theme assembly, so custom implicit styles and triggers can resolve against it in surprising ways - when customizing a Fluent-themed control, override the specific Fluent resource keys or start from a copied Fluent template rather than assuming a clean, overridable theme layer.

## Styling and theming

WPF styling is the same view-only discipline as the MVVM line above, just applied to resources: a
ViewModel exposes state, and the View decides how that state paints. Keep the visual layer declarative
and centralized so a theme or a look can change without touching a single code-behind file.

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
  or use the built-in `ThemeMode` on .NET 9+ (see Fluent theming above) where it covers the
  need. Every themed value must be reached through `DynamicResource` or the swap has nothing to repaint.
- **Design tokens, not literals.** Centralize the palette and spacing scale once - named brushes
  (`Brush.Primary`, `Brush.Surface`) and named thicknesses (`Thickness.CardPadding`) - and reference
  the token everywhere instead of a literal `Color` or `Thickness` inline in a template. A hardcoded
  `#FF3366` three templates deep is a color theming can never reach.
- **Visual states over triggers where cleaner.** `VisualStateManager` groups mutually exclusive
  states (`Normal`, `MouseOver`, `Pressed`, `Disabled`) into named `VisualState`s with their own
  storyboards, which reads more clearly than several independent `Trigger`/`MultiTrigger` setters
  fighting over the same properties. Reach for a trigger for one independent condition; reach for
  `VisualStateManager` once two or more states are mutually exclusive or animate.

Don't:
- Repeat the same inline `Style` block across multiple views - promote it to a resource dictionary
  the moment a second view needs it.
- Hardcode a color literal outside the palette dictionary - every color is a token reference.
- Reference a theme brush with `x:Static` - it resolves at compile/load time and cannot see a
  runtime theme swap; use `DynamicResource` for anything theme-dependent instead.

## Localization

- Every user-facing string comes from a `resx` file (`Strings.en.resx`, `Strings.uk.resx`). No
  literal sentences in XAML or code.
- Bind with `{x:Static loc:Strings.OrderListTitle}` for static text, or a runtime-resolving markup
  extension where the culture can switch live without a restart.
- Build sentences with composite format strings and named-position placeholders, never string
  concatenation - word order is not the same across languages.

## Forbidden in a ViewModel

- `MessageBox.Show` - go through `IDialogService`.
- Business logic inside a code-behind event handler.
- `Application.Current.Dispatcher` - inject a dispatcher abstraction instead.
- `FindResource` / `TryFindResource` - resource lookup is a View concern.
- Any reference to `Window`, `UserControl`, `Dispatcher`, or a visual-tree type - the moment one
  appears, the MVVM line has been crossed.
