---
name: project-agent-capabilities
description: "The deliberate capabilities capture. Use when the user asks to capture the project capabilities, refresh the capabilities rule, or find out what this project has installed - and after an install, a stack update, or a manifest trim. Manual, /-only. It inventories what THIS project actually has - the slash-only orchestration skills, the subagent seats, the MCP servers, the plugins - and regenerates wholesale the always-on awareness rule .claude/rules/baseline-project-agent-capabilities.md: the fixed house usage policy plus the real inventory, never an assumed stack. NOT for capturing architecture (project-architecture-analyzer), code style (project-code-style-analyzer), or a sibling repo's context - that is the sibling-context capture, where the project installed one."
disable-model-invocation: true
---

# Project Capabilities - inventory what is installed, generate the awareness rule

Every project trims the stack differently - skills commented out of the manifest, MCPs dropped (`memory` in a standalone project, `angular-cli` outside Angular), seats it never installed. A predefined list would name capabilities the project does not have; this skill reads the REAL inventory and generates the rule from it, so every session knows exactly what this project can do - and never gets steered at a capability that is not there.

The measurements behind these rules live in `references/evidence.md` - an audit appendix, not a run-time load.

## The run - precheck, inventory, then generate

### 0. PRECHECK - is there anything to capture at all?
ONE command, before any inventory read:

```bash
RULE=.claude/rules/baseline-project-agent-capabilities.md
[ -f "$RULE" ] && { find .claude/skills .claude/agents .claude/rules .mcp.json .claude/claude-stack.stamp \
  -newer "$RULE" ! -name 'baseline-project-*' ! -name 'project-code-style.md' -print 2>/dev/null | head -3; } || echo FIRST
```

- `FIRST` - no rule yet. Go to step 1; this is the capture the skill exists for.
- **Empty output** - nothing under the inventory sources has changed since the rule was written.
  Say so in ONE line naming the rule's `Captured:` date, and STOP. Do not inventory, do not
  regenerate, do not write. This is the whole point of the step: a run that re-inventories and then
  reports 'unchanged from the previous capture' has paid the full price for an answer it already had.
- **Any path printed** - that is the drift. Continue to step 1 and name those paths in the report.

Two things the precheck cannot see, and the only two reasons to continue past an empty result:
the PLUGIN list is machine-global (an enable or disable changes no file in this tree), and the USER
may ask for a refresh outright. Either one overrides it - say which one you are acting on.

