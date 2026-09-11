---
name: project-agent-capabilities
description: "The deliberate capabilities capture: inventory what THIS project actually has installed - the slash-only orchestration skills (from .claude/skills frontmatter), the subagent seats (.claude/agents), the MCP servers (.mcp.json), the plugins (best-effort) - and generate the always-on awareness rule .claude/rules/baseline-project-agent-capabilities.md: the fixed house usage policy plus the real inventory, never an assumed stack. Re-run after an install, a stack update, or a manifest trim - the rule is regenerated wholesale. Manual, /-only. Triggers on 'capture the project capabilities', 'refresh the capabilities rule', 'what does this project have installed'. NOT for capturing architecture (project-architecture-analyzer), code style (project-code-style-analyzer), or siblings (project-related-context)."
disable-model-invocation: true
---

# Project Capabilities - inventory what is installed, generate the awareness rule

Every project trims the stack differently - skills commented out of the manifest, MCPs dropped (`memory` in a standalone project, `angular-cli` outside Angular), seats it never installed. A predefined list would name capabilities the project does not have; this skill reads the REAL inventory and generates the rule from it, so every session knows exactly what this project can do - and never gets steered at a capability that is not there.

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
  regenerate, do not write. This is the whole point of the step: the skill re-ran the full
  inventory whether or not anything had changed and reported 'unchanged from the previous capture'
  only AFTER paying for it - measured at 44 runs, 218.3M cache-read (14.6% of an entire
  nine-project collection's bill), with 12 project-days carrying more than one run and one pair 18
  minutes apart.
- **Any path printed** - that is the drift. Continue to step 1 and name those paths in the report.

Two things the precheck cannot see, and the only two reasons to continue past an empty result:
the PLUGIN list is machine-global (an enable or disable changes no file in this tree), and the USER
may ask for a refresh outright. Either one overrides it - say which one you are acting on.

### 1. INVENTORY - read what is actually on disk
- **Skills**: Glob `.claude/skills/*/SKILL.md` and EXTRACT the three fields - never dump the frontmatter. One pass, one line per file:
  `for f in <abs>/.claude/skills/*/SKILL.md; do printf '%s|%s|%s\n' "$(grep -m1 '^name:' "$f" | cut -d' ' -f2-)" "$(grep -c '^disable-model-invocation: true' "$f")" "$(grep -m1 '^description:' "$f" | cut -c1-160)"; done`
  A `Grep` for `description:` returns `[Omitted long matching line]` on every house skill and a whole-frontmatter dump costs 10-30x the fields (measured: 84.1KB spilled, 30,828 B re-read, against 2,727 chars for the extractor - four runs paid this, one of them ~96.5k tokens). Collect `name`, the FIRST CLAUSE of `description` (see the shape's cap), and whether `disable-model-invocation: true` (those are the slash-only orchestration skills; the rest self-trigger and need no listing - one deliberate exception: `project-architecture-analyzer` carries no flag so the architecture loop can invoke it, yet it is still an orchestration skill - list it with that set, marked model-invocable-by-design).
- **Seats**: Glob `.claude/agents/*.md` - collect the names (the dispatch surface; their own descriptions say when each applies).
- **MCP servers**: read `.mcp.json` for the registered server names, AND list the session's live `mcp__<server>__` tool namespaces. The file is not the whole inventory: a connector reaching the session from the account or the harness has no `.mcp.json` row, and a run that inventoried the file alone wrote 'no issue-tracker connector is registered' into the always-on rule while 41 Jira/Confluence and 42 Notion tools were live in that same session. Never write a NEGATIVE claim about a server class the file cannot see.
- **Plugins**: probe first, then run it unguarded - `command -v claude >/dev/null || echo CLI_ABSENT`, then `claude plugin list`. Never `claude plugin list || echo none` (the fallback launders a failure into the same output an empty result gives, which `baseline-quality-gates.md` bans) and never `| head -N` (it masks the exit status behind the pipe's, and it truncated a real listing mid-entry, forcing a re-run). The listing repeats a project-scoped plugin once per marketplace record, so DEDUPE by name before counting. If the probe says absent, omit the plugins section rather than guess.

Inventory only - nothing is judged, nothing is read beyond frontmatter and config. No dispatch; the whole run is in-session and cheap. Any Bash in this step uses absolute paths or a subshell (`(cd .claude && ...)`) - a bare `cd` persists into the session's later commands (measured: an inventory's bare `cd .claude` left the shell there for ~7 minutes of follow-on commands until the user redirected).

### 2. GENERATE - write .claude/rules/baseline-project-agent-capabilities.md
A valid PATHLESS rule (frontmatter with a `description:` marking it generated, NO `paths:`), regenerated WHOLESALE each run - it is fully derived, so no upsert, no hand edits to preserve. Wholesale is mechanical, not a mood: COMPOSE the whole body in-session first, then READ the existing file and compare. An edit-in-place keeps stale policy wording the skill has since changed (measured: an upsert run silently missed a new usage-policy bullet), so the write is always the whole file.

**Identical? Do not write.** Report `rule unchanged - <N> bytes, not rewritten` and go to step 3. This is not a nicety: two projects and four runs produced a byte-for-byte identical rule (one pair 7,582 bytes, zero delta) and each still paid a delete plus a full write, and the next session paid the changed mtime. Different? Write the composed body over the file in one call - the read you just did is what makes that Write legal, and it is one round trip. Do NOT `rm` it first: the auto-mode classifier denies that delete, which costs exactly the blocked round trip the delete was meant to save (measured on the sibling architecture capture, which had the same instruction).

This skill was renamed from project-capabilities: when a legacy `.claude/rules/baseline-project-capabilities.md` exists, delete it in the same run - this rule supersedes it, and nothing else ever prunes generated rules. Keep it lean (always-on tokens are paid every session and subagent).

The block below is a COPY TARGET, not prose to retype: take it verbatim and fill only the `<...>` slots. One slot is not a slot - every `<docs-path>` in it is replaced with the LITERAL resolved docs root this project uses (the `CLAUDE_STACK_DOCS_PATH` value, or `.claude/docs`), because the generated rule is a deterministic pointer and cannot itself carry the placeholder it exists to resolve. The shape:

```markdown
---
description: Project capabilities awareness - generated by /project-agent-capabilities; edit via a re-run, not by hand.
---

# This project's capabilities

Captured: <YYYY-MM-DD> from <stack version>@<short-sha> (the install stamp's, or `no stamp` when absent)

## Usage policy (fixed - stamped verbatim, every run)
<!-- policy-rev: be8eea1c -->
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
  stop you: measured, a model-initiated Skill call on a flagged skill went straight
  through (the user had typed the command with a leading space, so no command marker
  fired). `guard-fresh-session-start.js` denies that call now, and the rule holds with or
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
  'name the route' - the prose form of it lost in 4 of 4 audited sessions, one of which
  named the route and continued anyway to 380k per message where the same step cost 134k
  run fresh.
- Every doc the assistant creates lands under the docs root (`<docs-path>`), in its owned
  folder: `architecture/`, `test-coverage/`, `loops/` - and `related-context/` for anything
  tied to a sibling repo (the orientation doc `related-context/PROJECT-RELATED-CONTEXT.md`
  plus cross-repo plans, change requests, issue notes, run recipes; look there before
  re-deriving sibling state). A doc outside the root takes the user's approval, asked
  first - never silently.

## Orchestration skills (slash-only - invisible until invoked)
<one line per detected disable-model-invocation skill: `/name - <first clause, max 120 chars>`.
The row is a ROUTER, not the skill's documentation - the skill's own description is loaded anyway.
House first sentences run 460-588 chars, so 'the first sentence' put 4,594 chars of orchestration
block into a rule every session and every subagent pays for (measured on a 16-seat project).>

## Subagent seats
<one line: the installed seat names, comma-separated - dispatch is explicit only (@agent-, an
orchestration skill, or a repair-loop rule); each seat's description says when it applies>

## MCP routing
<one row per REGISTERED server only, from the house routing map below - a server absent from
.mcp.json gets no row, and an unknown server gets its name + 'routing: see project docs'.
EVERY row ends with its `first call:` line - the exact `ToolSearch select:...` that loads that
server's load-bearing tools. MCP tools arrive DEFERRED in this harness: the names exist, the
schemas do not, and a deferred tool cannot be called until it is loaded. A row that says WHEN to
use a server and not HOW to load it describes a capability the session cannot reach.>

## Plugins
<ONE line, comma-separated, each entry exactly `<name> (<state>)` where state is the word the
listing printed - installed / disabled. No WHY clause: `claude plugin list` is machine-global, so
this line reports STATE and never cause. Omit the section entirely when the CLI probe failed.>
```

The house routing map the MCP rows are stamped from (only for servers actually present). Each row
carries its `first call:` line VERBATIM - that line is the row's load-bearing half, and the reason
it exists is measured: across 164 audited sessions in 9 projects, `serena` made zero calls in 6 of
the 9 and `context7` in 8 of the 9, with 42-110 of their tools sitting deferred and unloaded. Both
servers are locked into every install, both are named in an always-on baseline rule, and naming
them is what did not work:
- `serena` - default symbol navigator + symbol-level editor; `find_symbol` / `find_referencing_symbols` before any whole-file Read; also holds the per-project handoff memory (`.serena/memories/`). first call: `ToolSearch select:mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__get_symbols_overview` (add `,mcp__serena__write_memory,mcp__serena__read_memory,mcp__serena__list_memories` for a seat handoff).
- `context7` - up-to-date docs for any API you don't own; resolve + query before writing against a third-party or version-sensitive surface, never from recall - and through these tools, not a shell fallback (`npx`, a registry `curl`), which answers a different question and leaves the registered server unused. first call: `ToolSearch select:mcp__context7__resolve-library-id,mcp__context7__query-docs`.
- `memory` - cross-project recall only; search when this project's context is thin, store significant cross-project outcomes at task end. first call: `ToolSearch select:` plus the `mcp__memory__*` names the session's own listing shows.
- `playwright` - drive a browser for visual checks / large HTML reports - don't text-read them. Screenshots: omit `filename` (auto-names land in the registered output dir, `.playwright/output/`), or prefix an explicit name with `.playwright/output/` - the server resolves explicit filenames against the repo ROOT, so a bare name litters the repo. Readback discipline: verify UI state via `browser_snapshot` / `browser_evaluate` (DOM assertions), or a `target`-scoped screenshot for a localized visual check - a full-page PNG Read is for the FINAL accepted state only, never the iteration loop (measured: two sessions Read ~260k tokens of full-page PNGs while iterating styling, then re-paid them as cache-read every turn after; the evaluate/snapshot sessions verified the same class of change for under 10k each, and a target-scoped read cost 0.6k where the full page cost 22k).
- `angular-cli` - the framework CLI's own docs / commands.
- `chrome-devtools` / `appium-mcp` - browser / native-mobile debug, only for those targets.
- `sentry` - production error monitoring; pull the reported issue / event detail before diagnosing a production error, never from the stack trace alone.
- an issue-tracker connector - tracker read-write; ticket skills write the content, the connector files it - confirm before filing.

The usage-policy section is the house skill/agent policy's ONE home - it ships verbatim from this skill (a policy wording change lands here and reaches projects on their next re-run). Copy the `<!-- policy-rev: ... -->` line with it, unchanged: it is a content stamp over the block, recomputed by the stack's own lint whenever the policy text moves, and it is the ONLY way to tell a project carrying a current copy from one carrying a two-release-old one - the generated rule is never re-fetched, only re-generated by a user re-run. `/claude-stack:validate` compares a project's stamp against the snapshot's. Like every generated `baseline-project-*.md` rule it stays out of the installer's fetch manifest, so a stack update cannot overwrite it.

### 3. REPORT
A literal line template, not prose to remember. The prose form of these lines lost in 2 of 2 audited
runs with the text loaded, so the close is filled in, field by field:

```
Rule:       <created | refreshed | unchanged, not rewritten> - <N> bytes
Inventory:  skills <n> / seats <n> / MCP servers <n> / plugins <n | CLI absent>
Drift:      <the paths the precheck printed, or `user asked for a refresh` / `plugin state only`>
Live from:  next session - an always-on rule is read at session start, so it does not govern this one
Next run:   start the next deliberate run in a FRESH session - /<the command they named>
Flags:      <one row each, or `none>`
```

Every count comes from the command that produced the list, never from a hand tally - four audited
sessions miscounted the seats, every one of them off by one and every one of them LOW (17 vs 18, 18
vs 19, 21 vs 22). Pipe the inventory through `wc -l`, or quote the number the listing printed.
`Live from:` and `Next run:` are UNCONDITIONAL and identical on both branches - a rule is read at
session start either way, and the first-act session is the one most likely to run something else
next (measured: a first-act run that recommended nothing chained a second orchestration run 3
minutes later and wrote off 205.9k tokens before the user killed it by hand). The FIRST-ACT test
itself stays mechanical - this run was NOT the session's first act when a user message, a tool call
or another skill run precedes it in the transcript - and it is now only a detail in the sentence,
not a branch that changes what is owed.

Then the prose, short. The `Live from:` line above is what the un-scripted version of this used to get wrong in 4 of 5 audited runs - two called a first-act session 'mid-session', and one told the user a rule written 90 seconds in was 'live for the rest of it' - so say it the one way it is true on BOTH branches: an always-on rule loads at session start, not retroactively, so this one governs from the next session and its guidance starts applying at the next `/clear`. Name the next deliberate skill in `Next run:` by name (measured: a session wrote the rule at minute 2, then chained three more orchestration runs the rule's own text warns against, every context spike landing above 320k - the warning existed only in a file the session never re-read). Flag anything odd worth the user's eye. Two of these are MECHANICAL - compute them, do not eyeball them, because the prose form was missed by a run that had the evidence in front of it: (a) intersect the parsed `.mcp.json` names against the heavy-native-deps list {`chrome-devtools`, `appium-mcp`} and report every hit as its own row (measured: a run with `appium-mcp` registered closed with 'Nothing odd to flag'); (b) `ls .claude/rules/` in step 1 and report any seat family with no matching convention rule - a run asserted that cross-check having never listed the directory. Also flag a slash-only skill whose seats are not installed. State observed facts plainly ('typescript-lsp: listed disabled') - never assert WHY something is installed or disabled without checking the per-project plugin records first: `claude plugin list` is machine-global, and install-scope causation inferred from it is the measured failure (a 'rides the stack closure, inert' claim was confidently wrong - the plugin belonged to a sibling repo - and cost a user challenge plus 5 corrective calls). The rule is MACHINE-LOCAL, not committed: the installers tell every project to gitignore `.claude/*` and re-include only `.claude/CLAUDE.md`, so this file is untracked and a fresh clone does not carry it - re-run the command there. (The older text here claimed the opposite; a session checked `git check-ignore` and found the contradiction.)

## Don't game it
The rule lists what the inventory proved, nothing else - no capability is assumed from the house defaults, no row survives for a server or skill the project dropped, and an unreadable source (a malformed frontmatter, a missing .mcp.json) is reported as unreadable, not filled from memory. If the inventory looks wrong (an empty skills dir in a stack-installed project), say so and stop rather than generate an empty rule over a good one.
