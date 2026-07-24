# CLAUDE.md - claude-stack repo

## What this repo is

The single source of truth for the **Claude Code** half of the house coding-agent setup -
not an application. It collects everything applied to *other* projects: the house-style
skills, the base instruction template those projects extend, the hook scripts and
convention rules, and the installer that wires skills / MCP servers / plugins into each
project. The **Cursor** twin stack was split out to its own repo,
[`cursor-stack`](https://github.com/envoydev/cursor-stack) - its installers git-clone THIS
repo for the shared skills, so the skill + MCP baseline stays single-sourced here, and a
baseline change is a TWO-REPO commit (the manifest lists are mirrored there in the same
sitting; each repo lints its own `.sh`/`.ps1` twins). Consuming projects pull from here -
they do not own their copy. Skills install via the installers' one-snapshot download (the
versioned release archive, git-clone fallback; or the claude-stack plugin's
`/claude-stack:setup`); the rest is laid down by the same installers. The durable change always lives in *this* repo's source; a
change made only inside a consuming project is throwaway (see Invariants).

## Layout - one home per concern

- `stack/skills/` - the house-style skills, each a `SKILL.md`. Auto-activate on their own
  keywords / file types in consuming projects. Distributed via the stack installers'
  snapshot-download-and-copy step (or the claude-stack plugin) - including `cursor-stack`'s
  installers, which clone this repo.
- `scripts/os/claude-stack.{sh,ps1}` - the installer twins (Unix / Windows); `docs/claude-stack.html` is the browser inventory.
- `stack/CLAUDE.template.md` - the stack-neutral per-project skeleton (with `<placeholders>`) that each
  consuming project's `CLAUDE.md` is filled in from; the working conventions ship separately in
  the `stack/rules/baseline-*.md` set. Content shipped to projects, not this repo's own file.
- `stack/hooks/` - `guard-protected-force-push.js` + `guard-catastrophic-rm.js` (PreToolUse `Bash`) +
  `guard-read-whole-file.js` (PreToolUse `Read`) + `guard-unapproved-dispatch.js` (PreToolUse
  `Task|Agent` - blocks an `*-implementer` dispatch without the `<docs-path>/flow/APPROVAL` gate
  file the flows write on explicit user approval or an explicit AUTO waiver), all wired; plus
  `instrument-tool-usage.js`,
  installed UNWIRED (opt-in per-run tool/skill/MCP stats via STACK_INSTRUMENT=1 + manual wiring).
  Copied from the run's clone into a project's `.claude/hooks/`; a hooks layer in the guided walk
  makes them selectable per install (a selection with no `hook` lines installs all five).
