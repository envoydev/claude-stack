# Click-path audit - after a shared-state refactor

Run it when a change moved, merged or reshaped state that more than one handler writes - a signal service, a SignalStore, an NgRx slice, a `linkedSignal`. Each handler's spec passes on its own; the bug is the sequence: the user does A, then B, and B silently undoes A. A debugging pass starts from a known failure; this one looks for the failure nobody has reported yet.

## The pass

1. **List every writer** of the refactored state by reference, not by name-match: each method, handler, effect or reducer case that calls `set`, `update`, `patchState` or dispatches into the slice.
2. **One row per writer** - what it SETS on purpose, and what it also RESETS as a side effect:

   | Writer | Sets | Also resets | Reached after |
   |---|---|---|---|
   | `applyFilter(term)` | `filter.term` | `page` to 1 (designed) | search box |
   | `changePage(n)` | `page` | `filter` to its default (not designed) | pager |

3. **Walk each pair** where B resets what A set: can a user reach B after A on a real screen? A reachable, undesigned reset is a finding, named as the click path - 'filter applied, then the pager clears it'. A designed reset (a new search returns to page 1) is noted as designed, never flagged.
4. **Pin each finding with a spec** that drives A, then B, and asserts A's effect survived.

## Where the silent resets hide

- A whole-object write where a merge was meant: `state.set({ ...defaults, page })` instead of `state.update((s) => ({ ...s, page }))`.
- `patchState` merges only the TOP level: `patchState(store, { filter: { term } })` replaces the whole `filter` object and drops its other fields - spread the old one in an updater.
- A `linkedSignal` whose source is a list: a reload hands it a new array, and the plain form recomputes the user's selection back to the default. The object form's computation receives `previous` - keep `previous.value` while the new source still contains it.
- An `effect` that writes one piece of state when another changes: every such write is a reset some other click path reaches - list it as a writer.
- State held in a component's `providers` is re-created with the component: leaving the view and coming back starts from the initial state.
- A store `onInit` hook or a resolver that loads and overwrites state every time it runs, over what the user changed since.
