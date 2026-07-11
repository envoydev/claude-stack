# Architecture & quality-loop redesign - implementation plan

Status: IMPLEMENTED (phases 1-7) 2026-07-11 on branch `feat/analyzer-split-quality-redesign`, each phase green on `npm run lint`. Phase 8 validation done in-repo (adversarial prompt review + lint; the live agent smoke-test needs a consuming project, so it is a follow-up). The **opus-find** experiment (Phase 6/8) was NOT shipped on: per the repo's prove-don't-assert rule it stays opt-in/off by default until a benchmark on a real target shows it pays. Planned 2026-07-11; kept as the build reference and the record of what landed.

## What this delivers

Three independent analyzer agents, three generated docs, one new loop skill, and a redesigned quality loop - so a project can be **analyzed deliberately** (architecture, assessment, code style) and **improved through two focused loops**, with the heavy opus analysis run on purpose rather than auto-fired in build flows.

### The analyzer split (one job each)

| Agent | Job | Reads | Writes / returns | Model |
|---|---|---|---|---|
| `code-analyzer` | gather CODE data | one module/topic's code | a structured verdict (purpose, deps, patterns, smells) | sonnet |
| `style-analyzer` | produce the STYLE doc | the code + each language's style config (`.editorconfig` / eslint / tsconfig / SQL rules) | `docs/CODE-STYLE.md` | sonnet |
| `architecture-analyzer` | iterative reasoner: structure + pros/cons | the code, via `code-analyzer` | `docs/architecture/ARCHITECTURE.md` + `docs/architecture/ASSESSMENT.md` | opus/xhigh |

`architecture-analyzer` is the only nested-dispatcher here: it loops `code-analyzer` (aggregate -> if unclear, dispatch again) until the architecture picture is clear and the pros/cons are reasoned, then writes its two docs. `code-analyzer` and `style-analyzer` are also independently callable.

### The docs (generated artifacts, regenerated to stay current)

- `docs/architecture/ARCHITECTURE.md` - the structure map (layers, boundaries, dependency directions, patterns, packages).
- `docs/architecture/ASSESSMENT.md` - 10 reasoned pros + 10 reasoned cons of the current architecture, each tied to located code, remediation per con, tiered small / substantial / structural.
- `docs/CODE-STYLE.md` - the project's actual code style: config-derived rules + the idioms a linter can't encode (error handling, naming intent, DI/async, test/file conventions), across all languages.

### Invocation map

| Goal | Invoke |
|---|---|
| document the project (analyze only) | `@agent-architecture-analyzer` (+ `@agent-style-analyzer` for the style doc) |
| one module's code analysis | `@agent-code-analyzer` |
| analyze **and** fix architecture cons | `/architecture-quality-loop` |
| polish code quality (code-quality / naming / comments / tests) | `/project-quality-loop` |

## Key design decisions (settled in planning)

- `architecture-analyzer` runs **deliberately only** (`@agent-` or the arch loop) - never embedded in build flows. The per-change extend/refactor/isolate fit-verdict folds into the solution-designers (they already read the docs).
- Heavy analysis offloads its code reading to cheap sonnet `code-analyzer`s - the opus seat reasons over digests, never slurps the whole codebase.
- Code style is **not** architecture: `docs/CODE-STYLE.md` lives at the top of `docs/`, produced by a separate `style-analyzer`, sourced from the per-language configs (which stay the enforced source) + observed idioms.
- Every agent-dispatching skill stays **manual** (`disable-model-invocation`) - the new `architecture-quality-loop` included.
- `project-quality-loop` is code-quality only (four stages), architecture-aware (reads the `ARCHITECTURE.md` map), opus-free except one flagged find-pass override.

---

## Phase 1 - `code-analyzer` agent

**Goal:** the read-only code data-gatherer that `architecture-analyzer` loops over (and that is independently callable).

**Steps:**
- Create `claude/agents/code-analyzer.md`. Frontmatter: `model: sonnet`, `effort: low` (or medium - see acceptance), a `tools:` allowlist of read-only nav only (`Read`, `Grep`, `Glob`, `mcp__serena__find_symbol`, `mcp__serena__find_referencing_symbols`, `mcp__serena__get_symbols_overview`, `mcp__context7__*`) - **no `Edit`/`Write`, no `Agent`**.
- Body: given one module/topic, read it and return a **structured verdict** - purpose, public surface, dependencies (in/out), patterns in use, smells/violations - windowed and factual, no synthesis of the whole-project picture. A `## Don't game it` (report located facts, mark the unverified) and a lean report contract.
- Wire: add `code-analyzer` to the `AGENTS=(` block in `claude/claude-stack.sh` + `$Agents = @(` in `claude/claude-stack.ps1`; bump the Agents count in `claude/README.md`. Claude-only (no Cursor twin).

**Acceptance:** `npm run lint` green (agent-file/manifest parity, backticked-token checks); the agent reads a module and returns a structured verdict without editing anything. Decide `effort` low vs medium by whether a low-effort read reliably characterizes a module.

---

