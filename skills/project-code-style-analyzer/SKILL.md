---
name: project-code-style-analyzer
description: "The deliberate project code-style capture: fan out code-style-analyzer agents (one per detected language), merge their reports into docs/PROJECT-CODE-STYLE.md, and generate + wire the inject-code-style hook that surfaces that doc at edit time, filtered to the exact file extensions the agents observed. Re-run to refresh: the same analysis, but the doc reconciles in place and the hook is rewritten only if invalid or outdated. Manual, /-only. Triggers on 'capture the project code style' or 'set up the code-style doc and hook'. NOT for architecture (project-architecture-quality-loop), one language's style question (@agent-code-style-analyzer alone), or enforcing style (the per-language configs stay the enforced source)."
disable-model-invocation: true
---

# Project Code Style Analyzer - Capture, Merge, Inject (Deliberate)

You drive the deliberate capture of a project's ACTUAL code style and make it self-serving at edit time. Three artifacts come out of a run; a re-run repeats the same analysis, then reconciles the doc in place, rewrites the hook only if it is invalid or outdated, and leaves the wiring alone:

1. `docs/PROJECT-CODE-STYLE.md` - the merged style doc: how this codebase really writes each of its languages (config-enforced rules + the idioms a linter cannot encode), divergence from the house convention skills flagged.
2. `.claude/hooks/inject-code-style.js` - a generated PreToolUse hook that injects that doc into context once per session, on the first edit of a file whose extension the analysis actually observed - so the style is in front of whoever writes code without anyone remembering to open a doc.
3. The `.claude/settings.json` wiring for that hook (idempotent - added once, kept thereafter).

The per-language configs (`.editorconfig`, eslint/prettier, `tsconfig`, the SQL linter rules) stay the enforced source of truth; the doc records what they encode and what they cannot. Code style is NOT architecture - structure, boundaries, and patterns live in `docs/architecture/`, owned by the project-architecture-analyzer skill. Never fold one into the other.

## Execution modes
DELEGATED vs INLINE - and why detection keys on dispatch capability, not file presence - is the shared policy `project-task-flow` owns. Pick once, hold for the run:

- **DELEGATED** (dispatch available) - fan out code-style-analyzer per language as below; you merge and write.
- **INLINE** (no dispatch: Cursor, or a single-language repo too small to fan out) - do the same characterization in-session, one language at a time, honoring the agent's own rules (config first, located code second, 2 locating passes per language, divergence flagged) - then continue at MERGE identically.

## The run

### 1. DETECT - what languages does this repo hold?
A cheap Glob scan, in-session: `*.cs`, `*.xaml`, `*.ts`, `*.html`, `*.scss`/`*.css`, `*.sql`, plus the config markers (`package.json`, `angular.json`, `*.csproj`, `tsconfig.json`, `.editorconfig`, eslint/prettier config, SQL linter config). The result is the fan-out list - one language family per seat (e.g. WPF repo: C# + XAML; Angular repo: TypeScript/Angular + SCSS/CSS; ASP.NET repo: C# alone). Do not dispatch for a language the scan did not find.

### 2. FAN OUT - one code-style-analyzer per language, in parallel
Dispatch all seats in a single message. Each dispatch prompt names its language-family scope and nothing else - the agent reads its config + representative code and returns the structured report (project type, observed extensions, enforcement map, enforced rules, idioms, uncertain/inconsistent). The agents write no files; their final messages are your merge input.

### 3. MERGE - write docs/PROJECT-CODE-STYLE.md
Consolidate the reports into one doc - apply the `markdown-style` skill so it reads as a quick reference, not a wall of prose. Shape:

1. One opening line - the project's actual style; configs stay enforced; this captures what they cannot; where this doc and a house convention skill disagree, THIS doc wins.
2. **Project type** - the consolidated verdict from the seats' evidence.
3. **Enforcement map** - one table across languages: language -> config file(s) -> what runs them.
4. **Per language** - each seat's Enforced + Idioms sections, merged faithfully: keep every 'uncertain'/'inconsistent' marker, never smooth one over, and keep the divergence-from-house-skill flags - they are the useful signal.
5. **Cross-cutting idioms** - what spans languages: file/folder organization, test structure and naming, comment density.

Re-run: reconcile the existing doc against the fresh reports - correct what drifted, add what is new, drop what is gone.

### 4. HOOK - rewrite the injector only when invalid or outdated
Build the extension union from the agents' **Language + extensions** sections ONLY - never pad it from assumption (a WPF repo gets `cs|xaml`, an Angular repo `ts|html|scss`, an ASP.NET repo `cs` - plus whatever else was genuinely observed, e.g. `sql`). Then decide, don't blindly overwrite:

1. **Check the existing `.claude/hooks/inject-code-style.js`** (missing counts as invalid). It is CURRENT when all three hold:
   - valid: `node --check` passes;
   - same template generation: its `template-version:` line matches `references/inject-code-style.template.js`;
   - same filter: the extension alternation in its `/\.( ... )$/` test equals the fresh union (order-insensitive).
   All three hold -> leave the hook untouched, report 'hook current', skip to WIRE.
2. **Invalid or outdated** (any check fails) -> regenerate: copy the template over it, replacing the `__EXTENSIONS__` placeholder with the pipe-joined fresh union (e.g. `cs|xaml`). Never hand-edit the copy or patch it in place - the template is the only source.
3. **Verify what you (re)generated before trusting it:** `node --check`, then drive it once - pipe a fake PreToolUse JSON (`{"session_id":"test","cwd":"<root>","tool_input":{"file_path":"x.<ext>"}}`) through it and confirm it emits the `additionalContext` JSON; pipe a non-matching extension and confirm silence. Delete the test's temp marker (`$TMPDIR/claude-codestyle-*.marker`).

This generated hook is per-project output, deliberately NOT in the stack installer's HOOKS manifest - the installer fetches only named files and prunes nothing in `.claude/hooks/`, so `stack update` never touches it.

### 5. WIRE - .claude/settings.json, idempotently
Read the project's `.claude/settings.json` (create `{}` if absent), and ensure `hooks.PreToolUse` contains an entry whose command references `inject-code-style.js`; if missing, append:

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/inject-code-style.js\"" }]
}
```

Parse, check, append, rewrite - never regex-edit JSON, and never remove or reorder the entries the stack installer wired. Already present (a re-run): leave it untouched.

### 6. REPORT
Confirm the three artifacts (doc created/refreshed + sections touched; hook generated / rewritten-as-outdated / left current, with the extension union; wiring added/already present). Then briefly: the languages detected, the notable idioms a linter cannot enforce, and any divergence from the house skills worth attention. All three artifacts are committed files - remind the user they ship with the repo. No re-paste of the doc body - point to the file.

## Don't game it
The doc records the style the code actually follows, not an aspiration - the agents' rules bind the merge too: every idiom names observed code, splits stay 'inconsistent', absent conventions stay absent. The hook filter is derived, not designed - extensions come from the reports, and the verify step in HOOK runs against the real generated file, not the template.
