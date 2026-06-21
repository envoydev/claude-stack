# Code quality stage

A findings-based audit. Review TARGET for correctness and clarity within each unit - run after structure and names are settled, before comments and tests.

Look for:
- Bugs: off-by-one errors, null and boundary mishandling, swallowed exceptions, the wrong operator, an unhandled async rejection.
- Dead code, unreachable branches, and conditions that can never be true or never false.
- Needless complexity - a nested conditional ladder that flattens to a guard clause, a hand-rolled loop that is one built-in call, a re-implementation of something the standard library already does.
- Resource and lifetime issues: leaks, unclosed handles, mutation of shared state, a missing dispose or unsubscribe.
- Magic numbers and copy-pasted blocks that should be a named constant or a single function.

Severity: a real bug is a BLOCKER; an awkward-but-correct expression is MINOR. Make the smallest change that resolves each finding; a fix that introduces new findings is divergence, not progress.

Bar: zero findings at every severity.
