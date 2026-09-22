# CLAUDE.md - claude-stack repo

## What this repo is

The single source of truth for the **Claude Code** half of the house coding-agent setup - not an
application. It holds what is applied to *other* projects: house-style skills, the base instruction
template, hook scripts, convention rules, agents, and the installer that wires skills / MCP servers /
plugins into each project. The **Cursor** twin lives in
[`cursor-stack`](https://github.com/envoydev/cursor-stack), a sibling with its OWN skills, agents and
installers (it does not clone this repo, and its lists may diverge - e.g. it ships no `plugin-authoring`).
A change that maps to Cursor is mirrored there in the same sitting; each repo lints its own
`.sh`/`.ps1` twins. Consuming projects pull from here; a
change made only inside a consuming project is throwaway.

**The goal every change serves: Sonnet at high / xhigh effort, run through this stack, does better
work than Opus at high effort without it.** Skills, rules, hooks, agents, docs structures and scripts
exist to close that gap - pre-digested context, deterministic scripts and hooks doing the navigation
and checking, small pushed slices instead of broad reads. Judge every design by that yardstick: does
it make Sonnet more correct, cheaper or more reliable? A feature that only pays off on Opus, or needs
the model to infer what a script could state, works against the goal. Prove it like any behavioral
change (see the invariants below).

## Layout - one home per concern

- `stack/skills/` - the house-style skills (`SKILL.md` each), auto-activating on their keywords /
  file types. Carried by the per-stack PLUGINS: an install enables the plugins its own picks live
  in (`scripts/selection-plugins.js` over the same placement the entries are generated from), and
  only the EXTRAS - the items no stack's closure reaches - are still copied into `.claude/skills`.
  `CLAUDE_STACK_SKILLS_VIA_PLUGIN=false` restores the 0.2.x copy route unchanged.
- `scripts/os/claude-stack.{sh,ps1}` - the installer twins (Unix / Windows); `docs/claude-stack.html`
  is the browser inventory.
- `stack/CLAUDE.template.md` - the stack-neutral per-project skeleton a consuming project's
  `CLAUDE.md` is filled in from. Conventions ship separately in `stack/rules/baseline-*.md`.
- `stack/hooks/` - thirteen hooks, shipped as the `claude-stack-hooks` plugin entry: the installers
  register the stack marketplace and enable it, and NOTHING is copied or wired per project except the
  two engines (`docs.js`, `memory.js`) and `model-windows.json`, which stay in `.claude/hooks/` because
  22 bodies shared with cursor-stack run `node .claude/hooks/docs.js`. The entry is GENERATED from the
  installer's own `HOOKS_CATALOG` (`build-marketplace.js --hooks-entry`, lint check 48), so one table
  owns the wiring; every hook carries `"timeout": 10` there (a hook with no timeout gets Claude Code's
  600s default). `CLAUDE_STACK_HOOKS_VIA_PLUGIN=false` restores the 0.2.x copy route unchanged, and
  the walk's hooks layer now writes the rows it did NOT pick into `CLAUDE_STACK_HOOKS_OFF` instead of
  leaving files out. Both gates live in `hook-prelude.js`, never inlined thirteen times: the csv
  opt-out, and the migration window where the plugin copy stands down while a project still wires its
  copied twin (fail-open - a hook that cannot read the settings file runs).
  Every guard appends one row per BLOCK to `<docs-path>/hook-blocks/<session>.jsonl`
  (`analyze-usage.js --hook-blocks` tallies it) - the block RATE is what says a gate earns its keep.
  A denial that needs the user's decision ends in ONE AskUserQuestion, and an 'allow' answer is
  honoured through a `<docs-path>/flow/*-ALLOW` receipt (this session's own, under 8h).
  - `guard-protected-force-push.js` - blocks force-push to protected branches.
  - `guard-catastrophic-rm.js` (PreToolUse `Bash`) - a recursive `rm` of an unrecoverable target, and
    `git checkout --` / `restore` / `reset --hard` / `clean -f` only when the PATHSPEC the command names
    is dirty (not the whole tree). A 'discard it' answer is honoured via `<docs-path>/flow/DISCARD-ALLOW`.
  - `guard-read-whole-file.js` (PreToolUse `Read` + `Bash`) - blocks whole-file dumps (also through the
    shell, any oversized file, a sweep over `.md` files). An unexpanded `$VAR` target is not judged; a
    leading `cd` moves the anchor; a counting expression is not a dump. Every denial carries the
    `ToolSearch select:` line that loads the serena tools.
  - `guard-secret-value.js` (PreToolUse `Read` + `Bash`) - credentials are read for PRESENCE, never
    value. Judged by file CONTENT (a JSON/dotenv file holding a `secret_key_pattern` key with a live
    value). On the shell route the dump / `echo $SECRET` / bare `env` are REWRITTEN via
    `hookSpecificOutput.updatedInput` to redacted forms (`--redacted <file>`, `--redacted-env`); the
    Read tool and a credential literal stay blocked. A rewrite drops the rest of the command, so one
    carrying a CHANGING step (an edit, a redirect, a build) is blocked instead; a filtering read (`grep`,
    `jq .path`, `head`) keeps its filter over the view. A connection-string / URL password and a PEM
    private key count as credentials whatever the key. `--presence <file> [KEY ...]` is the sanctioned
    one-key read. 'Show' is honoured through the `<docs-path>/flow/SECRET-READ-ALLOW` receipt. The four
    account-settings `permissions.deny` entries written until 0.2.62 are retired and dropped every run.
  - `guard-unapproved-dispatch.js` (PreToolUse `Task|Agent`) - blocks an `*-implementer` dispatch
    without the `<docs-path>/flow/APPROVAL` gate file (written on explicit approval or an AUTO waiver),
    blocks a generic `general-purpose`/`claude` dispatch while that stamp is live (stamps older than 8h
    or the session are absent), and blocks an `Explore`/generic dispatch asking a SYMBOL question.
  - `guard-ungated-commit.js` (PreToolUse `Bash`) - blocks a non-trivial `git commit` without the
    `<docs-path>/flow/COMMIT-GATE` receipt, and `git push` / `gh pr merge` without `PUSH-GATE`. A dry
    run or a branch level with upstream is never gated; `CLAUDE_STACK_PUSH_GATE=0` turns the push half off.
    A PUSH-GATE receipt spanning more than one MANIFEST-owning directory needs a `scope:` line naming
    what the probe actually ran (a plain top-level folder is no project, so an ordinary repo never asks).
  - `guard-stop-contract.js` (`Stop` + `SubagentStop`, plus an INJECTION-ONLY PreToolUse `AskUserQuestion`
    branch that never denies) - blocks a turn ending on a decision-shaped question in prose, or a 'done, next step
    pending' close; holds ONCE a subagent that stops on a wait nobody will end ('I'll wait for...' or its own
    ScheduleWakeup) with no background work of its own - a fork read its parent's pending fork as its own; a close saying the RUN has nothing pending (the pinned line in shared-rules.json) is
    finished. Credential branch: asks for rotation ONCE per exposure (`CLAUDE_STACK_ROTATE_ASK=0` off).
    Fresh-session offer on a clean close past the window's ABSOLUTE trigger:
    `CLAUDE_STACK_FRESH_SESSION_200K` (default 150000), `_1M` (400000), `_DEFAULT` (180000, any other or
    unreadable window); `0` switches that case off; seeded absent-only. The window comes from ONE table (the session
    model's row in the shipped `model-windows.json`, else `CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW`, seeded 1000000; no id
    suffix, carry or compaction is read), never declared - `CLAUDE_STACK_FRESH_SESSION_PCT`, `CLAUDE_STACK_CONTEXT_WINDOW` and the
    seeding of `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` are retired. A trigger at or above its window is clamped
    inside it, and `_DEFAULT` must stay below the smallest window it can land on. The offer fires only
    when a resume recovers something (carry minus the session's first-message floor >= 40% of carry),
    re-arms at 1.5x growth, and never mid-response. A long-idle or long-span session takes the same
    offer under the window (`CLAUDE_STACK_FRESH_SESSION_AFTER_HOURS`, default 2, unseeded, `0` off).
  - `guard-fresh-session-start.js` - denies the MODEL's own PreToolUse `Skill` call on a
    `disable-model-invocation` skill (read from its frontmatter; the user's slash turn is untouched), and
    offers a fresh session before a deliberate orchestration run (capture, loop, solve flow, review,
    guided walk) when the context is past the window trigger OR (slash route only) this session already
    TYPED a run - a Skill call is a phase of a run in flight, and harness-written user rows are no turn. Routes:
    PreToolUse `Skill` BLOCKS; `UserPromptSubmit` INJECTS for slash-invoked runs (never denies - that
    would erase the prompt); `SessionStart` matcher `compact` injects the ask plus two lines: answer in
    the language of the user's prompts, and re-read a live plan file's header first.
  - `guard-cross-project-write.js` (PreToolUse `Write`/`Edit`/`NotebookEdit`/`Bash`) - a write outside
    the project root is blocked (file tools and shell routes: redirection, `tee`, in-place `sed`/`perl`,
    `cp`/`mv` destination, `rm`/`mkdir`/`chmod`, `git -C <other>` mutating, `cd <other>` then a write);
    the change goes to a task card under `<docs-path>/cross-project-tasks/`. Reading stays open. Session
    scratch, `~/.claude` / `~/.claude-<space>` and `/dev` stay writable; paths compared as REAL paths; a
    Git Bash mount path (`/c/...`, `/cygdrive/c/...`) is translated first (the same regex is inlined in
    four hooks, pinned as `gitbash-mount-path`). 'Allow' is honoured through the
    `<docs-path>/flow/CROSS-WRITE-ALLOW` receipt; `CLAUDE_STACK_ALLOW_WRITE_OUTSIDE` opens a second
    tree permanently. Also carries the log-only fork-liveness PROBE (`mode: probe` rows, denies nothing).
  - `guard-answer-length.js` (`UserPromptSubmit` + `Stop`) - injects the answer budget every turn; the
    Stop half blocks prose past 1800 chars when the user asked for no depth, and blocks an em-dash in
    prose at any length. After the third consecutive short correction following a long answer it injects
    the format ask (injection only).
  - `instrument-tool-usage.js` - wired env-gated: skipped unless `CLAUDE_STACK_INSTRUMENT` (seeded "0")
    is "1".
  - `docs-session.js` (`SessionStart`, `SubagentStart`, `SubagentStop`, PreToolUse on Read/Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell/Grep/Glob, `Stop`) with its engine `docs.js` (copied beside it, not wired) - every docs DOMAIN (a top-level folder under the docs root holding a `watch.json`, plus the grandfathered `architecture/`) follows the branch, and HOW is declared at install time in `CLAUDE_STACK_DOCS_VERSIONING` (`--docs-versioning` / `-DocsVersioning` writes it; absent, it is seeded - and the engine falls back - by ONE rule in four homes, the two installer seeds, `stamp-docs-root.js` and `docs.js`, pinned together by one table-driven test: `local` only when the docs are kept out of git - no domain tracked, and a domain exists or git ignores the docs root - else `git`, a fresh project included): `git` means the docs are committed and git versions them per branch, `local` means per-branch section overlays under `<docs-path>/.branches/`, folded into mainline at the first mainline session after the branch merges. The setting WINS over what the repo does, and a disagreement is reported in `status` and the start block rather than resolved the other way. The start block pushes `ORIENTATION.md` (4KB cap); the first change under a source root waits for a section read (two holds, then a logged bypass); the FINISH ask fires only when a changed file hits the capture's `watch.json` - at `SubagentStop` for what that agent WROTE (a tool event carries `agent_id` only inside a subagent, so every write is attributed to its actor - the main session included, under one key of its own - and intersected with the tree diff; a read-only seat running beside a writer is never asked, a write the gate DENIED is never credited, and paths are compared in git's spelling on every platform), then once at `Stop` for what the session wrote itself plus every change no actor claimed (a script's output, a tool this hook is not wired on), both in the same shape: the section named, its file, its current FIRST SENTENCE quoted, and a `set ... --expect <hash>` that refuses a rewrite of a section another agent moved meanwhile. `CLAUDE_STACK_DOCS_BLOCK` / `_GATE` / `_ASK` = `0` switch the parts off.
  - `memory-session.js` (`SessionStart`) with its engine `memory.js` (copied beside it, not wired -
    the `docs.js` pattern) - reads the shared memory database FILE directly (`node:sqlite`, no
    server, no model call) and injects this project's memories plus every `preference` /
    `correction` carrying no project tag, newest first, capped at 4KB like the docs start block; a
    related-projects domain adds those projects' memories too, inside the same cap. `node
    .claude/hooks/memory.js level [projectRoot]` is the same engine's CLI, read by `validate` and
    `status` (`<level> <dbPath>`, or `none`). Fail-open: a missing database, a locked file, or
    `node:sqlite` unavailable on this Node injects nothing, and never logs - a silent SessionStart
    is never reported as a failure.
  The guided walk's hooks layer makes them selectable (a selection with no `hook` lines installs all).
- `stack/agents/` - 43 Claude-contract subagents, copied into `.claude/agents/`:
  - resolvers: `dotnet-build-error-resolver`, `dotnet-test-failure-resolver`, `ng-build-error-resolver`,
    `angular-test-resolver`;
  - cross-cutting: `ci-failure-diagnoser`, `runtime-failure-diagnoser`, `security-auditor` (read-only
    OWASP/CWE posture audit), `integration-reviewer` (mandatory read-only cross-domain final gate
    against the frozen contract);
  - 30 per-domain seats - `<stack>-solution-designer` -> `<stack>-implementer` -> `<stack>-verifier`
    across 10 stacks (ASP.NET, web Angular, WPF, WinForms, console, Windows Service, Ionic Angular, data,
    DevOps, browser extension);
  - five read-only sonnet support seats: `evidence-gatherer`, `test-coverage-analyzer`,
    `architecture-analyzer`, `code-style-analyzer`, `related-project-analyzer`.
  Pins: resolvers `sonnet`/`high`, designers `opus`/`xhigh`, verifiers `sonnet`/`xhigh`, implementers
  `sonnet`/`medium`, support seats `sonnet`. The architecture capture is deliberate-only (the
  `project-architecture-analyzer` skill writes `<docs-path>/architecture/ARCHITECTURE.md` and
  `baseline-project-architecture.md`; the findings split out to `project-architecture-quality-analyzer`,
  which writes `<docs-path>/quality/ASSESSMENT.md`; never in a build flow).
  `project-solve-cross-task` is the single entry-point orchestrator (single-stack vertical per
  `references/domain-trio-protocol.md`; cross-domain runs freeze the contract and end at
  `integration-reviewer`). cursor-stack ships adapted twins of all 43 - a protocol change here usually
  needs the same edit there (divergences only: `model: inherit`, no `tools:` allowlist, `superpowers`
  optional, no auto-delegation hard-disable).
- `stack/rules/` - nineteen single-job rules copied into `.claude/rules/`. Seven always-on `baseline-*.md`
  (no `paths:`): interaction, quality-gates, security, git (the commit checkpoint itself is the
  `project-commit-checkpoint` skill), navigation, docs-root (`CLAUDE_STACK_DOCS_PATH` is the ONLY lever;
  installers stamp its value over `__DOCS_ROOT__` on every install/update, setup/configure re-stamp),
  memory (what belongs in the shared `memory` MCP, when to save it, and to search before asking or
  reading - locks the server in the way `baseline-navigation` locks serena).
  Skill/agent usage policy + MCP routing live in the GENERATED `baseline-project-agent-capabilities.md`.
  Twelve path-scoped: `markdown-docs.md`, the repair routers (`dotnet-repair-agents.md`,
  `angular-repair-agents.md`) and nine convention rules, each glob-attaching ONE file family to its
  house-style skill. Every convention rule uses the imperative form pinned as
  `convention-rule-first-action` in shared-rules.json - a new one copies that form, never paraphrases it.
- `setup-plugin/` - the claude-stack plugin: five COMMANDS and one router SKILL.
  - `/claude-stack:setup` (fresh install), `/claude-stack:update` (no-questions refresh + prune from the
    stamp compare), `/claude-stack:configure` (add or drop), `/claude-stack:status` (read-only tables plus
    the install's always-on FLOOR), `/claude-stack:validate` (project-relative two-way reconcile via
    `stack-select.js --redundant` / `--missing` / `--evidence-gaps`, plus the settings.json `env` layer
    against `environment.json`).
  - The script route prunes only names in the installers' RETIRED_SKILLS / RETIRED_AGENTS /
    RETIRED_RULES / RETIRED_HOOKS / RETIRED_MCPS / RETIRED_PLUGINS lists - extend BOTH twins' lists when
    any of the six is renamed or removed (a stamp compare only names what left after the stamped commit).
    A retired pathless rule, hook wiring, MCP registration or plugin keeps costing every session until
    pruned. A shipped-but-unneeded server or plugin is validate's whole-stack-absent pass, not a retirement.
  - The `/claude-stack` router is a SKILL and the workers are COMMANDS on purpose (commands list
    namespaced, skills list bare) - do not convert either back.
  - Table before question: `hooks/guard-layer-table.js` (PreToolUse `AskUserQuestion`) denies an ask
    (up to 3 times per table) whose decision table was run but never pasted - a `stack-select.js
    --table` catalog or the `plugin-settings.js` report. It ships in the plugin because a fresh setup
    has no stack hooks yet; the rule text is pinned as `table-before-question`.
  - None of the five carries `allowed-tools` - settled: it is a per-turn permission pre-approval, not a
    restriction or a context saving.
- `meta/` - never installed:
  - `shared-rules.json` pins every deliberate multi-home rule (owner + marker-pinned copies); the lint
    goes red when a copy's marker breaks.
  - `stack-graph.json` - generated dependency graph read by `stack-select.js`; regenerate with
    `npm run graph` (lint fails when stale).
  - `plugin-entries.json` - the GENERATED marketplace `plugins[]`, computed by
    `scripts/build-marketplace.js` from the placement rule in `scripts/plugin-placement.js`: an item
    goes to the plugin named for the SET of stacks whose closure reaches it, so a project enables
    exactly its own closure (`docs/plugin-placement-cost.md` is the committed gate evidence, +0% on
    every combination). Regenerate with `npm run marketplace`; lint checks 44 and 45 fail when either
    file is stale or a combination goes past +10%. A new shared set needs a NAME in `GROUP_NAMES`,
    never a generated slug.
  - `environment.json` - the ONE list of settings.json `env` values the stack owns; adding a variable is
    one row plus the two installer seeds (lint-checked).
  - `recommendations.json` - seeds + the never-flag `general` list (project-conditional opt-ins, e.g.
    `project-related-context` / `related-project-analyzer`: addable, never seeded or re-added).
  - `evidence.json` - need-signals `scripts/scan-evidence.js` matches against manifests; evidence rows
    arrive pre-selected, absence is advisory, evidence never creates a `required` lock.
  - `plugin-settings.json` - recommended config for INSTALLED plugins, applied by
    `scripts/plugin-settings.js`: walks report and ask in the plugins layer turn, apply after install;
    add-only by default (`--replace` overwrites); each row names the verified plugin VERSION (lint 28).
  - `judgment.json`, `migrations.json` - existence-detected retirements of GENERATED artifacts plus the
    `env` RENAMES the env pass applies every run (order pinned as `env-pass-order`). A renamed key is read
    under its old spelling as fallback until every install has it (e.g. `CLAUDE_STACK_DOCS_PATH`,
    ex-`CLAUDE_DOCS_PATH`).
  Commands reach `meta/` through the run's snapshot (`$TMP/repo/meta/`), never `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/lint-skills.js` - the parity lint. `scripts/analyze-usage.js` - offline token/tool report over
  a session transcript (+ `subagents/`), with an EFFICIENCY scorecard (one measured number per practice);
  it reads `PowerShell` as a shell route, writes with `--out <file>` (never a `>` redirect), and
  `--check-report <file>` re-reads a finished report, printing every judgment number that cites no
  machine row of that same report. `scripts/scan-evidence.js` - deterministic manifest-only
  evidence scan. `README.md` stays compact (headline counts lint-checked; inventories live in the HTML).

## The stack's delivery surfaces

All surfaces come from ONE source snapshot per run, so an install is a single revision (the one
`claude-stack.stamp` records).

| Surface | Delivery |
|---|---|
| Skills | the project's own plugin closure (`claude-stack@claude-stack` + its per-stack entries), computed by `selection-plugins.js`; only the EXTRAS are copied to `.claude/skills` |
| MCP | `claude mcp add` -> `<repo>/.mcp.json`, then VERIFIED against the manifest shape and rewritten on drift |
| Plugins | 6 third-party via `claude plugin install` (superpowers, claude-md-management, the `*-lsp` pair, security-guidance, claude-hud) plus the stack's own `claude-stack-hooks@claude-stack` and this project's skill/agent closure; update installs an absent one, enables a parked one, then updates, at the scope `claude plugin list --json` reports, and reads versions back |
| Hooks | `claude-stack-hooks@claude-stack` plugin (all thirteen, generated from `HOOKS_CATALOG`); only `docs.js` / `memory.js` / `model-windows.json` are copied; instrumentation off via CLAUDE_STACK_INSTRUMENT=0 |
| Agents | the same plugin closure carries the 43 pinned subagents (per-tool `tools:` allowlist); `.claude/agents/` keeps only the extras |
| Install stamp | `claude-stack.stamp` (project `.claude/`, or the account dir for global) - source commit; configure diffs it against `main` |
| Convention gate | nine path-scoped convention rules in `.claude/rules/` |
| Security review | `/security-review` + `security-guidance` hooks + the `security-auditor` agent |
| Project instructions | `CLAUDE.md` (seeded to `.claude/CLAUDE.md`) |
| LSP | `csharp-lsp` / `typescript-lsp` plugins |

Cursor's deliveries live in cursor-stack, whose lists are its own; a change here that maps to Cursor is
mirrored there in the same sitting.

## The model these templates encode

- **MCP servers are per-project, never global.** `serena` (baseline-navigation), `context7`
  (baseline-quality-gates) and `memory` (baseline-memory) are LOCKED into every install and may be
  named in artifacts; every other server is droppable, so a body describes it. Only those three are
  seeded everywhere; the rest arrive by proof - a stack whose surface always has them, an evidence
  signal, or the user's pick. Catalog (8):
  - `playwright` - seeded for web-angular / ionic / extension, evidence-proven elsewhere. One catalog
    entry, expanded after the selection into ONE server per kept browser (`playwright-chrome|msedge|firefox|
    webkit`, each `--browser <engine>` + profile `.playwright/<engine>`; firefox/webkit downloaded via the
    server's bundled playwright). `--playwright-browsers <csv>` / `--playwright-enabled` (setup/configure ask
    both); absent = read back, a legacy `playwright` server migrates. The installer writes NO toggle: it prints
    `/mcp disable` lines, switching is `/mcp` (a server cannot change browser at runtime). Every installed-name
    reader maps `playwright-*` back to `playwright`; the four playwright agents grant all four servers.
  - `angular-cli` - framework-specific.
  - `chrome-devtools`, `appium-mcp` - addable only, seeded by no stack (both fail at launch without
    native deps; appium arrives pre-selected on an `appium` / `@wdio/` / `webdriverio` dependency).
  - `sentry` - hosted remote MCP registered as the CONSTANT `https://mcp.sentry.dev/mcp/${SENTRY_SLUG}`
    with header `Authorization: Sentry-Bearer ${SENTRY_ACCESS_TOKEN}`. Both placeholders stay LITERAL
    and expand from the ACCOUNT settings.json `env` (`~/.claude/settings.json` or the space's) - a
    project `.claude/settings.json` does not reach `.mcp.json` expansion (Cursor: `${env:VAR}` + OS env).
    `SENTRY_SLUG` = org or `org/project` (`--sentry-slug`); the token is added by hand or exported in the
    installer's shell, never through the chat; installers write handed keys (slug, token,
    `CONTEXT7_API_KEY`) to the account file, secrets logged by length. `Sentry-Bearer` is the API-token
    scheme - plain `Bearer` rejects it as `invalid_token`. `--sentry-auth oauth` registers no header (the
    browser consent flow); never mix the modes. Never use `${SENTRY_SLUG:-}` (the trailing slash 404s).
    `update` keeps the auth mode and migrates old plain-`Bearer` registrations. `SENTRY_AUTH_TOKEN` is a
    different credential (sentry-cli uploads).
  - plus `serena`, `context7` and `memory`.
- **`memory` is required like serena and context7**, chosen per install by LEVEL rather than by
  a droppable pick: `global` (`~/.memory-mcp/memory.db`, every Claude account and Cursor on the
  machine - the default for a fresh install), `scoped` (`~/.memory-mcp/memory_<space>.db`,
  `memory_default.db` with no space - one account), `project` (`<project>/.memory-mcp/memory.db`,
  gitignored - this project only). `--memory-level <global|scoped|project>` / `-MemoryLevel` sets
  it; setup and configure ASK it (one AskUserQuestion, the three levels, `global` recommended),
  update passes it only when the invocation names one, changing it re-points the registration and
  never touches the database file. The registration needs the `[sqlite]` extra -
  `mcp-memory-service[sqlite]==<ver>` via `uvx --with numpy --from ...` - because that extra is
  what gives the service real 384-dim embeddings; without it the server refuses to start on a
  database already holding memories. Env: `MCP_MEMORY_STORAGE_BACKEND=sqlite_vec`,
  `MCP_MEMORY_SQLITE_PATH=<db>`, `MCP_MEMORY_SQLITE_PRAGMAS=busy_timeout=15000` (a shared file,
  several writers). Before switching Claude's own memory off, the installer imports the project's
  existing `MEMORY.md` / `memory/*.md` notes into the chosen database once, through the memory
  service itself (idempotent - a re-run imports nothing twice); the switch-off
  (`autoMemoryEnabled: false`) writes to THIS repo's own project `.claude/settings.json` - always,
  even at global scope, never the account file, which would silence every other project's memory
  too - and waits for that import to succeed first: a failed import leaves Claude's own memory ON
  and is reported as such, never retried into a false success, and the old `MEMORY.md` /
  `memory/*.md` files are never deleted either way. A note a PRE-fix registration imported was
  hash-embedded rather than given a real 384-dim embedding, has no re-embed path in the service, and
  so still loads by project tag but may miss a `memory_search` by meaning.
- **serena self-activates via `--project-from-cwd`** (finds `.serena/project.yml` in its cwd). Its
  AUTO-GENERATED config is not a substitute (empty language list filled async, only the top language
  enabled), so the installers SEED `.serena/project.yml` on install and update: project name, the
  `language_servers` their own scan detects (C#, TypeScript/JS), and `ignored_paths` for `.serena` /
  `.claude` / `.playwright`. A key that already has entries is never rewritten, and never appended twice
  (a duplicate YAML key is an error). The key was renamed from `languages` in serena 1.7.0; the C#
  Roslyn server needs .NET 10+ (serena installs it into `SERENA_HOME`). Two approaches FAIL - do not
  retry: (1) an `mcp_tool` `SessionStart` hook calling `activate_project`; (2)
  `--project ${CLAUDE_PROJECT_DIR}`. `.mcp.json` DOES expand `${VAR}` / `${VAR:-default}`, but
  `CLAUDE_PROJECT_DIR` is not reliably in scope at parse time, and expansion reads only the shell
  environment plus the ACCOUNT settings.json `env` (an unset `${VAR}` stays literal with a
  `claude mcp list` warning). Cursor runs serena with `--context ide-assistant`; Claude with `claude-code`.
- **serena state is isolated per project** via `-e SERENA_HOME=.serena/home`; memories live in
  `.serena/memories/`. The whole `.serena/` must be gitignored (LSP cache ~327MB for C#, memories).
- **Three memory stores, don't conflate:** the `memory` MCP is the SHARED memory - preferences,
  corrections, project facts and agent lessons, searchable by meaning, one database per chosen
  level (global/scoped/project) read by every Claude account and Cursor at that level; serena's
  per-project memory (`.serena/memories/`) is the EPHEMERAL handoff bus between agents within one
  feature, never a place for what should outlast it; Claude's own built-in memory (`MEMORY.md` +
  `memory/*.md`) is SWITCHED OFF in every stack install (`autoMemoryEnabled: false`) after a
  one-time import of its existing notes into the `memory` MCP - it has no search and is not shared
  with Cursor, which is why the MCP replaces it rather than sitting beside it. Which repos are
  related lives in the generated `.claude/rules/baseline-project-related-context.md` (the
  `/project-related-context` skill), not memory.
- **Two stores, split by durability** (hard rule). The committed architecture docs
  (`<docs-path>/architecture/ARCHITECTURE.md` + `references/`, owned by
  `project-architecture-analyzer`) are the DURABLE truth every seat reads to orient, refreshed
  deliberately (that skill or `project-architecture-quality-loop`), never after each change. The code
  style lives in `<docs-path>/code-style/CODE-STYLE.md` + the path-scoped `project-code-style.md` rule
  (owned by `project-code-style-analyzer`). The findings (`<docs-path>/quality/ASSESSMENT.md`, owned by
  `project-architecture-quality-analyzer`) are the opposite of durable - recomputed fresh every run, so
  `quality/` carries no `watch.json` and is no docs domain at all. serena memory (`<feature>__<contract_version>__<seat>`,
  never the `memory` MCP) is the EPHEMERAL inter-seat bus; anything that must survive a fresh clone
  belongs in the committed docs.
- **Never `Read` a whole file to find a symbol** (hard rule, both stacks): locate via serena
  (`find_symbol` / `find_referencing_symbols`) or the LSP; `Read` is for code already located.

## Working in THIS repo - invariants

- **`develop` is where work lands; `main` is the release branch.** Merging `develop` -> `main` IS the
  release: the workflow rebuilds the archive and tags `v<version>` from
  `setup-plugin/.claude-plugin/plugin.json`. Bump it (plus `marketplace.json` metadata; lint enforces
  equality) on `develop` with any release-worthy change. Never commit feature work to `main`; keep `main`
  the GitHub default branch. Lint + test workflows gate every push and PR.
- **Public repo.** No private project names or absolute local paths in tracked files.
- **The repo root is a plugin source, so seven names are RESERVED there.** Every marketplace entry
  shares this root as its `source` and lists the paths it ships, but a shared root is auto-discovered
  whatever an entry lists (measured, spike S9c in `docs/plugin-migration-evidence.md`): a root
  `agents/` or `commands/` loads once PER ENTRY, a root `.mcp.json` or `hooks/hooks.json` loads once
  and is attributed to a different entry each time. So `skills/`, `commands/`, `agents/`,
  `hooks/hooks.json`, `monitors/`, `settings.json` and `.lsp.json` never appear at the root (lint
  check 46), and hooks and MCP servers are declared INLINE in each entry instead. `.mcp.json` is the
  one exception, because this repo is also a consuming project: it stays machine-local and
  gitignored, and the temp-project matrix installs from `scripts/clean-export.js` so it cannot leak
  into a case.
- **Parity / source-of-truth.** Changes land in the SOURCE here: `SKILLS` + `MCPS` + `PLUGINS` identical
  across both installer twins (`npm run lint` enforces it, plus the HTML and skill count). A shared
  baseline change is mirrored into cursor-stack in the same sitting. Never patch only a generated
  `.mcp.json` or a consuming project's copy - the installer wipes it.
- **Select a skill by DESCRIPTION, not by name.** Naming works only for a skill guaranteed alongside its
  citer (a frontmatter preload, an own-stack skill). Anything else - a skill no stack seeds, or one from a
  DIFFERENT stack - is described by what it covers. A guard phrase beside the name is not the remedy.
  Lint checks 25 and 26 block a named cite that can be absent; a router hub opts out with an
  `**Availability**` callout. Naming a skill never installs it: `suggests:` is removed (check 27) and the
  graph emits no body-mention edge. Install need is PROVEN via `meta/evidence.json` or a per-stack seed.
- **One home per piece, no duplication.** A deterministic gate -> a hook. A per-file-type convention -> a
  path-scoped rule attaching its skill. A keyword capability -> the skill's description. Cross-cutting
  guidance -> the always-on `baseline-*.md` set (each with an `.mdc` twin in cursor-stack to mirror). The
  base template carries only per-project structure + platform routing. Never state one trigger twice.
- **Prove a behavioral change, don't assert it.** A model / effort pin, routing rule or plugin-set change
  ships only with evidence: run the build + tests yourself and read the code, measure the token delta when
  the claim is about cost, and commit the evidence BEFORE any reset. Verify outside-world claims
  (package, version, API shape, CLI flag) through context7 in the same sitting and cite it.
- **Every change is proven on a TEMP PROJECT before it is committed - MANDATORY, no exceptions.** Unit
  tests and a green `npm run lint` / `npm test` are necessary, never sufficient. Each change or feature
  (installer, hook, command, skill, rule, agent, MCP, manifest - a one-line or prose-only edit included)
  is exercised end to end from THIS working tree (`--source <repo>`) inside throwaway projects created
  under the session scratchpad (or `os.tmpdir()`), never a real consuming project, and removed after.
  - Edge cases are REQUIRED, not optional: a fresh install; an update over an older install; a re-run
    (idempotent - a second run changes nothing); a project holding the user's own config the change must
    not clobber (hand-added MCP server, settings key, hook); missing, empty or malformed input (absent
    file, garbage JSON, unset env); both installer twins (`pwsh` for the `.ps1` when installed, else say
    it was not run); and every boundary the change introduces (at, one under, one over).
  - Read the RESULT, never the exit code alone: open the written `.mcp.json` / `settings.json` / copied
    files and hook output, and assert they are what the change claims.
  - A bug found blocks the commit AND the release: fix it, add a regression test, re-run the whole
    temp-project matrix. A case not run is reported as NOT RUN, never implied as passing. No 'done',
    commit, version bump or `develop` -> `main` merge until the matrix is green and its commands plus
    results are in the report.
- **House voice:** direct, lean, single dashes not em-dashes, single quotes in prose, recommend one
  option with a reason. Lint check 32 sweeps `stack/`, `setup-plugin/`, `meta/` for em-dashes.
- **The always-on surface has a BUDGET.** Lint check 33 sums the pathless `baseline-*.md` bodies plus
  every agent and skill DESCRIPTION and fails over 160,000 chars (109,826 on 2026-09-19: pathless rules 35,452, agent descriptions 28,541, skill descriptions 45,833 - the shared-memory rule and its tool grants added ~2,900). A rule moved into the
  baseline set or a grown description is costed against it. `/claude-stack:status` reports an install's
  own floor.

## Maintenance gotchas

- **`.mcp.json` is registered by the CLI and VERIFIED by the installer - fix the manifest, not the
  output.** `claude mcp add` over an existing name prints 'already exists' and exits 0, so a failed
  `remove` looks like success. `verify_mcps` / `Test-McpRegistrations` read the result back: at project
  scope `.mcp.json` is parsed and drifted entries rewritten (`mcp repaired: <name>`); at user scope the
  shape comes from `claude mcp get`, a mismatch is retried once through the CLI, then reported (the
  account config is never hand-edited). The expected shape is built from the same manifest words; a
  server the project added by hand is never touched. `scripts/mcp-verify.test.js` pins it on both twins.
- Editing a consuming project's installed copy is local-only; mirror it into both installer twins here
  (and into cursor-stack when it touches the shared baseline or a twinned agent/rule).
- **Everything installs from ONE source snapshot** per run (`stack_src` / `Get-StackSrc`): the release
  archive (`releases/latest/download`, with a `RELEASE-SOURCE` file naming commit + version), falling
  back to a shallow clone. A change ships only once merged to `main`; until then the per-file fail-soft
  keeps existing copies. Never reintroduce a raw fetch of a repo-owned file (per-file, stale, mixes
  revisions).
- **One download per RUN.** The plugin commands download the snapshot anyway and pass it with
  `--source` / `-Source`; a borrowed source is never deleted by the script
  (`STACK_SRC_OWNED` / `$script:StackSrcOwned`) - the skills remove their `$TMP` on every exit path.
  Standalone (no `--source`) still fetches and cleans up; keep that path working.
- **One download per RELEASE - the source cache** at `<config>/cache/stack-source/<repo-slug>/<version>`,
  reused when a `HEAD` of `/releases/latest` says that version is newest. Both twins and the guided walks
  write the same layout, so a shape change is a four-site edit (`stack_src`, `Get-StackSrc`, the
  protocol's two snippets). Keyed by VERSION, never time; an entry counts only with `stack/skills` +
  `stack/agents`; a promote drops siblings older than a WEEK, never 'all but current'.
  `STACK_SOURCE_CACHE=0` restores always-fresh; an unwritable cache is never fatal.
- **The marketplace clone** (`<config>/plugins/marketplaces/<name>`) is taken into the cache only when
  its `origin` is this repo AND its plugin manifest carries the exact version the probe named. Exception:
  when archive, probe and clone all failed, it is taken UNVERIFIED (logged, and the stamp names the
  commit). Same four sites; `scripts/source-cache.test.js` covers it.
- **The install is versioned, not the file.** `version:` exists only in plugin.json - a `version:` key on
  a skill/agent/rule is ignored; don't add one. Each run writes `claude-stack.stamp` (source commit +
  release version); configure diffs it via the GitHub compare API. A run whose source never resolved
  writes NO stamp.
- Authoring a skill in `stack/skills/`: superpowers writing-skills is a reference - take its testing
  discipline, subordinate it to the parity lint, HTML + count sync and house voice.
- Skills are shared with Cursor: a skill body stays platform-neutral (conditionals like 'INLINE when no
  dispatch'), never forked per platform.
