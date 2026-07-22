---
description: "RECONCILE an existing claude-stack install to THIS project - detect the project's real stacks by artifact (the setup step-2 scan), inventory what is installed, then walk the selection one layer at a time (rules -> agents -> skills -> hooks -> MCPs -> plugins) showing, per layer, what is REDUNDANT (installed but its whole owning stack is absent - remove?) and what is MISSING (the detected stacks' + baseline closure not installed here - add?), each pre-marked with its reason and taken on per-item consent. Shared items, deliberate non-stack extras, and the always-baseline already installed are never touched. Detection evidence for every absent stack is shown BEFORE the walk so a mis-detection is vetoable. Adds run the installer for the accepted set; removes delete explicitly - the same paths setup/configure use. Project mode only. This is the project-relative two-way audit that setup (fresh), update (refresh), and configure (manual add/drop) do not do."
disable-model-invocation: true
---

# Validate the Claude stack - reconcile the install to this project

You are reconciling a claude-stack install against the project it sits in: removing artifacts whose
framework is absent and offering the detected stacks' artifacts that are not yet installed. Same
discipline as the sibling commands - drive it interactively, walk one layer at a time, show the
evidence/prerequisite before acting, never add or remove without consent. `stack-select.js` does
the deterministic work; you orchestrate.

**ONE release archive is the entire download** - read `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`
before step 1 and hold the whole run to it: download + extract once into `$TMP/repo`, use
`stack-select.js` / the graph / `recommendations.json` / the installer from that snapshot, hand
the installer `--source "$TMP/repo"` in step 9, and remove `$TMP` per the 'Clean up' section on
EVERY exit path. Its 'Narrate, don't trace' section governs every tool call: one quiet call per
recompute, no pasted tool output, one narration line between steps.

**Project mode only.** This command needs a project to reconcile against. If cwd is not a project
root with a populated `.claude/` (or the install lives in an account dir), stop and say so - a
global adjust is the sibling `/claude-stack:configure`. Detect the OS too (`darwin`/`linux` -> the
sh installer; Windows -> ps1 via `pwsh`).

## The ladder - announce every step

Ten user-facing steps; the machinery between them runs silently. One banner line before each:

```
[step 3/10 - rules] reconcile the rule layer · next: agents
```

1 find + inventory · 2 detect stacks · 3 rules · 4 agents · 5 skills · 6 hooks · 7 MCPs · 8 plugins · 9 apply · 10 post-check

## 1. Find the install and inventory it

Confirm the install (project mode, above), then **inventory the installed set from disk** - never
from memory - exactly as configure does: skills = the directory names under `.claude/skills/`;
agents = `.claude/agents/*.md`; rules = `.claude/rules/*.md` EXCLUDING the generated
`baseline-project-*.md` awareness rules; hooks = `.claude/hooks/*.js` EXCLUDING the generated
`inject-code-style.js`; mcps = the server names in `<repo>/.mcp.json`; plugins = `claude plugin
list` (fail-soft without the CLI). Write it as one inventory JSON in `$TMP`
(`{rules,agents,skills,hooks,mcps,plugins}` arrays) - the `--installed` input for the walk.

## 2. Detect the project's stacks - and show the evidence

The setup step-2 artifact scan:

- `*.csproj` / `*.sln` -> .NET, split by content: `Microsoft.NET.Sdk.Web` -> `aspnet`;
  `<UseWPF>true` -> `wpf`; otherwise `console`.
- `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
- `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- `tsconfig.json` / `jsconfig.json` -> `typescript` (language-level - keeps the TS rule/skill/LSP
  plugin owned in a plain TS/Node repo with no framework marker).

Report the detected set AND, for every stack you will treat as ABSENT, the exact signal you looked
for and did not find (`wpf -> *.csproj <UseWPF>: none`). **This is the veto point** - a
mis-detection (a WPF app on a non-standard SDK, SQL in an odd path) is corrected HERE, before the
walk removes anything on it. Detecting nothing is valid; confirm the detection is right, then walk.

Compute the audits once against the current inventory, quietly - the two stack-level passes,
the evidence scan, and the evidence gaps:

```
node "$TMP/repo/scripts/stack-select.js" --redundant --installed "$TMP/installed.json" \
  --recs "$TMP/repo/setup-plugin/references/recommendations.json" --graph "$TMP/repo/scripts/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/redundant.out"
node "$TMP/repo/scripts/stack-select.js" --missing   --installed "$TMP/installed.json" \
  --recs "$TMP/repo/setup-plugin/references/recommendations.json" --graph "$TMP/repo/scripts/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/missing.out"
node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog "$TMP/repo/setup-plugin/references/evidence.json" \
  --out "$TMP/found.json"
node "$TMP/repo/scripts/stack-select.js" --evidence-gaps --found "$TMP/found.json" \
  --catalog "$TMP/repo/setup-plugin/references/evidence.json" --installed "$TMP/installed.json" \
  --recs "$TMP/repo/setup-plugin/references/recommendations.json" --graph "$TMP/repo/scripts/stack-graph.json" \
  --stacks "<detected,csv>" > "$TMP/evidence.out"
```

