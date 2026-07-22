---
description: "FRESH install of the claude-stack, from scratch - ask scope + profile up front, then detect the OS + analyse the project and walk the selection in six dependency-ordered layers (rules -> agents -> skills -> hooks -> MCPs -> plugins): each layer shows ONE numbered table of the whole catalog (recommended pre-selected, locked rows carrying the required-by reason), then one selection round - Recommended / All / None, or typed numbers to add and drop. Prerequisite check, install, an OFFERED (never forced) CLAUDE.md fill-in, and a next-steps card (git-hygiene suggestions, the capture sequence in order, a per-language serena note) close the run. In a project, the selection is decided FROM the project (detected stacks seed the recommendations); outside any project it falls back to a global install seeded from the recommended set, stacks chosen by the user. NOT for an existing install - a plain refresh is the sibling update command, choosing what to add or drop is configure."
disable-model-invocation: true
---

# Set up the Claude stack - fresh install

You are bootstrapping the claude-stack FROM SCRATCH. If the stack is already installed here (a populated `.claude/skills` + `.claude/agents`, or the global account equivalents in no-project mode), stop and route to a sibling command: `/claude-stack:update` for a plain refresh, `/claude-stack:configure` to adjust the selection - updates are their job. Work the ladder in order and drive it interactively; the deterministic work is done by `stack-select.js`, you orchestrate. Two modes, detected silently before the first question: **project mode** (the normal case - cwd is a project root in a git repo; the selection is decided from the project itself) and **no-project mode** (anything else - a global install seeded from the recommended set).

**ONE release archive is the entire download** - read `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md` before step 1 and hold the whole run to it: download + extract once into `$TMP/repo` (the reference owns the fallback), use every tool from that snapshot, hand it to the installer with `--source` in step 10, and remove `$TMP` per the 'Clean up' section on every exit path. The protocol's 'Narrate, don't trace' section governs every tool call in this run: one quiet call per recompute, no pasted tool output, one narration line between steps.

## The ladder - announce every step

Eleven user-facing steps; the machinery between them runs silently. Before EVERY question, one banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 3/11 - rules] choose the rule set · next: agents
```

1 install choices · 2 project analysis · 3 rules · 4 agents · 5 skills · 6 hooks · 7 MCPs · 8 plugins · 9 prerequisite check · 10 install · 11 CLAUDE.md (optional)

**The skeleton is INVARIANT - the stability contract.** Every run prints all 11 banners, in this
order, exactly once each. A step that does not apply THIS run still prints its banner followed by
ONE line naming why it is a no-op (`[step 2/11 - project analysis] skipped - no-project mode,
stacks chosen by hand`, `[step 11/11 - CLAUDE.md] skipped - global install, no project file`),
then moves on - a step never silently vanishes, and steps are never merged, reordered,
renumbered, or invented. Two runs must be comparable banner by banner; the content varies, the
skeleton never does. The closing next-steps card (Post-check below) is part of the skeleton too -
every run ends with it.

## 1. Install choices

Detect silently first - the OS (`darwin`/`linux` -> `claude-stack.sh`; Windows -> `claude-stack.ps1` via `pwsh`) and the mode (project root in a git repo -> project mode; anything else -> no-project mode) - then ask ONE screen with only the choices a fresh install actually needs: scope (`project` default / `global`; in no-project mode this question becomes the no-project-mode confirmation instead - a `global` install into the account `~/.claude` - since there is no project to scope to) and profile (the optional `--space` account name, default none), plus the two environment values the install writes into the scope's settings.json: the context auto-compact trigger (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` - accept the house default 40, type another percent, or 'off' = `autoCompactEnabled: false` instead) and the generated-docs root (`CLAUDE_DOCS_PATH` - default `.claude/docs`, machine-local; a committed forward-slash path like `docs` shares the captured docs with the team). Brownfield: when the target settings.json already carries either value, present THAT as the default - never silently override a pinned choice. One conditional extra: 'install the GitHub CLI?' - asked ONLY when `gh` is not already on PATH, skipped entirely when it is. Everything else moved to where it belongs: the context7 transport is asked at step 7 only if context7 ends up selected, and `--keep-pins` is a configure/update question - a fresh install has no local pin edits to keep, so never ask it here.

## 2. Project analysis - the stacks

