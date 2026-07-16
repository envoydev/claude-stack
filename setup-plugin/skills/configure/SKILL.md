---
name: configure
description: "ADJUST an existing claude-stack install - inventory what is actually installed, report what an update would bring (the stamp compare), then walk the installed selection in the same four dependency-ordered layers as setup (rules -> agents -> skills -> MCPs + plugins), no recommended phase: each layer is a straight modify of what exists - drop what is no longer wanted, add from the catalog. An item another kept item requires is locked, always with the reason shown; a drop cascades forward - what it alone pulled in is offered for removal at its own layer, never removed silently. Prerequisite check, the installer's update action, explicit removals, and an OFFERED (never forced) CLAUDE.md reconcile close the run. Trigger by invoking /claude-stack:configure or 'add X to / drop Y from the claude stack'. NOT for a first install - that is the sibling setup skill; for a plain refresh (+ prune of upstream removals) the sibling update skill is the shorter path."
disable-model-invocation: true
---

# Configure the Claude stack - adjust an existing install

You are adjusting a claude-stack install that already exists. Same discipline as `setup`: drive
it interactively, walk the selection one layer at a time, always show the prerequisite report
before running, never run past an unmet blocker. `stack-select.js` does the deterministic work;
you orchestrate. Two differences from `setup`: the baseline selection is what is INSTALLED, not
the recommendations - every layer is a straight modify, no accept-recommended phase - and the
action is `update`, not `install`. (For a no-questions refresh that also prunes what upstream
removed, the sibling `update` skill is the shorter path - this skill is for CHOOSING what
changes.)

**ONE release archive is the entire download** - the shared contract lives in the sibling `setup`
skill's `references/source-protocol.md`; read it first and hold the whole run to it: download +
extract the `latest` release archive once into `$TMP/repo` (the reference owns the fallback), use
every tool from that snapshot, hand it back with `--source` in step 7, and remove `$TMP` per the
'Clean up' section on every exit path. This skill's extra stake in the snapshot: its
`RELEASE-SOURCE` commit is what step 1 compares the stamp against to report what an update would
bring.

## The ladder - announce every step

Eight user-facing steps; the machinery between them (the download, the post-check, the cleanup)
runs silently. Before EVERY question, one banner line so the user always knows where they are,
what is being decided, and what comes next:

```
[step 2/8 - rules] adjust the installed rules · next: agents
```

1 install status · 2 rules · 3 agents · 4 skills · 5 MCPs + plugins · 6 prerequisite check · 7 update · 8 CLAUDE.md (optional)

## 1. Install status - find it, inventory it, diff it

- **Find the install.** Project mode: cwd is a project root with a populated `.claude/`
  (skills/agents/rules dirs, or `.mcp.json`). Global mode: no project here, but the account
  (`~/.claude`, or `~/.claude-<space>`) carries installed skills. Nothing installed in either
  place -> stop and route to the sibling `setup` skill; there is nothing to configure yet. OS: on
  `darwin`/`linux` use the sh installer; on Windows the ps1 (via `pwsh`).
