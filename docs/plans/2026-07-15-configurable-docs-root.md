# Configurable docs-root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the location of the skill-generated project docs (architecture map, code style, related context, quality loops) configurable per project, defaulting to the committed `docs/` folder, via a single remap rule declared in the project template - so no per-reference edits across ~40 agents.

**Architecture:** The templates (`CLAUDE.template.md`, `AGENTS.template.md`) declare a docs-root convention + a remap rule: generated project docs live under the docs root (default `docs/`); wherever an instruction names `docs/<generated-doc>`, it resolves under the configured root. Instruction-following consumers (agents, skills) honor the remap through the always-loaded project instructions and keep `docs/` as their visible default. Only the two GENERATED artifacts that bake a concrete path deterministically - the inject-code-style hook and the architecture awareness rule - must substitute the configured root at generation time; and the owner skills' folder-CREATION steps reference the root. Default `docs/` = identity remap = zero behavior change.

**Tech Stack:** Markdown prose + one JS hook template. No new dependencies, no unit-testable logic (validation is lint + grep + review).

## Global Constraints

- Default docs root is `docs/` (committed). Zero behavior change unless a project overrides it.
- `.claude/` is gitignored in consuming projects - the template must warn that relocating the root under `.claude/` makes the durable docs local-only (not committed, lost on a fresh clone).
- House voice: single dashes, single quotes, no em-dashes.
- Public repo: no private names or absolute personal paths.
- `.sh`/`.ps1` installers and `CLAUDE`/`AGENTS` template pairs stay in parity where they carry the same content; `npm run lint` must stay clean.
- The 40 agents and the convention skills that only READ `docs/...` are NOT edited - they resolve through the remap rule. Do not sweep them.
- Do NOT push. Commit locally only on branch `feat/configurable-docs-root`.

## File Structure

- `claude/CLAUDE.template.md` (modify) - declare the docs-root convention + remap rule.
- `cursor/AGENTS.template.md` (modify) - the same, Cursor-worded.
- `skills/project-code-style-analyzer/references/inject-code-style.template.js` (modify) - read the docs root from an env/arg with a `docs` default, so the generated hook can bake a relocated root.
- `skills/project-code-style-analyzer/SKILL.md` (modify) - the generation step substitutes the configured root.
- `skills/project-architecture-analyzer/SKILL.md` (modify) - the generated awareness rule + folder creation use the configured root.
- `skills/project-quality-loop/SKILL.md` (modify) - the BOOTSTRAP `mkdir` uses the configured root.
- `skills/project-related-context/SKILL.md` (modify) - one line noting the doc path honors the root.
- `skills/project-architecture-quality-loop/SKILL.md` (modify) - one line noting the paths honor the root.
- `claude/claude-stack.sh`, `claude/claude-stack.ps1` (modify) - the gitignore reminder notes the docs root.

---

### Task 1: declare the docs-root convention + remap rule in the templates

**Files:**
- Modify: `claude/CLAUDE.template.md`, `cursor/AGENTS.template.md`

- [ ] **Step 1: Add the convention to `CLAUDE.template.md`**

Find where the template documents the generated project docs (the rules table mentioning `docs/architecture/` and `docs/PROJECT-CODE-STYLE.md`, around lines 33-35). Add a short subsection just above or below that table:

```markdown
### Generated docs root

The skill-generated project docs - the architecture map (`architecture/`), `PROJECT-CODE-STYLE.md`,
`PROJECT-RELATED-CONTEXT.md`, and the quality-loop prompts (`loops/`) - all live under a single
**docs root**, `docs/` by default. To relocate them, set the root here:

- **Docs root:** `docs/`

Wherever a skill or agent instruction names a generated project doc as `docs/<name>` (for example
`docs/architecture/ARCHITECTURE.md`), resolve it under the configured root instead - so with the
default the path is unchanged. Relocating to `.claude/docs/` keeps the docs local: `.claude/` is
gitignored, so they will NOT be committed, will not survive a fresh clone, and will not reach a
teammate - keep the root under a committed path (the `docs/` default) unless you specifically want
them machine-local.
```

- [ ] **Step 2: Add the twin to `AGENTS.template.md`**

Add the same subsection to `cursor/AGENTS.template.md` where it documents its generated docs, worded for Cursor (`AGENTS.md` instead of `CLAUDE.md`, same content otherwise).

- [ ] **Step 3: Verify lint + parity**

Run: `npm run lint`
Expected: `lint-skills: clean (...)`. (The added prose introduces no new backticked skill tokens - `PROJECT-CODE-STYLE.md` etc. carry a `.md` suffix so they are not treated as skill tokens.)

- [ ] **Step 4: Commit**

```bash
git add claude/CLAUDE.template.md cursor/AGENTS.template.md
git commit -m "$(printf 'feat(templates): declare a configurable generated-docs root\n\n  Added a docs-root convention plus a remap rule to both templates so a project can relocate the skill-generated docs, defaulting to the committed docs/ folder.\n  Warned that relocating under .claude/ makes the durable docs local-only (gitignored).')"
```

---

### Task 2: generators + owner skills honor the configured root

