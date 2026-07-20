---
description: "FAST refresh of an existing claude-stack install - no selection questions: bring everything currently installed to the newest release AND prune what the stack itself deleted or renamed upstream since the stamped install. The prune list is computed from the GitHub compare between the stamp and the new snapshot, never guessed - user-authored artifacts and the generated baseline-project-*.md rules never appear in that diff, so they can never be touched. One confirmation before anything is deleted. NOT for choosing items to add or drop - that is the sibling configure command; not a first install - that is setup."
disable-model-invocation: true
---

# Update the Claude stack - refresh everything, prune what upstream removed

You are refreshing an existing install to the newest release, unchanged in shape: the same
items, new content - plus removing the artifacts the STACK removed upstream, which a plain
refresh leaves orphaned forever. No selection questions; the one gate is the deletion confirm.
`stack-select.js` still closes and prerequisite-checks the refreshed selection; you orchestrate.

**ONE release archive is the entire download** - the shared contract lives at
`${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`; read it first and hold the whole run to
it: download + extract once into `$TMP/repo`, use every tool from that snapshot, hand it back
with `--source` in step 6, and remove `$TMP` on every exit path in step 10. The protocol's
'Narrate, don't trace' section governs every tool call: quiet machinery, no pasted output, one
narration line between steps.

## 1. Preconditions - find the install
Exactly as the sibling `configure` command's step 1 (`${CLAUDE_PLUGIN_ROOT}/commands/configure.md` -
read it for any step cited below, command bodies do not co-load): project mode (populated `.claude/`) or global
mode (the account's skills). Nothing installed in either place -> stop and route to the sibling
`/claude-stack:setup` command. The user names items to add or drop -> that is the sibling
`configure` command, not this one. OS: `darwin`/`linux` -> the sh installer; Windows -> the ps1
(via `pwsh`).

## 2. Inventory the installed set
Build the CURRENT selection from disk exactly as the sibling `configure` command's step 1 does -
skills dirs, `agents/*.md`, `rules/*.md` (excluding the GENERATED `baseline-project-*.md`),
hooks (`.claude/hooks/*.js`, excluding the GENERATED `inject-code-style.js`), mcps from
`<repo>/.mcp.json`, plugins fail-soft - never from memory or assumption.

## 3. Compute the delta since the stamp
Read the stamp (`.claude/claude-stack.stamp`, or the account's) and the snapshot's
`RELEASE-SOURCE`; lead with the version delta (`0.1.0 -> 0.2.0`). Then the same status-emitting
compare the `configure` command's step 1 runs, and split by status:

- **modified / added files under an installed item** -> covered by the refresh; count them.
- **removed** -> the prune list, mapped to installed artifacts: `stack/skills/<name>/...` gone
  entirely from `$TMP/repo/stack/skills/` -> `.claude/skills/<name>`; `stack/agents/<f>.md` ->
  `.claude/agents/<f>.md`; `stack/rules/<f>.md` -> `.claude/rules/<f>.md`; `stack/hooks/<f>` -> `.claude/hooks/<f>` plus its
  `.claude/settings.json` wiring. A path still present in the snapshot is a move WITHIN the item,
  not a removal - the refresh handles it; prune only what the snapshot no longer has.
- **renamed** (`new-path <- old-path`) of an INSTALLED item -> BOTH halves, automatically: the old
  path joins the prune list AND the selection carries over to the new name in step 5 - a rename
  is the same item continuing under a new name, never an adoption choice. Say what was followed
  (`web-conventions -> typescript-conventions`).
- **added items not installed** -> an FYI list for the report; never auto-install - route the user
  to `configure` to adopt them.
- **No stamp, or the compare unreachable** -> refresh-only mode: say pruning needs a stamped,
  reachable baseline, and continue WITHOUT deletions - never guess a prune list.
- **The compare says `TRUNCATED`** (the API caps at 300 files) -> the removal list cannot be
  trusted complete: refresh-only mode, and route the reconcile to `configure` - never prune from
  a possibly-partial diff.

## 4. Confirm once
Show the version delta, the refresh counts by category, and the NAMED prune list. Ask one
question: proceed with refresh + prune, or refresh only. Nothing is ever deleted silently; a 'no'
means refresh-only. For example:

```
claude-stack 0.1.0 -> 0.2.0 - refresh: 12 skills, 9 agents, 6 rules, 3 hooks
prune: .claude/rules/web-conventions.md (renamed upstream; typescript-conventions.md carried over)
Proceed with refresh + prune, or refresh only?
```

## 5. Selection and gates
Selection = installed, minus the confirmed prune list, plus the new names of step-3 renames;
write `raw.json`, run `stack-select.js --selection raw.json --graph stack-graph.json --emit
selection.txt --check`. A `required:` line (a dependency the new release introduced) is auto-kept
and reported. An `unknown:` line is an upstream retirement the compare missed - stack-select has
already excluded it from the emitted selection; add the artifact to the prune list (an MCP simply
drops out of the regenerated `.mcp.json`; name it in the report). Blockers stop the run with
their fixes - never update past one; warnings are listed and passed.

## 6. Run the update
From the snapshot, handing it back so the run lands the revision step 3 previewed:
- Unix: `bash "$TMP/repo/scripts/os/claude-stack.sh" update --source "$TMP/repo" --scope <scope> --selection selection.txt [--space <name>] --keep-pins`
- Windows: `pwsh -File "$TMP/repo/scripts/os/claude-stack.ps1" update -Source "$TMP/repo" -Scope <scope> -Selection selection.txt [-Space <name>] -KeepPins`
Scope/space mirror how the install was laid down. `--keep-pins` is the default here - a fast
refresh must not flatten deliberate local model/effort pin edits.

## 7. Prune
Delete each item on the confirmed list, showing every command before running it. A deleted hook
also loses its `.claude/settings.json` wiring in the same pass - show that edit too. Then re-run
`/project-agent-capabilities` (when installed) so the generated awareness rule reflects the new
inventory.

## 8. Reconcile the project's CLAUDE.md (project mode)
Against the snapshot's `stack/CLAUDE.template.md`, ADDITIVELY, exactly as the sibling
`configure` command's step 11: add sections the template gained, update the rules table for what
this run pruned, never overwrite the project's own prose, show changes before writing. Skip in
global mode.

## 9. Post-check
Report the version delta, refreshed / pruned counts by category (naming the pruned items), the
FYI additions routed to `configure`, and the MCP-restart reminder. The run rewrote
`claude-stack.stamp` - the next update or configure diffs from here.

## 10. Clean up the temp dir - ALWAYS
Remove `$TMP` per `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md`, on EVERY exit path: after
a successful run, after refresh-only, after a blocker, and after a user 'no'. Then confirm the
project tree holds only installed artifacts.

## Do not
- Never delete anything the upstream diff did not name - user-authored skills/agents/rules/hooks
  and the generated `baseline-project-*.md` rules never appear in it; if a candidate is not in
  the diff, it stays.
- Never install additions and never remove an MCP or plugin the diff did not retire - adopting or
  dropping by choice is the sibling `configure` command.
- Never skip the step-4 confirm before deletions, never run past a blocker, and never leave
  `$TMP` behind. Do not commit anything on the user's behalf.
