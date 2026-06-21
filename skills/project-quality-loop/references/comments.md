# Comments stage

A findings-based audit. Review TARGET for comments and inline documentation only - run late, after the code they describe has stopped moving, so you are not documenting something a later stage will change.

Look for:
- Comments that now contradict the code (an earlier stage changed the code but not the comment).
- Comments that narrate what the line plainly does instead of why it does it - delete the redundant ones.
- Missing rationale where a non-obvious decision, a workaround, or an external constraint would baffle the next reader.
- Stale TODO and FIXME markers, and commented-out code - remove them or convert to a tracked note.
- Public API surface left undocumented where the codebase documents its public surface.

Severity: a comment that actively misleads is MAJOR; a redundant restatement is MINOR. Prefer deleting a bad comment to rewriting it, unless the why is genuinely worth capturing - then write the why, not the what.

Bar: zero findings at every severity.
