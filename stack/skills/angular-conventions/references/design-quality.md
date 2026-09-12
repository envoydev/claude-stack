# Design quality - distinctive, production-grade UI

House taste guidance for UI that looks intentional, not generic-AI-default. Load it on greenfield or visual work; skip it when you are reproducing a fixed design or Figma handoff faithfully. It owns the *taste* only - the mechanism (CSS, tokens, responsive, a11y styling) is the styling skill's, and Material theming the theming skill's.

- **A real design system, not defaults.** Commit to a deliberate type scale, a spacing rhythm, and a genuine color system (surfaces, accents, states) - not the framework's out-of-the-box palette and default margins.
- **Layout with intent.** Build hierarchy from scale, weight, and whitespace; align to a grid; give content room. Avoid the evenly-spaced, center-everything, single-column default.
- **Motion with purpose.** Transitions and micro-interactions that clarify a state change, not decoration - and respect prefers-reduced-motion.
- **Design every state.** Empty, loading, error, and success are part of the UI, not afterthoughts.
- **Responsive by construction, accessible by default.** Contrast, focus-visible, and keyboard paths are not optional; the a11y rules themselves are the skill body's Accessibility section and the styling skill's.