Project mode - detect stacks by artifact and record which apply (this detection IS the recommendation input; decide from the project, not from a generic default):

- `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
- `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
- `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- `tsconfig.json` / `jsconfig.json` -> `typescript` (the language-level seed - conventions rule + LSP plugin; an Angular/mobile repo matches it too, harmlessly, their seeds already carry both).

Alongside the stack scan, run the EVIDENCE scan quietly - one call, one narration line:
`node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog "$TMP/repo/setup-plugin/references/evidence.json" --out "$TMP/found.json"` - a deterministic read of the project's package manifests (csproj / Directory.Packages.props / package.json) against the signal catalog. Its `found` map feeds the walk's tables via `--found` and pre-selects what the project provably uses; the conclusions are computed from THIS project's files, never assumed.

A project can match several. Report the detected stacks and let the user confirm/adjust - the walk starts IMMEDIATELY after this answer, no other question in between:

```
[step 2/11 - project analysis] confirm the detected stacks · next: rules
Detected: aspnet (src/Api/Api.csproj - Microsoft.NET.Sdk.Web), angular (angular.json), devops (Dockerfile + .github/workflows/)
```

No-project mode, and a repo with NO recognizable artifacts (greenfield): skip the artifact detection and instead present the stacks available in `${CLAUDE_PLUGIN_ROOT}/references/recommendations.json` as a multi-pick ('which stacks do you work with?' / 'what will this project be?'); picking none installs just the `always` baseline. Every later step applies unchanged.

## The walk - steps 3-8, one layer at a time

The layer order follows the dependency graph's arrows: rules pull agents + skills, agents pull skills, everything pulls MCPs and plugins, and hooks stand alone - dependencies only point FORWARD through the walk, so an earlier answer is never invalidated by a later one. Hold ONE running `raw.json` (in the temp dir) of the user's DIRECT picks per category (`rules`, `agents`, `skills`, `hooks`, `mcps`, `plugins`); locked items never enter it - the closure re-adds them at emit time.

Per layer, the SAME three-beat shape:

1. **Recompute quietly** - one call: fold the previous layer's picks into `raw.json`, run `node stack-select.js --selection raw.json --graph stack-graph.json`, parse the category-tagged `required: <category> <name> - <why>` lines yourself. The current layer's lines are its **locked** set.
2. **Show ONE numbered table of the layer's ENTIRE catalog** - every item the release ships, so nothing is ever offered later or out-of-band. The TOOL renders it, never you: `node stack-select.js --selection raw.json --graph stack-graph.json --table <layer> --recs <recommendations.json> --stacks <confirmed,csv> --found "$TMP/found.json" > "$TMP/table.txt"`, then paste `table.txt` verbatim inside a fenced code block (the one sanctioned paste - pre-padded by the tool, so it stays aligned at any length; a hand-written markdown table shears when the renderer flushes it in segments). The table ends in a `total: N <layer>` footer - part of the paste and the user's truncation check: fewer visible rows than the footer names (or a missing footer) means the display was cut down - re-paste in full, and never summarize rows into prose; the user decides from the whole catalog, not from a shortlist. Row numbers come from the tool and are stable across rounds. The tool labels each row: `required` (closure-locked, reason in the last column), `evidence` (the scan matched a signal - PRE-SELECTED, the matched signal shown as the reason, droppable like any seed), `recommended` / `stack:<name>` (seeded, droppable), `suggested` (a conditional load a kept agent's protocol names - NOT selected: an option is not a requirement, and it only earns a place when the project actually has what it is for), `added` (the user's own pick), `-` (not selected). Recommended = the union of `always` + each confirmed stack in `${CLAUDE_PLUGIN_ROOT}/references/recommendations.json`, pre-selected:

```
[step 4/11 - agents] adjust the agent roster · next: skills
 # | agent                       | selected     | required by
---+-----------------------------+--------------+---------------------------
 1 | ci-failure-diagnoser        | recommended  | -
 2 | dotnet-build-error-resolver | stack:aspnet | rule dotnet-repair-agents
 3 | wpf-implementer             | -            | -