- **Inventory the installed set** from disk - never from memory or assumption: skills = the
  directory names under `.claude/skills/` (or the account's `skills/`); agents =
  `.claude/agents/*.md`; rules = `.claude/rules/*.md` (exclude the GENERATED
  `baseline-project-*.md` awareness rules - they are written by capture skills, never installed);
  mcps = the server names in `<repo>/.mcp.json`; plugins = `claude plugin list` (fail-soft
  without the CLI). Show the inventory grouped by category, with counts.
- **Report what changed since the install.** `.claude/claude-stack.stamp` (or the account's)
  records the commit every artifact of the current install was copied from - the stack versions
  the INSTALL, not the file. Use it to tell the user what an update would actually bring, BEFORE
  they choose:

```bash
SHA=$(sed -n 's/^sha: //p' .claude/claude-stack.stamp)
NEW=$(sed -n 's/^sha: //p' "$TMP/repo/RELEASE-SOURCE")   # the snapshot's commit (an archive has no git history to diff locally)
curl -fsSL "https://api.github.com/repos/envoydev/claude-stack/compare/$SHA...$NEW" |
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const F=(JSON.parse(d).files||[]);if(F.length>=300)console.log("TRUNCATED - the compare API caps at 300 files; this list may be incomplete");const P=/^(skills|agents|rules|hooks|templates)\//;for(const f of F)if(P.test(f.filename)||(f.previous_filename&&P.test(f.previous_filename)))console.log(f.status+"\t"+f.filename+(f.previous_filename?"\t<- "+f.previous_filename:""))})'
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

Close the step with one question: **walk the layers** (steps 2-5, adjust the selection), or
**refresh as-is** (nothing to change - skip straight to step 6; when upstream changed nothing
either, offer to stop rather than running a no-op, and note the sibling `update` skill is the
no-questions path for plain refreshes).

## The walk - steps 2-5, one layer at a time

Same dependency-ordered walk as `setup` (rules pull agents + skills, agents pull skills,
everything pulls MCPs + plugins - dependencies only point FORWARD), applied to the installed set
with no recommended phase. Hold TWO running files in the temp dir: `raw.json` - the remaining
selection (installed + adds - drops, every category incl. mcps) - and `dropped.json` -
everything dropped so far, per category.

Per layer:

- Recompute first: `node stack-select.js --selection raw.json --graph stack-graph.json --dropped dropped.json`.
  Two line kinds drive the step:
  - `required: <category> <name> - <why>` naming a DROPPED item -> the drop is blocked: something
    kept still depends on it. Show the reason; the user keeps it, or also drops the dependents
    the reason names (their layer is reopened if already walked, and its own cascade re-runs).
  - `orphan: <category> <name> - <why> (dropped); nothing kept still needs it` -> the cascade:
    an installed item whose only dependents were dropped at an earlier layer. Offer this layer's
    orphans for removal - 'it was only there for what you dropped; remove it too, or keep it?' -
    never remove one silently, never re-offer one the user chose to keep.
- Present the layer: **kept** (the installed items, staying by default), **locked** (kept items
  something else kept requires - marked with the reason, deselectable only via their dependents),
  **orphaned** (the offer above), **addable** (the release catalog minus installed - the graph's
  `rules`/`agents`/`skills` keys, `catalog.mcps`/`catalog.plugins`). One question: keep as-is, or
  modify (multi-pick of drops + adds)?
- Fold the answers into `raw.json` + `dropped.json` and move on. An `unknown:` line marks an
  installed name this release no longer ships (retired or renamed upstream) - it is excluded
  from the emitted selection automatically; surface it: adopt the replacement here if step 1
  showed a rename, or let the sibling `update` skill prune the leftover artifact.

A layer step looks like:

```
[step 4/8 - skills] adjust the installed skills · next: MCPs + plugins
kept 41 (37 locked by your rules + agents) · orphaned by dropping rule dotnet-repair-agents:
  dotnet-project-setup, dotnet-wpf (were required by agent dotnet-build-error-resolver - dropped)
Remove the orphans too, keep them, or modify the list further?
```

## 2. Rules

Nothing depends on a rule, so every installed rule is freely droppable and every catalog rule
addable - and a rule drop is where cascades START: what it alone pulled in surfaces as orphan
offers in the layers ahead.

## 3. Agents

Locked = agents a kept rule requires. Orphans here trace back to rule drops in step 2.

## 4. Skills

Locked = skills the kept rules + agents require. Orphans trace back to the rule and agent drops
before them.

## 5. MCPs + plugins

Locked = what the kept selection pulls; the rest of the installed servers/plugins are direct
picks - droppable, and preserved across runs now that `raw.json` carries them. Addable from
`catalog.mcps` + `catalog.plugins`.

## 6. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check`.
Show the closed selection grouped by category - closure adds marked with their reasons, the final
drop list (incl. accepted orphans) named. Blockers: list each with its fix and never run past
one (fix now, or reopen the owning layer and drop the affected items). Warnings are listed and
passed. Also ask here: keep local model/effort pins? (`--keep-pins`, default yes for a configure
run - an existing install often carries deliberate pin edits).

## 7. Update + removals

Run the installer **from the snapshot**, passing it back with `--source` so the run lands the
same revision step 1 previewed:

- Unix: `bash "$TMP/repo/scripts/claude-stack.sh" update --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/claude-stack.ps1" update -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-KeepPins]`
- Scope/space mirror how the install was laid down (project install -> `project`; account
  install -> `global`, with the space that owns it) - ask only when it is genuinely ambiguous.

`update --selection` refreshes the selected set - it does NOT uninstall what was dropped. Remove
dropped items (incl. accepted orphans) explicitly, show each command before running it: delete
the skill directory / agent file / rule file; `claude mcp remove <name>` for an MCP;
`claude plugin uninstall <name>` for a plugin. Then re-run `/project-capabilities` (when
installed) so the generated awareness rule reflects the new inventory.

## 8. CLAUDE.md - the user's call (project mode)

Not required - ask first, and a 'no' ends the run cleanly. On a yes: reconcile the project's
CLAUDE.md against the fetched `templates/CLAUDE.template.md` - add the sections the template
gained since the install, update the selection-tied parts (the rules table and any capability
mentions) for what this run added or dropped, and complete any still-unwritten authoring-outline
sections from what the inventory established. Reconcile ADDITIVELY: never overwrite the project's
own prose, and show the changes before writing. Skip in global mode (no project file to
reconcile).

## Post-check

Report what changed per category (refreshed / added / dropped, orphans removed vs kept), the
CLAUDE.md decision and reconcile result, anything deferred, and remind that a restart picks up
MCP registration changes. The run rewrites `claude-stack.stamp` to the revision it installed, so
the next configure diffs from here.

## Clean up the temp dir - ALWAYS

Remove `$TMP` per the `setup` skill's `references/source-protocol.md`, on EVERY exit path of THIS
skill: after a successful update, after an abort, after a blocker, and after the step-1 'nothing
changed, stop here' case. Then confirm the project tree holds only installed artifacts.

## Do not

- Do not fall back to a full re-install - this is the update path; a from-scratch install is the
  sibling `setup` skill. Never present a layer question without its
  `[step n/8 - <name>] ... · next: <name>` banner.
- Never drop a locked item on the user's behalf, never remove an orphan silently, and never
  re-offer an orphan the user chose to keep - the reason line is the answer, the dependent's
  layer is the remedy.
- Do not skip the walk, the prerequisite gate, or the explicit-removal pass. Do not write the
  archive, the extracted repo, or the working files into the project tree, and do not leave
  `$TMP` behind on any exit path. Do not commit anything on the user's behalf.
