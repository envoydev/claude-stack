---
name: setup-claude-stack
description: "Bootstrap the personal agents-stack into the CURRENT project - detect the OS + analyse the project, ask the scalar install choices, fetch the tools, curate a dependency-complete selection with a prerequisite check, and run the installer. Trigger by invoking /claude-stack or 'set up the claude stack here'. Runs the installer against a curated subset; not for editing the stack source itself."
disable-model-invocation: true
---

# Set up the Claude stack in this project

You are bootstrapping the agents-stack into the CURRENT project. Work in the project root, in order, and drive it interactively: ask the scalar choices, always show the resolved selection and the prerequisite report before installing, and never install past an unmet blocker. The deterministic work is done by `stack-select.js`; you orchestrate.

Everything is fetched from `https://raw.githubusercontent.com/envoydev/agents-stack/main`. Use a temp working dir (e.g. `mktemp -d`) for the fetched tools; never write them into the project.

## 1. Preconditions
- Confirm the cwd is the target project's root and it is a git repo. If not, stop and ask.

## 2. Detect the OS and analyse the project
- OS: on `darwin`/`linux` use `claude-stack.sh`; on Windows use `claude-stack.ps1` (via `pwsh`).
- Detect stacks by artifact and record which apply:
  - `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
  - `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
  - `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- A project can match several. Report the detected stacks and let the user confirm/adjust before proceeding.

## 3. Ask the scalar choices
Ask with the question tool (one screen): scope (`project` default / `global`), space (optional account name), context7 transport (`remote` default / `local`), install the GitHub CLI? (default no), keep local pins? (`--keep-pins`, default no).

## 4. Fetch the tools
Into the temp dir, download from `.../main`: the right installer (`claude/claude-stack.sh` or `claude/claude-stack.ps1`), `scripts/stack-select.js`, and `scripts/stack-graph.json`.

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
- Unix: `bash claude-stack.sh install --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli] [--keep-pins]`
- Windows: `pwsh -File claude-stack.ps1 install -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli] [-KeepPins]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

## 9. Post-check
Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Finally, surface the installer's own gitignore reminder so the stack-generated artifacts are not committed.

## Do not
- Do not install the full set - always go through the selection. Do not skip the review or the prerequisite gate. Do not write fetched tools into the project tree. Do not commit anything on the user's behalf.