- `stack/agents/` - the Claude-contract subagents, 42 total: the four build/test resolvers - .NET
    (`dotnet-build-error-resolver`, `dotnet-test-failure-resolver`) + Angular (`ng-build-error-resolver`,
    `angular-test-resolver`) - plus four cross-cutting agents (`ci-failure-diagnoser`, `issue-diagnoser`, `security-auditor` - a read-only
    cross-stack security posture audit that routes an OWASP/CWE punch-list to the implementers, complementing
    `/security-review` - and `integration-reviewer`, the mandatory read-only cross-domain final gate that
    checks the assembled feature against the frozen contract before commit) - plus
    30 per-domain seats, the same 3-agent vertical repeated across 10 stacks (ASP.NET, web Angular, WPF, WinForms,
    console, Windows Service, Ionic Angular, data, DevOps, browser extension - the five C# verticals split by surface: ASP.NET web/API,
    WPF desktop, WinForms desktop LOB, console the headless Generic-Host worker/bot/daemon/CLI, windows-service the SCM-hosted
    worker; the three TypeScript verticals by runtime surface: Angular web, Ionic/Capacitor mobile, MV3 browser extension): `<stack>-solution-designer` (decomposes into parallel tasks) → `<stack>-implementer`
    (builds one task, code + tests) → `<stack>-verifier` (gates the assembled build vs plan + quality,
    punch-list loop) - plus four read-only sonnet support seats: `evidence-gatherer` (sonnet/low - the two
    diagnosers dispatch it to reproduce and pull logs), `code-analyzer` (sonnet/low - the
    `project-architecture-analyzer` capture fans it out to characterize modules) and `code-style-analyzer` (sonnet/medium - the read-only
    per-language style characterizer the `project-code-style-analyzer` skill fans out and merges into
    `<docs-path>/PROJECT-CODE-STYLE.md` + the generated inject-code-style hook) and `related-project-analyzer` (sonnet/medium -
    characterizes one sibling repo, the `project-related-context` skill fans it out and merges
    `<docs-path>/PROJECT-RELATED-CONTEXT.md`), each keeping read volume off the opus seat.
    the architecture capture is deliberate-only (the `project-architecture-analyzer` skill - dispatches
    `code-analyzer` per module, reasons in the main session, writes `<docs-path>/architecture/ARCHITECTURE.md` +
    the pros/cons `<docs-path>/architecture/ASSESSMENT.md` + the generated always-on awareness rule
    `baseline-project-architecture.md`; never in a build flow); the per-change fit
    verdict moved to the domain solution-designers. The `project-solve-cross-task` skill is the single
    entry-point orchestrator - it picks the execution mode, runs a single stack's vertical per its
    `references/domain-trio-protocol.md` (main-stack-agents-flow was folded into that reference),
    and for cross-domain work freezes the shared contract and drives the parallel
    per-stack runs through the `integration-reviewer` final gate. All 42 carry
    frontmatter model/effort pins (resolvers `sonnet`/`high`, designers `opus`/`xhigh`, verifiers
    `sonnet`/`xhigh`, implementers `sonnet`/`medium`, the four support seats `sonnet`). Copied from
    the run's clone into a project's `.claude/agents/`. The `cursor-stack` repo ships adapted twins of all 42 - a
    protocol change to an agent here usually needs the same edit to its twin there (the deliberate
    divergences are only the platform gaps, listed in that repo's CLAUDE.md: `model: inherit`, no
    per-tool `tools:` allowlist, `superpowers` optional, no auto-delegation hard-disable).
- `stack/rules/` - eighteen rules, fetched into a project's `.claude/rules/`, each doing ONE job. Six
    are the always-on `baseline-*.md` set (no `paths:` - the cross-project working conventions grouped
    by exclusion affinity: interaction (communication + proposal review + planning), quality-gates
    (code quality + definition of done), security, git + pre-commit, navigation, docs-root (the
    generated-docs root - `CLAUDE_DOCS_PATH` resolution, what lives under `<docs-path>`; the env var
    is the ONLY lever, no CLAUDE.md restatement - the installers stamp the resolved value over the
    rule's `__DOCS_ROOT__` placeholder on every install/update, and setup/configure re-stamp after
    an env change) - loaded every session and
    subagent like `CLAUDE.md` but refreshed on `update`, individually excludable via the manifest;
    the skill/agent usage policy + per-project MCP routing live in the GENERATED
    baseline-project-agent-capabilities.md, written by the `project-agent-capabilities` skill).
    The other twelve
    are path-scoped, lazy-loaded on a matching file touch: `markdown-docs.md`, the two repair-loop
    routers (`dotnet-repair-agents.md` / `angular-repair-agents.md`), and the nine convention rules
    (`javascript-conventions.md` / `typescript-conventions.md` / `angular-conventions.md` /
    `angular-styling-conventions.md` /
    `csharp-conventions.md` / `wpf-conventions.md` / `winforms-conventions.md` / `sql-conventions.md` / `devops-conventions.md`)
    each glob-attaching ONE file family to its house-style skill - single-job so a stack a project
    lacks is simply not installed; the soft replacement for the retired require-convention-skill
    hard gate.
