# The two architecture docs - required shape

## docs/architecture/ARCHITECTURE.md - the structure map

The committed, whole-project architecture record - the orientation a solution-designer reads to keep new work consistent with the structure that already exists. Keep it LEAN: it carries the CORE map only, and deep-dive detail spills to `docs/architecture/references/<topic>.md` topic files that the main file links from a short index (the same hub-and-spoke shape as a skill's `SKILL.md` plus its `references/`). The five core sections, in order, each concise:

1. **Framework and packages** - the runtime and target framework version, the language version, and the load-bearing packages (ORM, DI, messaging, auth, UI) with their role and major version. The dependencies that shape the architecture, not a lockfile echo.
2. **Architecture logic** - the architecture style (clean / vertical-slice / modular-monolith / layered / MVVM ...) and the layering: the modules or layers, their responsibilities, and the dependency direction between them - which way the arrows point and what an inner layer may not reference.
3. **Project structure** - the projects and folders with their entry points, and which module owns what: the map from a concern to the place it lives.
4. **Patterns in play** - the recurring patterns and cross-cutting mechanisms actually in use (CQRS, repository / unit-of-work, mediator, options binding, the DI composition root, the error envelope, the auth seam), each named where it lives, so new work reuses the established pattern instead of inventing a rival.
5. **Boundaries and specifications** - the module and bounded-context boundaries and the contracts that guard them: which boundary is enforced by an architecture test versus held only by convention, the schema-ownership lines, and the constraints new work must satisfy (the house conventions in force, the non-functional targets, the seams that must not be crossed).

## docs/architecture/ASSESSMENT.md - the reasoned evaluation

The companion to the neutral map: a candid judgement of the architecture as it stands, so its weaknesses are visible and improvable rather than silently inherited. The `project-architecture-quality-loop` skill reads this to drive fixes, keyed by the tier assigned. The shape:

- **Strengths (10)** - ten titled strengths of the current architecture, each with the reasoning (what it buys - testability, isolation, evolvability, clear ownership) tied to located code (the module / boundary / pattern it comes from). Fewer than ten only if the codebase is small enough that padding would fabricate - say so rather than invent.
- **Weaknesses (10)** - ten titled weaknesses, each with the reasoning (what it costs - coupling, fragility, blast radius, a captive dependency, a perf or consistency hazard) tied to located code, then two required fields:
  - **Remediation** - concretely how to resolve it: the boundary to introduce, the dependency to invert, the pattern to adopt, the seam to guard with a fitness test. Every remediation is **strength-checked** against the Strengths list before it lands: if applying it would erode a listed strength, the entry names that tension and shapes the fix to preserve the strength - and where the two genuinely trade off, the entry says so explicitly, which forces the weakness to the structural tier (a user decision, never an auto-fix).
  - **Tier** - **small** (a localized edit an implementer can land), **substantial** (a designer-led multi-task change - decompose, build, verify), or **structural** (a risky cross-cutting rework - flag it, do not let a loop auto-apply it).

  One entry in that shape:

  > **W3 - Invoicing queries Orders' persistence entities across the module boundary.** `InvoiceBuilder.BuildAsync` reaches into Orders' data context directly (located: `Invoicing/InvoiceBuilder` -> `Orders.Order`), so an Orders schema change ripples into Invoicing untested - the boundary exists in folders, not in the dependency graph.
  > **Remediation** - feed Invoicing from an Orders-owned read projection (or an integration event), and guard the seam with an architecture test asserting Invoicing never references Orders' data context.
  > **Strength check** - preserves S2 (module isolation): the projection keeps Orders' persistence private instead of widening the shared surface a direct-reference fix would.
  > **Tier** - substantial.
- **Summary** - the tier tally, the top few highest-leverage fixes, and any weakness that is a deliberate, accepted tradeoff rather than a defect (mark it so, so a loop does not 'fix' a conscious choice).
