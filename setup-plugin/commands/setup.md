---
description: "FRESH install of the claude-stack, from scratch - ask scope + profile up front, then detect the OS + analyse the project and walk the selection in six dependency-ordered layers (rules -> agents -> skills -> hooks -> MCPs -> plugins): each layer shows ONE numbered table of the whole catalog (recommended pre-selected, locked rows carrying the required-by reason), then one selection round - Recommended / All / None, or typed numbers to add and drop. Prerequisite check, install, and an OFFERED (never forced) CLAUDE.md fill-in close the run. In a project, the selection is decided FROM the project (detected stacks seed the recommendations); outside any project it falls back to a global install seeded from the recommended set, stacks chosen by the user. NOT for an existing install - a plain refresh is the sibling update command, choosing what to add or drop is configure."
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

## 1. Install choices

Detect silently first - the OS (`darwin`/`linux` -> `claude-stack.sh`; Windows -> `claude-stack.ps1` via `pwsh`) and the mode (project root in a git repo -> project mode; anything else -> no-project mode) - then ask ONE screen with only the choices a fresh install actually needs: scope (`project` default / `global`; in no-project mode this question becomes the no-project-mode confirmation instead - a `global` install into the account `~/.claude` - since there is no project to scope to) and profile (the optional `--space` account name, default none). One conditional extra: 'install the GitHub CLI?' - asked ONLY when `gh` is not already on PATH, skipped entirely when it is. Everything else moved to where it belongs: the context7 transport is asked at step 7 only if context7 ends up selected, and `--keep-pins` is a configure/update question - a fresh install has no local pin edits to keep, so never ask it here.

## 2. Project analysis - the stacks

Project mode - detect stacks by artifact and record which apply (this detection IS the recommendation input; decide from the project, not from a generic default):

- `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
- `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
- `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.

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
2. **Show ONE numbered table of the layer's ENTIRE catalog** - every item the release ships, so nothing is ever offered later or out-of-band. The TOOL renders it, never you: `node stack-select.js --selection raw.json --graph stack-graph.json --table <layer> --recs <recommendations.json> --stacks <confirmed,csv> > "$TMP/table.txt"`, then paste `table.txt` verbatim inside a fenced code block (the one sanctioned paste - pre-padded by the tool, so it stays aligned at any length; a hand-written markdown table shears when the renderer flushes it in segments). Row numbers come from the tool and are stable across rounds. The tool labels each row: `required` (closure-locked, reason in the last column), `recommended` / `stack:<name>` (seeded, droppable), `suggested` (a conditional load a kept agent's protocol names - pre-selected, freely droppable, never locked), `added` (the user's own pick), `-` (not selected). Recommended = the union of `always` + each confirmed stack in `${CLAUDE_PLUGIN_ROOT}/references/recommendations.json`, pre-selected:

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

The full release catalog in one table - the generator `project-*` skills and every other house skill included, so THIS is the only place skills are ever chosen; later steps (CLAUDE.md included) never offer skill additions. Locked = every skill the kept rules and agents REQUIRE (rule attachments and `skills:` frontmatter preloads), each with the reason naming its dependent. The kept agents' `suggests` (their bodies' conditional 'load X when...' mentions) join the table pre-selected as `suggested` - an option is not a requirement, so they drop freely, no cascade. There is no separate skills seed: recommended = locked + suggested, plus whatever the user adds as extras.

## 6. Hooks

Hooks are leaf picks - nothing requires them, they require nothing, so every row is free. Recommended = the three always-on guards; `instrument-tool-usage` is the opt-in extra (installed unwired - it only runs when a project wires it deliberately). The installer wires the selected hooks into `.claude/settings.json` on install.

## 7. MCPs

Locked = the servers the kept selection pulls (typically just `serena`, via `baseline-navigation`); recommended = the core four (`serena`, `context7`, `memory`, `playwright`) plus the confirmed stacks' seeds (browser/mobile servers). Everything else - `sentry` included - is a free add for projects that actually use it; note next to `sentry` that it needs `SENTRY_ACCESS_TOKEN`. After the round, and only if context7 stayed selected, ask its transport here (`remote` default / `local`).

## 8. Plugins

Locked = the plugins the kept selection pulls (an LSP plugin rides its stack's closure; `superpowers` and `ponytail` arrive via the skills and agents that cite them); recommended = the confirmed stacks' plugin seeds. The rest of `catalog.plugins` is freely addable.

## 9. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check [--context7-local] [--github-cli]` (`--context7-local` only when the user chose context7 `local`; `--github-cli` only when they opted in at step 1). Redirect its output to `$TMP/select.out` like every recompute. It writes `selection.txt` - the closed installer selection.

- Blockers: list each with its fix. Ask: fix them now and continue, or drop the affected items (reopen the owning layer's table, re-run, re-emit). Never install past a blocker.
- Warnings: list them and proceed.

## 10. Install

Run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:

- Unix: `bash "$TMP/repo/scripts/os/claude-stack.sh" install --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli]`
- Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" install -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove at cleanup. It writes `.claude/claude-stack.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/claude-stack:configure` diffs against.

## 11. CLAUDE.md - the user's call (project mode)

Not required - open with WHERE it lives and WHAT a yes changes, then ask; a 'no' ends the run cleanly (a later `/claude-stack:configure` can always reconcile it). The location: the installer seeded `.claude/CLAUDE.md` from the snapshot's `stack/CLAUDE.template.md` when the project had none - that file, in this project, is the target; a pre-existing CLAUDE.md (root or `.claude/`) is NEVER overwritten - the offer becomes a reconcile against the fetched template instead (add the sections it lacks, leave the project's own prose untouched), with the changes shown before writing. On a yes: follow the template's own authoring-outline comment - write the project top (what the project is, structure, the real build/test commands), cover the outline's inventories (stack, commands, secrets/config globs), and trim its rules table to the rules this selection actually installed. Never offer skill/agent/MCP additions here - the walk owned the selection. Skip in no-project mode (a global install seeds no project file).

## Post-check

Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Finally, surface the installer's own gitignore reminder so the stack-generated artifacts are not committed.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`, on EVERY exit path of THIS command: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not install the full set - always go through the walk, and never present a layer question without its `[step n/11 - <name>] ... · next: <name>` banner or without the full-catalog table (a partial table hides choices; a later 'want these too?' question is the failure this shape exists to prevent).
- Do not deselect a locked row on the user's behalf, and never drop one silently - the reason column is the answer, the reopen offer is the remedy.
- Do not paste tool output or run chatty per-file commands - the 'Narrate, don't trace' contract holds for the whole run.
- Do not skip a layer, the selection round, or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