## Phase 2 - `style-analyzer` agent + `docs/CODE-STYLE.md`

**Goal:** produce the project's descriptive code-style doc from the per-language configs + the code.

**Steps:**
- Create `claude/agents/style-analyzer.md`. `model: sonnet`, read-only nav + `Read`/`Grep`/`Glob` + `Write`/`Edit` (it writes `docs/CODE-STYLE.md` only). No `Agent`.
- Body / method: detect the languages present; for each, read its style config (`.editorconfig` for C#, eslint/prettier/tsconfig for TS/JS, the SQL linter/formatter rules for SQL, ...) **and** representative code; consolidate into `docs/CODE-STYLE.md` - the enforced rules (from configs) + the non-enforceable idioms (error-handling pattern, naming intent, DI/async conventions, test structure, file organization), with any divergence from the house skills flagged. Regenerate-in-place on re-run.
- Define the `CODE-STYLE.md` section shape (per-language style + cross-cutting idioms).
- Wire: add `style-analyzer` to the AGENTS manifests + the README count.

**Acceptance:** lint green; a run produces a `docs/CODE-STYLE.md` that reflects `.editorconfig`/eslint/SQL rules + observed idioms, and touches nothing but that file.

---

## Phase 3 - `architecture-analyzer` rewrite (deliberate, iterative)

**Goal:** turn the change-fit/direct-reading agent into the deliberate iterative reasoner that writes `ARCHITECTURE.md` + `ASSESSMENT.md`.

**Steps:**
- Rewrite `claude/agents/architecture-analyzer.md`:
  - Add `Agent` to `tools:` (it becomes a nested-dispatcher of `code-analyzer`). Keep `model: opus`, `effort: xhigh`.
  - Replace the Method with the loop: (1) dispatch `code-analyzer` on the modules/topics it needs; (2) aggregate -> build the structure; (3) if a part is unclear or uncovered, dispatch `code-analyzer` again on that topic; (4) loop until the architecture picture is clear and the pros/cons are reasoned; (5) write the two docs. **Bounded** - a hard cap on gather rounds; if still unclear, report what is settled vs uncertain.
  - Drop the change-fit ("extend/refactor/isolate" per-change verdict) and the embedded/audit-mode uses - it is deliberate-only now.
  - Add the `ASSESSMENT.md` output alongside `ARCHITECTURE.md`.
- Define the `ASSESSMENT.md` shape: 10 pros + 10 cons, each reasoned and tied to located code, remediation per con, a tier (small / substantial / structural) per con.
- Update the agent's own description/negative-scope so it no longer claims the fit-verdict role.

**Acceptance:** lint green (backticked `code-analyzer` reference resolves once Phase 1 landed); the agent dispatches `code-analyzer`, iterates, and writes both docs; it no longer runs inside build flows.

---

## Phase 4 - fold the fit-verdict into designers, drop the build-flow doc-refresh, seats read `CODE-STYLE.md`

**Goal:** move the per-change structural judgment to the designers, stop the flows auto-refreshing docs, and make every code seat style-aware.

**Steps:**
- Update the 6 `claude/agents/<stack>-solution-designer.md`: add the extend/refactor/isolate fit judgment (read `ARCHITECTURE.md`, judge where the change belongs) to the designer's job - previously `architecture-analyzer`'s before-run role.
- Update `skills/main-stack-agents-flow/SKILL.md` + `skills/cross-stack-agents-flow/SKILL.md`: remove the auto doc-refresh step (docs update deliberately via `@agent-architecture-analyzer`); note the fit-verdict is now the designer's.
- Extend the house orientation rule (base template `claude/CLAUDE.template.md` + the seat bodies that state it) so seats read `docs/CODE-STYLE.md` at start alongside `docs/architecture/ARCHITECTURE.md`.

**Acceptance:** lint green; the flows carry no `architecture-analyzer` doc-refresh dispatch; designers state the fit judgment; seats orient from `ARCHITECTURE.md` + `CODE-STYLE.md`.

---

## Phase 5 - `architecture-quality-loop` skill (new)

**Goal:** the dedicated, deliberate architecture-improvement loop.

**Steps:**
- Create `skills/architecture-quality-loop/SKILL.md`. Manual: `disable-model-invocation: true`. Flow: (1) ANALYZE+ASSESS - dispatch `architecture-analyzer` (writes/updates `ARCHITECTURE.md` + `ASSESSMENT.md`); (2) FIX per open con by tier - small -> implementer; substantial -> solution-designer -> implementers -> verifier (seats dispatched directly, since `main-stack-agents-flow` is manual); structural/risky -> flag, no auto-fix; (3) UPDATE DOCS - re-dispatch `architecture-analyzer` to reconcile the docs; (4) LOOP/STOP until fixable cons resolved / PLATEAU / cap; final report.
- Wire the SKILLS surface: add `architecture-quality-loop` to the SKILLS block in all four installers (`claude/claude-stack.{sh,ps1}`, `cursor/cursor-stack.{sh,ps1}`) in the **same order**; both `*-stack.html` personal blocks; the ps1 `every skill (N)` counts; the root `README.md` `Available skills` bullet; `claude/README.md` + `cursor/README.md` Skills counts; the base template's list of manual agent-dispatching skills.

**Acceptance:** lint green (skill count +1 across the 4-way parity + HTML + counts); the skill is `/`-only (manual).

---

## Phase 6 - `project-quality-loop` redesign

**Goal:** the four-stage, architecture-aware, command-first code-quality loop.

**Steps:**
- Rewrite `skills/project-quality-loop/SKILL.md`:
  - Remove the architecture stage / any `architecture-analyzer` dispatch.
  - Step 1 reads the `loops/` stages + TARGET; **no** main-session `ARCHITECTURE.md` read (the seats read it themselves); confirm the green baseline (build + tests) up front.
  - Four audit stages, each FIND -> FIX -> VERIFY: code-quality (its FIND reads `ARCHITECTURE.md` + the code -> quality + architecture-conformance findings), naming, comments, tests.
  - FIND = domain verifier at **opus/xhigh** (per-dispatch override of the sonnet/xhigh pin - flagged to validate); FIX = implementer sonnet/medium; VERIFY = verifier sonnet/xhigh.
  - Gate checks (build / format / tests-pass) run in the main session, no agent; a red escalates to the matching resolver (sonnet/high). Command-first ordering: green-baseline gate -> the four audits -> re-gate.
  - Keep the STOP vocabulary (SATISFIED / PLATEAU / OSCILLATION / DIVERGED / CAPPED), the DELEGATED/INLINE split, and the bounded fix rounds.
- Confirm `disable-model-invocation` stays set (already applied earlier).

**Acceptance:** lint green; the loop carries no architecture stage; the four stages + command-first + re-gate are present; the opus find-override is marked as an experiment to validate.

---

## Phase 7 - parity & docs sweep

**Goal:** every registration surface and doc agrees, 4-way.

**Steps:**
- Reconcile the full parity surface for the two new agents + one new skill: AGENTS manifests (both claude shells), SKILLS blocks (all four installers, same order), both HTML inventories, all ps1 counts, all three READMEs (Skills/Agents counts), the base template `## Stack agents` (name the three analyzers, their roles, and that `architecture-analyzer` is deliberate-only + a nested-dispatcher).
- Update the two guides: `docs/agent-flow-guide.md` (the roster now includes `code-analyzer` + `style-analyzer`; `architecture-analyzer` is deliberate + iterative; the two loops) and `docs/single-chat-guide.md` where it references the seats.
- Update the repo `CLAUDE.md` layout/agent-count prose to the new roster.

**Acceptance:** `npm run lint` green - skill count, agent-file/manifest parity (both stacks), HTML agreement, README counts, backticked-token resolution across skills/agents/templates/rules all pass.

---

## Phase 8 - validate, record, commit

**Goal:** prove the behavioral changes and land the work with evidence.

**Steps:**
- Smoke-test: `@agent-code-analyzer` on a module returns a verdict; `@agent-style-analyzer` writes a `CODE-STYLE.md`; `@agent-architecture-analyzer` loops `code-analyzer` and writes `ARCHITECTURE.md` + `ASSESSMENT.md`; `/architecture-quality-loop` and `/project-quality-loop` dispatch the right seats.
- Per the repo invariant *prove a behavioral change, don't assert it*: decide the **opus-find** experiment - benchmark whether opus find catches materially more real issues than sonnet/xhigh; keep the override only with evidence, else revert to the sonnet/xhigh pin.
- Update memories + any affected repo docs; branch, commit with a `Verified:` line, push; merge to main on approval.

**Acceptance:** lint green; the smoke tests pass; the opus-find decision is evidence-backed; committed.

---

## Cross-cutting requirements

- **4-way parity is law.** `SKILLS` + `MCPS` identical across all four installers in the same order; agents are Claude-only. `npm run lint` enforces the whole surface - run it green after every phase.
- **House voice** in every body/doc: direct, lean, single dashes not em-dashes, single quotes in prose, recommend one option with a reason.
- **Manual dispatch policy** holds: the new `architecture-quality-loop` is `disable-model-invocation`; agents fire only via `@agent-<name>` or a manually-run skill.
- **Public repo:** no private names or absolute personal paths in any tracked file.

## Open flags

- `code-analyzer` / `style-analyzer` model: **sonnet** (shipped - `code-analyzer` sonnet/low, `style-analyzer` sonnet/medium); revisit only with a reason.
- `project-quality-loop` **opus-find**: DECIDED - left OPT-IN and OFF by default. It is an unproven pin change, and the repo invariant forbids shipping a behavioral pin change without evidence; adopt it as the default first-find only after a benchmark on a real target shows it catches materially more real issues. The skill documents it as the opt-in experiment; the default first-find is the sonnet/xhigh pin.

## Out of scope (postponed)

- `project-docs` skill (CLAUDE.md + README authoring) - shelved; CLAUDE.md stays with the template + install-seed + the `claude-md-management` plugin.
