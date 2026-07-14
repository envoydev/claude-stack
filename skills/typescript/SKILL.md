---
name: typescript
description: "Personal TypeScript and JavaScript conventions, framework-agnostic - lean on the compiler (full strict plus the extra safety flags), model data with types, narrow unknown instead of any, keep the two failure channels apart (typed result for expected, thrown Error for unexpected), default to immutability, and treat plain JS as checked JS via JSDoc and checkJs. Baseline is TypeScript 5+. Load before writing or editing any .ts, .tsx, .js, .jsx, .mjs, or .cjs file in any runtime - browser, Node, build script, service worker, extension. In an Angular project also load `angular-conventions`, the framework layer. Not for C#/.NET or other languages."
---

# TypeScript and JavaScript conventions

These are the language rules for every piece of TS/JS in a codebase, independent of where it runs - browser, Node, bundler script, service worker, browser extension. A framework adds its own layer on top (`angular-conventions` for Angular); this skill is purely the language. Baseline is TypeScript 5+.

The single organizing idea: the compiler is the cheapest test you have. Configure it to be strict, describe your data so it can check the data, and never quietly disable it.

**The concrete tooling and the rule-by-rule style live in `references/typescript-style.md`** - the tsconfig (`@tsconfig/strictest`), the ESLint flat config (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`), Prettier, `.editorconfig`, and the naming / interface-vs-type / import / class-member rules those tools enforce. This SKILL.md owns the conceptual model below; where the two overlap, the reference is authoritative on the concrete rule. **Above both, a project's own config (its `.editorconfig`, `eslint.config.mjs`, `.prettierrc`, `tsconfig.json`) and its `docs/PROJECT-CODE-STYLE.md` are higher priority - follow the project where it diverges.**

## Make the compiler strict, then stricter

`strict: true` is non-negotiable - it is the floor, not the goal. On top of it, turn on the flags that catch the bugs `strict` alone misses:

- `noUncheckedIndexedAccess` - `arr[i]` and `record[key]` become `T | undefined`, which is the truth. This is the single highest-value extra flag.
- `exactOptionalPropertyTypes` - `x?: T` stops silently accepting `x: undefined`, so an optional property and a present-but-undefined one are no longer conflated.
- `noImplicitOverride` - an override must say `override`, so a renamed base method surfaces as an error instead of a silent shadow.
- `noFallthroughCasesInSwitch` and `noImplicitReturns` - close the two control-flow holes where a path returns nothing or falls through unintentionally.

Keep these in one shared base `tsconfig` and have each project `extends` it. A per-project config that redefines the flags drifts; one that inherits them cannot.

## Don't lie to the compiler

The whole value proposition collapses the moment you suppress a check. The rules:

- No `any`. For a value whose shape you genuinely don't know, use `unknown` and narrow it with a type guard before touching it. When a dependency ships no types, the `any` lives in exactly one typed wrapper module - it never leaks to call sites.
- No `@ts-ignore`. Use `@ts-expect-error` with a reason on the same line, so the day the underlying problem is fixed the directive itself errors as unused and you delete it. `@ts-ignore` rots silently; `@ts-expect-error` is self-cleaning.
- No non-null assertion (`x!`) without a comment stating why null is impossible there. The honest alternatives are an early return or a narrowing check; the assertion is a promise to the compiler that nothing enforces.
- A user-defined guard returns `value is T`, not `boolean` - the predicate form is what teaches the compiler. Give narrowing logic a name and reuse the guard rather than re-checking inline.

A worked case that bites people: removing nulls from an array. `list.filter((x) => x != null)` keeps the right values but the result is still typed `(T | null)[]` - the compiler doesn't know the predicate narrowed anything. Write the predicate as a guard: `list.filter((x): x is T => x != null)` yields `T[]`. And `.filter(Boolean)` is not the same thing - it also drops `0`, `''`, `false`, and `NaN`, so reach for it only when you really mean every falsy value. State the predicate by what it keeps; an inverted `=> !x` reads as removal but keeps exactly the wrong elements.

## Model the data with types

A precise type is documentation the compiler enforces. Reach for the type system to make illegal states unrepresentable:

- **Discriminated unions** over a bag of optionals. Give each variant a literal tag (`kind` / `type`) and let a `switch` branch on it; a `never`-typed `default` makes the switch exhaustive, so adding a variant forces every consumer to handle it. This is the workhorse - prefer it to inheritance and to 'some of these fields are set together' objects.
- **Utility types** instead of re-typing shapes: `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `Record`, `ReturnType`, `Parameters`, `Awaited`. A derived type stays correct when its source changes.
- **String-literal unions** over `enum` for any closed set that crosses a runtime boundary - JSON, storage, a wire message. A union is just strings at runtime, so it round-trips cleanly; an `enum` is a runtime object with its own quirks. Keep `const enum` only for values that stay inside one bundle and never cross a package edge.
- **`interface` vs `type`**: `interface` for object shapes that are implemented or extended; `type` for unions, intersections, tuples, and anything mapped or conditional. Be consistent within a file rather than mixing both for the same job.
- **Model absence on purpose.** A lone optional (`x?: T`) beats `T | null | undefined` ambiguity. Pick `undefined` or `null` and mean one of them throughout a codebase - `undefined` is the TS-idiomatic default. Keep correlated nullable fields all-or-nothing: a `{ lat: number; lng: number } | null`, or a discriminated state, never two independent optionals that can drift into an impossible half-set. Build objects complete through a factory rather than assembling them via nullable intermediates.
- **`readonly` by default.** `readonly` properties, `readonly T[]` / `ReadonlyArray<T>` for collections, `as const` for literal config and tuples. Mutation is the exception you opt into, not the default you forget to prevent.
- **Brand primitives that share a representation but not a meaning** - a `UserId` and a `PostId` are both `string`, and mixing them is a real bug. `type UserId = string & { readonly __brand: 'UserId' }`, constructed only through a single validating guard, never a bare `as` at call sites. It is compile-time only - zero runtime cost - and it makes the type system reject a `PostId` where a `UserId` is required.

The mental model underneath all of this: a type is a set of values. Assignability is 'is a subset of'; `extends` and intersection shrink the set; `never` is the empty set and `unknown` the set of everything. That is why a `never` default proves exhaustiveness and why `unknown` is the safe top type to narrow down from.

Library-grade type work - conditional types with `infer`, mapped types, template-literal types - is worth it behind a published API surface, verified with `tsc --noEmit`. It is not worth it when a plain type or a utility type already says the shape. Type-level cleverness is a cost; spend it only where the surface is wide enough to repay it.

## Modules and imports

- ES modules only - `import` / `export`. No CommonJS `require` in new TypeScript, save for a `.cjs` interop shim. Set `"type": "module"` wherever the runtime allows it.
- Named exports by default; they keep one canonical name and survive renames. Reserve `export default` for the entry points a framework or bundler demands.
- Expose a package - or a feature wide enough to have a public surface - through a single `index.ts` barrel at its boundary, and import through that barrel from outside. Barrels stop there: no deep intra-feature barrels (they hurt build/lint/test performance and invite cycles - the reference's caution). Inside a feature, deep relative imports are fine; reaching past another feature's barrel is not.
- `import type { ... }` for type-only imports. It erases at build, can't pull a value at runtime, and won't create an import cycle through types alone.
- When an upstream package's types are merely incomplete, fix them in place with module augmentation - `declare module 'pkg' { ... }`, or `declare global { interface Window { ... } }` for globals - in a dedicated `*.d.ts`. That is strictly better than casting to `any` or wrapping the library to dodge the gap.

## Async

The rule-by-rule enforcement - `async`/`await` over `.then()` chains, no floating promise (every promise awaited, returned, or `void`ed with a comment), `Promise.all` for independent work instead of serialized awaits in a loop - is `references/typescript-style.md`'s; a dropped rejection is an unhandled error you'll only find in production. The house additions:

- Thread an `AbortSignal` through cancellable I/O - fetch, timers, sockets - and wire it to teardown (component destroy, request abort, service-worker lifecycle). Cancellation is part of the contract, not an afterthought.
- No `async` function as a `new Promise(...)` executor - a rejection inside it vanishes. Wrap a legacy callback API exactly once in a typed `promisify`-style helper and use that everywhere.

## The two failure channels

Failures split the same way they do server-side, and the split must stay clean:

- **Expected, recoverable outcomes** - not found, validation rejected, a conflict - are return values, not exceptions. Model them as a discriminated result: `{ ok: true; value: T } | { ok: false; error: E }`, branched on at the call site. This mirrors the C# Result convention and keeps the failure visible in the signature instead of hidden in a `throw`.
- **Unexpected failures** - a bug, a broken invariant, a dependency that's down - throw. Always throw an `Error` or a subclass, never a string or a plain object; `instanceof` and stack traces both depend on it. Define a typed `Error` subclass per distinct failure mode so a handler can discriminate.

Around the `throw` side:

- `catch (e)` binds `unknown` (with `useUnknownInCatchVariables`, which `strict` turns on). Narrow before you touch it - `if (e instanceof SomeError)` - rather than assuming a `.message`.
- Never swallow. An empty `catch`, or one that logs and limps onward as if nothing happened, hides the failure. Handle it specifically or rethrow.

## Plain JavaScript is checked JavaScript

You don't lose the type checker by writing `.js`. The same language server checks it - turn it on:

- `// @ts-check` at the top of a single file, or `checkJs: true` with `allowJs: true` in `jsconfig.json` / `tsconfig.json` for a whole tree. Treat the diagnostics it produces as real errors.
- Describe types in JSDoc - `@param`, `@returns`, `@type`, `@typedef`. The language server reads JSDoc for inference and diagnostics, so JS gets most of TypeScript's safety with no build step at all.
- `const` / `let`, never `var`. `===` / `!==`, never `==`. The module, async, and failure rules above apply unchanged.
- When a JS file fills up with `@typedef` and JSDoc generics, that's the signal it wants to be `.ts`. Convert it.

## Naming and shape of code

- Identifier casing (camelCase / PascalCase / UPPER_CASE), boolean predicate prefixes (`isReady`, `hasItems`), and file naming are `references/typescript-style.md`'s rules - it owns the detail and the enforcing lint config.
- No abbreviations past the universally understood ones (`id`, `url`, `http`).
- A function does one thing. Prefer pure functions and early returns to deep nesting; a flat function with guard clauses is easier to read and to test than a pyramid.
- Class-member style - the `public` modifier, `#private` vs `private`, `readonly` on injected fields, `override`, parameter properties, and member ordering - is `references/typescript-style.md`'s ground: it owns the ordering rule and the implicit-`public` convention; follow it there rather than from recall.

## Tooling

- ESLint with typescript-eslint and its type-aware rules, plus Prettier. Both run pre-commit and in CI. Prettier owns formatting - don't hand-format and don't add stylistic ESLint rules that fight it; let the lint surface real problems, not whitespace. The concrete config to copy - the flat `eslint.config.mjs`, the `@tsconfig/strictest` base, the `.prettierrc` and `.editorconfig` - is in `references/typescript-style.md`.
- Type-check in CI as its own step (`tsc --noEmit`), separate from bundling. A bundler can transpile past a type error; an explicit `tsc` pass cannot, so a green build genuinely means a type-clean build.
- Audit dependencies (`npm audit` / `pnpm audit`) before a release-bound change; fix the high-severity advisories or document the deliberate exception.
- Public API surfaces carry JSDoc - `@param`, `@returns`, `@throws`. It documents intent and feeds editor tooling for both TS and JS consumers.

## Forbidden

- `var`, `==` / `!=`, implicit globals - in TypeScript as much as in JS.
