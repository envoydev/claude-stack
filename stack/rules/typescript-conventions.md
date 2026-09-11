---
paths: ["**/*.ts", "**/*.tsx"]
---

Editing TypeScript - load `typescript` and the `javascript` base layer it stacks on: the FIRST action after this rule attaches is that Skill call, before the NEXT edit lands (a path-scoped rule attaches ON the touch, so it can never precede its own trigger) - even when the touch is incidental to the session's main thread (measured:
both this rule and the Angular one attached, their bodies entered the session, and neither skill was
loaded across 12 edits to `.ts` components). Skip a load when it is already in context (some seats
preload them); conventions are the source of truth, not recall. Say which layers you loaded, or that
they were already in context - the receipt is what makes the load happen. Framework layers (Angular / Ionic) stack on top where installed.
Skip one-line tweaks.
