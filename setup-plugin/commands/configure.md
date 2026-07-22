---
description: "ADJUST an existing claude-stack install - inventory what is actually installed, report what an update would bring (the stamp compare), pick WHICH areas to adjust, then walk the chosen areas in dependency order: each layer shows ONE numbered table of the whole catalog with what is installed and what is locked (the required-by reason shown), then an ADD round and a DROP round (quick options + typed numbers). Drops cascade BOTH ways, always with consent: what a dropped item alone pulled in is offered for removal at its own layer, and dropping a required item offers the dependent rules/agents that hold it for removal with it - nothing is ever removed silently. Prerequisite check, the installer's update action, explicit removals, and an OFFERED (never forced) CLAUDE.md reconcile close the run. NOT for a first install - that is the sibling setup command; for a plain refresh (+ prune of upstream removals) the sibling update command is the shorter path."
disable-model-invocation: true
---

# Configure the Claude stack - adjust an existing install

You are adjusting a claude-stack install that already exists. Same discipline as `setup`: drive
it interactively, walk the selection one layer at a time, always show the prerequisite report
before running, never run past an unmet blocker. `stack-select.js` does the deterministic work;
you orchestrate. Two differences from `setup`: the baseline selection is what is INSTALLED, not
the recommendations - every layer is a straight modify, no recommended phase - and the action is
`update`, not `install`. (For a no-questions refresh that also prunes what upstream removed, the
sibling `update` command is the shorter path - this command is for CHOOSING what changes.)

**ONE release archive is the entire download** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`; read it first and hold the whole run to
it: download + extract once into `$TMP/repo` (the reference owns the fallback), use every tool
from that snapshot, hand it back with `--source` in step 10, and remove `$TMP` per the 'Clean up'
section on every exit path. The protocol's 'Narrate, don't trace' section governs every tool
call: one quiet call per recompute, no pasted tool output, one narration line between steps.
This command's extra stake in the snapshot: its `RELEASE-SOURCE` commit is what step 1 compares
the stamp against to report what an update would bring.

## The ladder - announce every step

Eleven user-facing steps; the machinery between them runs silently. Before EVERY question, one
banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 3/11 - rules] adjust the installed rules · next: agents
```

1 install status · 2 areas · 3 rules · 4 agents · 5 skills · 6 hooks · 7 MCPs · 8 plugins · 9 prerequisite check · 10 update · 11 CLAUDE.md (optional)

## 1. Install status - find it, inventory it, diff it

- **Find the install.** Project mode: cwd is a project root with a populated `.claude/`
  (skills/agents/rules dirs, or `.mcp.json`). Global mode: no project here, but the account
  (`~/.claude`, or `~/.claude-<space>`) carries installed skills. Nothing installed in either
  place -> stop and route to the sibling `/claude-stack:setup` command; there is nothing to
  configure yet. OS: on `darwin`/`linux` use the sh installer; on Windows the ps1 (via `pwsh`).