- `setup-plugin/` - the claude-stack plugin: four guided COMMANDS, `/claude-stack:setup` (fresh install from scratch), `/claude-stack:update` (no-questions refresh + prune of upstream-removed artifacts, computed from the stamp compare), `/claude-stack:configure` (adjust an existing install - add or drop) and `/claude-stack:validate` (reconcile an install against THIS project - prune what its frameworks do not use (whole-stack-absent) AND add the detected stacks' missing artifacts, the project-relative two-way audit configure does not do; project mode only, a per-layer walk like setup/configure driven by `stack-select.js --redundant` / `--missing` / `--evidence-gaps`), their data catalogs in repo `meta/` (`recommendations.json` - the seeds + the never-flag `general` list - and `evidence.json`, the need-signal catalog `scripts/scan-evidence.js` matches the project's package manifests against: evidence rows arrive pre-selected with the matched signal as the reason, absence is advisory-only, and evidence never creates a `required` lock), plus the `/claude-stack` router SKILL (answers with the right command). The split is display-driven, empirically proven: plugin commands list namespaced-only (`/claude-stack:setup`, like claude-hud's), plugin skills list bare - so workers-as-commands kills the generic bare `/setup`-`/update`-`/configure`-`/validate` entries, and router-as-skill (named exactly like the plugin) lists as bare `/claude-stack` instead of the `/claude-stack:claude-stack` stutter a router command produces. Do not convert either back.
- `meta/` - the repo's own registries, never installed into a project: `shared-rules.json` pins
  every deliberate multi-home rule (one canonical owner + its inline restatement sites, each copy
  marker-pinned; no prose cross-mentions in the bodies) - the lint goes red when any copy's marker
  breaks, so a multi-home edit syncs all copies mechanically; the generated `stack-graph.json`
  (the dependency graph `stack-graph.js` builds and `stack-select.js` reads at guided-install
  time - regenerate with `npm run graph`, the lint fails when stale); and the guided commands'
  catalogs (`recommendations.json`, `evidence.json`, `judgment.json`). Commands reach ALL of
  these through the run's snapshot (`$TMP/repo/meta/`), never `${CLAUDE_PLUGIN_ROOT}` - the
  installed plugin package is `setup-plugin/` only, so nothing in `meta/` exists inside it.
- `scripts/lint-skills.js` - the parity lint (below). `scripts/analyze-usage.js` - offline
  token/tool consumption report over a session's transcript JSONL (+ its `subagents/`), the token
  side of the flow instrumentation (`instrument-tool-usage.js` is the identity side - hooks never
  see tokens). `scripts/scan-evidence.js` - the deterministic evidence scan the guided commands
  run against a project (manifests only, no restore/network; conclusions computed per run, the
  catalog ships only signal definitions). `README.md` - deliberately compact: what the repo is, technologies, the two install routes (plugin / script), headline counts (lint-checked), and the usage-analysis pointer - no per-surface inventories (those live in `docs/claude-stack.html`) and no deep operational docs (env vars, troubleshooting - the guided plugin flow covers prerequisites interactively; history has the old text).

The **Cursor** delivery - installers, the 42 agent twins, `.mdc` rules, hooks,
`AGENTS.template.md` - lives in the `cursor-stack` repo (its own CLAUDE.md documents the
platform gaps and the twin-maintenance rule).

## The stack's delivery surfaces (and the Cursor twin repo)

The Claude Code delivery, per surface. Skills, hooks, agents, rules and the CLAUDE.md template all
come from the SAME one-per-run source snapshot (the newest release archive, or the shallow-clone
fallback), so an install is a single revision - the one `claude-stack.stamp` records:

| Surface | Delivery |
|---|---|
| Skills | installer snapshot-download + copy → `.claude/skills` (or plugin `/claude-stack`) |
| MCP | `claude mcp add` → `<repo>/.mcp.json` |
| Plugins | 7 via `claude plugin install` (superpowers, claude-md-management, the `*-lsp` pair, security-guidance, claude-hud, ponytail) |
| Hooks | copied from the snapshot → `.claude/hooks/`, wired into `.claude/settings.json` (4 wired + 1 copied-unwired instrumentation) |
| Agents | `.claude/agents/` - the 42 model/effort-pinned subagents described under Layout. Copied like hooks; per-tool `tools:` allowlist |
| Install stamp | `claude-stack.stamp` (project `.claude/`, or the account dir when scope=global) - the source commit this install came from; `/claude-stack:configure` diffs it against `main`. Machine-local (covered by the `.claude/*` gitignore line) |
| Convention gate | nine path-scoped convention rules in `.claude/rules/` (soft, glob auto-attach - each points a file type at its house-style skill; replaced the `require-convention-skill` hard gate) |
| Security review | `/security-review` (diff/PR) + `security-guidance` hooks (commit-time) + the `security-auditor` agent (opus/xhigh, read-only posture audit routing an OWASP/CWE punch-list to the implementers) |
| Project instructions | `CLAUDE.md` (seeded to `.claude/CLAUDE.md`) |
| LSP | `csharp-lsp` / `typescript-lsp` plugins |

The Cursor deliveries of the same surfaces (`.cursor/skills`, `.cursor/mcp.json` with tokens
pre-resolved, no plugins, `.cursor/hooks.json`, `.cursor/agents/` twins, `.mdc` rules, Bugbot
`/review`, `AGENTS.md`) live in the `cursor-stack` repo - `SKILLS` and `MCPS` stay identical
across the two repos' installers by the two-repo-commit discipline; the platform gaps are
documented there.

## The model these templates encode

- **MCP servers are per-project, never global.** Active baseline (8): `context7` (docs),
  `serena` (symbol nav + edits + per-project memory), `playwright` (browser), `memory`
  (cross-project recall), plus `angular-cli` (framework-specific - comment out where not
  applicable), `chrome-devtools` (browser/extension debug), `appium-mcp` (native mobile E2E -
  Capacitor/Ionic, needs Xcode/Android SDK + Java) and `sentry` (error monitoring - the hosted
  remote MCP at `https://mcp.sentry.dev/mcp`; its `Authorization: Bearer` header keeps
  `${SENTRY_ACCESS_TOKEN}` LITERAL in the registration and expands at launch: settings.json `env`
  on Claude, `${env:VAR}` + OS env on Cursor; comment out where the project has no Sentry). The heavy two (`chrome-devtools`,
  `appium-mcp`) fail at launch without their native deps - comment them out where not applicable. The `memory` MCP (one shared
  SQLite DB under `$HOME`) is the cross-project store - the per-project transient handoff runs
  on serena's local memory (durable orientation is the committed architecture docs), so comment
  `memory` out in a standalone project.
- **serena self-activates via `--project-from-cwd`**, not a hook: it finds `.serena/project.yml`
  in its cwd (the project root) and binds on process start, zero model involvement. Two approaches
  that look right but FAIL - do not retry: (1) an `mcp_tool` `SessionStart` hook calling
  `activate_project` never fires before serena connects; (2) `--project ${CLAUDE_PROJECT_DIR}` is the
  wrong lever - use `--project-from-cwd` (above). Current Claude Code *does* expand `${VAR}` /
  `${VAR:-default}` in `.mcp.json` (command/args/env/url/headers), so the blanket 'no `${...}`
  expansion' was too broad; the catch is only that `CLAUDE_PROJECT_DIR` isn't reliably in scope at
  `.mcp.json` parse time for a non-plugin config. Cursor runs
  serena with `--context ide-assistant`; Claude with `claude-code`.
- **serena state is isolated per project** via `-e SERENA_HOME=.serena/home` (relative, resolved
  from cwd): registry, logs, and language servers live in-project under `.serena/home`, and serena's
  project memories live alongside in `.serena/memories/` - so nothing pools across projects or
  accounts (default `~/.serena` keys off `$HOME`, merging every repo across both Claude config dirs).
  Cost: the LSP is re-downloaded per same-language project (~327MB for C# Roslyn); the whole `.serena/`
  must be gitignored (it holds the LSP cache and the memories).
- **serena holds local memory; the `memory` MCP is the cross-project store.** Three stores,
  don't conflate: the file-based auto-memory (`MEMORY.md` + `memory/*.md`, harness-injected);
  **serena's per-project memory** (`.serena/memories/`, name-addressed, local to the repo and
  gitignored - the store for the transient per-feature subagent handoff, not durable orientation); and the `memory`
  MCP (one SQLite DB under `$HOME`, shared across projects *and* accounts - active in the baseline
  for cross-project recall; a space arg names its DB `memory_<space>.db` and, on Claude, selects
  the `~/.claude-<space>` account). Comment `memory` out in a standalone project. Cross-project
  *structure* - which repos are related and where they live - lives in each repo's generated
  awareness rule (`.claude/rules/baseline-project-related-context.md`, written by the
  `/project-related-context` skill), not in memory.
- **Two stores, split by durability** - the second hard rule (peer of the read-whole-file rule
  below). The committed architecture docs - a lean `<docs-path>/architecture/ARCHITECTURE.md` core map plus the deep-dive
  files under `<docs-path>/architecture/references/` it links to - are the DURABLE truth: every seat READS them at start
  to orient (the structure, patterns, boundaries and packages already in place) instead of re-deriving
  the project, and the `project-architecture-analyzer` skill owns them (plus a `<docs-path>/architecture/ASSESSMENT.md` pros/cons
  doc), reasoning in the main session over `code-analyzer` module digests - refreshed deliberately via that
  skill or the `project-architecture-quality-loop`, never after each change lands; the project's actual code style lives alongside in `<docs-path>/PROJECT-CODE-STYLE.md`, owned by the `project-code-style-analyzer` skill (fans out `code-style-analyzer` per language and generates the inject-code-style hook that surfaces the doc at edit time, filtered to the observed extensions). serena's
  per-project memory (`write_memory` / `read_memory` / `list_memories`, named
  `<feature>__<contract_version>__<seat>`, never the shared `memory` MCP) is the EPHEMERAL inter-agent
  comms bus - the transient per-feature handoff between seats: a diagnoser's task cards to the
  implementer, the implementer's build summary to the verifier, a short 'what to do' context note -
  info that is not durable architecture. serena memory is local and disposable; a reference that must
  survive a fresh clone belongs in the committed docs, not memory.
- **Never `Read` a whole file to find a symbol** - the hard rule shipped to both stacks: locate via
  serena (`find_symbol` / `find_referencing_symbols`) or the LSP; `Read` is for code already located.

## Working in THIS repo - invariants

- **`develop` is where work lands; `main` is the release branch.** Commit to `develop` (or a
  branch off it); merging `develop` -> `main` IS the release act - the release workflow rebuilds
  the release archive from that merge, and that revision is what every install delivers. ONE
  version everywhere: the workflow tags each release `v<version>` from
  `setup-plugin/.claude-plugin/plugin.json` - the same manifest the marketplace serves from
  `main` - so bump it (plus `marketplace.json` metadata; the lint enforces they stay equal) on
  `develop` as part of any release-worthy change.
  Never commit feature work directly to `main`, and keep `main` the GitHub default branch (the
  README's raw installer bootstrap delivers the default branch; the installers' and skills'
  clone fallback is pinned `-b main` regardless). The lint + test workflows gate every push and
  PR, so a merge to `main` only ever promotes a green tree.
- **Public repo.** No private project names or absolute local paths in any tracked file - generic
  'consuming project' references only; real names / paths stay in untracked local files.
- **Parity / source-of-truth.** A change to skills / MCPs / hooks / rules / plugins lands in the
  SOURCE here, kept in parity: `SKILLS` + `MCPS` + `PLUGINS` identical across both `claude-stack`
  twins - **`npm run lint` enforces it** (and that the HTML agrees, and the skill count). A change
  to the shared `SKILLS`/`MCPS` baseline is additionally mirrored into the `cursor-stack` repo's
  manifests in the same sitting (cross-repo parity is discipline, not a networked lint). Never patch
  only a generated `.mcp.json` or a consuming project's copy - the installer
  regenerates and silently wipes it.
- **One home per piece, no duplication.** A deterministic gate at a discrete event → a hook
  (`hooks/`). A per-file-type convention → a path-scoped rule that glob-attaches
  its house-style skill (`.claude/rules/`). A keyword capability → the skill's own description.
  Cross-cutting guidance → the always-on `baseline-*.md` set (fleet-updatable): interaction,
  quality-gates, security, git, navigation - each with an `.mdc` twin in `cursor-stack` that a
  content change must be mirrored to. The base template (`templates/CLAUDE.template.md`)
  carries only per-project structure + platform routing, never the baseline conventions. Never state one
  trigger twice.
- **Prove a behavioral change, don't assert it.** A change to a model / effort pin, a routing rule, or a
  plugin set - any claim the flow got cheaper or still catches the same bugs - ships only with evidence:
  run the affected build + tests yourself and read the code (never a run's self-report), measure the cost /
  token delta when the claim is about cost, and commit that evidence (a benchmark note or branch) BEFORE any
  reset. An earlier reset destroyed an unverified 'green' claim - so evidence lands first.
- **House voice:** direct, lean, single dashes not em-dashes, single quotes in prose, recommend one
  option with a reason.

## Maintenance gotchas

- The installer regenerates `.mcp.json` on every run - fix the template, not the output.
- Editing a consuming project's installed copy is local-only; mirror the change into this repo's
  installer twins (both shells) or the next install wipes it - and into `cursor-stack`
  when the change touches the shared skills/MCP baseline or a twinned agent/rule.
- **Everything installs from ONE source snapshot** of this repo, taken once per run (`stack_src` /
  `Get-StackSrc`): the release archive that `.github/workflows/release.yml` republishes on every
  release merge to main - tagged `v<plugin version>`, always served by the
  `releases/latest/download` URL, with a `RELEASE-SOURCE` file inside naming the exact commit +
  version - falling back to a shallow git clone when no release is reachable. Skills, hooks, agents, rules
  and the CLAUDE.md template are all copied out of it, so a change ships only once merged to
  `main` (the release branch - the workflow rebuilds the archive from the merge); until then the
  per-file fail-soft keeps any existing copy. The snapshot replaced the per-file `…/main/…` raw fetches - the raw CDN is per-file and
  ~5 min stale after a push, so a run could mix revisions. One snapshot = one revision, which is
  what makes the stamp below true. Never reintroduce a raw fetch of a repo-owned file.
- **One download per RUN, not per layer.** The plugin skills (`/claude-stack:setup`, `:configure`)
  must download anyway - they need `stack-select.js`, the graph, the template and the stamp diff
  before the installer runs - so they pass that extracted snapshot to the installer with
  `--source` / `-Source` and it skips its own fetch. A borrowed source is never deleted by the
  script (`STACK_SRC_OWNED` / `$script:StackSrcOwned` gates the cleanup); the SKILLS own removing
  their `$TMP`, on every exit path. Standalone (no `--source`) still fetches and cleans up after
  itself - keep that path working, it is the no-plugin install documented in the README.
- **The install is versioned, not the file.** Claude Code has no per-artifact version: `version:` is
  in the plugin.json schema and NOWHERE else (a `version:` key on a skill/agent/rule parses but is
  ignored - don't add one). Instead each run writes `claude-stack.stamp` (project `.claude/`, or the
  account dir for a global install) naming the source commit and release version; `/claude-stack:configure` diffs it
  against the new snapshot's commit (the GitHub compare API - an archive has no local history) to
  report what an update would bring. A run whose source never resolved writes NO stamp - a wrong
  stamp is worse than none.
- Authoring or editing a house skill in stack/skills/? The superpowers writing-skills method is a useful
  reference - subordinate it to the parity lint, the HTML + skill-count sync, and the house
  voice; take its skill-testing discipline, not its own formatting or its push-to-fork deploy step.
- Skills are shared with Cursor: a skill body must stay platform-neutral (execution-mode
  conditionals like 'INLINE when no dispatch' handle the platform delta inside the skill - never
  fork a skill per platform).