**Files:**
- Modify: `skills/project-code-style-analyzer/references/inject-code-style.template.js`, `skills/project-code-style-analyzer/SKILL.md`, `skills/project-architecture-analyzer/SKILL.md`, `skills/project-quality-loop/SKILL.md`, `skills/project-related-context/SKILL.md`, `skills/project-architecture-quality-loop/SKILL.md`, `claude/claude-stack.sh`, `claude/claude-stack.ps1`

**Interfaces:**
- Consumes: the docs-root convention from Task 1.

- [ ] **Step 1: Make the code-style hook template read a configurable root**

In `skills/project-code-style-analyzer/references/inject-code-style.template.js`, the doc path is hardcoded (`const docPath = path.join(root, 'docs', 'PROJECT-CODE-STYLE.md');`). Change it to take the docs-root segment from an env var with a `docs` default, so a generated hook for a relocated project bakes the right path:

```js
const docsRoot = process.env.STACK_DOCS_ROOT || 'docs';
const docPath = path.join(root, docsRoot, 'PROJECT-CODE-STYLE.md');
```

Update the two nearby comment/string mentions of `docs/PROJECT-CODE-STYLE.md` (lines ~6, ~69, ~73) to say `<docs-root>/PROJECT-CODE-STYLE.md` or keep `docs/PROJECT-CODE-STYLE.md` as the default label - do not leave a claim that contradicts the now-configurable path.

- [ ] **Step 2: The code-style-analyzer generation step substitutes the root**

In `skills/project-code-style-analyzer/SKILL.md`, at the step that writes `docs/PROJECT-CODE-STYLE.md` and generates the hook, state that both the doc and the generated hook use the project's configured docs root (default `docs/`, per the project's CLAUDE.md), and that when the root is relocated the generated hook must bake that root (it is deterministic code and cannot follow the remap rule). Keep `docs/` as the default in the description/first mention.

- [ ] **Step 3: The architecture analyzer uses the configured root**

In `skills/project-architecture-analyzer/SKILL.md`, where it CREATES `docs/architecture/` and generates the `baseline-project-architecture.md` awareness rule (which embeds the read-the-map path), state that the folder is created under and the awareness rule embeds the project's configured docs root (default `docs/`). Keep `docs/architecture/` as the default label.

- [ ] **Step 4: The quality loops + related-context note the root**

- `skills/project-quality-loop/SKILL.md`: the BOOTSTRAP `mkdir -p docs/loops` and the DISCOVERY `ls docs/loops/*.md` should say the loops folder lives under the configured docs root (default `docs/loops/`). Keep `docs/loops/` as the default in the description.
- `skills/project-related-context/SKILL.md`: one line that `PROJECT-RELATED-CONTEXT.md` lives under the configured docs root (default `docs/`).
- `skills/project-architecture-quality-loop/SKILL.md`: one line that the `docs/architecture/` paths it names resolve under the configured docs root.

Keep each skill's `description:` frontmatter naming the `docs/` default unchanged (descriptions cite the default for discovery).

- [ ] **Step 5: Installer gitignore reminder notes the docs root**

In the gitignore reminder block of `claude/claude-stack.sh` and `claude/claude-stack.ps1`, add a line noting that if the project relocates its docs root under `.claude/`, those generated docs are covered by the existing `.claude` ignore (and are therefore local-only) - so the durable default is a committed `docs/`. Keep the two installers in parity.

- [ ] **Step 6: Verify - lint, parity, and a grep sanity check**

Run: `npm run lint`
Expected: clean.

Run a grep sanity check that no owner skill's WRITE/CREATE instruction still hardcodes `docs/` without acknowledging the root (informational, not a hard gate):
```bash
grep -rn "mkdir -p docs/\|writeFileSync.*'docs'" skills/project-*/ claude/ 2>/dev/null || echo "no un-parameterized doc-creation found"
```

- [ ] **Step 7: Commit**

```bash
git add skills/project-code-style-analyzer skills/project-architecture-analyzer skills/project-quality-loop skills/project-related-context skills/project-architecture-quality-loop claude/claude-stack.sh claude/claude-stack.ps1
git commit -m "$(printf 'feat(skills): honor the configurable docs root in generators and owner skills\n\n  Made the inject-code-style hook read STACK_DOCS_ROOT (default docs) so a generated hook bakes a relocated root, and had the code-style and architecture captures generate under the configured root.\n  Noted the root in the quality loops, related-context, and the installer gitignore reminder.')"
```

---

## Self-Review

**Spec coverage:**
- Configurable docs location with a committed `docs/` default - Task 1 convention + Task 2 generators. Covered.
- No 50-file sweep - the remap rule handles the 40 read-only agents; only generators + folder-creation are edited. Covered.
- `.claude/` = local-only warning - Task 1 Step 1 + Task 2 Step 5. Covered.

**Placeholder scan:** none - all edits are concrete prose or code.

**Type consistency:** the env var name `STACK_DOCS_ROOT` and the default `docs` are used identically in the hook template (Task 2 Step 1) and its generation step (Task 2 Step 2). The convention label 'docs root' / default `docs/` is consistent across the templates and skills.

---

## Note

This is a self-contained enhancement to the existing stack (not part of the setup-plugin feature, which is already merged). The Cursor twin of the setup plugin remains a separate deferred item.
