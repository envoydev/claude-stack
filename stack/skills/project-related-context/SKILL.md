---
name: project-related-context
description: "The deliberate related-projects capture: given paths or git URLs to sibling repos, fan out related-project-analyzer agents (one per sibling, parallel) and write BOTH tiers from their entries - the always-on awareness rule .claude/rules/baseline-project-related-context.md (lean name / location / relation / seam per sibling) and docs/PROJECT-RELATED-CONTEXT.md (the on-demand orientation doc). Re-run to refresh: entries upserted per passed sibling, unlisted entries kept. Args-driven - it analyzes the locations you name, it never scans for siblings. Triggers on 'capture the related projects' or 'map the sibling repos'. NOT for this repo's own architecture (project-architecture-analyzer) or dynamic cross-repo findings (the memory MCP)."
disable-model-invocation: true
---

# Project Related Context - Capture the Sibling Repos (Deliberate)

You drive the deliberate capture of a project's related repositories, and you own both tiers of the house related-projects model:

1. `.claude/rules/baseline-project-related-context.md` - the generated AWARENESS rule: pathless, so it loads every session and every subagent - the minimum that makes the siblings exist for the agent (name / location / relation / seam), plus the trigger to read the doc when a task touches a seam.
2. `docs/PROJECT-RELATED-CONTEXT.md` - the on-demand ORIENTATION doc: the full entries including `first_read` and the evidence behind each relation and seam, read when actually working near a seam. Lives under the project's configured docs root (`CLAUDE_DOCS_PATH` in `.claude/settings.json` env, default `.claude/docs`).

Both are generated files; a re-run refreshes both in place. The rule's name is deliberately NOT in the stack installer's fetch manifest (and never may be - a fetch would overwrite the generated copy) and nothing prunes the rules directory, so both survive `stack update`. Under the default layout both are machine-local (`.claude/*` is gitignored and the docs root defaults inside it) - a fresh clone re-runs the capture; only a committed docs root ships the doc with the repo.

**Args-driven, never a scan.** The user names the related projects - local paths or git URLs, optionally with a relation hint each (`../backend`, `git@github.com:org/shared-contracts.git provides-to`). In-repo sub-projects are siblings too: `./server`, `./client` in a monorepo are valid locations, and their entries give project-solve-cross-task the dependency direction for producer-first ordering. No args: ask for them and stop. Do not guess at siblings from the filesystem.

## Execution modes
DELEGATED vs INLINE - the shared policy `project-solve-cross-task` owns. Pick once, hold for the run:

- **DELEGATED** (dispatch available) - fan out related-project-analyzer per sibling as below; you merge and write.
- **INLINE** (no dispatch: Cursor) - do the same characterization in-session, one sibling at a time, honoring the agent's own rules (both-sides cross-reference evidence, verified first_read, 3 locating passes, UNVERIFIED over fabrication; a URL sibling is shallow-cloned to scratch and removed after) - then continue at MERGE identically.

## The run

### 1. VALIDATE - the arg list
For each location: a path must exist (relative resolved from the project root), a URL must look like a git remote. An invalid location is reported and skipped, never silently dropped. Note each relation hint - it travels to the agent as a prior, not a verdict.

### 2. FAN OUT - one related-project-analyzer per sibling, in parallel
Dispatch all seats in a single message. Each dispatch prompt carries: the HOST project's root and identity (name + package/assembly ids - read them once from the manifest files first), ONE sibling location, and its hint if given. The agents write no files; their final messages - one YAML entry + evidence + uncertainty each - are your merge input. An agent returning UNVERIFIED fields is a valid result: both tiers record what could not be read.

### 3. MERGE - write docs/PROJECT-RELATED-CONTEXT.md
Consolidate into one doc - apply the `markdown-style` skill so it reads as a quick reference. Shape:

1. One opening line - what the doc is: the durable orientation detail for cross-repo work; the always-loaded awareness minimum lives in the generated rule; dynamic findings go to the memory MCP, never here.
2. **The entries** - one `related_projects:` YAML block, the house schema per sibling:
```yaml
related_projects:
  - name:     <sibling name>
    location: <path or git URL>
    relation: consumes | provides-to | peer | depends-on | embeds
    first_read: [<docs-path-from-sibling-root-to-read-before-working-a-seam>]
    seam:     <the shared surface a change here can break there - API, package, schema>
```
3. **Per sibling** - a short evidence note under its own heading: what grounds the relation and seam (the located files, both sides), plus any uncertainty or UNVERIFIED marker carried over verbatim. Keep each note lean - orientation, not an audit.

A filled entry looks like:

```yaml
related_projects:
  - name:     acme-billing-api
    location: ../acme-billing-api
    relation: provides-to
    first_read: [docs/architecture/ARCHITECTURE.md]
    seam:     the OrderCreated contract in src/Contracts - this repo publishes, billing consumes
```

### 4. RULE - write .claude/rules/baseline-project-related-context.md
The awareness tier, generated from the same entries - a valid PATHLESS rule (frontmatter with a `description:` and NO `paths:`, so it is always-on). Keep it to the awareness minimum; describe edges, not roles:

```markdown
---
description: Related projects awareness - generated by /project-related-context; edit via a re-run, not by hand.
---

# Related projects

This repo is one of several that make up a product. The siblings, the edges that bind them:

<related_projects yaml block - name / location / relation / seam per sibling (NO first_read - that
detail is the doc's job)>

- Everything past awareness - first_read, the evidence behind each seam - lives in the committed
  `docs/PROJECT-RELATED-CONTEXT.md`; read it when a task touches a seam.
- serena binds to THIS repo: Read/Grep a sibling directly, but symbol-navigate it only from a
  context rooted there.
- Dynamic cross-repo findings go to the memory MCP, never a committed file.
```

Create `.claude/rules/` when absent. The rule is regenerate-only: entries come from the reports, the three closing bullets are fixed - never hand-edit the copy, never let the rule grow evidence or first_read detail (always-on tokens are paid every session and every subagent; the fat stays in the doc).

**Re-run is an upsert, keyed by `location`, in BOTH files.** A sibling passed this run: its entry (and doc note) rewritten from the fresh report. An existing entry whose location was NOT passed: kept exactly as-is (removal is a manual edit - report which entries you left untouched so stale ones are visible). Both files converge; they never accumulate duplicates, and their entry sets never drift apart - the same run writes both.

### 5. REPORT
Confirm both artifacts (rule created/refreshed + entry count; doc created/refreshed + entries rewritten vs kept; any location skipped as invalid or UNVERIFIED). State where each landed - machine-local under the default layout, shipped with the repo only when the project set a committed docs root. No re-paste of either body - point to the files.

## Don't game it
Every entry is grounded in the agent's located evidence or carries its UNVERIFIED marker into both tiers - a relation is never smoothed over, a hint never overrides contradicting evidence silently (the contradiction is reported), a first_read never lists a doc that was not verified to exist. Unreachable siblings stay in both files as UNVERIFIED entries, not silently dropped - the reader deserves to know a seam exists even when it could not be read.
