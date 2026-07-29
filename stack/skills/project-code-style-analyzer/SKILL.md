---
name: project-code-style-analyzer
description: "The deliberate project code-style capture: fan out code-style-analyzer agents (one per detected language), merge their reports into <docs-path>/PROJECT-CODE-STYLE.md, and generate the path-scoped project-code-style rule that auto-attaches the style core whenever a matching file is touched - in the main session AND in dispatched subagents. Re-run to refresh: the same analysis, the doc reconciles in place, the rule regenerates from the fresh reports. Manual, /-only. Triggers on 'capture the project code style' or 'set up the code-style doc and rule'. NOT for architecture (project-architecture-analyzer), one language's style question (@agent-code-style-analyzer alone), or enforcing style (the per-language configs stay the enforced source)."
disable-model-invocation: true
---

# Project Code Style Analyzer - Capture, Merge, Attach (Deliberate)

You drive the deliberate capture of a project's ACTUAL code style and make it self-serving at write time. Two artifacts come out of a run; a re-run repeats the same analysis, then reconciles the doc in place and regenerates the rule from the fresh reports:

1. `<docs-path>/PROJECT-CODE-STYLE.md` - the merged style doc: how this codebase really writes each of its languages (config-enforced rules + the idioms a linter cannot encode), divergence from the house convention skills flagged. It opens with the `Captured: <branch>@<short-sha>, <date>` lifecycle stamp (`+dirty` on an uncommitted tree) - the docs-root rule (`.claude/rules/baseline-docs-root.md`) owns what readers make of it.
2. `.claude/rules/project-code-style.md` - a generated path-scoped rule carrying the condensed style core, its `paths:` globs built from the exact extensions the analysis observed. The rules channel delivers it mechanically wherever a matching file is touched - main session and dispatched subagents alike (a PreToolUse hook's injected context never reaches subagent tool calls, which is why this is a rule and not a hook). The full doc stays the deep reference; the rule is the always-delivered essence.

The per-language configs (`.editorconfig`, eslint/prettier, `tsconfig`, the SQL linter rules) stay the enforced source of truth; the doc records what they encode and what they cannot. Code style is NOT architecture - structure, boundaries, and patterns live in `<docs-path>/architecture/`, owned by the project-architecture-analyzer skill. Never fold one into the other.

## Execution modes
DELEGATED vs INLINE keys on dispatch capability, not file presence - agent files on disk with no Agent tool to dispatch them is still INLINE. When dispatch is available, ask ONE question before a first capture's fan-out, via AskUserQuestion - characterize via code-style-analyzer seats (recommend it: the seats absorb the reads), or in-session? - unless a calling flow already picked the run's mode, which is inherited, never re-asked. Pick once, hold for the run:

- **FIRST capture** (no existing doc, or no `Captured:` stamp) - DELEGATED (the user chose seats): fan out code-style-analyzer per language as below; you merge and write. INLINE (chosen - or forced, no question asked: no dispatch (Cursor), or a single-language repo too small to fan out): the same characterization in-session, one language at a time, honoring the agent's own rules (config first, located code second, 2 locating passes per language, divergence flagged) - then continue at MERGE identically.
- **UPDATE** (doc + stamp exist) - INLINE in this session: `git diff --name-only <stamp-sha>..HEAD` names the changed files, and only the language families those files belong to get re-verified (config re-read, idioms spot-checked) - the other languages' sections stand. Escalate back to per-language dispatch when the drift spans most languages, the stamp's sha is unreachable or `+dirty`, or the USER explicitly asks for agents - their ask always wins.

## The run

### 1. DETECT - what languages does this repo hold?
A cheap Glob scan, in-session: `*.cs`, `*.xaml`, `*.ts`, `*.html`, `*.scss`/`*.css`, `*.sql`, plus the config markers (`package.json`, `angular.json`, `*.csproj`, `tsconfig.json`, `.editorconfig`, eslint/prettier config, SQL linter config). The result is the fan-out list - one language family per seat (e.g. WPF repo: C# + XAML; Angular repo: TypeScript/Angular + SCSS/CSS; ASP.NET repo: C# alone). Do not dispatch for a language the scan did not find.

### 2. FAN OUT - one code-style-analyzer per language, in parallel
Dispatch all seats in a single message. Each dispatch prompt names its language-family scope and nothing else - the agent reads its config + representative code and returns the structured report (project type, observed extensions, enforcement map, enforced rules, idioms, uncertain/inconsistent). The agents write no files; their final messages are your merge input.

### 3. MERGE - write <docs-path>/PROJECT-CODE-STYLE.md
Consolidate the reports into one doc - apply the `markdown-style` skill so it reads as a quick reference, not a wall of prose. Shape:

1. One opening line - the project's actual style; configs stay enforced; this captures what they cannot; where this doc and a house convention skill disagree, THIS doc wins.
2. **Project type** - the consolidated verdict from the seats' evidence.
3. **Enforcement map** - one table across languages: language -> config file(s) -> what runs them.
4. **Per language** - each seat's Enforced + Idioms sections, merged faithfully: keep every 'uncertain'/'inconsistent' marker, never smooth one over, and keep the divergence-from-house-skill flags - they are the useful signal.
5. **Cross-cutting idioms** - what spans languages: file/folder organization, test structure and naming, comment density.

Re-run: reconcile the existing doc against the fresh reports - correct what drifted, add what is new, drop what is gone.

### 4. RULE - regenerate .claude/rules/project-code-style.md
Build the extension union from the agents' **Language + extensions** sections ONLY - never pad it from assumption (a WPF repo gets `cs|xaml`, an Angular repo `ts|html|scss`, an ASP.NET repo `cs` - plus whatever else was genuinely observed, e.g. `sql`). Then generate from `references/code-style-rule.template.md`:

1. `__PATH_GLOBS__` -> one `  - "**/*.<ext>"` line per observed extension. Derived, not designed.
2. `__STYLE_CORE__` -> the condensed essence of the merge: each language's Enforced + Idioms as tight bullets (keep 'uncertain'/'inconsistent' markers), plus the cross-cutting idioms. Aim small - this text is injected into every session that touches matching code; detail beyond what a writer needs on the spot belongs in the doc, not the rule.
3. `__DOC_PATH__` -> the SAME resolved docs root the doc was just written under, baked as a literal (a rule is static text - it cannot resolve env at load; the next capture re-bakes it if the root moved).

Regenerate on every run - the rule is derived output, cheap to rebuild, and rebuilding from the same reports as the doc is what keeps the two in sync. Never hand-reconcile it. Verify after writing: frontmatter parses, every glob came from an observed extension, the doc pointer names an existing file.

This generated rule is per-project output, deliberately NOT in the stack's RULES set - the installer fetches only named files and never prunes `.claude/rules/`, so `stack update` never touches it.

### 5. RETIRE - remove the legacy hook, if present
Earlier captures generated `.claude/hooks/inject-code-style.js` + a `settings.json` PreToolUse entry. The rule replaces it (one home per piece - both together would double-inject in main sessions). If the hook file exists: delete it, then parse `.claude/settings.json`, remove the PreToolUse entry whose command references `inject-code-style.js`, and rewrite - never regex-edit JSON, never touch the entries the stack installer wired. Nothing to retire on a clean project: skip silently.

### 6. REPORT
Confirm the artifacts (doc created/refreshed + sections touched; rule regenerated, with the extension union; legacy hook retired / none found). Then briefly: the languages detected, the notable idioms a linter cannot enforce, and any divergence from the house skills worth attention. State where each landed - machine-local under the default layout (`.claude/*` is gitignored), shipped with the repo only when the project set a committed docs root. No re-paste of the doc body - point to the file.

## Don't game it
The doc records the style the code actually follows, not an aspiration - the agents' rules bind the merge too: every idiom names observed code, splits stay 'inconsistent', absent conventions stay absent. The rule's globs and core are derived, not designed - extensions and idioms come from the reports, and the verify step in RULE runs against the real generated file, not the template.
