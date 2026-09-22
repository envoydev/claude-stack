# Plugin-native migration - Phase 0 spike evidence

Every row is a run, not a reading: the command, what came back, and the verdict the plan's PASS
condition gives it. A spike that was not run is reported NOT RUN, never implied as passing.

Harness: Claude Code 2.1.278 on macOS. Spike plugin `spike` 0.0.1, loaded with `--plugin-dir`, in a
throwaway git project under the session scratchpad.

**One deviation from the plan's Phase 0 preamble.** It asks for a throwaway `CLAUDE_CONFIG_DIR` so
nothing touches the real account dir. A throwaway config dir carries no credentials, so
`claude -p` answers `Not logged in - Please run /login` and measures nothing; looking for the
credential store to copy it is not something this run will do. The spikes therefore run against the
authenticated config dir, with the PROJECT still in the scratchpad. What this costs: the spike
sessions' own transcripts land under that config dir's `projects/` tree like any other session.
Nothing is installed into it - `--plugin-dir` loads the plugin for the one invocation.

---

## S1 preload naming - PASS

**Question.** Does a plugin agent's `skills:` frontmatter preload a plugin skill, under the BARE
skill name, the plugin-SCOPED name, or neither? And does a plugin agent resolve when dispatched by
its bare name?

**Setup.** Skill `alpha` whose body is `The passphrase is HERON-42`. Two agents, identical but for
one frontmatter line: `seat-bare` (`skills: alpha`) and `seat-scoped` (`skills: spike:alpha`). Both
`tools: Read`, `model: haiku` - no `Skill` tool, so a preload is the only route to the passphrase.

**Run 1 - what registers.**

```
claude --plugin-dir $S/plugin -p 'List every agent type available to you ...' --output-format json
```

```
claude, Explore, general-purpose, Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

The skill registers as `spike:alpha`. Both agents register, plugin-scoped.

**Run 2 - the scoped preload.** Dispatch `spike:seat-scoped`, 'ask it for the passphrase, reply with
its answer only'. Result: `HERON-42`. The subagent transcript's only tool call is
`SubagentHandback` - no `Skill` call.

**Run 3 - the bare preload.** Dispatch `spike:seat-bare`, same prompt. Result: `HERON-42`. Same
transcript shape: `SubagentHandback` only, no `Skill` call.

**Run 4 - the bare AGENT name.** Dispatch with `subagent_type: seat-scoped`, no prefix, instructed
not to retry under another spelling:

```
Agent type 'seat-scoped' not found. Available agents: claude, Explore, general-purpose,
Plan, spike:seat-bare, spike:seat-scoped, statusline-setup
```

**Verdict: PASS.** The plan's condition was 'one form answers HERON-42 with no Skill tool call'.
BOTH forms do. Agents move to the plugin; they do not stay in the seed.

**What it settles for the build:**
- `skills:` in agent frontmatter resolves under BOTH spellings when the plugin skill is the only
  candidate. **Corrected by S6:** it must still be rewritten to the scoped `claude-stack:<skill>`.
  S6 ran the same two agents with a stale project copy of `alpha` present and the bare form
  preloaded the PROJECT copy, silently. Every migrating project has exactly that shape for one
  session. The Phase 3 edit pass stands.
- The DISPATCH surface does change: a plugin agent is addressable only as `<plugin>:<agent>`. Every
  place that names a bare seat name has to carry the prefix - the skills that dispatch seats, the
  trio protocol, and `guard-unapproved-dispatch.js`, whose `*-implementer` test is a bare-name match
  today.
- Hook matchers on `SubagentStart` / `SubagentStop` take the scoped identifier and are regexes, so
  they need anchoring: `^claude-stack:aspnet-implementer$`. `docs-session.js` is wired on both
  events and attributes writes per `agent_id`, so this is a Phase 2 edit, not a Phase 3 one.

**Docs check (same sitting, context7 `/websites/code_claude`):**
- `skills` on an agent: 'Array of skill names to preload into the agent context', and 'To preload
  Skills into the agent's context, use the `skills` field rather than listing `Skill` here'
  (agent-sdk/typescript, AgentDefinition).
- Plugin agent naming: 'For subagents shipped by a plugin, the agent type is the plugin-scoped
  identifier such as `my-plugin:reviewer`, not the bare frontmatter name. The colon places a
  plugin-scoped name on the regular-expression path, so anchor the matcher with `^` and `$` for an
  exact match' (hooks, SubagentStart).

---

## S2 skillOverrides over a plugin skill - PASS (the plan's design stands)

**Question.** Does `skillOverrides` in a project `settings.json` switch a PLUGIN skill off, and under
which key - bare or scoped?

**Method.** One measurement harness for S2, S3 and S6: `claude -p 'Reply with the single word ok'
--output-format json`, summing `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
off the result JSON. The skill carries a 1500-character description with `ALPHA_MARKER_7431` in it,
so a skill that loads is worth roughly 400 tokens and a drop is visible well above the noise.

