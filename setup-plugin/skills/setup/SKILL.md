---
name: setup
description: "FRESH install of the claude-stack, from scratch - detect the OS + analyse the project, ask the scalar install choices, fetch the tools, then walk the selection in four dependency-ordered layers (rules -> agents -> skills -> MCPs + plugins): each layer offers its recommended set first, then a customize pass to add or drop - only items another kept item requires are locked, always with the reason shown. Prerequisite check, install, and an OFFERED (never forced) CLAUDE.md fill-in close the run. In a project, the selection is decided FROM the project (detected stacks seed the recommendations); outside any project it falls back to a global install seeded from the recommended set (references/recommendations.json), stacks chosen by the user. Trigger by invoking /claude-stack:setup or 'set up the claude stack here'. NOT for an existing install - a plain refresh is the sibling update skill, choosing what to add or drop is configure."
disable-model-invocation: true
---

# Set up the Claude stack - fresh install

You are bootstrapping the claude-stack FROM SCRATCH. If the stack is already installed here (a populated `.claude/skills` + `.claude/agents`, or the global account equivalents in no-project mode), stop and route to a sibling: `update` for a plain refresh, `configure` to adjust the selection - updates are their job. Work the ladder in order and drive it interactively: ask the scalar choices, walk the selection one layer at a time, always show the prerequisite report before installing, and never install past an unmet blocker. The deterministic work is done by `stack-select.js`; you orchestrate. Two modes, decided at step 1: **project mode** (the normal case - the selection is decided from the project itself) and **no-project mode** (a global install seeded from the recommended set).

**ONE release archive is the entire download** - read `references/source-protocol.md` before step 1 and hold the whole run to it: download + extract the `latest` release archive once into `$TMP/repo` (the reference owns the fallback), use every tool from that snapshot (`stack-select.js`, `stack-graph.json`, the installer, the template - never a raw re-fetch), hand it to the installer with `--source` in step 8, and remove `$TMP` per the 'Clean up' section on every exit path.

## The ladder - announce every step

Nine user-facing steps; the machinery between them (the download, the post-check, the cleanup) runs silently. Before EVERY question, one banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 3/9 - rules] choose the rule set · next: agents
```

1 project analysis · 2 install choices · 3 rules · 4 agents · 5 skills · 6 MCPs + plugins · 7 prerequisite check · 8 install · 9 CLAUDE.md (optional)

## 1. Project analysis - mode, OS, stacks

- OS: on `darwin`/`linux` use `claude-stack.sh`; on Windows use `claude-stack.ps1` (via `pwsh`).
- Cwd is a project root in a git repo -> **project mode**. Detect stacks by artifact and record which apply (this detection IS the recommendation input; decide from the project, not from a generic default):
  - `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
  - `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
  - `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- A project can match several. Report the detected stacks and let the user confirm/adjust before proceeding:

```
[step 1/9 - project analysis] confirm the detected stacks · next: install choices
Detected: aspnet (src/Api/Api.csproj - Microsoft.NET.Sdk.Web), angular (angular.json), devops (Dockerfile + .github/workflows/)
```

- No project here (not a git repo, or an empty/unrelated directory) -> offer **no-project mode**: a `global` install into the account (`~/.claude`), seeded from the recommended set - confirm with the user before proceeding. Skip the artifact detection and instead present the stacks available in `references/recommendations.json` as a multi-pick ('which stacks do you work with?'); picking none installs just the `always` baseline. Scope is `global` (step 2 does not re-ask it); every later step applies unchanged.
- A repo with NO recognizable artifacts (greenfield) falls back the same way: present the recommendations stacks as a multi-pick of what the project WILL be, then continue normally at project scope.

## 2. Install choices

Ask with the question tool (one screen): scope (`project` default / `global`), space (optional account name), context7 transport (`remote` default / `local`), install the GitHub CLI? (default no), keep local pins? (`--keep-pins`, default no).

## The walk - steps 3-6, one layer at a time

The layer order follows the dependency graph's arrows: rules pull agents + skills, agents pull skills, and everything pulls MCPs + plugins - dependencies only point FORWARD through the walk, so an earlier answer is never invalidated by a later one. Hold ONE running `raw.json` (in the temp dir) of the user's DIRECT picks per category; locked items never enter it - the closure re-adds them at emit time.

