---
name: dotnet-winforms
description: "House WinForms conventions for maintenance and modernization - logic out of code-behind (MVP passive view for legacy, the .NET 8 MVVM binding engine for new), DI-resolvable forms, async/await with no UI-thread blocking, BindingSource + INotifyPropertyChanged binding, control/component/GDI disposal, PerMonitorV2 high-DPI, virtual-mode grids, presenter unit tests. Floors new work at .NET 8 / C# 12 and covers 4.8 as the supported-but-frozen maintenance surface. Load before editing any Form, UserControl, code-behind, presenter, or .Designer.cs. Do NOT load for WPF (-> dotnet-wpf), WinUI 3, MAUI, Avalonia, or Uno; async baseline -> csharp, MVP/command orchestration -> csharp-design-patterns, tests -> dotnet-testing, upgrade playbook -> dotnet-migrate, a paired Windows-Service worker -> dotnet-hosted-services."
---

# WinForms conventions

WinForms is an immediate-mode, control-tree desktop UI. The realistic work is maintenance and
modernization of line-of-business apps, not greenfield, so this skill floors **new** work at .NET 8 /
C# 12 while treating **.NET Framework 4.8 as a supported-but-frozen maintenance surface** - fully
serviced, but no new WinForms features land there. The conventions below are the same whichever
runtime you are on; the version-specific mechanics live in the references.

**Control naming, event-handler naming, and designer-file conventions live in `references/winforms-style.md`.** This SKILL.md owns the architecture (MVP passive view, DI-resolvable forms, disposal, high-DPI, virtual-mode grids); the C# naming baseline is the `csharp` skill. Above these general conventions, a project's own `.editorconfig` and its `docs/PROJECT-CODE-STYLE.md` win where they diverge.

**Load the version reference for the concrete mechanics:**

- .NET Framework 4.8 (the frozen world) -> **references/net-framework-48.md**
- .NET 8 / 9 / 10 (the strategic target) -> **references/modern-net.md**

Out of scope, by design: the async / nullable / mapping baseline -> `csharp`; deeper MVP, command,
observer, and memento orchestration -> `csharp-design-patterns`; test framework + UI-automation
mechanics -> `dotnet-testing`; the upgrade safety playbook (baseline, staged, rollback) ->
`dotnet-migrate`; SDK-style project shape and packaging -> `dotnet-project-setup`; general
managed-memory profiling -> `dotnet-diagnostics`; general perf and type design ->
`dotnet-performance`; a paired Windows-Service half -> `dotnet-hosted-services`.

## Logic out of code-behind - the one rule everything rests on

Code-behind translates a UI event into a call on a presenter or ViewModel and does nothing else. No
business rules, no data access, no branching on domain state. This is the single highest-leverage
maintainability move in a WinForms codebase, because everything testable and everything reusable
lives on the far side of that line.

Two ways to draw the line; pick by the age of the code:

- **MVP passive view** - the workhorse for existing 4.8 and modern code because it needs no framework
  support. The Form or UserControl implements a narrow `IView` interface (properties for values,
  events for intent) and holds no logic; the presenter reads and writes the view only through that
  interface and owns every decision, so it unit-tests against a mocked view. In the *supervising
  controller* variant the view is allowed to data-bind directly to the model for simple
  synchronization and the presenter handles only complex logic - less code, weaker testability.
  Default to passive view; reach for supervising controller only when a stateful model must reflect
  into the view through binding anyway.
- **The MVVM binding engine** - a WPF-style `DataContext` / `Command` engine, stable from .NET 8, so
  it is a modern-runtime option only. It lets a ViewModel be shared with WPF/MAUI, but never reaches
  WPF fidelity (no XAML, no `DependencyProperty`, weak converters). Its mechanics live in
  **references/modern-net.md**. On 4.8, MVP is the only separation pattern available.

One presenter (or ViewModel) per view, injected through the constructor. The Form owns no dependency
it could receive instead.

## Forms are DI-resolvable

A Form is a service like any other - resolved from the container, never `new`ed with its
collaborators reached through a static or a field.

- Register forms and services and resolve the main form from the container. The container and startup
  wiring differ by runtime (generic host on modern .NET, a hand-built `ServiceProvider` on 4.8) - see
  the references.
- For a transient child form that needs a runtime argument, inject a **factory delegate**
  (`Func<OrderForm>` or a typed factory), not the container itself. The parent stays ignorant of the
  provider and the factory is trivially stubbed in a test.
- A Form's collaborators arrive through its constructor. If a form reaches for a singleton or a
  service locator, the seam that would have made it testable is gone.

## Async and the UI thread

The async baseline - return `Task`, never block, `ConfigureAwait` placement - is the `csharp` skill's
and applies unchanged. The WinForms-specific points:

- **`async void` only on event handlers**, and wrap the body in try/catch - a fault in an
  `async void` cannot be observed by any caller and becomes an unhandled exception. Everywhere else
  return `Task` / `Task<T>`.
- **Never block the UI thread** with `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()`. The
  awaited continuation needs the UI thread to resume, but you have blocked it - a deadlock against
  the `WindowsFormsSynchronizationContext`, plus a frozen window. Async all the way, no exceptions.
- **Do not `ConfigureAwait(false)` in a UI event handler** - after it the continuation runs on a
  thread-pool thread and touching a control throws a cross-thread exception. Use it only in the
  UI-agnostic library code you call into.
- **Report progress with `IProgress<T>` / `Progress<T>`** - `Progress<T>` captures the creating
  thread's `SynchronizationContext` and raises its callback there, so a worker reports from any
  thread and the UI update lands safely. Pair it with a `CancellationToken` for cancellation.
- **Marshal back with `Control.Invoke` / `BeginInvoke`.** On modern .NET prefer the async
  `Control.InvokeAsync`, which removes a class of deadlocks (see **references/modern-net.md**); it does
  not exist on 4.8.
- **`BackgroundWorker` is legacy** - supported, but no longer the recommended model and it only
  offloads CPU work, not I/O. New code uses `await` for I/O and an awaited `Task.Run` for CPU-bound
  work, marshaling UI updates through `IProgress<T>` or `InvokeAsync`.

## Data binding through a BindingSource

- Bind controls through a **`BindingSource`**, not directly - it centralizes currency, position, and
  change notification and lets you swap the underlying list without rebinding every control.

```csharp
ordersSource.DataSource = new BindingList<Order>(orders);   // IBindingList: grid sees adds/removes
ordersGrid.DataSource = ordersSource;
nameTextBox.DataBindings.Add(
    "Text", ordersSource, nameof(Order.CustomerName),
    formattingEnabled: true, DataSourceUpdateMode.OnPropertyChanged);
```
- Two-way binding requires the bound type to implement **`INotifyPropertyChanged`** (raise it in
  setters); collections must be **`BindingList<T>`** (or another `IBindingList`) so the grid sees
  inserts and deletes. Convert display-to-storage with a `Binding`'s `Format` / `Parse` events.
- **The silent binding leak:** binding to a plain CLR property that does *not* implement
  `INotifyPropertyChanged` makes the framework subscribe through a `PropertyDescriptor`, a strong
  reference that pins the source object for the app's lifetime. Implementing `INotifyPropertyChanged`
  on bound types removes the leak (and is correct anyway). Unhook bindings and dispose the
  `BindingSource` when a dynamically created form tears down.
- Validate with an `ErrorProvider` driven off the `Validating` event, or implement
  `INotifyDataErrorInfo` on the model so errors surface through binding. Do not trust UI-enforced
  constraints as the only validation - the boundary rule is the `dotnet-security` skill's.

## Secrets and the desktop trust boundary

A desktop app cannot keep a secret from the user running it - the process can recover any credential
it is able to use, whatever the runtime - so prefer removing high-value credentials from the client
entirely (broker them through a service or token endpoint) over any local-storage scheme. For the
fields that genuinely must live on the box, Windows DPAPI (`ProtectedData`, `CurrentUser` scope, never
`LocalMachine`) is the local-protection floor; the per-runtime `ProtectedData` mechanics (in-box on
4.8, a package on modern .NET) are in the references. The input-validation boundary and general secret
handling are the `dotnet-security` skill's.

## Disposal is the failure surface - manage it deliberately

Undisposed resources are the dominant WinForms defect. Two leak families, both worth real care.

### Event-handler leaks (the top managed leak)

A `publisher.Event += handler` is a strong reference from publisher to subscriber. It leaks only when
the **publisher outlives the subscriber** - a long-lived service or main form raising events into
short-lived child forms or controls that should have been collected.

- You do **not** need to detach a child control's handler from its parent - their lifetimes are tied
  and they die together.
- You **do** need to unsubscribe when a shorter-lived object subscribed to a longer-lived one -
  detach in `OnClosed` / `Dispose`.
- Weak-event patterns and messenger/event-aggregator abstractions are a safety net, not a substitute
  for correct lifetime management - a still-subscribed handler can run on a logically dead object.

### GDI / USER object leaks (the top native leak)

`System.Drawing` types - `Pen`, `Brush`, `Font`, `Graphics`, `Bitmap`, `Icon`, `Region` - each wrap a
native handle and are `IDisposable`. A process has a bounded GDI-handle quota (the widely cited
default is roughly 10,000; the real ceiling is a configurable session quota), and exhausting it
throws or renders windows with missing content.

