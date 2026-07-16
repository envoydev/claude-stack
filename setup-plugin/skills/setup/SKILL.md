---
name: setup
description: "FRESH install of the personal claude-stack, from scratch - detect the OS + analyse the project, ask the scalar install choices, fetch the tools, curate a dependency-complete selection with a prerequisite check, and run the installer's install action. In a project, the selection is decided FROM the project (detected stacks seed the recommendations); outside any project it falls back to a global install seeded from the recommended set (references/recommendations.json), stacks chosen by the user. Trigger by invoking /claude-stack:setup or 'set up the claude stack here'. NOT for refreshing or adjusting an existing install - that is the sibling configure skill."
disable-model-invocation: true
---

# Set up the Claude stack - fresh install

You are bootstrapping the claude-stack FROM SCRATCH. If the stack is already installed here (a populated `.claude/skills` + `.claude/agents`, or the global account equivalents in no-project mode), stop and route to a sibling: `update` for a plain refresh, `configure` to adjust the selection - updates are their job. Work in order and drive it interactively: ask the scalar choices, always show the resolved selection and the prerequisite report before installing, and never install past an unmet blocker. The deterministic work is done by `stack-select.js`; you orchestrate. Two modes, decided at step 1: **project mode** (the normal case - the selection is decided from the project itself) and **no-project mode** (a global install seeded from the recommended set).

**ONE release archive is the entire download** - read `references/source-protocol.md` before step 1 and hold the whole run to it: download + extract the `latest` release archive once into `$TMP/repo` (falling back to one shallow clone only when the download fails; never a raw URL), use every tool from that snapshot, hand it to the installer with `--source` in step 8, and remove `$TMP` on every exit path in step 11.

## 1. Preconditions - pick the mode
- Cwd is a project root in a git repo -> **project mode**; continue at step 2.
- No project here (not a git repo, or an empty/unrelated directory) -> offer **no-project mode**: a `global` install into the account (`~/.claude`), seeded from the recommended set - confirm with the user before proceeding. In this mode skip the artifact detection in step 2 and instead present the stacks available in `references/recommendations.json` as a multi-pick ('which stacks do you work with?'); picking none installs just the `always` baseline. Scope is `global` (step 3 does not re-ask it) and the prerequisite + review gates below apply unchanged.

## 2. Detect the OS and analyse the project
- OS: on `darwin`/`linux` use `claude-stack.sh`; on Windows use `claude-stack.ps1` (via `pwsh`).
- Project mode - detect stacks by artifact and record which apply (this detection IS the recommendation input; decide from the project, not from a generic default):
  - `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
  - `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
  - `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- A project can match several. Report the detected stacks and let the user confirm/adjust before proceeding.
- A repo with NO recognizable artifacts (greenfield) falls back the same way as no-project mode: present the `references/recommendations.json` stacks as a multi-pick of what the project WILL be, then continue normally at project scope.

## 3. Ask the scalar choices
Ask with the question tool (one screen): scope (`project` default / `global`), space (optional account name), context7 transport (`remote` default / `local`), install the GitHub CLI? (default no), keep local pins? (`--keep-pins`, default no).

## 4. Use the tools from the snapshot
Per `references/source-protocol.md`: the installer, `stack-select.js`, `stack-graph.json`, and `templates/CLAUDE.template.md` (for step 9) all come out of `$TMP/repo` - never a raw re-fetch.

## 5. Build the recommended selection and close it
- Read this skill's `references/recommendations.json`. Union `always` with the seed of each confirmed stack into a raw selection `{ agents: [...], rules: [...], skills: [...], plugins: [...] }`; write it to `raw.json` in the temp dir.
- Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check [--context7-local] [--github-cli]`
  - `--context7-local` only when the user chose context7 `local`; `--github-cli` only when they opted in.
  - It prints `required: <name> - <why>` (closure adds) and `BLOCKER: ...` / `warning: ...` lines, and writes `selection.txt` (the installer selection file).

## 6. Present the selection for review
Show the closed selection grouped by category (skills / agents / rules / mcps / plugins). Mark each closure-added item as required and show its reason from the `required:` lines. Let the user deselect items they directly chose (not the required closure adds); if they remove a required item, re-run step 5 and it returns with its reason. Re-emit `selection.txt` after any edit.

## 7. Prerequisite gate
- Blockers: list each with its fix. Ask: fix them now and continue, or drop the affected items from the selection (re-run step 5). Never install past a blocker.
- Warnings: list them and proceed.

## 8. Run the installer
Run the installer **from the snapshot**, and pass it back with `--source` so it installs from what you already downloaded instead of fetching again:
- Unix: `bash "$TMP/repo/scripts/claude-stack.sh" install --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/claude-stack.ps1" install -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli] [-KeepPins]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

`--source` is what makes the guided run take ONE download. The installer owns nothing here: it copies out of `$TMP/repo` and leaves it for you to remove in step 11. It writes `.claude/claude-stack.stamp` recording the commit it installed (read from the snapshot's `RELEASE-SOURCE`) - that is what a later `/claude-stack:configure` diffs against.

## 9. Fill the project's CLAUDE.md from the template (project mode)
The installer seeded `.claude/CLAUDE.md` from `templates/CLAUDE.template.md` when the project had none. Make it real now, from the step-2 analysis: follow the template's own authoring-outline comment - write the project top (what the project is, structure, the real build/test commands), cover the outline's inventories (stack, secret/config globs, related projects), and trim its rules table to the rules this selection actually installed. A pre-existing CLAUDE.md is NEVER overwritten - offer to reconcile it against the fetched template instead (add the sections it lacks, leave the project's own prose untouched), and show the changes before writing. Skip in no-project mode (a global install seeds no project file).

## 10. Post-check
Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Finally, surface the installer's own gitignore reminder so the stack-generated artifacts are not committed.

## 11. Clean up the temp dir - ALWAYS
Remove `$TMP` per `references/source-protocol.md`, on EVERY exit path of THIS skill: after a successful install, after an abort, and after a blocker or a user 'no' that stops the run early. Then confirm the project tree holds only installed artifacts.

## Do not
- Do not install the full set - always go through the selection. Do not skip the review or the prerequisite gate. Do not write the archive, the extracted repo, or the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
