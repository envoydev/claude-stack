---
name: project-related-context
description: "The deliberate related-projects capture: given paths or git URLs to sibling repos, fan out related-project-analyzer agents (one per sibling, parallel), and merge their YAML entries into docs/PROJECT-RELATED-CONTEXT.md - the committed orientation doc for cross-repo work (name / location / relation / first_read / seam per sibling). Re-run to refresh: the same analysis, entries upserted per passed sibling, unlisted entries kept. Manual, /-only, and args-driven - it analyzes the locations you name, it never scans for siblings. Triggers on 'capture the related projects' or 'map the sibling repos'. NOT for this repo's own architecture (architecture-quality-loop), the always-loaded awareness entries in CLAUDE.md's '## Related projects' section (maintained by hand - this skill reports suggestions, never edits CLAUDE.md), or dynamic cross-repo findings (the memory MCP)."
disable-model-invocation: true
---

# Project Related Context - Capture the Sibling Repos (Deliberate)

You drive the deliberate capture of a project's related repositories into one committed doc: `docs/PROJECT-RELATED-CONTEXT.md` - the on-demand orientation tier of the house related-projects model. The always-loaded awareness minimum stays in the project's `CLAUDE.md` `## Related projects` section (the lean name/location/relation/seam entries its template defines), maintained by hand - this skill writes ONLY the doc, and its report offers ready-to-paste awareness entries so the two tiers stay easy to align.

**Args-driven, never a scan.** The user names the related projects - local paths or git URLs, optionally with a relation hint each (`../backend`, `git@github.com:org/shared-contracts.git provides-to`). No args: ask for them and stop. Do not guess at siblings from the filesystem.

## Execution modes
DELEGATED vs INLINE - the shared policy `cross-stack-agents-flow` owns. Pick once, hold for the run:

- **DELEGATED** (dispatch available) - fan out related-project-analyzer per sibling as below; you merge and write.
- **INLINE** (no dispatch: Cursor) - do the same characterization in-session, one sibling at a time, honoring the agent's own rules (both-sides cross-reference evidence, verified first_read, 3 locating passes, UNVERIFIED over fabrication; a URL sibling is shallow-cloned to scratch and removed after) - then continue at MERGE identically.

## The run

### 1. VALIDATE - the arg list
For each location: a path must exist (relative resolved from the project root), a URL must look like a git remote. An invalid location is reported and skipped, never silently dropped. Note each relation hint - it travels to the agent as a prior, not a verdict.

### 2. FAN OUT - one related-project-analyzer per sibling, in parallel
Dispatch all seats in a single message. Each dispatch prompt carries: the HOST project's root and identity (name + package/assembly ids - read them once from the manifest files first), ONE sibling location, and its hint if given. The agents write no files; their final messages - one YAML entry + evidence + uncertainty each - are your merge input. An agent returning UNVERIFIED fields is a valid result: the doc records what could not be read.

### 3. MERGE - write docs/PROJECT-RELATED-CONTEXT.md
Consolidate into one doc - apply the `markdown-style` skill so it reads as a quick reference. Shape:

1. One opening line - what the doc is: the committed orientation detail for cross-repo work; the always-loaded awareness minimum lives in `CLAUDE.md` `## Related projects`; dynamic findings go to the memory MCP, never here.
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

**Re-run is an upsert, keyed by `location`.** A sibling passed this run: its entry and note are rewritten from the fresh report. An existing entry whose location was NOT passed: kept exactly as-is (removal is a manual edit - report which entries you left untouched so stale ones are visible). The doc converges; it never accumulates duplicates.

### 4. REPORT
Confirm the doc (created/refreshed, entries rewritten vs kept, any location skipped as invalid or UNVERIFIED). Then offer the awareness tier: for each entry, a ready-to-paste lean line set (name/location/relation/seam - no first_read, that detail is this doc's job) for the user to reconcile into `CLAUDE.md` `## Related projects` by hand. The doc is a committed file - remind the user it ships with the repo. No re-paste of the doc body - point to the file.

## Don't game it
Every entry is grounded in the agent's located evidence or carries its UNVERIFIED marker into the doc - a relation is never smoothed over, a hint never overrides contradicting evidence silently (the contradiction is reported), a first_read never lists a doc that was not verified to exist. Unreachable siblings stay in the doc as UNVERIFIED entries, not silently dropped - the reader deserves to know a seam exists even when it could not be read.