| settings.json `skillOverrides` | token sum | marker answer |
|---|---|---|
| absent (baseline, 3 runs) | 20050, 20050, 20050 | `spike:alpha` |
| `{"spike:alpha": "off"}` | 20052 | `spike:alpha` |
| `{"alpha": "off"}` | 20052 | `spike:alpha` |
| both keys | 20052 | `spike:alpha` |

**Verdict: PASS, and it is the expected result, not a surprise.** Neither spelling moves the number
(+2 tokens is the settings file itself) and the model still names `spike:alpha` as the skill holding
`ALPHA_MARKER_7431`. `skillOverrides` does not reach a plugin skill.

**What it settles for the build:** trimming stays where the plan put it - a project takes the skills
it wants by choosing marketplace ENTRIES, not by switching individual plugin skills off after the
fact. No per-skill opt-out surface is built.

---

## S3 permissions.deny over a plugin agent - PASS

**Question.** Does `permissions.deny` drop a plugin agent from the listing, and does its description
stop being paid for?

**Run.** Project `settings.json` `"permissions": {"deny": ["Agent(spike:seat-bare)"]}`, the same
measurement harness. `seat-bare` carries a 1500-character description holding `BETA_MARKER_9182`.

```
without deny   sum=20441   'is BETA_MARKER_9182 in your agent descriptions?' -> YES
with deny      sum=20007   same question -> NO
```

**Verdict: PASS.** -434 tokens, which is the description, and the agent is gone from the listing.

**What it settles for the build:** a project that wants a seat off has a real lever, and it is the
per-seat trim the plan assumed. `Agent(<plugin>:<name>)` is the spelling - the scoped identifier,
matching S1's dispatch finding.

---

## S4 bin/ on PATH - PASS on macOS, Windows NOT RUN

**Question.** Does a plugin's `bin/` land on PATH for the model's own Bash calls, and for a child
shell?

**Run.** `bin/spike-cli`, `#!/usr/bin/env node`, prints a marker.

```
spike-cli                       -> marker printed
command -v spike-cli            -> <plugin>/bin/spike-cli
pwsh -NoProfile -Command spike-cli -> marker printed (child shell inherits PATH)
```

**Verdict: PASS on macOS.**

**Windows: NOT RUN** - no Windows machine in this session. The specific untested risk is the
`#!/usr/bin/env node` shebang: Windows has no shebang handling, so whether Claude Code shims a
`bin/` entry there (a generated `.cmd`, or invoking through node) is unknown. Phase 4 carries a
Windows check for it, and until that check runs no shipped code path may depend on a `bin/` entry
being callable as a bare word on Windows.

---

## S5 plugin hooks - PASS, with one branch NOT RUN

**Question.** Do plugin `hooks/hooks.json` entries fire for every event the stack uses, in exec form
with `args` and `timeout`, and what is in scope when they do?

**Run.** Five entries, each `{"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/log-hook.js",
"args": ["<label>"], "timeout": 10}`: `SessionStart` (bare), `SessionStart` with `matcher: "compact"`,
`UserPromptSubmit`, `PreToolUse` on `Bash`, `Stop`, `SubagentStop`. The script appends one JSON row per
firing to `$CLAUDE_PLUGIN_DATA/fired.jsonl`.

Observed over the spike session: SessionStart-any 2, UserPromptSubmit 3, PreToolUse-Bash 1, Stop 2,
SubagentStop 1. Every row carried `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`,
`cwd`, and `CLAUDE_STACK_DOCS_PATH=docs-x` read out of the project `settings.json` `env`. Rows landed
at `~/.claude/plugins/data/spike-inline/fired.jsonl`.

**Verdict: PASS.** Exec form with `args` and `timeout` works, all five events fire, and the three
variables the thirteen hooks read are in scope.

**NOT RUN:** whether `matcher: "compact"` fires on a real compaction. A one-shot `-p` run cannot
compact. What the run DID show is that the matcher is applied: the `compact` entry did not fire on a
startup session while the bare `SessionStart` entry did, so SessionStart matchers are honoured.
`guard-fresh-session-start.js` depends on the `compact` matcher, so Phase 2 must exercise a real
compaction before that hook moves.

---

## S6 coexistence - PASS, and it overturns part of S1

