# Generated rule - fill rules for the inventory sections, plus the house MCP routing map

Read at step 2 GENERATE, before the rule body is composed. The SHAPE of the generated rule
(frontmatter, `Captured:` line, the stamped usage policy, the four inventory headings) is the copy
target in SKILL.md; this file says how each inventory section is FILLED. Every character written
into the generated rule is paid by every session and every subagent of the project - keep the rows
lean.

## Orchestration skills (slash-only - invisible until invoked)
One line per detected `disable-model-invocation` skill: `/name - <first clause, max 120 chars>`.
The row is a ROUTER, not the skill's documentation - the skill's own description is loaded anyway.
House first sentences run 460-588 chars, so 'the first sentence' is not the cap; the first CLAUSE
at 120 chars is. The inventory step marks the one model-invocable-by-design exception - list it
with this set, marked as such.

## Subagent seats
One line: the installed seat names, comma-separated - dispatch is explicit only (@agent-, an
orchestration skill, or a repair-loop rule); each seat's description says when it applies.

## MCP routing
One row per REGISTERED server only, from the routing map below - a server absent from `.mcp.json`
gets no row, and an unknown server gets its name + 'routing: see project docs'. EVERY row ends with
its `first call:` line - the exact `ToolSearch select:...` that loads that server's load-bearing
tools. MCP tools arrive DEFERRED in this harness: the names exist, the schemas do not, and a
deferred tool cannot be called until it is loaded. A row that says WHEN to use a server and not HOW
to load it describes a capability the session cannot reach - naming a server is not loading it,
and the `first call:` line is the row's load-bearing half. Copy each one VERBATIM.

The routing map (only for servers actually present):
- `serena` - default symbol navigator + symbol-level editor; `find_symbol` / `find_referencing_symbols` before any whole-file Read; also holds the per-project handoff memory (`.serena/memories/`). first call: `ToolSearch select:mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__get_symbols_overview` (add `,mcp__serena__write_memory,mcp__serena__read_memory,mcp__serena__list_memories` for a seat handoff).
- `context7` - up-to-date docs for any API you don't own; resolve + query before writing against a third-party or version-sensitive surface, never from recall - and through these tools, not a shell fallback (`npx`, a registry `curl`), which answers a different question and leaves the registered server unused. first call: `ToolSearch select:mcp__context7__resolve-library-id,mcp__context7__query-docs`.
- `memory` - cross-project recall only; search when this project's context is thin, store significant cross-project outcomes at task end. first call: `ToolSearch select:` plus the `mcp__memory__*` names the session's own listing shows.
- `playwright` - drive a browser for visual checks / large HTML reports - don't text-read them. Screenshots: omit `filename` (auto-names land in the registered output dir, `.playwright/output/`), or prefix an explicit name with `.playwright/output/` - the server resolves explicit filenames against the repo ROOT, so a bare name litters the repo. Readback discipline: verify UI state via `browser_snapshot` / `browser_evaluate` (DOM assertions), or a `target`-scoped screenshot for a localized visual check - a full-page PNG Read is for the FINAL accepted state only, never the iteration loop.
- `angular-cli` - the framework CLI's own docs / commands.
- `chrome-devtools` / `appium-mcp` - browser / native-mobile debug, only for those targets.
- `sentry` - production error monitoring; pull the reported issue / event detail before diagnosing a production error, never from the stack trace alone.
- an issue-tracker connector - tracker read-write; ticket skills write the content, the connector files it - confirm before filing.

## Plugins
ONE line, comma-separated, each entry exactly `<name> (<state>)` where state is the word the
listing printed - installed / disabled. No WHY clause: `claude plugin list` is machine-global, so
this line reports STATE and never cause. Omit the section entirely when the CLI probe failed.