```

3. **One selection round - quick options + numbers.** Ask with the question tool, options in this order: **Recommended** (keep the table exactly as shown - the default), **All** (select every row in the layer's catalog), **None** (keep only the locked rows), and typed adjustments through the free-text answer - `add 3 7 12`, `drop 5`, or both (bare numbers mean add). A drop naming a LOCKED row is refused with its reason shown ('#2 stays - required by rule dotnet-repair-agents; drop that rule first (reopening step 3) or keep it'), never silently honored or silently ignored. Restate the outcome in one line (added N, dropped M), fold it into `raw.json`, and narrate the handoff to the next layer. An `unknown:` line from the recompute is a typo or a retired name - surface it, never pass it through.

## 3. Rules

Nothing in the graph depends on a rule, so this layer never has locked rows - it is the one fully free pick, which is why it goes first: the rules chosen here decide what later layers must keep.

## 4. Agents

Locked = agents the kept rules require (the repair-loop rules pin their resolvers, e.g. `required by rule dotnet-repair-agents`).

## 5. Skills

The full release catalog in one table - the generator `project-*` skills and every other house skill included, so THIS is the only place skills are ever chosen; later steps (CLAUDE.md included) never offer skill additions. Locked = every skill the kept rules and agents REQUIRE (rule attachments and `skills:` frontmatter preloads), each with the reason naming its dependent. The kept agents' `suggests` (their bodies' conditional 'load X when...' mentions) appear labeled `suggested` but UNSELECTED. Rows the step-2 evidence scan backed arrive labeled `evidence` and PRE-SELECTED, the matched signal in the reason column ('MassTransit in src/Api/Api.csproj') - droppable like any seed. The scan IS the evidence mechanism: never hand-propose add-candidates beyond what the table already shows. The user adds or drops by number. The only skills seed is `always.skills` - the house METHOD set: the cross-task orchestrator plus the manual `project-*` method skills (the inline execution twins, the capture/loop generators, the upgrade planner), all pre-selected `recommended` and droppable; their need is 'the stack is installed', not anything a project manifest could prove, which is why they are seeded rather than evidence-scanned. The ONE deliberate exception is `project-build-from-scratch` - greenfield-only by its own description, dead weight on an existing project, so it is never seeded; offer it as an unselected row like any other, and only in a greenfield/no-project run is picking it natural. Beyond the seed set, selected = locked + whatever the user adds.

## 6. Hooks

Hooks are leaf picks - nothing requires them, they require nothing, so every row is free. Recommended = the three always-on guards; `instrument-tool-usage` is the opt-in extra (installed unwired - it only runs when a project wires it deliberately). The installer wires the selected hooks into `.claude/settings.json` on install.

## 7. MCPs

Locked = the servers the kept selection pulls (typically just `serena`, via `baseline-navigation`); recommended = the core four (`serena`, `context7`, `memory`, `playwright`) plus the confirmed stacks' seeds (browser/mobile servers). Everything else - `sentry` included - is a free add for projects that actually use it; note next to `sentry` that it needs `SENTRY_ACCESS_TOKEN`. After the round, and only if context7 stayed selected, ask its transport here (`remote` default / `local`).

## 8. Plugins

Locked = the plugins the kept selection pulls (an LSP plugin rides its stack's closure; `superpowers` and `ponytail` arrive via the skills and agents that cite them); recommended = the confirmed stacks' plugin seeds. The rest of `catalog.plugins` is freely addable.

## 9. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check [--context7-local] [--github-cli]` (`--context7-local` only when the user chose context7 `local`; `--github-cli` only when they opted in at step 1). Redirect its output to `$TMP/select.out` like every recompute. It writes `selection.txt` - the closed installer selection. **Fixed shape, three blocks:** (1) one verdict line - `blockers: N · warnings: N`; (2) the closed selection grouped by category, closure adds marked with their reasons; (3) the lists:

