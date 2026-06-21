# Architecture stage

A findings-based audit. Review TARGET for structural soundness only - leave naming, formatting, and micro-quality to later stages. Run this stage first: structure has the widest blast radius, so fixing it after the others would invalidate everything downstream.

Look for:
- Misplaced responsibility - logic in the wrong layer, a controller doing persistence, a domain model reaching into the UI.
- Leaky or circular dependencies between modules, and dependencies pointing the wrong way (a core depending on a detail).
- A second architecture pattern bolted onto the one already in the repo. Match the existing structure; never introduce a rival pattern alongside it, even a better one.
- God objects, files, or functions that have accreted several unrelated concerns.
- Duplicated structure that should be one abstraction - but do not abstract a coincidence into a wrong shared shape.

Severity: a dependency cycle or a cross-layer leak is a BLOCKER; a single misplaced helper is MINOR. Fix by moving code to its correct home with the smallest change that resolves the finding; do not rewrite a working module wholesale just to make it tidier.

Bar: zero findings at every severity.
