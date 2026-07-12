# ViewEncapsulation modes - what each trades away

`SKILL.md` sets the rule: `Emulated` everywhere unless a specific reason says otherwise. This file is the mode-by-mode comparison for the rare case where the switch is on the table.

The four modes (`ViewEncapsulation` enum):

- **`Emulated`** (default) - attribute-scoped, no native shadow tree. Angular stamps a unique attribute onto the host and template elements and rewrites every selector to match it. Styles stay in the component; globals still penetrate inward. Use this everywhere unless you have a specific reason not to.
- **`None`** - no encapsulation at all; every selector in the file becomes global and applies app-wide. The component's styles now leak into the entire app. Reserve it for a deliberate global leaf (SKILL.md's third sanctioned way out) and write defensively scoped selectors when you do.
- **`ShadowDom`** - real browser Shadow DOM. True bidirectional-ish isolation, but it changes event retargeting and slotting, breaks `:host-context()`, and global app styles no longer reach inside - so a global theme stops at the boundary. Only choose it for a genuinely self-contained widget (a distributable web component), never as a default.
- **`ExperimentalIsolatedShadowDom`** (experimental, added v21) - ShadowDom plus a hard block on external styles leaking in. Same trade-offs, stricter. Treat as experimental; flag the version and confirm on angular.dev before using.

Angular itself notes that even in `Emulated` and `ShadowDom` it does not 100% guarantee a component's styles win over outside styles - so do not lean on encapsulation as a specificity weapon.
