---
name: configure
description: "UPDATE an existing claude-stack install - inventory what is actually installed, let the user adjust the selection (refresh as-is, add stacks/items, or drop items), close it against the dependency graph with a prerequisite check, and run the installer's update action against that subset. Same selection machinery as the sibling setup skill, applied to an install that already exists. Trigger by invoking /claude-stack:configure or 'update the claude stack here'. NOT for a first install - that is the sibling setup skill (install from scratch); routes there when nothing is installed yet."
disable-model-invocation: true
---

# Configure the Claude stack - update an existing install

You are refreshing or adjusting a claude-stack install that already exists. Same discipline as
`setup`: drive it interactively, always show the resolved selection and the prerequisite report
before running, never run past an unmet blocker. `stack-select.js` does the deterministic work;
you orchestrate. The one difference from `setup`: the baseline selection is what is INSTALLED,
not the recommendations - and the action is `update`, not `install`.

**ONE shallow clone is the entire download** - the shared contract lives in the sibling `setup`
skill's `references/clone-protocol.md`; read it first and hold the whole run to it: clone once
into `$TMP/repo`, use every tool from that clone (never a raw URL; `git` missing means stop),
hand it back with `--source` in step 8, and remove `$TMP` on every exit path in step 12. This
skill's extra stake in the clone: its git history is what step 3 fetches the stamped commit into
to diff what an update would bring.

## 1. Preconditions - find the install
- Project mode: cwd is a project root with a populated `.claude/` (skills/agents/rules dirs, or
  `.mcp.json`). Global mode: no project here, but the account (`~/.claude`, or `~/.claude-<space>`)
  carries installed skills. Nothing installed in either place -> stop and route to the sibling
  `setup` skill; there is nothing to configure yet.
- OS: on `darwin`/`linux` use the sh installer; on Windows the ps1 (via `pwsh`).

## 2. Inventory the installed set
Build the CURRENT selection from disk - never from memory or assumption:
- skills: the directory names under `.claude/skills/` (or the account's `skills/`).
- agents: `.claude/agents/*.md`; rules: `.claude/rules/*.md` (exclude the GENERATED
  `baseline-project-*.md` awareness rules - they are written by capture skills, never installed).
- mcps: the server names in `<repo>/.mcp.json`; plugins: `claude plugin list` (fail-soft without
  the CLI).
Show the inventory grouped by category, with counts.

## 3. Report what changed since the install (the stamp)
`.claude/claude-stack.stamp` (or the account's, in global mode) records the commit every artifact
of the current install was copied from - the stack versions the INSTALL, not the file, because
Claude Code has no per-artifact `version:` field. Use it to tell the user what an update would
actually bring, BEFORE they choose:

```bash
SHA=$(sed -n 's/^sha: //p' .claude/claude-stack.stamp)
# the depth-1 clone has no history - fetch just the stamped commit so it can be diffed
git -C "$TMP/repo" fetch --depth 1 origin "$SHA" 2>/dev/null &&
  git -C "$TMP/repo" diff --name-only "$SHA" HEAD -- skills/ agents/ rules/ hooks/ templates/
```

Summarise the result by category (`N skills, N agents, N rules changed`), naming the items - that
is the honest answer to 'what does updating get me'. Two cases to handle, neither an error:
- **No stamp** - an install predating stamping, or one whose source never resolved. Say the
  baseline is unknown, so an update's effect cannot be previewed; the update itself is unaffected
  and will write a stamp.
- **The fetch or diff fails** - the commit is gone (history rewritten, or a fork/`STACK_SKILLS_REPO`
  source that never had it). Report that the baseline is unreachable and move on; never guess a
  diff, and never treat this as a reason to skip the update.

Nothing changed since the stamp and no adds/drops wanted? Say so plainly and offer to stop rather
than running a no-op update.

## 4. Ask what to change
One question: **refresh as-is** (default - update everything currently installed), **add**
(multi-pick: a whole stack seeded from the sibling `setup` skill's
`references/recommendations.json`, or named individual items), or **drop** (pick installed items
to remove). Also ask: keep local model/effort pins? (`--keep-pins`, default yes for a configure
run - an existing install often carries deliberate pin edits).

## 5. Use the tools from the clone
Per the `setup` skill's `references/clone-protocol.md`: the installer, `stack-select.js`,
`stack-graph.json`, and `templates/CLAUDE.template.md` (for step 10) all come out of `$TMP/repo` -
never a raw re-fetch.

## 6. Build the selection and close it
- Selection = installed set, plus the adds, minus the drops; write it to `raw.json`.
- Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check`
- A drop that something kept still depends on comes back as a `required:` line - show the reason
  and let the user keep it or also drop the dependents.

## 7. Review, prerequisite gate
Same contract as `setup`: show the closed selection grouped by category, closure adds marked with
their reasons; list blockers with fixes and never run past one; warnings are listed and passed.

## 8. Run the update
Run the installer **from the clone**, and pass the clone back with `--source` so it updates from
what you already downloaded instead of cloning again:
- Unix: `bash "$TMP/repo/scripts/claude-stack.sh" update --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] [--keep-pins]`
- Windows: `pwsh -File "$TMP/repo/scripts/claude-stack.ps1" update -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] [-KeepPins]`
- Scope/space mirror how the install was laid down (project install -> `project`; account
  install -> `global`, with the space that owns it) - ask only when it is genuinely ambiguous.
- `--source` is what makes the guided run take ONE clone, and it guarantees the update lands the
  same revision step 3 previewed. The installer copies out of `$TMP/repo` and leaves it for you to
  remove in step 12.

## 9. Apply the drops
`update --selection` refreshes the selected set - it does NOT uninstall what was dropped. Remove
dropped items explicitly, show each command before running it: delete the skill directory /
agent file / rule file; `claude mcp remove <name>` for an MCP; `claude plugin uninstall <name>`
for a plugin. Then re-run `/project-capabilities` (when installed) so the generated awareness
rule reflects the new inventory.

## 10. Reconcile the project's CLAUDE.md with the template (project mode)
Reconcile the project's CLAUDE.md against the fetched `templates/CLAUDE.template.md`: add the
sections the template gained since the install, update the selection-tied parts - the rules
table and any capability mentions - for what this run added or dropped, and fill any
still-empty `<placeholders>` from what the inventory established. Reconcile ADDITIVELY: never
overwrite the project's own prose, and show the changes before writing. Skip in global mode
(no project file to reconcile).

## 11. Post-check
Report what changed per category (refreshed / added / dropped), the CLAUDE.md reconcile result,
anything deferred, and remind that a restart picks up MCP registration changes. The run rewrites
`claude-stack.stamp` to the revision it installed, so the next configure diffs from here.

## 12. Clean up the temp dir - ALWAYS
Remove `$TMP` per the `setup` skill's `references/clone-protocol.md`, on EVERY exit path of THIS
skill: after a successful update, after an abort, after a blocker, and after the step-3 'nothing
changed, stop here' case. Then confirm the project tree holds only installed artifacts.

## Do not
- Do not fall back to a full re-install - this is the update path; a from-scratch install is the
  sibling `setup` skill. Do not skip the review or the prerequisite gate. Do not write the clone or
  the working files into the project tree, and do not leave `$TMP` behind on any exit path. Do not
  commit anything on the user's behalf.
