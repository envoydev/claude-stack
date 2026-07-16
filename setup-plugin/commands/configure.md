---
description: "ADJUST an existing claude-stack install - inventory what is actually installed, report what an update would bring (the stamp compare), then walk the installed selection in the same six dependency-ordered layers as setup (rules -> agents -> skills -> hooks -> MCPs -> plugins), no recommended phase: each layer shows ONE numbered table of the whole catalog with what is installed and what is locked (the required-by reason shown), then one selection round - Keep as-is / All / None, or typed numbers to add and drop. A drop cascades forward - what it alone pulled in is offered for removal at its own layer, never removed silently. Prerequisite check, the installer's update action, explicit removals, and an OFFERED (never forced) CLAUDE.md reconcile close the run. NOT for a first install - that is the sibling setup command; for a plain refresh (+ prune of upstream removals) the sibling update command is the shorter path."
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
from that snapshot, hand it back with `--source` in step 9, and remove `$TMP` per the 'Clean up'
section on every exit path. The protocol's 'Narrate, don't trace' section governs every tool
call: one quiet call per recompute, no pasted tool output, one narration line between steps.
This command's extra stake in the snapshot: its `RELEASE-SOURCE` commit is what step 1 compares
the stamp against to report what an update would bring.

## The ladder - announce every step

Ten user-facing steps; the machinery between them runs silently. Before EVERY question, one
banner line so the user always knows where they are, what is being decided, and what comes next:

```
[step 2/10 - rules] adjust the installed rules · next: agents
```

1 install status · 2 rules · 3 agents · 4 skills · 5 hooks · 6 MCPs · 7 plugins · 8 prerequisite check · 9 update · 10 CLAUDE.md (optional)

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
  without the CLI). Show the inventory grouped by category, with counts.
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

Close the step with one question: **walk the layers** (steps 2-7, adjust the selection), or
**refresh as-is** (nothing to change - skip straight to step 8; when upstream changed nothing
either, offer to stop rather than running a no-op, and note the sibling `update` command is the
no-questions path for plain refreshes).

## The walk - steps 2-7, one layer at a time

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
2. **Show ONE numbered table of the layer's ENTIRE catalog** (installed and not-installed alike -
   the graph's `rules`/`agents`/`skills` keys, `catalog.hooks`, `catalog.mcps`,
   `catalog.plugins`) - emitted as ONE contiguous markdown table in a single reply, no blank
   lines inside and nothing interleaved: a table split across blocks renders as misaligned
   fragments. Columns: number, name, `installed` (`yes`, `orphaned` for the cascade
   offers, or `-`), `required by` (the lock reason for kept items something else kept needs, or
   `-`):

```
[step 4/10 - skills] adjust the installed skills · next: hooks
| # | skill | installed | required by |
|---|-------|-----------|-------------|
| 1 | csharp | yes | rule csharp-conventions |
| 2 | dotnet-wpf | orphaned | was: agent dotnet-build-error-resolver (dropped) |
| 3 | postgres | - | - |
```

3. **One selection round - quick options + numbers.** Ask with the question tool, options in
   this order: **Keep as-is** (the installed set exactly as shown - the default; orphaned rows
   are pre-suggested for dropping, each with its cascade origin), **All** (add every catalog
   row), **None** (drop everything droppable, keep only the locked rows), and typed adjustments
   through the free-text answer - `add 3 7 12`, `drop 5`, or both (bare numbers mean add). A
   drop naming a LOCKED row is refused with its reason shown - the remedy is dropping the
   dependent at its own layer, never a silent override. Restate the outcome in one line (added
   N, dropped M), fold it into `raw.json` + `dropped.json`, narrate the handoff, move on. An `unknown:` line marks an installed name this release no
   longer ships (retired or renamed upstream) - it is excluded from the emitted selection
   automatically; surface it: adopt the replacement here if step 1 showed a rename, or let the
   sibling `update` command prune the leftover artifact.

## 2. Rules

Nothing depends on a rule, so every installed rule is freely droppable and every catalog rule
addable - and a rule drop is where cascades START: what it alone pulled in surfaces as orphan
offers in the layers ahead.

## 3. Agents

Locked = agents a kept rule requires. Orphans here trace back to rule drops in step 2.

## 4. Skills

Locked = skills the kept rules + agents require. Orphans trace back to the rule and agent drops
before them.

## 5. Hooks

Leaf picks - nothing requires a hook and a hook requires nothing, so every row is free and the
cascade never reaches here. Dropping a wired hook removes its `.claude/settings.json` wiring too
(step 9 shows that edit).

## 6. MCPs

Locked = the servers the kept selection pulls (typically just `serena`, via `baseline-navigation`);
the rest of the installed servers are direct picks - droppable, and preserved across runs
(`raw.json` carries them). Addable from `catalog.mcps`; note next to `sentry` that it needs
`SENTRY_ACCESS_TOKEN`.

## 7. Plugins

Locked = the plugins the kept selection pulls (an LSP plugin rides its stack's closure;
`superpowers` and `ponytail` arrive via the skills and agents that cite them); the rest of the
installed plugins are direct picks. Addable from `catalog.plugins`.

## 8. Prerequisite check

Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check`,
output redirected to `$TMP/select.out` like every recompute. Show the closed selection grouped by category - closure adds marked with their reasons, the final
drop list (incl. accepted orphans) named. Blockers: list each with its fix and never run past
one (fix now, or reopen the owning layer and drop the affected items). Warnings are listed and
passed. Also ask here: keep local model/effort pins? (`--keep-pins`, default yes for a configure
run - an existing install often carries deliberate pin edits).

## 9. Update + removals

Run the installer **from the snapshot**, passing it back with `--source` so the run lands the
same revision step 1 previewed:

- Unix: `bash "$TMP/repo/scripts/os/claude-stack.sh" update --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" update -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-KeepPins]`
- Scope/space mirror how the install was laid down (project install -> `project`; account
  install -> `global`, with the space that owns it) - ask only when it is genuinely ambiguous.

`update --selection` refreshes the selected set - it does NOT uninstall what was dropped. Remove
dropped items (incl. accepted orphans) explicitly, show each command before running it: delete
the skill directory / agent file / rule file; a hook loses BOTH its `.claude/hooks/` file and its
`.claude/settings.json` wiring (show that edit too - step 5's promise); `claude mcp remove <name>` for an MCP;
`claude plugin uninstall <name>` for a plugin. Then re-run `/project-agent-capabilities` (when
installed) so the generated awareness rule reflects the new inventory.

## 10. CLAUDE.md - the user's call (project mode)

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
  `[step n/10 - <name>] ... · next: <name>` banner or without the full-catalog table.
- Never drop a locked row on the user's behalf, never remove an orphan silently, and never
  re-offer an orphan the user chose to keep - the reason column is the answer, the dependent's
  layer is the remedy.
- Do not paste tool output or run chatty per-file commands - the 'Narrate, don't trace' contract
  holds for the whole run.
- Do not skip the walk, the selection rounds, the prerequisite gate, or the explicit-removal
  pass. Do not write the archive, the extracted repo, or the working files into the project
  tree, and do not leave `$TMP` behind on any exit path. Do not commit anything on the user's
  behalf.