`redundant:` lines = installed, whole owning stack absent (remove candidates). `missing:` lines =
detected-stack + baseline closure not installed (add candidates), each with `needed by <stack|baseline>`.
`evidence-missing:` lines = the scan found a signal for an artifact that is not installed (add
candidates, the signal as the reason - already deduped against the `missing:` lines by the tool).
`no-evidence:` lines = installed, catalog-listed, no signal found - ADVISORY ONLY, never an action.
The tool already excludes shared items, deliberate non-stack extras, already-installed baseline,
and the curated `general` set in recommendations.json (cross-stack skills a narrow seat happens to
preload - GoF patterns, dotnet-migrate) - you present its output, you do not re-derive it.

## The walk - steps 3-8, one layer at a time

The layer order is the dependency order rules -> agents -> skills -> hooks -> MCPs -> plugins. Per
layer, slice `redundant.out` + `missing.out` to that layer and run the SAME shape:

1. **Show one table** of this layer's actionable rows - REDUNDANT (installed, remove?) and MISSING
   (not installed, add?; `evidence-missing:` lines join as MISSING with the signal as the reason),
   each with its reason. Under the table, this layer's `no-evidence:` lines as PLAIN TEXT - no row
   numbers, no consent: 'advisory: dotnet-messaging installed, no messaging package found - kept,
   your call'. A line carrying `held by <cat> <name>` is NOT your-call: the kept closure requires
   it, so present it as locked-by-holder info - its real drop path is dropping the holder via the
   sibling configure, never a promise this walk can keep. A layer with none of the three gets a single line ('rules: nothing to reconcile')
   and you move straight on - do not invent rows.

```
[step 4/10 - agents] reconcile the agent layer · next: skills
 # | agent                  | state     | reason
---+------------------------+-----------+-----------------------------------
 1 | wpf-implementer        | REDUNDANT | owned by wpf, not detected
 2 | aspnet-verifier        | MISSING   | needed by aspnet
 3 | ci-failure-diagnoser   | MISSING   | needed by baseline
```

2. **One consent round** - options: **Accept all** (add every MISSING, remove every REDUNDANT in
   this layer), **Add only**, **Remove only**, **Skip** (touch nothing), or typed numbers
   (`add 2 3`, `remove 1`). Never bulk-act without an explicit choice; a REDUNDANT removal the user
   declines is simply kept. Restate the outcome in one line and carry this layer's accepted adds +
   removes forward.

## 3-8 per-layer notes

- **Rules** first - a rule's closure pulls agents/skills, so accepting a MISSING rule here means
  its pulled agents/skills already appear as MISSING in their own later layers; the apply step
  re-closes the union, so you never double-add.
- **Hooks** are leaf - REDUNDANT never appears (hooks are always-baseline or deliberate); MISSING
  only if a baseline guard was removed.
- **MCPs / plugins** - an LSP plugin shows MISSING when its stack is detected but it was dropped.

## 9. Apply - the same paths setup/configure use

Build the final selection = the installed set, PLUS every accepted add, MINUS every accepted
remove. Emit + prereq-check it, then:

- **Adds**: run the installer from the snapshot for the kept+added set -
  `bash "$TMP/repo/scripts/os/claude-stack.sh" install --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>]`
  (ps1 on Windows). The installer closes the selection and copies the added artifacts; already-installed
  ones are simply re-laid, harmless. Show the prereq report first; never install past a blocker.
- **Removes**: `install --selection` does NOT uninstall - delete each accepted removal explicitly,
  showing the command first: the skill directory / agent file / rule file; a hook loses BOTH its
  `.claude/hooks/` file and its `.claude/settings.json` wiring; `claude mcp remove <name>`;
  `claude plugin uninstall <name>`.
- Then re-run `/project-agent-capabilities` (when installed) so the generated awareness rule
  reflects the reconciled inventory. The run rewrites `claude-stack.stamp` to the snapshot revision.

## 10. Post-check

Report per category what was added, removed, and left as-is (disputed detections, deliberate
extras, declined suggestions). Remind that a restart picks up MCP registration changes, and surface
the installer's gitignore reminder. If a CLAUDE.md rules table names a rule you added or removed,
offer to reconcile that row (additive, shown before writing) - never rewrite the user's prose.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`, on EVERY exit path of
THIS command: after apply, after an abort, after a disputed-detection stop, and after a clean bill
(nothing redundant or missing). Then confirm the project tree holds only installed artifacts.

## Do not

- Do not add or remove on a detection the user disputes, and never act on a layer without its
  consent round - the evidence line and the per-layer consent are the whole safety model.
- Do not touch a deliberate non-stack extra, an always-baseline item already installed, or a shared
  item whose owning stack IS present - the tool already excludes these; never second-guess it.
- Do not act on a `no-evidence:` advisory - it is information, not a removal candidate; package
  absence is weak proof (vendored code, a preinstalled skill for planned work, a scan miss).
- Do not skip the prerequisite gate before an install, and never remove what a kept item still
  needs. Do not paste tool output or leave `$TMP` behind on any exit path. Do not commit anything.