- Blockers: list each with its fix. Ask: fix them now and continue, or drop the affected items (reopen the owning layer's table, re-run, re-emit). Never install past a blocker.
- Warnings: list them and proceed.
- **Convention-conflict warnings (brownfield only).** When the project already carries stated conventions - a root or `.claude/` CLAUDE.md, `<docs-path>/architecture/` docs - check the user's TYPED ADDS from the walk (never the closure-locked rows, never the stack/evidence seeds - those are signal-backed) against them: an add whose PURPOSE conflicts with a stated convention gets ONE warning line quoting the rule verbatim (`warning: skill dotnet-architecture conflicts with CLAUDE.md: 'NOT Clean Architecture / DDD / VSA'`) and one keep-or-drop consent. No citable conflict, no warning - unused-looking is not a conflict; no project docs, skip silently. A conflict warning never blocks the install - the user's keep is final.

## 10. Install

Run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:

- Unix: `bash "$TMP/repo/scripts/os/claude-stack.sh" install --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli]`
- Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" install -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove at cleanup. It writes `.claude/claude-stack.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/claude-stack:configure` diffs against.

Then apply the step-1 environment choices where they differ from what the installer left: a merge on the scope's settings.json touching ONLY the chosen keys - `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` and `env.CLAUDE_DOCS_PATH` (plus `autoCompactEnabled: false` when the user chose 'off'; delete the pct override in that case rather than writing a dead value) - everything else in the file preserved. The installer seeds these only when absent, so the values written here are the user's and survive every later update untouched. Accepted defaults on a fresh install need no write - the installer's seed already matches.

## 11. CLAUDE.md - the user's call (project mode)

Not required - open with WHERE it lives and WHAT a yes changes, then ask; a 'no' ends the run cleanly (a later `/claude-stack:configure` can always reconcile it). The location: the installer seeded `.claude/CLAUDE.md` from the snapshot's `stack/CLAUDE.template.md` when the project had none - that file, in this project, is the target; a pre-existing CLAUDE.md (root or `.claude/`) is NEVER overwritten - the offer becomes a reconcile against the fetched template instead (add the sections it lacks, leave the project's own prose untouched), with the changes shown before writing. On a yes: follow the template's own authoring-outline comment - write the project top (what the project is, structure, the real build/test commands), cover the outline's inventories (stack, commands, secrets/config globs), and trim its rules table to the rules this selection actually installed. Never offer skill/agent/MCP additions here - the walk owned the selection. Skip in no-project mode (a global install seeds no project file).

## Post-check + next steps - close every run with this card

Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Then, AFTER the summary, print the next-steps card - built from what THIS run actually installed, never naming a command whose skill is absent:

1. **Git hygiene (project mode).** Suggest ignoring the machine-local artifacts this install creates - only entries that apply to the selection and are not already covered by the project's ignore rules: `.claude/` (the install + stamp + the default docs root), `.serena/` (LSP cache + project memories - when serena is selected), `.mcp.json` (installer-regenerated on every run - fix the template, never this file), plus runtime dirs when present in the tree (`.playwright/`, `.slopwatch/`). Offer BOTH homes and let the user pick: the committed `.gitignore`, or `.git/info/exclude` for a local-only ignore that touches no committed file. Show the exact lines first; write only on consent.

2. **The capture sequence** - the deliberate captures that turn a fresh install into an oriented one, in dependency order. List each ONLY when its skill is installed; a missing one gets a single line ('project-code-style-analyzer not installed - add via `/claude-stack:configure`') instead of a dead command:
   1. `/project-architecture-analyzer` - writes the durable architecture docs every seat reads to orient.
   2. `/project-code-style-analyzer` - captures the project's real code style and generates the inject-code-style hook.
   3. `/project-related-context <sibling> ...` - sibling-repo awareness, args only (local paths or git URLs, e.g. `frontend - ../client`, `backend - ../server`); it never scans on its own.
   4. `/project-agent-capabilities` - LAST, so the generated usage-policy rule reflects the final inventory including anything the captures above added.

3. **serena, honestly per language.** Recommend serena symbol nav only where it actually holds: TypeScript / Angular / mixed web projects - yes, it is the nav tool. On C#, serena's Roslyn-backed nav is unreliable - navigation belongs to the `csharp-lsp` plugin there, and saying otherwise sends the user down a dead end. serena still earns its seat in a C# project as the per-project memory bus (the inter-agent handoff), so it stays installed either way. State which case THIS project is - one line, no hedging.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`, on EVERY exit path of THIS command: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not install the full set - always go through the walk, and never present a layer question without its `[step n/11 - <name>] ... · next: <name>` banner or without the full-catalog table (a partial table hides choices; a later 'want these too?' question is the failure this shape exists to prevent).
- Do not deselect a locked row on the user's behalf, and never drop one silently - the reason column is the answer, the reopen offer is the remedy.
- Do not paste tool output or run chatty per-file commands - the 'Narrate, don't trace' contract holds for the whole run.
- Do not skip a layer, the selection round, or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