**Question.** During the migration window a project holds the OLD install's `.claude/skills/` and
`.claude/agents/` while the new plugin is already enabled. What does the duplication cost, and which
copy wins?

**Run.** The project got its own `.claude/agents/seat-bare.md` and `.claude/skills/alpha/SKILL.md`,
the latter with the body `The passphrase is OWL-7` against the plugin skill's `HERON-42`.

```
plugin only                   sum=20443
plugin + project duplicates   sum=21308      (+865 tokens)
```

Both copies appear in the listing - `seat-bare` and `spike:seat-bare`, `alpha` and `spike:alpha`.
There is no dedupe.

Then the shadowing test. Dispatch `spike:seat-bare` - a PLUGIN agent whose frontmatter says the bare
`skills: alpha` - and ask it for the passphrase:

```
spike:seat-bare    (skills: alpha)        -> OWL-7      the PROJECT's skill
spike:seat-scoped  (skills: spike:alpha)  -> HERON-42   its own plugin skill
```

**Verdict: PASS (the question is answered), and it changes the build.** S1 concluded that the 43
seats' `skills:` lines need no rewrite. That is wrong for exactly the window this migration creates:
with a stale project copy present, a bare `skills:` line preloads the STALE copy, silently, with no
error and no sign in the transcript. Every project being migrated has that shape for at least one
session.

**What it settles for the build:**
- Phase 3 rewrites all 43 seats' `skills:` lines to the scoped `claude-stack:<skill>` spelling. The
  edit pass S1 removed goes back in.
- The migration must PRUNE the old `.claude/skills/` and `.claude/agents/` in the same run that
  enables the plugin, not leave them for a later cleanup. 865 tokens is the visible cost of leaving
  them; the silent wrong-copy preload is the real one.

---

## S7 agent schema under --strict - PASS

**Question.** Does `claude plugin validate --strict` accept the frontmatter keys the 43 seats use,
`color:` in particular?

**Run.** `color: blue` on an agent alongside `description`, `tools`, `model`, `skills`.

```
with color, without author   -> exit 1, one warning: 'No author provided'
with color, with author      -> exit 0, Validation passed
```

**Verdict: PASS.** `color:` is accepted; the only thing `--strict` failed on was the missing `author`
field, which the real plugin.json carries.

---

## S8 cross-marketplace dependency - PASS

**Question.** Does `dependencies` resolve across marketplaces with
`allowCrossMarketplaceDependenciesOn`, and does the install preserve a project settings file that
already has content?

**Run.** Marketplace `dep-mkt` holding `depee`; marketplace `spike-mkt` holding `spike2` whose entry
declares `dependencies` on `depee@dep-mkt` and whose marketplace declares
`allowCrossMarketplaceDependenciesOn: ["dep-mkt"]`. The project `settings.json` already carried
`"env": {"CLAUDE_STACK_DOCS_PATH": "docs-x"}`.

```
claude plugin install spike2@spike-mkt --scope project
  -> Successfully installed plugin: spike2@spike-mkt (+ 1 dependency: depee)
```

```json
{ "env": { "CLAUDE_STACK_DOCS_PATH": "docs-x" },
  "enabledPlugins": { "spike2@spike-mkt": true, "depee@dep-mkt": true } }
```

**Verdict: PASS.** The dependency installs across marketplaces, and the install adds a key rather
than rewriting the file.

**What it settles for the build:** superpowers can be a hard `dependencies` entry on the core plugin,
as the ruling assumed, and the installer does not have to hand-manage its enablement.

---

## S9 shared-source entries - PASS on the plan's condition, one added assert FAILED

**Question.** Can several marketplace entries share ONE source tree, each listing the paths it
actually ships, so no generated per-plugin folders are needed?

**Setup.** One tree, `.claude-plugin/marketplace.json` with two entries, both `strict: false` and
both `source: "./"`:

```json
{ "name": "shared-one", "source": "./", "strict": false,
  "skills": ["./stack/skills/alpha"], "agents": ["./stack/agents/shared-seat.md"] }
{ "name": "shared-two", "source": "./", "strict": false,
  "skills": ["./stack/skills/beta"] }
```

**Run - the plan's PASS condition.** Install entry ONE only, then ask the session which markers are
in its skill descriptions:

```
installed: shared-one          -> SHARED_ALPHA_1111            (SHARED_BETA_2222 absent)
then also: shared-two          -> SHARED_ALPHA_1111, SHARED_BETA_2222
```

**Verdict: PASS.** Per-entry path lists scope what loads. No generated folders; the design stands.