Per layer:

- Recompute first: `node stack-select.js --selection raw.json --graph stack-graph.json` over the picks so far. The category-tagged `required: <category> <name> - <why>` lines belonging to THIS layer are its **locked** set.
- Present three groups:
  - **locked** - required by an earlier choice; shown with its reason (`required by rule dotnet-repair-agents`), never offered for deselection. The ONLY way to shed one is to drop the dependent its reason names: offer to reopen that layer, apply the drop, then re-run the closure and re-confirm any layer whose locked set changed.
  - **recommended** - this layer's seed (union of `always` + each confirmed stack in `references/recommendations.json`) minus what is already locked; pre-selected, freely droppable.
  - **available** - the rest of the release's catalog for the layer (the graph's `rules`/`agents`/`skills` keys, `catalog.mcps`/`catalog.plugins`); freely addable.
- Two phases, two questions: **(a) accept** the set as shown, or customize? **(b) customize** - a multi-pick of adds and drops over recommended + available. A drop attempt on a locked item is answered with its reason, never silently honored or silently ignored.
- Fold the final picks into `raw.json` and move on. An `unknown:` line is a typo or a retired name - surface it, never pass it through.

## 3. Rules

Recommended = `always.rules` + each confirmed stack's rules. Nothing in the graph depends on a rule, so this layer never has locked items - it is the one fully free pick, which is why it goes first: the rules chosen here decide what later layers must keep.

## 4. Agents

Recommended = `always.agents` + each confirmed stack's agents; locked = agents the kept rules require (the repair-loop rules pin their resolvers, e.g. `required by rule dotnet-repair-agents`).

## 5. Skills

No seed of its own - the recommended set IS the locked set: every skill pulled by the kept rules and agents, each with the reason naming its dependent. Phase (a) confirms that set; phase (b) offers the rest of the release's skills as extras (an extra is a direct pick - freely droppable on a later configure run).

## 6. MCPs + plugins

Locked = the MCP servers and plugins the kept selection pulls; recommended = the confirmed stacks' plugin seeds; available = the rest of `catalog.mcps` + `catalog.plugins`. Both ride in one step - they are the leaf capabilities the graph pulls the same way. A directly added MCP or plugin survives re-runs (it lands in `raw.json`).

## 7. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check [--context7-local] [--github-cli]` (`--context7-local` only when the user chose context7 `local`; `--github-cli` only when they opted in). It writes `selection.txt` - the closed installer selection.

- Blockers: list each with its fix. Ask: fix them now and continue, or drop the affected items (reopen the owning layer, re-run, re-emit). Never install past a blocker.
- Warnings: list them and proceed.

## 8. Install

Run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:

- Unix: `bash "$TMP/repo/scripts/claude-stack.sh" install --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/claude-stack.ps1" install -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli] [-KeepPins]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove at cleanup. It writes `.claude/claude-stack.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/claude-stack:configure` diffs against.

## 9. CLAUDE.md - the user's call (project mode)

Not required - ask first, and a 'no' ends the run cleanly (a later `/claude-stack:configure` can always reconcile it). The installer seeded `.claude/CLAUDE.md` from the snapshot's `templates/CLAUDE.template.md` when the project had none; offer to make it real now from the step-1 analysis. On a yes: follow the template's own authoring-outline comment - write the project top (what the project is, structure, the real build/test commands), cover the outline's inventories (stack, secret/config globs, related projects), and trim its rules table to the rules this selection actually installed. A pre-existing CLAUDE.md is NEVER overwritten - offer to reconcile it against the fetched template instead (add the sections it lacks, leave the project's own prose untouched), and show the changes before writing. Skip in no-project mode (a global install seeds no project file).

## Post-check

Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Finally, surface the installer's own gitignore reminder so the stack-generated artifacts are not committed.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `references/source-protocol.md`, on EVERY exit path of THIS skill: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not install the full set - always go through the walk, and never present a layer question without its `[step n/9 - <name>] ... · next: <name>` banner.
- Do not deselect a locked item on the user's behalf, and never drop one silently - the reason line is the answer, the reopen offer is the remedy.
- Do not skip a layer, the review phases, or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
