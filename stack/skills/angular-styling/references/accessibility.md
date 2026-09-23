# Accessibility - the WCAG 2.2 AA checklist for a web screen

`SKILL.md` holds the styling half - visible focus, reduced motion, contrast ratios, no state by color alone. This file is the rest of the checklist a screen is reviewed against: the WCAG 2.2 criteria a styling or layout change most often breaks, numbered so a finding can cite one. Web targets only - a native mobile shell answers to its platform's guidelines, not this file.

## Pointer targets - 2.5.8 Target Size (Minimum), AA

- Every pointer target is at least 24 by 24 CSS px: an icon button, a dialog's close, a chip's remove, a row action in a table. Size the CONTROL (`min-inline-size: 24px; min-block-size: 24px`, or padding), never just the glyph inside it.
- The exceptions are narrow: an undersized target passes only when a 24px circle centered on it overlaps no other target and no other undersized target's circle (spacing); when another control on the same page does the same job at full size; when it is a link inside a sentence; when it is a native control the author never restyled; or when the size is essential. A toolbar of 16px icons packed edge to edge fails.

## Focus not obscured - 2.4.11 Focus Not Obscured (Minimum), AA

- A focused control is never ENTIRELY hidden by author-created content - a sticky header or footer, a cookie banner, a non-modal dialog, a floating chat launcher.
- Under a sticky bar, set `scroll-padding-top: <bar height>` on the scroll container (`scroll-padding-bottom: <bar height>` for a footer), so a control reached by Tab scrolls clear of it (W3C technique C43).
- Content the USER opened may cover focus only while it can be dismissed without moving focus back - Escape closes it, or it closes on its own when focus leaves.

## Keyboard - 2.1.2 No Keyboard Trap, A

- Focus that reaches a component by keyboard leaves it by keyboard alone; an exit that needs more than Tab, the arrows or Escape is announced to the user.
- A modal traps focus on purpose (the CDK's `cdkTrapFocus`, a dialog service built on it) and passes only because it has an exit: Escape and a reachable close control. When it closes, focus returns to the element that opened it.
- The usual traps: an embedded editor, map or iframe that swallows Tab; a custom widget whose keydown handler calls `preventDefault()` on Tab; a menu that loops focus with no Escape.

## Forms - 3.3.7 Redundant Entry, A

- Information the user already entered or was given in the same process is auto-populated or offered for selection, never typed again - a 'same as shipping' option for billing, step three prefilled from step one.
- The exceptions: re-entry is essential, it is required for security (a password confirmation), or the earlier value is no longer valid.

## The rest of the 2.2 additions

- **2.5.7 Dragging Movements, AA.** Anything done by dragging - a reorderable list, a slider, a kanban card - also works with a single pointer and no drag: move-up / move-down buttons, a click on the track.
- **3.3.8 Accessible Authentication (Minimum), AA.** A sign-in step never blocks paste or a password manager's autofill - both fail the criterion unless another route is offered.
- **3.2.6 Consistent Help, A.** A help link, contact detail or chat that repeats across pages stays in the same relative order on each.

## Proof

The automated a11y checks in the component specs scan one render, and most of this list is not visible in one: obscured focus depends on the scroll position, a keyboard exit on interaction, a prefilled step on the step before. Check those by hand - Tab through the screen with the sticky bars in place, open and close each overlay, and measure the smallest target. Quote what you checked against which criterion; 'looks accessible' is not a result.