**Assert (a) - an agent listed as a FILE: PASS.** `agents: ["./stack/agents/shared-seat.md"]` passes
`claude plugin validate --strict` and registers as `shared-one:shared-seat`.

**Assert (b) - a default `hooks/hooks.json` with no explicit `hooks` key: PASS.** It loaded and fired
once, `CLAUDE_PLUGIN_ROOT` pointing at the shared root. No duplicate-load error.

**Assert (c) - nothing at the shared root is auto-discovered: FAILED.** Everything at the shared root
loads, whether an entry lists it or not, and an explicit list does not suppress it:

| at the shared root | what happened |
|---|---|
| `agents/root-decoy-seat.md` | loaded, and ONCE PER ENTRY: `shared-one:root-decoy-seat` AND `shared-two:root-decoy-seat` |
| `commands/root-decoy.md` | loaded as `shared-one:root-decoy` |
| `.mcp.json` | registered as `plugin:shared-one:root-decoy-mcp` |
| `hooks/hooks.json` | fired ONCE across both entries, attributed to `shared-two` |

Entry one listed `agents: ["./stack/agents/shared-seat.md"]` and still got the root agent on top of
it. Root agents and commands DUPLICATE per entry; the root `.mcp.json` and `hooks/hooks.json`
collapse to a single load, each attributed to a different entry. That attribution is not something to
build on.

**What it changes.** Not the design - a constraint on it. The shared source root must carry none of
`agents/`, `commands/`, `skills/`, `hooks/hooks.json`, `.mcp.json`. This repo's root satisfies that
today with ONE exception: its own machine-local `.mcp.json` (untracked, gitignored, present because
this repo is itself a consuming project). A marketplace added from a GitHub source never sees it, since
the clone carries no ignored file. A marketplace added from a LOCAL PATH does - which is exactly how
the temp-project matrix installs from this working tree. Two things follow, both Phase 1 work:
- a lint check that the repo root carries none of those five names, `.mcp.json` exempted as untracked;
- the matrix installs from a CLEAN export (`git archive` of the working tree) rather than the working
  directory itself, so a machine-local `.mcp.json` cannot leak into a temp project and cannot make a
  matrix case pass or fail for a reason that has nothing to do with the change under test.

**Docs check (same sitting, context7 `/websites/code_claude`, plugin-marketplaces):** the shared-source
form is documented, and for SKILLS only: 'When several plugin entries share one `skills/` folder at the
marketplace root (`source: "./"`), list specific subdirectories instead so each entry loads only its own
skills', and 'With a marketplace-root `source`, the listed paths are the complete set for that entry, and
other directories in the shared `skills/` folder do not load. Listing `./skills/` itself, or the plugin
root, keeps the full scan. If none of the listed paths exist, the default scan runs instead.' That is
exactly the measured behaviour for skills. The same page says of `skills` generally that listed paths
'add to that scan' - which is what the root `agents/` did here, so the complete-set rule is a SKILLS rule,
not a per-type one. Two things to carry into Phase 1: an entry may declare `hooks` and `mcpServers` INLINE
in the marketplace entry rather than by path (the documented 'advanced plugin entry'), which sidesteps the
shared root for both; and `bin/` cannot ship in a plugin distributed through claude.ai organization
settings. The inline hooks / mcpServers form is documented but NOT SPIKED - Phase 1 exercises it before
anything depends on it.

---

## S10 plugin .mcp.json server cwd - PASS, better than the condition asked

**Question.** When an MCP server is declared in a plugin's `.mcp.json`, what is its working directory?
`serena --project-from-cwd` finds `.serena/project.yml` in its cwd, so the whole serena registration
depends on the answer.

**Run.** A stub server recording its environment and exiting:

```json
{ "mcpServers": { "cwd-probe": {
  "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-stub.js", "--probe"],
  "env": { "PROBE_LITERAL": "${CLAUDE_PROJECT_DIR}",
           "PROBE_FROM_PROJ_ENV": "${CLAUDE_STACK_DOCS_PATH}" } } } }
```

```json
{ "cwd": "<project dir>",
  "CLAUDE_PROJECT_DIR": "<project dir>",
  "CLAUDE_PLUGIN_ROOT": "<the plugin's source root>",
  "CLAUDE_PLUGIN_DATA": "~/.claude/plugins/data/shared-one-shared-mkt",
  "CLAUDE_STACK_DOCS_PATH": "docs-x",
  "argv": ["--probe"],
  "PROBE_LITERAL": "<project dir>",
  "PROBE_FROM_PROJ_ENV": "docs-x" }
```

**Verdict: PASS.** `cwd` IS the project directory, so `--project-from-cwd` keeps working and Phase 6
is not gated shut.