- Wrap every created drawing object in `using`, especially inside `OnPaint` / owner-draw where they
  are created per paint.
- **Do not dispose `SystemPens` / `SystemBrushes`** - they are cached. **Do dispose `SystemFonts`** -
  each access is a live OS fetch.
- **Never dispose `PaintEventArgs.Graphics`** - you do not own it. **Do dispose** a `Graphics` you got
  from `CreateGraphics()`, `Graphics.FromImage`, or `Graphics.FromHwnd`.
- In a `DataGridView`, share one `DataGridViewCellStyle` across rows and columns; never allocate a new
  `Font` or `Brush` per cell in `CellFormatting` / `CellPainting` without disposing it - a classic
  font leak.

### Control and component disposal

- A disposed control disposes its children, but automatic disposal only reaches the top-level form
  started by `Application.Run(new Form())`. Everything below inherits from that or must be handled.
- **A modal dialog shown with `ShowDialog()` is not auto-disposed** (so you can read its state after
  close) - wrap it in `using`.
- **Dynamically added and removed controls dispose manually** - dispose the topmost one (disposing a
  swapped-out `Panel` disposes its children).
- A non-visual `IComponent` dropped in the designer (a `Timer`, `ToolTip`, `ImageList`,
  `ErrorProvider`) auto-registers with the `IContainer components` field and is auto-disposed; **the
  same component created in code must be disposed by hand** - an undisposed `Timer` keeps firing and
  holding handles.
- A custom control that owns `IDisposable` fields overrides `Dispose(bool disposing)`, disposes them
  inside `if (disposing)`, and always calls `base.Dispose(disposing)` (analyzers `CA1063` / `CA2215`).

Watch live GDI and USER handle counts (Task Manager's Details tab has both columns) across an
open/close stress test - flat counts are the acceptance bar before shipping or migrating. Managed
allocation profiling is the `dotnet-diagnostics` skill's.

## Performance: batch, virtualize, bind

- Wrap bulk mutations in `SuspendLayout()` / `ResumeLayout()`, and use `BeginUpdate()` / `EndUpdate()`
  on `ListView` / `ListBox` / `TreeView` / `ComboBox` to suppress intermediate repaints.
- Enable double buffering to cut flicker - note it is a protected property on `DataGridView`, so turn
  it on through a subclass rather than assuming the public toggle exists.
- **Populate a grid through `DataSource`, not row-by-row `Rows.Add`** - unbound population is
  dramatically slower for large sets.
- For large datasets set `VirtualMode = true` on `DataGridView` / `ListView` and serve cells on
  demand, so only visible rows materialize. General perf and type-design guidance is the
  `dotnet-performance` skill's.

## High-DPI: PerMonitorV2 is the target

Target **Per-Monitor V2** DPI awareness - it enables dynamic DPI-change handling and automatic
non-client scaling. *How* you declare it differs by runtime (app.config plus a manifest on 4.8, a
build property on modern .NET) - see the references.

- Every container must use the **same `AutoScaleMode`**; mixing modes is unsupported. The default
  `AutoScaleMode.Font` scales by the system font, which is why the default-font change across
  runtimes ripples into designer layout (covered in **references/modern-net.md**).
- Test on a genuinely mixed-DPI multi-monitor setup - a window opened on a secondary monitor can
  briefly scale at the primary monitor's DPI.

## Testing: unit the presenters, automate the critical path

- The whole point of the architecture is that presenters, ViewModels, and services carry the logic
  and have no WinForms dependency, so they unit-test with a mocked `IView` and injected fakes - fast,
  deterministic, no UI thread. This is the return on keeping code-behind thin.
- UI end-to-end automation rides Windows UI Automation; **FlaUI** is the modern choice and keeps to
  smoke and critical-path coverage only. Do not adopt WinAppDriver fresh (see
  **references/net-framework-48.md** for why). Test framework and structure are the `dotnet-testing`
  skill's.

## Designer and resource hygiene

- Never hand-edit a `*.Designer.cs` file in a way the designer will fight - one control per meaningful
  change, and expect DPI / default-font re-serialization churn on modern .NET (mitigation in
  **references/modern-net.md**).
- Every user-facing string comes from a `resx` file with satellite assemblies (`Localizable = true`
  plus the form `Language` property to generate per-culture resx). No hard-coded UI sentences; build
  them with composite format strings, never concatenation.

## Forbidden in a presenter or ViewModel

- Any reference to a `Form`, `UserControl`, `Control`, or other view type - the moment one appears,
  the line has been crossed and the logic is no longer testable without a UI host.
- `MessageBox.Show` - go through an injected dialog abstraction.
