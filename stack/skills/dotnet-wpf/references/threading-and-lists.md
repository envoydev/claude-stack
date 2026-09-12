# WPF threading and list virtualization

Keeping the UI thread free and big lists cheap. The SKILL.md body carries the two rules an ordinary
edit needs; open this file before mutating a bound collection off the UI thread, tuning a
high-frequency update path, or binding a list past a few hundred rows.

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
