# Code quality stage

A findings-based audit. Review TARGET for correctness, clarity, and conformance to the project's recorded architecture. Run this stage FIRST: it carries the widest blast radius now that it covers structural conformance, so fixing it after the others would invalidate downstream work. Architecture-level restructuring (introducing a new boundary, inverting a layer wholesale, adopting a new pattern) is out of scope here - that is the `architecture-quality-loop` skill; in this stage you flag where the code violates the structure already recorded and fix it with the smallest correct change.

First, read `docs/architecture/ARCHITECTURE.md` if it exists - the recorded layers, boundaries, dependency directions, and patterns - then audit TARGET against it and against general quality.

Look for:
- **Architecture conformance** (against ARCHITECTURE.md): logic in the wrong layer, a controller doing persistence, a domain model reaching into the UI; a dependency pointing the wrong way (a core depending on a detail) or a cycle between modules; a second architecture pattern bolted onto the one the map records - match the recorded structure, never introduce a rival even if it is better.
- Bugs: off-by-one errors, null and boundary mishandling, swallowed exceptions, the wrong operator, an unhandled async rejection.
- Dead code, unreachable branches, and conditions that can never be true or never false.
- Needless complexity - a nested conditional ladder that flattens to a guard clause, a hand-rolled loop that is one built-in call, a re-implementation of something the standard library already does.
- Resource and lifetime issues: leaks, unclosed handles, mutation of shared state, a missing dispose or unsubscribe.
- God objects, files, or functions that have accreted unrelated concerns; magic numbers and copy-pasted blocks that should be a named constant or a single function; duplicated structure that should be one abstraction - but do not abstract a coincidence into a wrong shared shape.

Severity: a real bug, a dependency cycle, or a cross-layer leak is a BLOCKER; an awkward-but-correct expression or a single misplaced helper is MINOR. Make the smallest change that resolves each finding - move code to its correct home, extract the constant - without rewriting a working module wholesale; a fix that introduces new findings is divergence, not progress.

Bar: zero findings at every severity.