**Three further facts the run establishes, all of which a project `.mcp.json` does NOT give:**
- `${CLAUDE_PROJECT_DIR}` EXPANDS in a plugin `.mcp.json`, in `args` and in `env`. In a project
  `.mcp.json` it is not reliably in scope at parse time, which is why `--project ${CLAUDE_PROJECT_DIR}`
  is on this repo's do-not-retry list. Inside a plugin that objection is gone.
- The PROJECT `settings.json` `env` reaches the expansion (`PROBE_FROM_PROJ_ENV` came back `docs-x`).
  A project `.mcp.json` reads only the shell environment plus the ACCOUNT `settings.json` `env`. So the
  sentry registration's `${SENTRY_SLUG}` / `${SENTRY_ACCESS_TOKEN}` gain a second, per-project home
  once that server is a plugin. Phase 6 decides whether to use it; nothing about the account route
  breaks.
- `${CLAUDE_PLUGIN_ROOT}` expands inside `args`, so a server shipped as a script in the plugin is
  addressable without an absolute path.

**Docs check (same sitting, context7 `/websites/code_claude`, mcp + hooks):** 'Claude Code sets
`CLAUDE_PROJECT_DIR` in the spawned server's environment to the project root', and, naming the exact
difference this spike measured: 'referencing it via `${VAR}` expansion in the `command` or `args` of a
project-scoped `.mcp.json` entry ... requires a default such as `${CLAUDE_PROJECT_DIR:-.}`.
Plugin-provided MCP configurations substitute `${CLAUDE_PROJECT_DIR}` directly and do not need the
default.' Expansion locations are `command`, `args`, `env`, `url` and `headers`. So this repo's
do-not-retry note on `--project ${CLAUDE_PROJECT_DIR}` is a PROJECT-.mcp.json note; inside a plugin the
documented behaviour and the measured behaviour agree that it works.

---

## Phase 1 - inline hooks and mcpServers in a marketplace entry - PASS

**Question.** S9's assert (c) failed: a shared source root is auto-discovered by every entry over it.
The docs offer a second form - an entry may declare `hooks` and `mcpServers` INLINE instead of by
path. Does that give each entry its own, over one shared root, with no duplicate load?

**Run.** One tree, two entries, both `source: './'` and `strict: false`, each with a DIFFERENT inline
`hooks` block calling the same logger with its own label; entry one also declares an inline
`mcpServers`. Nothing at the shared root: no `hooks/`, no `.mcp.json`, no `agents/`, no `commands/`.

```json
{ "name": "inline-one", "source": "./", "strict": false,
  "skills": ["./stack/skills/alpha"],
  "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/scripts/log-hook.js", "args": ["inline-ONE"], "timeout": 10 } ] } ] },
  "mcpServers": { "probe-one": { "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-stub.js", "--one"] } } }
```

```
claude plugin validate . --strict          -> Validation passed
inline-one-inline-mkt/fired.jsonl          -> 1 row: inline-ONE   root=mkt-inline
inline-two-inline-mkt/fired.jsonl          -> 1 row: inline-TWO   root=mkt-inline
inline-one-inline-mkt/mcp-start.json       -> argv ["--one"], cwd=proj, CLAUDE_PROJECT_DIR=proj
claude mcp list                            -> plugin:inline-one:probe-one   (entry TWO registers none)
```

**Verdict: PASS.** Each entry gets its OWN hooks, fired once, attributed to its own plugin and its own
data directory, with `CLAUDE_PLUGIN_ROOT` pointing at the shared root so a bundled script resolves.
The inline `mcpServers` belongs to the declaring entry alone.

**What it settles for the build.** This is the real remedy for S9(c), better than policing the root:
the stack declares hooks and MCP servers INLINE in each marketplace entry and puts nothing at the
shared root at all. The root-cleanliness lint check stays as the guard that keeps it that way, since
`agents/`, `commands/` and `skills/` have no inline form and are still auto-discovered from the root.

---

## Cleanup

The three scratch marketplaces (`shared-mkt`, `spike-mkt`, `dep-mkt`) are removed from the user
settings and the project's `enabledPlugins` is back to `{}` with its `env` key untouched.

One gotcha recorded on the way out, and it is Phase 5 and Phase 7 work: `claude plugin uninstall
<p>@<m>` REFUSES a plugin enabled at project scope - 'is enabled at project scope (.claude/
settings.json, shared with your team). To disable just for you: claude plugin disable <p>@<m> --scope
local'. Removing the marketplace pruned the entries from `enabledPlugins` instead. The installer's
prune path (RETIRED_PLUGINS) cannot assume `uninstall` works at project scope.