### 1. INVENTORY - read what is actually on disk
- **Skills**: Glob `.claude/skills/*/SKILL.md` and EXTRACT the three fields - never dump the frontmatter. One pass, one line per file:
  `for f in <abs>/.claude/skills/*/SKILL.md; do printf '%s|%s|%s\n' "$(grep -m1 '^name:' "$f" | cut -d' ' -f2-)" "$(grep -c '^disable-model-invocation: true' "$f")" "$(grep -m1 '^description:' "$f" | cut -c1-160)"; done`
  A `Grep` for `description:` returns `[Omitted long matching line]` on every house skill and a whole-frontmatter dump costs 10-30x the fields. Collect `name`, the FIRST CLAUSE of `description` (see the shape's cap), and whether `disable-model-invocation: true` (those are the slash-only orchestration skills; the rest self-trigger and need no listing - one deliberate exception: `project-architecture-analyzer` carries no flag so the architecture loop can invoke it, yet it is still an orchestration skill - list it with that set, marked model-invocable-by-design).
- **Seats**: Glob `.claude/agents/*.md` - collect the names (the dispatch surface; their own descriptions say when each applies).
- **MCP servers**: read `.mcp.json` for the registered server names, AND list the session's live `mcp__<server>__` tool namespaces. The file is not the whole inventory: a connector reaching the session from the account or the harness has no `.mcp.json` row. Never write a NEGATIVE claim about a server class the file cannot see.
- **Plugins**: probe first, then run it unguarded - `command -v claude >/dev/null || echo CLI_ABSENT`, then `claude plugin list`. Never `claude plugin list || echo none` (the fallback launders a failure into the same output an empty result gives, which `baseline-quality-gates.md` bans) and never `| head -N` (it masks the exit status behind the pipe's and can truncate a listing mid-entry). The listing repeats a project-scoped plugin once per marketplace record, so DEDUPE by name before counting. If the probe says absent, omit the plugins section rather than guess.

Inventory only - nothing is judged, nothing is read beyond frontmatter and config. No dispatch; the whole run is in-session and cheap. Any Bash in this step uses absolute paths or a subshell (`(cd .claude && ...)`) - a bare `cd` persists into the session's later commands.

### 2. GENERATE - write .claude/rules/baseline-project-agent-capabilities.md
A valid PATHLESS rule (frontmatter with a `description:` marking it generated, NO `paths:`), regenerated WHOLESALE each run - it is fully derived, so no upsert, no hand edits to preserve. Wholesale is mechanical, not a mood: COMPOSE the whole body in-session first, then READ the existing file and compare. An edit-in-place keeps stale policy wording the skill has since changed, so the write is always the whole file.

**Identical? Do not write.** Report `rule unchanged - <N> bytes, not rewritten` and go to step 3. This is not a nicety: an identical rewrite pays a delete plus a full write, and the next session pays the changed mtime. Different? Write the composed body over the file in one call - the read you just did is what makes that Write legal, and it is one round trip. Do NOT `rm` it first: the auto-mode classifier denies that delete, which costs exactly the blocked round trip the delete was meant to save.

This skill was renamed from project-capabilities: when a legacy `.claude/rules/baseline-project-capabilities.md` exists, delete it in the same run - this rule supersedes it, and nothing else ever prunes generated rules. Keep it lean (always-on tokens are paid every session and subagent).

The block below is a COPY TARGET, not prose to retype: take it verbatim and fill only the `<...>` slots. One slot is not a slot - every `<docs-path>` in it is replaced with the LITERAL resolved docs root this project uses (the `CLAUDE_STACK_DOCS_PATH` value, or `.claude/docs`), because the generated rule is a deterministic pointer and cannot itself carry the placeholder it exists to resolve. Read `references/generated-rule-template.md` now - the fill rules for the four inventory sections and the house routing map the MCP rows are stamped from, `first call:` lines copied VERBATIM; the REPORT's `Template:` line is its receipt. The shape:

```markdown
---
description: Project capabilities awareness - generated by /project-agent-capabilities; edit via a re-run, not by hand.
---

# This project's capabilities

Captured: <YYYY-MM-DD> from <stack version>@<short-sha> (the install stamp's, or `no stamp` when absent)

## Usage policy (fixed - stamped verbatim, every run)
<!-- policy-rev: 6279be0d -->
- Load a skill for the work at hand - a file you're about to edit, a command you're about
  to run, a diff you're about to show - never to answer a question. Over-loading a simple
  turn is the failure to avoid.
- One home per rule: route in the project's CLAUDE.md only what an auto-injected
  description does not already cover. Path-scoped rules own per-file-type routing; hooks
  own deterministic gates and announce their own blocks - add a new gate as a hook, not prose.
- Subagent dispatch is explicit, never automatic: a user @agent-<name> mention, an
  orchestration skill routing to it, or a path-scoped repair-loop rule naming its resolver.
  Never self-delegate off a description match. When a task calls for multi-agent work,
  suggest the matching orchestration skill from the inventory below - never one this
  project does not carry.
- Memory recall is historical, not current: the assistant's per-project auto-memory
  persists across installs and roster changes. Validate any seat, skill, or command a
  recalled memory names against this rule's inventory before acting on it - a recall
  can name a capability this project no longer carries.
- A slash-only skill or plugin command (`disable-model-invocation` - the ones listed
  below) is the USER's to type - never call it yourself. Do not rely on the harness to
  stop you: `guard-fresh-session-start.js` denies that call now, and the rule holds with or
  without it. Never attempt one, never retry it under another spelling, and never spend
  the turn explaining that you cannot or weighing whether to: name the command, say in one
  line what it will do, hand the turn back.
- A deliberate orchestration skill (a capture, a quality loop, a build flow) starts in a
  fresh session when this one already carries another skill run's history. This is
  MECHANIZED, not advice: `guard-fresh-session-start.js` blocks the Skill call past the
  per-window trigger (150,000 tokens on a 200k window, 400,000 on a 1M one, 180,000 on any other
  window and on one that cannot be read at all) and the block is answered
  with one AskUserQuestion (fresh session, recommended, ending the turn with the resume
  block - or continue here with the cost stated). Do not restate the rule as a reminder to
  'name the route' - the prose form of it does not hold.
- Every doc the assistant creates lands under the docs root (`<docs-path>`), in its owned
  folder: `architecture/`, `test-coverage/`, `loops/` - and `related-context/` for anything
  tied to a sibling repo (the orientation doc `related-context/PROJECT-RELATED-CONTEXT.md`
  plus cross-repo plans, change requests, issue notes, run recipes; look there before
  re-deriving sibling state). A doc outside the root takes the user's approval, asked
  first - never silently.

## Orchestration skills (slash-only - invisible until invoked)
<one ROUTER row per slash-only skill: `/name - <first clause, max 120 chars>`>

## Subagent seats
<one line: the installed seat names, comma-separated>

## MCP routing
<one row per REGISTERED server from the routing map, each ending in its `first call:` line>

## Plugins
<ONE line: `<name> (<state>)` per plugin, comma-separated; omit the section when the CLI probe failed>
```

Verify after writing: the frontmatter parses, there is no `paths:` key, every inventory row came from the step-1 read of disk, and each MCP row ends in its `first call:` line. Report the result on the `Rule:` field - a rule that does not parse is a rule no session loads.

The usage-policy section is the house skill/agent policy's ONE home - it ships verbatim from this skill (a policy wording change lands here and reaches projects on their next re-run). Copy the `<!-- policy-rev: ... -->` line with it, unchanged: it is a content stamp over the block, recomputed by the stack's own lint whenever the policy text moves, and it is the ONLY way to tell a project carrying a current copy from one carrying a two-release-old one - the generated rule is never re-fetched, only re-generated by a user re-run. `/claude-stack:validate` compares a project's stamp against the snapshot's. Like every generated `baseline-project-*.md` rule it stays out of the installer's fetch manifest, so a stack update cannot overwrite it.

### 3. REPORT
A literal line template, not prose to remember - the close is filled in, field by field:

```
Rule:       <created | refreshed | unchanged, not rewritten> - <N> bytes
Template:   read - references/generated-rule-template.md
Inventory:  skills <n> / seats <n> / MCP servers <n> / plugins <n | CLI absent>
Drift:      <the paths the precheck printed, or `user asked for a refresh` / `plugin state only`>
Live from:  next session - an always-on rule is read at session start, so it does not govern this one
Next run:   start the next deliberate run in a FRESH session - /<the command they named>
Flags:      <one row each, or `none>`
```

Every count comes from the command that produced the list, never from a hand tally. Pipe the inventory through `wc -l`, or quote the number the listing printed.
`Live from:` and `Next run:` are UNCONDITIONAL and identical on both branches - a rule is read at
session start either way, and the first-act session is the one most likely to run something else
next. The FIRST-ACT test
itself stays mechanical - this run was NOT the session's first act when a user message, a tool call
or another skill run precedes it in the transcript - and it is now only a detail in the sentence,
not a branch that changes what is owed.

Then the prose, short - four things, each its own line so none of them is skimmed past:

- **Say `Live from:` the one way it is true on BOTH branches** - an always-on rule loads at session start, not retroactively, so this one governs from the next session and its guidance starts applying at the next `/clear`. Name the next deliberate skill in `Next run:` by name.
- **Two flags are MECHANICAL - compute them, do not eyeball them**: (a) intersect the parsed `.mcp.json` names against the heavy-native-deps list {`chrome-devtools`, `appium-mcp`} and report every hit as its own row; (b) `ls .claude/rules/` in step 1 and report any seat family with no matching convention rule. Also flag a slash-only skill whose seats are not installed.
- **Never infer causation from a machine-global listing** - state observed facts plainly ('typescript-lsp: listed disabled'), and never assert WHY something is installed or disabled without checking the per-project plugin records first: `claude plugin list` is machine-global, so install-scope causation read off it is a guess.
- **Say that the rule is MACHINE-LOCAL, not committed** - the installers tell every project to gitignore `.claude/*` and re-include only `.claude/CLAUDE.md`, so this file is untracked, a fresh clone does not carry it, and the command has to be re-run there.

## Don't game it
The rule lists what the inventory proved, nothing else - no capability is assumed from the house defaults, no row survives for a server or skill the project dropped, and an unreadable source (a malformed frontmatter, a missing .mcp.json) is reported as unreadable, not filled from memory. If the inventory looks wrong (an empty skills dir in a stack-installed project), say so and stop rather than generate an empty rule over a good one.
