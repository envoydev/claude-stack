# project-agent-capabilities - evidence appendix

The measured anecdotes behind this skill's rules, kept out of the run-time body so every session stops paying
for them. Audit material: read it to learn WHY a rule is shaped the way it is, never to run the skill.

## 0. PRECHECK
- **Empty output - say so in ONE line and STOP** - measured: the skill re-ran the full inventory whether or not anything had changed and reported 'unchanged from the previous capture' only AFTER paying for it - 44 runs, 218.3M cache-read (14.6% of an entire nine-project collection's bill), with 12 project-days carrying more than one run and one pair 18 minutes apart.

## 1. INVENTORY
- **Skills: EXTRACT the three fields - never dump the frontmatter** - measured: 84.1KB spilled, 30,828 B re-read, against 2,727 chars for the extractor - four runs paid this, one of them ~96.5k tokens.
- **MCP servers: the file is not the whole inventory** - measured: a run that inventoried the file alone wrote 'no issue-tracker connector is registered' into the always-on rule while 41 Jira/Confluence and 42 Notion tools were live in that same session.
- **Plugins: never `| head -N`** - measured: it truncated a real listing mid-entry, forcing a re-run.
- **Any Bash in this step uses absolute paths or a subshell** - measured: an inventory's bare `cd .claude` left the shell there for ~7 minutes of follow-on commands until the user redirected.

## 2. GENERATE
- **COMPOSE the whole body, then compare - the write is always the whole file** - measured: an upsert run silently missed a new usage-policy bullet.
- **Identical? Do not write.** - measured: two projects and four runs produced a byte-for-byte identical rule (one pair 7,582 bytes, zero delta) and each still paid a delete plus a full write, and the next session paid the changed mtime.
- **Do NOT `rm` it first** - measured on the sibling architecture capture, which had the same instruction: the auto-mode classifier denied the delete, which cost exactly the blocked round trip the delete was meant to save.

## Usage policy (the stamped block)
- **A slash-only skill is the USER's to type - do not rely on the harness to stop you** - measured: a model-initiated Skill call on a flagged skill went straight through (the user had typed the command with a leading space, so no command marker fired).
- **A deliberate orchestration skill starts in a fresh session - MECHANIZED, not advice** - measured: the prose form of it lost in 4 of 4 audited sessions, one of which named the route and continued anyway to 380k per message where the same step cost 134k run fresh.

## Generated rule - fill rules (references/generated-rule-template.md)
- **Orchestration row: the first CLAUSE, max 120 chars** - measured on a 16-seat project: house first sentences run 460-588 chars, so 'the first sentence' put 4,594 chars of orchestration block into a rule every session and every subagent pays for.
- **Each MCP row carries its `first call:` line VERBATIM** - measured: across 164 audited sessions in 9 projects, `serena` made zero calls in 6 of the 9 and `context7` in 8 of the 9, with 42-110 of their tools sitting deferred and unloaded - both servers are locked into every install, both are named in an always-on baseline rule, and naming them is what did not work.
- **playwright: a full-page PNG Read is for the FINAL accepted state only** - measured: two sessions Read ~260k tokens of full-page PNGs while iterating styling, then re-paid them as cache-read every turn after; the evaluate/snapshot sessions verified the same class of change for under 10k each, and a target-scoped read cost 0.6k where the full page cost 22k.

## 3. REPORT
- **A literal line template, not prose to remember** - measured: the prose form of these lines lost in 2 of 2 audited runs with the text loaded.
- **Every count comes from the command that produced the list** - measured: four audited sessions miscounted the seats, every one of them off by one and every one of them LOW (17 vs 18, 18 vs 19, 21 vs 22).
- **`Live from:` and `Next run:` are UNCONDITIONAL** - measured: a first-act run that recommended nothing chained a second orchestration run 3 minutes later and wrote off 205.9k tokens before the user killed it by hand.
- **Say the `Live from:` line the one way it is true on both branches** - measured: the un-scripted version got it wrong in 4 of 5 audited runs - two called a first-act session 'mid-session', and one told the user a rule written 90 seconds in was 'live for the rest of it'.
- **Name the next deliberate skill in `Next run:`** - measured: a session wrote the rule at minute 2, then chained three more orchestration runs the rule's own text warns against, every context spike landing above 320k - the warning existed only in a file the session never re-read.
- **Two flags are MECHANICAL - compute them, never eyeball them** - measured: the prose form was missed by a run that had the evidence in front of it.
- **(a) intersect `.mcp.json` against the heavy-native-deps list** - measured: a run with `appium-mcp` registered closed with 'Nothing odd to flag'.
- **(b) `ls .claude/rules/` and report a seat family with no convention rule** - measured: a run asserted that cross-check having never listed the directory.
- **Never assert WHY a plugin is installed or disabled without the per-project records** - measured: a 'rides the stack closure, inert' claim was confidently wrong - the plugin belonged to a sibling repo - and cost a user challenge plus 5 corrective calls.
- **The rule is MACHINE-LOCAL, not committed** - measured: the older text here claimed the opposite; a session checked `git check-ignore` and found the contradiction.