- **Inventory the installed set** from disk - never from memory or assumption: skills = the
  directory names under `.claude/skills/` (or the account's `skills/`); agents =
  `.claude/agents/*.md`; rules = `.claude/rules/*.md` (exclude the GENERATED
  `baseline-project-*.md` awareness rules - they are written by capture skills, never installed);
  hooks = `.claude/hooks/*.js` (exclude the GENERATED `inject-code-style.js` - same reason);
  mcps = the server names in `<repo>/.mcp.json`; plugins = `claude plugin list` (fail-soft
  without the CLI). Show the inventory grouped by category, with counts. In project mode, also
  run the evidence scan quietly - `node "$TMP/repo/scripts/scan-evidence.js" --root . --catalog
  "$TMP/repo/setup-plugin/references/evidence.json" --out "$TMP/found.json"` - so the walk's
  tables can label what the project provably uses (`--found`); skip it in global mode (no
  project to scan).
- **Report what changed since the install.** `.claude/claude-stack.stamp` (or the account's)
  records the commit every artifact of the current install was copied from - the stack versions
  the INSTALL, not the file. Use it to tell the user what an update would actually bring, BEFORE
  they choose:

```bash
SHA=$(sed -n 's/^sha: //p' .claude/claude-stack.stamp)
NEW=$(sed -n 's/^sha: //p' "$TMP/repo/RELEASE-SOURCE")   # the snapshot's commit (an archive has no git history to diff locally)
curl -fsSL "https://api.github.com/repos/envoydev/claude-stack/compare/$SHA...$NEW" |
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const F=(JSON.parse(d).files||[]);if(F.length>=300)console.log("TRUNCATED - the compare API caps at 300 files; this list may be incomplete");const P=/^(stack|skills|agents|rules|hooks|templates)\//;for(const f of F)if(P.test(f.filename)||(f.previous_filename&&P.test(f.previous_filename)))console.log(f.status+"\t"+f.filename+(f.previous_filename?"\t<- "+f.previous_filename:""))})'
```

Each line is `status<TAB>path` (`modified`/`added`/`removed`, and `renamed` with `<- old-path`).
Summarise by category, naming the items - that is the honest answer to 'what does updating get
me'. When the stamp and `RELEASE-SOURCE` both carry a `version:`, lead with the delta
(`0.1.0 -> 0.2.0` - the plugin/marketplace version; equal versions with differing shas just means
no release bumped it). (When the fallback cloned instead of downloading, `RELEASE-SOURCE` does
not exist - use `git -C "$TMP/repo" rev-parse HEAD` for `NEW`; the compare API works the same.)
The diff is what has been RELEASED since the stamp (merges to `main`, the release branch) - work
still on `develop` is invisible here by design, so never diff against or mention `develop`. Two
cases to handle, neither an error:

- **No stamp** - an install predating stamping, or one whose source never resolved. Say the
  baseline is unknown, so an update's effect cannot be previewed; the update itself is unaffected
  and will write a stamp.
- **The compare fails** - the commit is gone (history rewritten, or a fork/`STACK_SKILLS_REPO`
  source that never had it), or the API is unreachable. Report that the baseline is unreachable
  and move on; never guess a diff, and never treat this as a reason to skip the update.

A `TRUNCATED` first line means the preview may be missing files - say so alongside the summary.

Close the step with one question: **adjust the selection** (continue to the area pick at step 2), or
**refresh as-is** (nothing to change - skip straight to step 9; when upstream changed nothing
either, offer to stop rather than running a no-op, and note the sibling `update` command is the
no-questions path for plain refreshes).

## 2. Choose the areas

One multi-pick: which areas to adjust this run - rules, agents, skills, hooks, MCPs, plugins (default: all). Only the chosen areas are walked, in the fixed dependency order rules -> agents -> skills -> hooks -> MCPs -> plugins; every skipped layer keeps its installed set untouched and gets one narration line naming it. Cascades still cross area lines - the closure owns consistency, the picker only decides which tables you page through: a consent-drop's dependents are handled wherever they land, and orphans that fall in a SKIPPED layer are collected and presented in one combined drop round after the last walked layer, never silently kept or removed.

## The walk - steps 3-8, one layer at a time

Same dependency-ordered walk as `setup` (rules pull agents + skills, agents pull skills,
everything pulls MCPs and plugins, hooks stand alone - dependencies only point FORWARD), applied to
the installed set with no recommended phase. Hold TWO running files in the temp dir: `raw.json` -
the remaining selection (installed + adds - drops, every category incl. `hooks` and `mcps`) - and
`dropped.json` - everything dropped so far, per category.

Per layer, the SAME three-beat shape as setup:

1. **Recompute quietly** - one call:
   `node stack-select.js --selection raw.json --graph stack-graph.json --dropped dropped.json`,
   output redirected to `$TMP/select.out` and parsed from there, never pasted. Two line kinds drive the step:
   - `required: <category> <name> - <why>` naming a DROPPED item -> the drop is blocked: something
     kept still depends on it. Show the reason; the user keeps it, or also drops the dependents
     the reason names (their layer is reopened if already walked, and its own cascade re-runs).
   - `orphan: <category> <name> - <why> (dropped); nothing kept still needs it` -> the cascade:
     an installed item whose only dependents were dropped at an earlier layer. Offer this layer's
     orphans for removal - 'it was only there for what you dropped; remove it too, or keep it?' -
     never remove one silently, never re-offer one the user chose to keep.
2. **Show ONE numbered table of the layer's ENTIRE catalog** (installed and not-installed
   alike). The TOOL renders it, never you:
   `node stack-select.js --selection raw.json --graph stack-graph.json --table <layer> --installed installed.json --dropped dropped.json --found "$TMP/found.json" > "$TMP/table.txt"`
   (write the step-1 inventory to `installed.json` once; omit `--found` in global mode - no scan
   ran. A not-installed row whose reason column carries a matched signal is the project telling
   you it uses what the install lacks - an informed add candidate, never an auto-add) - then paste `table.txt` verbatim
   inside a fenced code block: the one sanctioned paste, pre-padded by the tool so it stays
   aligned at any length; a hand-written markdown table shears when the renderer flushes it in
   segments. Rows are labeled `yes` / `orphaned` (with the cascade origin) / `-`, the lock
   reason rides the last column, and row numbers are stable across rounds. Columns: number, name, `installed` (`yes`, `orphaned` for the cascade
   offers, or `-`), `required by` (the lock reason for kept items something else kept needs, or
   `-`):

```
[step 5/11 - skills] adjust the installed skills · next: hooks
 # | skill      | installed | required by
---+------------+-----------+------------------------------------------
 1 | csharp     | yes       | rule csharp-conventions
 2 | dotnet-wpf | orphaned  | was: required by agent dotnet-build-error-resolver
 3 | postgres   | -         | -
```

3. **Two rounds - ADD, then DROP.** The add round first, quick options + numbers: **Keep as-is**
   (add nothing - the default), **All** (add every catalog row), or typed numbers (`3 7 12`).
   Then the drop round: **Nothing** (the default; orphaned rows are pre-suggested, each with its
   cascade origin), **All droppable** (keep only locked rows), or typed numbers. A drop naming a
   LOCKED row triggers the consent cascade, not a refusal: run
   `node stack-select.js --selection raw.json --graph stack-graph.json --dependents <category>:<name>`
   (output to `$TMP/select.out`) and present what holds it - 'csharp is required by rule
   csharp-conventions, rule dotnet-repair-agents + 4 agents; drop them ALL together, or keep it?'
   On consent, the item AND its dependents fold into `dropped.json` - dependents from
   already-walked layers are named right there, and the next recompute's orphan lines surface
   immediately. On refusal, the row stays. Restate the outcome in one line (added N, dropped M
   incl. dependents), fold into `raw.json` + `dropped.json`, narrate the handoff, move on. An `unknown:` line marks an installed name this release no
   longer ships (retired or renamed upstream) - it is excluded from the emitted selection
   automatically; surface it: adopt the replacement here if step 1 showed a rename, or let the
   sibling `update` command prune the leftover artifact.

## 3. Rules

Nothing depends on a rule, so every installed rule is freely droppable and every catalog rule
addable - and a rule drop is where cascades START: what it alone pulled in surfaces as orphan
offers in the layers ahead.

## 4. Agents

Locked = agents a kept rule requires. Orphans here trace back to rule drops in step 3.

## 5. Skills

Locked = skills the kept rules + agents require (rule attachments and `skills:` frontmatter
preloads). A kept agent's `suggests` - its body's conditional 'load X when...' mentions - are
never locks: those installed rows show `-` in required-by and drop freely, no cascade. Orphans
trace back to the rule and agent drops before them.

## 6. Hooks

Leaf picks - nothing requires a hook and a hook requires nothing, so every row is free and the
cascade never reaches here. Dropping a wired hook removes its `.claude/settings.json` wiring too
(step 10 shows that edit).

## 7. MCPs

Locked = the servers the kept selection pulls (typically just `serena`, via `baseline-navigation`);
the rest of the installed servers are direct picks - droppable, and preserved across runs
(`raw.json` carries them). Addable from `catalog.mcps`; note next to `sentry` that it needs
`SENTRY_ACCESS_TOKEN`.

## 8. Plugins

Locked = the plugins the kept selection pulls (an LSP plugin rides its stack's closure;
`superpowers` and `ponytail` arrive via the skills and agents that cite them); the rest of the
installed plugins are direct picks. Addable from `catalog.plugins`.

## 9. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check`,
output redirected to `$TMP/select.out` like every recompute. Show the closed selection grouped by category - closure adds marked with their reasons, the final
drop list (incl. accepted orphans) named. Blockers: list each with its fix and never run past
one (fix now, or reopen the owning layer and drop the affected items). Warnings are listed and
passed. **Convention-conflict warnings (project mode only):** when the project carries stated
conventions (a root or `.claude/` CLAUDE.md, `<docs-path>/architecture/` docs), check THIS RUN'S
typed adds (never locked rows or kept installed items) against them - a conflicting add gets one
warning line quoting the rule verbatim plus a keep-or-drop consent. No citable conflict, no
warning; no project docs, skip silently; a conflict warning never blocks the run. Also ask here:
keep local model/effort pins? (`--keep-pins`, default yes for a configure
run - an existing install often carries deliberate pin edits).

## 10. Update + removals

Run the installer **from the snapshot**, passing it back with `--source` so the run lands the
same revision step 1 previewed:

- Unix: `bash "$TMP/repo/scripts/os/claude-stack.sh" update --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" update -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-KeepPins]`
- Scope/space mirror how the install was laid down (project install -> `project`; account
  install -> `global`, with the space that owns it) - ask only when it is genuinely ambiguous.

`update --selection` refreshes the selected set - it does NOT uninstall what was dropped. Remove
dropped items (incl. accepted orphans) explicitly, show each command before running it: delete
the skill directory / agent file / rule file; a hook loses BOTH its `.claude/hooks/` file and its
`.claude/settings.json` wiring (show that edit too - step 6's promise); `claude mcp remove <name>` for an MCP;
`claude plugin uninstall <name>` for a plugin. Then re-run `/project-agent-capabilities` (when
installed) so the generated awareness rule reflects the new inventory.

## 11. CLAUDE.md - the user's call (project mode)

Not required - open with WHERE it lives and WHAT a yes changes, then ask; a 'no' ends the run
cleanly. The location: the project's own CLAUDE.md - `.claude/CLAUDE.md` where the installer
seeded it, or the root `CLAUDE.md` where the project already had one; name which one you found.
On a yes: reconcile it against the fetched `stack/CLAUDE.template.md` - add the sections the
template gained since the install, update the selection-tied parts (the rules table and any
capability mentions) for what this run added or dropped, and complete any still-unwritten
authoring-outline sections from what the inventory established. Reconcile ADDITIVELY: never
overwrite the project's own prose, and show the changes before writing. Never offer
skill/agent/MCP additions here - the walk owned the selection. Skip in global mode (no project
file to reconcile).

## Post-check

Report what changed per category (refreshed / added / dropped, orphans removed vs kept), the
CLAUDE.md decision and reconcile result, anything deferred, and remind that a restart picks up
MCP registration changes. The run rewrites `claude-stack.stamp` to the revision it installed, so
the next configure diffs from here.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`, on EVERY exit path of
THIS command: after a successful update, after an abort, after a blocker, and after the step-1
'nothing changed, stop here' case. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not fall back to a full re-install - this is the update path; a from-scratch install is the
  sibling `setup` command. Never present a layer question without its
  `[step n/11 - <name>] ... · next: <name>` banner or without the full-catalog table.
- Never drop a locked row on the user's behalf, never remove an orphan silently, and never
  re-offer an orphan the user chose to keep - the reason column is the answer, the dependent's
  layer is the remedy.
- Do not paste tool output or run chatty per-file commands - the 'Narrate, don't trace' contract
  holds for the whole run.
- Do not skip the area pick, the walked layers, the add/drop rounds, the prerequisite gate, or the explicit-removal
  pass. Do not write the archive, the extracted repo, or the working files into the project
  tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's
  behalf.
