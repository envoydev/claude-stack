#!/usr/bin/env bash
#
# claude-stack.sh install|update [--space <name>] [--scope project|global] [--context7 local|remote]
# [--sentry-slug <slug>] [--sentry-auth token|oauth] [--playwright-browsers <csv>] [--playwright-enabled <engine>] [--docs-versioning git|local] [--github-cli] [--keep-pins] - install/update the CLAUDE CODE stack FOR A PROJECT: every skill / plugin / MCP from
# claude-stack.html (the complete toolset, not a curated subset), installed INTO a project. Built-in/
# system CLI skills are excluded (they ship with the CLI). Bash twin of claude-stack.ps1; the Cursor
# stack lives in the cursor-stack repo.
#
# Usage - run this file directly inside the target project:
#   bash claude-stack.sh install   # install for Claude Code
#   bash claude-stack.sh update    # update Claude Code (skills + plugins + mcp + hooks)
#
# Provisions Claude Code: skills --agent claude-code; plugins; MCPs via `claude mcp add`; hooks +
# settings.json. Requires the `claude` CLI; claude-only steps fail soft if it is absent.
#
# The action (install|update) is the one positional argument; everything else is a named flag (any order):
#   --space <name>          any word; selects the Claude account ~/.claude-<name> (skills/plugins/MCPs
#                           install there - CLAUDE_CONFIG_DIR is exported for the claude CLI). Omit for
#                           the default ~/.claude account. Does NOT by itself change where the memory
#                           MCP's db lives - pair it with --memory-level scoped for a memory_<name>.db.
#   --scope project|global  project (default) installs the full set INTO this repo (skills project-
#                           scoped, plugins/mcps --scope project); global installs it into the active
#                           account (skills -g, plugins/mcps --scope user). Overrides the SCOPE env var.
#   --context7 local|remote context7 transport; remote (default) is the hosted HTTP server, local the
#                           npx stdio server.
#   --memory-level global|scoped|project  where the memory MCP's own SQLite db lives: global =
#                           ~/.memory-mcp/memory.db (default); scoped = ~/.memory-mcp/memory_<space>.db
#                           (memory_default.db without --space); project = <project>/.memory-mcp/
#                           memory.db under the MAIN checkout (self-ignored via a generated
#                           .memory-mcp/.gitignore; refused with --scope global). Given, that level's
#                           path is used. Absent: an existing registration keeps its db path
#                           BYTE-FOR-BYTE (only the runtime extra + pragmas are upgraded); no existing
#                           registration = global. A level change never copies or deletes a db - one
#                           log line names the new file and the one the old memories stay in.
#   --docs-versioning git|local  WRITE CLAUDE_STACK_DOCS_VERSIONING into the project settings.json env,
#                           overriding a value already there (one line names the old and new value).
#                           Absent = seeded only when the key is missing: 'local' when the docs are kept
#                           out of git, else 'git'.
#   --github-cli            install the GitHub CLI (gh) via Homebrew (macOS) if missing; prompts for
#                           `gh auth login` when unauthenticated.
#   --keep-pins             keep this project's LOCAL model/effort frontmatter edits on installed
#                           agents (.claude/agents) and skills (SKILL.md) across the refresh - the
#                           local value is re-applied after the fetch/reinstall (which otherwise
#                           resets it to upstream). Only existing keys are re-applied; with the flag
#                           on, a local pin edit always wins over an upstream pin change.
#
# Full inventory - comment out manifest entries below to trim it to a curated subset.
set -euo pipefail

usage() {
  cat <<USAGE
claude-stack.sh - install or update the Claude Code stack into a project.

Usage: bash $0 <install|update> [--space <name>] [--scope project|global] [--context7 local|remote] [--memory-level global|scoped|project] [--sentry-slug <slug>] [--sentry-auth token|oauth] [--playwright-browsers <csv>] [--playwright-enabled <engine>] [--docs-versioning git|local] [--github-cli] [--keep-pins]

Action (one is REQUIRED, positional):
  install   first-time provision; MCP/plugin versions freeze until the next update; wires .claude/settings.json
  update    re-resolve every runtime to latest + refresh hooks/agents/rules; re-ensures the settings.json hook wiring (idempotent)

Named flags (any order, each optional with a default):
  --space <name>           install into the ~/.claude-<name> account (does not by itself scope the memory db - pair with --memory-level scoped)
  --scope project|global   project (default) installs INTO this repo; global installs into the account
  --context7 local|remote  context7 transport; remote (default) is the hosted server, local the npx server
  --memory-level global|scoped|project  where the memory MCP's db lives: global ~/.memory-mcp/memory.db
                           (default when nothing is registered yet), scoped ~/.memory-mcp/memory_<space
                           or default>.db, project <project>/.memory-mcp/memory.db (project scope only).
                           Absent + an existing registration = its db path is kept unchanged
  --sentry-slug <slug>     seed SENTRY_SLUG - the Sentry org ('<org>') or project ('<org>/<project>',
                           Sentry's recommended form) - into the ACCOUNT settings.json "env"
                           (<account>/settings.json); the registration reads it at launch as
                           https://mcp.sentry.dev/mcp/\${SENTRY_SLUG}. Absent = the env is left as it is
  --sentry-auth token|oauth  sentry MCP auth. token (default) sends 'Authorization: Sentry-Bearer
                           \${SENTRY_ACCESS_TOKEN}' (a personal/org API token you add to the same account
                           "env" yourself); oauth registers NO header, so Claude Code runs Sentry's
                           browser consent flow on first connect instead. Both values expand from the
                           ACCOUNT settings.json "env" or the launch shell - never from a project-level
                           .claude/settings.json (measured: that stays literal). update: absent = keep
                           the mode the registration already has
  --playwright-browsers <csv>  the browsers the playwright MCP can drive, any of chrome, msedge, firefox,
                           webkit - ONE server per engine (playwright-chrome, playwright-firefox, ...),
                           each with its own profile in .playwright/<engine>. chrome and msedge use the
                           browser installed on the machine; firefox and webkit are Playwright's own
                           builds, downloaded by the run. Absent = keep the registered set (a legacy
                           'playwright' server counts as its engine), chrome when there is none. A
                           dropped engine's server is removed
  --playwright-enabled <engine>  the one engine to keep switched on (one of the kept engines; given
                           alone, it is added to the set). The run prints '/mcp disable playwright-<x>'
                           for every other kept engine - switch any time with /mcp enable / disable
  --docs-versioning git|local  how the docs are versioned (CLAUDE_STACK_DOCS_VERSIONING in the project
                           settings.json env): git = committed, git versions them per branch; local =
                           per-branch overlays under <docs-path>/.branches/. Given, the value is WRITTEN,
                           overriding one already there, and one line names the old and new value.
                           Absent = seeded only when the key is missing: local when the docs are kept out
                           of git (no domain tracked, and a domain exists or git ignores the docs root),
                           else git - a fresh project included
  --github-cli             install the GitHub CLI (gh) if missing
  --keep-pins              keep local model/effort frontmatter edits on installed agents/skills across
                           the refresh (an update resets them to upstream otherwise)
  --selection <file>       install ONLY the skills/plugins/mcps/agents/rules/hooks named in <file> (one 'category name' per line); a selection with no 'hook' lines installs all hooks
  --installed-only         update only: derive the selection from what is already installed (skills/
                           agents/rules/hooks on disk, mcps from .mcp.json; generated project-owned
                           files excluded) and refresh exactly that - never adds, never removes.
                           Closed through stack-select.js when it is reachable next to this script,
                           so a dependency a new release introduced still installs. MCPs and
                           PLUGINS are refreshed to the newest versions: the pinned MCP entries are
                           re-resolved and re-registered, and every installed stack plugin gets
                           'claude plugin update'. Plugins come from 'claude plugin list' (machine-
                           level - no project dir to read), intersected with the manifest, so a
                           third-party plugin is never touched
  --print-plan             with --selection or --installed-only, print the resolved per-category install set and exit (dry run)
  --skills-only            run only the skill install/update step, then exit (testability; skips
                           prerequisites/plugins/mcps/hooks/agents/rules)
  --source <dir>           install FROM an existing claude-stack checkout instead of cloning one.
                           The caller owns <dir> - this script never deletes it. Used by the
                           /claude-stack setup+configure skills, which clone once and pass it here
                           so a guided run takes one clone, not two. Omit it and the script clones
                           its own source (and removes it on exit) - the standalone path.

Environment variables:
  SCOPE=project|global   fallback for --scope when the flag is absent (default project)
  CLAUDE_CONFIG_DIR      target a specific account when no --space is given (default ~/.claude)
  STACK_SKILLS_REPO      stack source repo (release-archive download, git-clone fallback; default https://github.com/envoydev/claude-stack); ignored with --source
  CONTEXT7_API_KEY       context7 API key, read from the ACCOUNT settings.json "env" (or the launch shell) at launch - higher
                         rate limits; unset = the keyless free tier. Exported in the shell THIS script runs in, it is
                         written into that file (every run, both scopes; logged by length, never by value)
  CONTEXT7_BAKE_KEY      with --context7 local, bake CONTEXT7_API_KEY into the registration (keep .mcp.json uncommitted)
  SENTRY_SLUG            the Sentry org or org/project the sentry MCP URL is scoped to - lives in the ACCOUNT
                         settings.json "env" (seeded by --sentry-slug, else from the launch shell); unset = a literal \${SENTRY_SLUG} URL
                         that connects and then fails every call naming the variable (claude mcp list warns)
  SENTRY_ACCESS_TOKEN    --sentry-auth token (default): a sentry API token (Settings -> Account -> API ->
                         Personal Tokens, or an org token) - add it to the ACCOUNT settings.json "env"
                         yourself, or export it in the shell this script runs in and the run writes it there
                         (every run, both scopes; logged by length); never in .mcp.json (the registration
                         keeps \${SENTRY_ACCESS_TOKEN} literal), never in a project-level settings.json (does
                         not reach .mcp.json expansion). Not SENTRY_AUTH_TOKEN: that is sentry-cli's
                         release/symbol-upload credential (needs project:releases)

Examples:
  bash $0 install
  bash $0 install --space work --github-cli
  bash $0 update --scope global
USAGE
}

# -h/--help anywhere -> print full usage and exit 0, before the required-action check below.
for _a in "$@"; do case "$_a" in -h|--help) usage; exit 0 ;; esac; done

# 'install' or 'update' is REQUIRED - the one positional argument (the action). Everything after it is
# a named flag with a default (parsed below); shift the action off so $@ is just the flags.
ACTION="${1:-}"
case "$ACTION" in
  install|update) shift ;;
  help) usage; exit 0 ;;
  *) usage >&2; echo "error: first argument must be 'install' or 'update' (got '${ACTION:-<none>}')" >&2; exit 1 ;;
esac

# This script provisions the Claude Code agent. (The Cursor stack lives in the cursor-stack repo.)
AGENT="claude-code"

# Named flags (any order, each with a default): --space <name> (account ~/.claude-<name> +
# memory_<name>.db), --scope project|global, --context7 local|remote, --sentry-slug <slug>,
# --sentry-auth token|oauth, --github-cli (install gh), --keep-pins (preserve local model/effort pin
# edits across the refresh).
# Named-only: there is no positional space - a value must be attached to its flag, so a space can be
# literally any word (no reserved-word collisions with the flag names).
SPACE=""
SCOPE_FLAG=""
INSTALL_GITHUB_CLI=false
KEEP_PINS=false
CONTEXT7_MODE="remote"
SENTRY_SLUG_FLAG=""
SENTRY_AUTH_FLAG=""
PLAYWRIGHT_BROWSERS_FLAG=""
PLAYWRIGHT_ENABLED_FLAG=""
DOCS_VERSIONING_FLAG=""
MEMORY_LEVEL_FLAG=""
SELECTION=""
INSTALLED_ONLY=false
PRINT_PLAN=false
SKILLS_ONLY=false
SOURCE_DIR=""
_flag_val() {  # $1 = flag name, $2 = the arg meant to be its value ('' when the flag was last)
  [ -n "$2" ] || { usage >&2; echo "error: $1 needs a value" >&2; exit 1; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --space)      _flag_val "$1" "${2:-}"; SPACE="$2";         shift 2 ;;
    --space=*)    SPACE="${1#*=}";                             shift ;;
    --scope)      _flag_val "$1" "${2:-}"; SCOPE_FLAG="$2";    shift 2 ;;
    --scope=*)    SCOPE_FLAG="${1#*=}";                        shift ;;
    --context7)   _flag_val "$1" "${2:-}"; CONTEXT7_MODE="$2"; shift 2 ;;
    --context7=*) CONTEXT7_MODE="${1#*=}";                     shift ;;
    --sentry-slug)  _flag_val "$1" "${2:-}"; SENTRY_SLUG_FLAG="$2"; shift 2 ;;
    --sentry-slug=*) SENTRY_SLUG_FLAG="${1#*=}";                   shift ;;
    --sentry-auth) _flag_val "$1" "${2:-}"; SENTRY_AUTH_FLAG="$2"; shift 2 ;;
    --sentry-auth=*) SENTRY_AUTH_FLAG="${1#*=}";                  shift ;;
    --playwright-browsers)   _flag_val "$1" "${2:-}"; PLAYWRIGHT_BROWSERS_FLAG="$2"; shift 2 ;;
    --playwright-browsers=*) _flag_val "--playwright-browsers" "${1#*=}"; PLAYWRIGHT_BROWSERS_FLAG="${1#*=}"; shift ;;
    --playwright-enabled)    _flag_val "$1" "${2:-}"; PLAYWRIGHT_ENABLED_FLAG="$2";  shift 2 ;;
    --playwright-enabled=*)  _flag_val "--playwright-enabled" "${1#*=}"; PLAYWRIGHT_ENABLED_FLAG="${1#*=}"; shift ;;
    --docs-versioning)   _flag_val "$1" "${2:-}"; DOCS_VERSIONING_FLAG="$2"; shift 2 ;;
    --docs-versioning=*) _flag_val "--docs-versioning" "${1#*=}"; DOCS_VERSIONING_FLAG="${1#*=}"; shift ;;
    --memory-level)   _flag_val "$1" "${2:-}"; MEMORY_LEVEL_FLAG="$2"; shift 2 ;;
    --memory-level=*) _flag_val "--memory-level" "${1#*=}"; MEMORY_LEVEL_FLAG="${1#*=}"; shift ;;
    --github-cli) INSTALL_GITHUB_CLI=true;                     shift ;;
    --keep-pins)  KEEP_PINS=true;                              shift ;;
    --selection)   _flag_val "$1" "${2:-}"; SELECTION="$2";     shift 2 ;;
    --selection=*) SELECTION="${1#*=}";                          shift ;;
    --installed-only) INSTALLED_ONLY=true;                       shift ;;
    --print-plan)  PRINT_PLAN=true;                              shift ;;
    --skills-only) SKILLS_ONLY=true;                              shift ;;
    --source)      _flag_val "$1" "${2:-}"; SOURCE_DIR="$2";      shift 2 ;;
    --source=*)    SOURCE_DIR="${1#*=}";                          shift ;;
    *) usage >&2; echo "error: unknown argument '$1' (named flags only: --space, --scope, --context7, --memory-level, --sentry-slug, --sentry-auth, --playwright-browsers, --playwright-enabled, --docs-versioning, --github-cli, --keep-pins, --selection, --installed-only, --print-plan, --skills-only, --source)" >&2; exit 1 ;;
  esac
done

# Validate: --space is baked into a path (~/.claude-<space>, memory_<space>.db); --scope + --context7 are enums.
if [ -n "$SPACE" ]; then
  case "$SPACE" in
    [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
      usage >&2; echo "error: --space '$SPACE' must start alphanumeric; chars [A-Za-z0-9._-]" >&2; exit 1 ;;
  esac
fi
# --scope flag wins, else the SCOPE env var, else project. Lower-case the two enums (NOT the space,
# whose casing is significant) so a non-canonical casing like 'Global'/'Remote' is accepted the same as
# on the case-insensitive PowerShell twin - printf|tr always exits 0, so this is set -e safe.
SCOPE="${SCOPE_FLAG:-${SCOPE:-project}}"
SCOPE="$(printf '%s' "$SCOPE" | tr '[:upper:]' '[:lower:]')"
CONTEXT7_MODE="$(printf '%s' "$CONTEXT7_MODE" | tr '[:upper:]' '[:lower:]')"
case "$SCOPE" in project|global) ;;
  *) usage >&2; echo "error: --scope must be 'project' or 'global' (got '$SCOPE')" >&2; exit 1 ;;
esac
case "$CONTEXT7_MODE" in local|remote) ;;
  *) usage >&2; echo "error: --context7 must be 'local' or 'remote' (got '$CONTEXT7_MODE')" >&2; exit 1 ;;
esac
# --sentry-auth: lower-cased like the other enums; empty means 'resolve later' - token on install, the
# existing registration's mode on update (the sentry block below). --sentry-slug is seeded into the
# account settings.json "env" and lands inside a URL at launch, so only slug characters: `org` or
# `org/project`; empty = leave the env alone.
SENTRY_AUTH="$(printf '%s' "$SENTRY_AUTH_FLAG" | tr '[:upper:]' '[:lower:]')"
case "$SENTRY_AUTH" in ""|token|oauth) ;;
  *) usage >&2; echo "error: --sentry-auth must be 'token' or 'oauth' (got '$SENTRY_AUTH')" >&2; exit 1 ;;
esac
# --docs-versioning: lower-cased like the other enums; empty means 'not given' - the absent-only seed decides.
# Refused HERE, before anything is written, so a typo never reaches settings.json.
DOCS_VERSIONING="$(printf '%s' "$DOCS_VERSIONING_FLAG" | tr '[:upper:]' '[:lower:]')"
case "$DOCS_VERSIONING" in ""|git|local) ;;
  *) usage >&2; echo "error: --docs-versioning must be 'git' or 'local' (got '$DOCS_VERSIONING')" >&2; exit 1 ;;
esac
# --memory-level: lower-cased like the other enums; empty means 'not given' - the existing-registration
# (else global) rule decides. Refused HERE, before anything is written.
MEMORY_LEVEL_FLAG="$(printf '%s' "$MEMORY_LEVEL_FLAG" | tr '[:upper:]' '[:lower:]')"
case "$MEMORY_LEVEL_FLAG" in ""|global|scoped|project) ;;
  *) usage >&2; echo "error: --memory-level must be 'global', 'scoped' or 'project' (got '$MEMORY_LEVEL_FLAG')" >&2; exit 1 ;;
esac
# A global install registers ONE memory server for every project of the account, so its db cannot live
# inside one repo: every other project would share that file, and it would go when the repo goes.
if [ "$MEMORY_LEVEL_FLAG" = "project" ] && [ "$SCOPE" = "global" ]; then
  usage >&2; echo "error: --memory-level project cannot be used with --scope global - a global install shares one db across every project of the account; pick global or scoped" >&2; exit 1
fi
# --playwright-browsers / --playwright-enabled: lower-cased like the other enums and put in ONE canonical
# order (chrome, msedge, firefox, webkit) so a server list never depends on how the flag was typed.
# Empty browsers = 'resolve later' from what is registered (the playwright block after the selection).
PW_ENGINES_ALL="chrome msedge firefox webkit"
PLAYWRIGHT_BROWSERS=""
if [ -n "$PLAYWRIGHT_BROWSERS_FLAG" ]; then
  _pw_want=" $(printf '%s' "$PLAYWRIGHT_BROWSERS_FLAG" | tr '[:upper:]' '[:lower:]' | tr ',' ' ') "
  for _pw_w in $_pw_want; do
    case " $PW_ENGINES_ALL " in *" $_pw_w "*) ;;
      *) usage >&2; echo "error: --playwright-browsers takes chrome, msedge, firefox, webkit (got '$_pw_w')" >&2; exit 1 ;;
    esac
  done
  for _pw_e in $PW_ENGINES_ALL; do case "$_pw_want" in *" $_pw_e "*) PLAYWRIGHT_BROWSERS="$PLAYWRIGHT_BROWSERS $_pw_e" ;; esac; done
  PLAYWRIGHT_BROWSERS="${PLAYWRIGHT_BROWSERS# }"
  # a value that names no engine at all (`,`) is a typo, never 'no flag'
  [ -n "$PLAYWRIGHT_BROWSERS" ] || { usage >&2; echo "error: --playwright-browsers needs at least one of chrome, msedge, firefox, webkit" >&2; exit 1; }
fi
PLAYWRIGHT_ENABLED="$(printf '%s' "$PLAYWRIGHT_ENABLED_FLAG" | tr '[:upper:]' '[:lower:]')"
if [ -n "$PLAYWRIGHT_ENABLED" ]; then
  case " $PW_ENGINES_ALL " in *" $PLAYWRIGHT_ENABLED "*) ;;
    *) usage >&2; echo "error: --playwright-enabled takes chrome, msedge, firefox, webkit (got '$PLAYWRIGHT_ENABLED')" >&2; exit 1 ;;
  esac
  if [ -n "$PLAYWRIGHT_BROWSERS" ]; then
    case " $PLAYWRIGHT_BROWSERS " in *" $PLAYWRIGHT_ENABLED "*) ;;
      *) usage >&2; echo "error: --playwright-enabled must be one of the kept engines ($PLAYWRIGHT_BROWSERS), got '$PLAYWRIGHT_ENABLED'" >&2; exit 1 ;;
    esac
  fi
fi
SENTRY_SLUG="${SENTRY_SLUG_FLAG:-${SENTRY_SLUG:-}}"   # the flag, else the launch environment - either lands in the account file (seed_account_keys)
_sentry_slug_ok() {  # $1 = candidate: <org> or <org>/<project>, slug characters only (it lands inside a URL)
  case "$1" in ""|[!A-Za-z0-9]*|*[!A-Za-z0-9._/-]*|*/|*//*) return 1 ;; esac; return 0
}
if [ -n "$SENTRY_SLUG" ] && ! _sentry_slug_ok "$SENTRY_SLUG"; then
  usage >&2; echo "error: --sentry-slug '$SENTRY_SLUG' must be a slug (<org> or <org>/<project>; chars [A-Za-z0-9._-])" >&2; exit 1
fi
# --installed-only refreshes an EXISTING install from disk - meaningless on a first install, and
# --selection is the explicit alternative to deriving one; the two cannot both decide the set.
if [ "$INSTALLED_ONLY" = true ]; then
  [ "$ACTION" = "update" ] || { usage >&2; echo "error: --installed-only is an update flag (got action '$ACTION')" >&2; exit 1; }
  [ -z "$SELECTION" ] || { usage >&2; echo "error: --installed-only and --selection are mutually exclusive - one source of the set" >&2; exit 1; }
fi
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# Run-outcome tracking for the honest end-of-run summary.
FAIL_COUNT=0            # item install/add failures (skills / plugins / mcps)
CLAUDE_MISSING=false    # claude CLI absent -> plugins / MCPs / settings.json wiring skipped
PREREQ_MISSING=false    # a hard prerequisite (uvx / python3 / node) was missing
note_failure() { FAIL_COUNT=$((FAIL_COUNT + 1)); log "  !! $*"; }

prerequisites_check() {
  # Warn (not fail) on missing prerequisites, matching the script's fail-soft philosophy.
  # CLAUDE_STACK_SKIP_PREREQS=1 (set by CI, whose runners lack these tools on purpose) skips the
  # warnings; the claude probe still runs because later steps read CLAUDE_MISSING.
  if [ "${CLAUDE_STACK_SKIP_PREREQS:-}" = 1 ]; then command -v claude >/dev/null 2>&1 || CLAUDE_MISSING=true; return 0; fi
  log "prerequisites check"
  local ok=true
  if command -v uvx >/dev/null 2>&1; then
    printf '  uvx: %s\n' "$(uvx --version 2>&1 | head -1)"
  else
    echo "  !! uvx not found - serena and memory MCPs will not work." >&2
    echo "     Install: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    ok=false
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '  python3: %s\n' "$(command -v python3)"
  else
    echo "  !! python3 not found - the security-guidance hook and the settings.json wiring will fail." >&2
    ok=false
  fi
  # node: required by Claude Code, the convention hooks, and npx-based MCPs. Below 22.12 LTS some
  # MCPs (chrome-devtools) refuse to start and die at launch with a generic JSON-RPC -32000.
  if command -v node >/dev/null 2>&1; then
    node_ver="$(node -v 2>/dev/null | sed 's/^v//')"
    node_major="${node_ver%%.*}"; node_rest="${node_ver#*.}"; node_minor="${node_rest%%.*}"
    case "$node_major" in (*[!0-9]*|'') node_major=0 ;; esac
    case "$node_minor" in (*[!0-9]*|'') node_minor=0 ;; esac
    if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 12 ]; }; then
      echo "  !! node $node_ver - recommend Node >= 22.12 LTS. chrome-devtools (and some npx MCPs)" >&2
      echo "     require it; an older Node makes them die at launch with a generic JSON-RPC -32000." >&2
    else
      printf '  node: %s\n' "$node_ver"
    fi
  else
    echo "  !! node not found - Claude Code, the convention hooks, and npx-based MCPs need it." >&2
    ok=false
  fi
  # csharp-ls: the csharp-lsp plugin shells out to it for Roslyn diagnostics. Off $PATH and the
  # plugin dies at launch with "Executable not found in $PATH". Needed only for C# work, so warn.
  if command -v csharp-ls >/dev/null 2>&1; then
    printf '  csharp-ls: %s\n' "$(command -v csharp-ls)"
  else
    echo "  !! csharp-ls not found - the csharp-lsp plugin needs it (C# work only)." >&2
    echo "     Install: dotnet tool install --global csharp-ls (needs the .NET SDK + ~/.dotnet/tools on PATH)." >&2
  fi
  # typescript-language-server: the typescript-lsp plugin shells out to it via a bare-name $PATH
  # lookup (a SEPARATE npm package from typescript/tsserver). Off $PATH -> the plugin dies at launch
  # with "Executable not found in $PATH". Needed for TS/JS work, so warn (the plugin self-scopes).
  if command -v typescript-language-server >/dev/null 2>&1; then
    printf '  typescript-language-server: %s\n' "$(command -v typescript-language-server)"
  else
    echo "  !! typescript-language-server not found - the typescript-lsp plugin needs it (TS/JS work)." >&2
    echo "     Install: npm i -g typescript-language-server typescript (nvm scopes globals per node version; add both to ~/.nvm/default-packages to cover future versions)." >&2
  fi
  # claude CLI: the core dependency for plugins, MCPs, and settings.json wiring. Absent -> those steps
  # are skipped (fail-soft); flag it upfront so the user can fix PATH before the long skill install runs.
  if command -v claude >/dev/null 2>&1; then
    printf '  claude: %s\n' "$(command -v claude)"
  else
    echo "  !! claude CLI not found - plugins, MCPs, and settings.json wiring will be SKIPPED." >&2
    echo "     Install: https://docs.claude.com/claude-code (then re-run to add plugins/MCPs)." >&2
    CLAUDE_MISSING=true
  fi
  if ! $ok; then PREREQ_MISSING=true; echo "  Install the missing tools above, then re-run." >&2; fi
}

install_github_cli() {  # opt-in via the 'github-cli' extra; fail-soft like everything else
  $INSTALL_GITHUB_CLI || return 0
  if command -v gh >/dev/null 2>&1; then
    log "github-cli: gh already installed ($(gh --version 2>/dev/null | head -1)) - skipping install"
  elif command -v brew >/dev/null 2>&1; then
    log "github-cli: installing gh via Homebrew"
    brew install gh || { echo "  !! brew install gh failed - install manually: https://cli.github.com" >&2; return 0; }
    # No auth during install (deliberate): run `gh auth login` once before the first GitHub
    # platform use (PRs/issues). Plain git push/pull never needs it.
    log "  installed - run 'gh auth login' before first GitHub platform use"
  else
    echo "  !! brew not found - install Homebrew or gh manually: https://cli.github.com" >&2
  fi
}

# CONFIG_DIR is for path resolution only and is normally NOT exported - EXCEPT when a space is given:
# a space (any word) selects the Claude account ~/.claude-<space> and IS exported so the claude CLI
# (skills/plugins/mcp) installs into it. Without a space, CLAUDE_CONFIG_DIR (a specific account you
# set yourself, e.g. ~/.claude-work) or the ~/.claude default is used and never exported.
if [ -n "$SPACE" ]; then
  CONFIG_DIR="$HOME/.claude-$SPACE"
  # Distinguish an existing account from a brand-new one so a typo'd space ('wrok') is visible, not silent.
  if [ -d "$CONFIG_DIR" ]; then
    log "space '$SPACE' -> existing account $CONFIG_DIR (CLAUDE_CONFIG_DIR exported for the claude CLI); pass --memory-level scoped for a matching memory_$SPACE.db (default without that flag: global)."
  else
    log "space '$SPACE' -> creating NEW account $CONFIG_DIR (typo? did you mean an existing one?); pass --memory-level scoped for a matching memory_$SPACE.db (default without that flag: global)."
  fi
  [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ "${CLAUDE_CONFIG_DIR}" != "$CONFIG_DIR" ] && \
    log "space '$SPACE' overrides CLAUDE_CONFIG_DIR ($CLAUDE_CONFIG_DIR)."
  export CLAUDE_CONFIG_DIR="$CONFIG_DIR"
else
  CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -z "${CLAUDE_CONFIG_DIR:-}" ]; then
    log "CLAUDE_CONFIG_DIR not set - using the claude CLI default account; resolving config paths to $CONFIG_DIR."
  fi
fi
# The account's registration file (user-scope MCP servers): Claude Code keeps the DEFAULT account's at
# ~/.claude.json, beside ~/.claude rather than inside it; only a CLAUDE_CONFIG_DIR account (a space is
# one - exported above) keeps it inside its own dir.
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then ACCOUNT_CLAUDE_JSON="$CONFIG_DIR/.claude.json"; else ACCOUNT_CLAUDE_JSON="$HOME/.claude.json"; fi

SERENA_CTX="claude-code"   # serena's --context for Claude Code

# A db path in the spelling the programs that open it read. Git Bash / MSYS2 / Cygwin on Windows answer
# $HOME in POSIX form (/c/Users/..., or /tmp/... under the temp mount) and git in mixed form (C:/...),
# while the memory server and node are native Windows programs - to them /tmp/... is C:\tmp\..., another
# file. `cygpath -w` gives the native C:\Users\...\memory.db, the same spelling the .ps1 twin registers
# and node's path.normalize reads back (_memory_registered_path), so an update matches its own
# registration instead of re-pointing it. Everywhere else the path is already native and passes through.
if command -v cygpath >/dev/null 2>&1; then
  _native_path() { cygpath -w "$1"; }
  MEMORY_SEP='\'
else
  _native_path() { printf '%s\n' "$1"; }
  MEMORY_SEP='/'
fi

# Shared memory root - the global and scoped levels' db folder, a fixed home path, so a Cursor install
# on the same machine points to the same DB.
HOME_MEMORY_DIR="$(_native_path "$HOME/.memory-mcp")"

if [ "$SCOPE" = "project" ]; then
  cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  CLAUDE_SCOPE="project"
else
  CLAUDE_SCOPE="user"
fi

# Two roots, because a worktree has its own top-level but shares its repo:
# - MEMORY_TOPLEVEL: the repo this run WRITES into - rules, hooks, settings.json and .mcp.json land at
#   the git top-level (a worktree's own folder inside a worktree), else (project scope only, a non-git
#   project) PWD itself. The registration lookup, the notes import and the switch-off all read it.
# - MEMORY_PROJECT_ROOT: where a `--memory-level project` db lives - the MAIN checkout (the git common
#   dir's parent), never a worktree, which is deleted with its branch; a submodule or an older git
#   falls back to the top-level.
# A global-scope run outside any project (not inside a git repo) has neither - the level resolution and
# import_memory_notes read that as 'no project' and fail-soft.
MEMORY_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$MEMORY_TOPLEVEL" ] && [ "$CLAUDE_SCOPE" = "project" ] && MEMORY_TOPLEVEL="$PWD"
_memory_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
case "$_memory_common" in
  */.git) MEMORY_PROJECT_ROOT="${_memory_common%/.git}" ;;
  *)      MEMORY_PROJECT_ROOT="$MEMORY_TOPLEVEL" ;;
esac
# The project level's db, native-spelled like the home levels (see _native_path); empty with no project.
MEMORY_PROJECT_DB=""
[ -n "$MEMORY_PROJECT_ROOT" ] && MEMORY_PROJECT_DB="$(_native_path "$MEMORY_PROJECT_ROOT/.memory-mcp/memory.db")"

# ===========================================================================
# MANIFEST - edit these, then run.
# ===========================================================================

# (1) Skills, one per line as "repo|skill" (comment a line to skip it).
SKILLS=(
  # House (envoydev/claude-stack)
  "envoydev/claude-stack|create-ticket"             # ticket generator (bug/story/epic/task) - tracker-agnostic EN Markdown, routes to references/<type>.md
  "envoydev/claude-stack|dev-log-convert"           # UA/EN work notes -> structured English work log; trigger 'dev-log'
  "envoydev/claude-stack|explain-code-tutor"        # senior-mentor explainer for code/bug/concept/trade-off via real-file walkthrough; depth ELI5/intermediate/expert
  "envoydev/claude-stack|project-quality-loop"             # autonomous review-and-fix loop pipeline over a loops/ folder of numbered prompts
  "envoydev/claude-stack|project-architecture-quality-loop"        # deliberate analyze-assess-improve loop - the architecture capture writes ARCHITECTURE.md, the pros/cons capture writes ASSESSMENT.md fresh every round, fix cons by tier, reconcile; manual /-only
  "envoydev/claude-stack|project-code-style-analyzer"    # deliberate code-style capture - fans out code-style-analyzer per language, merges docs/code-style/CODE-STYLE.md (its own docs domain), generates the path-scoped project-code-style rule; manual /-only
  "envoydev/claude-stack|project-architecture-analyzer"  # deliberate architecture capture - dispatches architecture-analyzer per module, reasons in the main session, writes docs/architecture/ARCHITECTURE.md + the generated awareness rule baseline-project-architecture.md; manual /-only
  "envoydev/claude-stack|project-first-look"             # provisional ORIENTATION.md from one manifest scan (scripts/scan-evidence.js --orientation) - stack, modules, build/test/run commands, entry points; never over a capture, replaced by the architecture capture
  "envoydev/claude-stack|project-architecture-quality-analyzer" # deliberate pros/cons capture over the architecture map - dispatches architecture-analyzer per module, reasons a gated, tiered strengths/weaknesses assessment in the main session, writes docs/quality/ASSESSMENT.md fresh every run (never versioned - quality/ carries no watch.json, so the docs engine never treats it as a domain); reads the decision log, never writes it; manual /-only
  "envoydev/claude-stack|project-test-coverage-analyzer" # deliberate coverage capture - detect tooling per surface, instrumented run ONCE per surface in the main session, writes docs/test-coverage/COVERAGE.md (90% line after exclusions default, tiered weak points) + raw/ machine-readable results; manual /-only (the loop Read-loads it)
  "envoydev/claude-stack|project-test-coverage-loop"     # deliberate coverage analyze-triage-fix loop - runs the capture, works weak points by tier (tests inline/implementer briefs, testability refactors approval-gated, structural = user decision), reconciles docs; manual /-only
  "envoydev/claude-stack|project-version-upgrade"        # deliberate BREAKING version-event flow (framework/runtime/package major) - plan in-session via context7 + architecture-analyzer digests, approval gate (auto mode only on explicit user ask), staged execution via implementers + resolvers; manual /-only
  "envoydev/claude-stack|project-agent-capabilities"           # deliberate capabilities capture - inventories installed skills/agents/MCPs/plugins, generates the awareness rule baseline-project-agent-capabilities.md; manual /-only
  "envoydev/claude-stack|project-related-context"        # deliberate related-projects capture - args paths/URLs, fans out related-project-analyzer per sibling, writes the awareness rule baseline-project-related-context.md + docs/related-projects/RELATED-PROJECTS.md (its own docs domain; docs/related-context/ stays the plain drop box for every other sibling-repo paper); manual /-only
  "envoydev/claude-stack|project-build-from-scratch" # greenfield scaffolding + design->scaffold->slice-by-slice build orchestration over the pipeline
  "envoydev/claude-stack|project-solve-cross-task"    # entry-point router: classify -> smallest execution mode -> cross-domain contract freeze + integration gate; home of the shared subagent policies
  "envoydev/claude-stack|project-verify-plan"      # audit an implementation plan BEFORE building - risk-coverage review (traps named per the stack skill, scope, edges, minimal); precedes /code-review
  "envoydev/claude-stack|project-verify-code"     # single-chat, no-dispatch review of an assembled build - the inline alternative to /code-review: rerun build/test, gate vs plan, RUN the app on failable inputs, trace wire-contract changes to consumers, ranked punch-list
  "envoydev/claude-stack|project-commit-checkpoint" # the pre-commit checkpoint + publish ceremony, out of the always-on git rule: formatter, house review, security review, the COMMIT-GATE / PUSH-GATE receipt the guard reads
  "envoydev/claude-stack|project-implementer"              # single-chat build step: execute a verified plan task-by-task (contracts + per-task green gate + inline red-resolution, no dispatch), finish via /code-review + the done-gate
  "envoydev/claude-stack|project-solution-design"  # single-chat designer twin: read the architecture, judge where a change fits (extend/refactor/isolate), load the stack skill for traps, decompose into an ordered plan; feeds project-verify-plan
  "envoydev/claude-stack|project-solve-task"       # gated single-chat vertical: design -> plan audit -> user approval + build mode -> build -> build review (skippable: project-verify-code inline or the verifier seat) -> done-gate; hard user stop between steps, plan-file + serena-note state survives compaction
  "envoydev/claude-stack|project-diagnose-failure" # gated single-chat investigation: triage evidence to a tier -> gather (evidence-gatherer seats or inline) -> prove root cause -> user fork (report / contracted fix tasks / log-points card); read-only, any evidence source incl. none but a client report
  "envoydev/claude-stack|project-runtime-failure-signatures" # single-chat diagnoser twin: local-runtime crash signatures (null-ref/DI/deadlock/disposed/config-drift/boundary/HTTP-status) -> where to isolate each; pairs with systematic-debugging
  "envoydev/claude-stack|project-ci-failure-signatures"        # single-chat CI-diagnoser twin: red-pipeline signatures (compile/restore, green-locally-red-on-runner, quality-gate, signing/release, workflow-config, infra-flake) -> code-vs-environment call + route; pairs with project-runtime-failure-signatures
  "envoydev/claude-stack|project-stack-usage-analyzer" # token/tool usage audit of stack skill runs: transcript hunt -> analyze-usage.js per session -> per-session report + raw data under <docs-path>/claude-stack-usage-report/
  "envoydev/claude-stack|plugin-authoring"   # Claude Code plugin authoring: manifest + marketplace schema, layout and precedence, plugin root vs data paths, per-component rules, the validate / plugin-dir / details / eval loop, security review
  "envoydev/claude-stack|devops"           # DevOps for the .NET/Angular house: Docker multi-stage/digest-pinned/non-root, GitHub Actions CI/CD, safe expand-contract deploys, secrets/OIDC, Aspire AppHost
  "envoydev/claude-stack|database-conventions" # cross-engine DB conventions + per-engine skill routing
  "envoydev/claude-stack|database-security"    # SQL/data-layer security: parameterized-only injection, least-privilege DB accounts, row-level security, connection-string secrets, encryption, audit
  "envoydev/claude-stack|typescript"       # framework-agnostic TS/JS baseline (strict typing, modules, async, JS+JSDoc)
  "envoydev/claude-stack|javascript"       # base JS-family language layer: ESM modules, async discipline, two failure channels, modern-feature adoption, untrusted input, naming; typescript stacks on it
  "envoydev/claude-stack|ts-js-testing" # plain TS/JS testing hub: runner routing (Vitest default), role-keyed strategy, seam stubs over module mocks, exclusion catalog - practices only, the % bar is user-set via project-test-coverage-analyzer
  "envoydev/claude-stack|npm"                 # professional npm: lockfile+ci discipline, supply-chain baseline (ignore-scripts/cooldown/allow-git), audit gating, overrides vs legacy-peer-deps, exports maps + ESM-first publishing, update-bot cooldowns
  "envoydev/claude-stack|browser-extension"    # MV3 browser extensions: ephemeral service worker + storage tiers, typed cross-context messaging, isolated vs MAIN world, least-privilege permissions, CSP-safe UI, WXT tooling, store review + monetization
  "envoydev/claude-stack|webpack"             # webpack 5 library builds: transpile/type-check split (swc + fork-ts-checker + tsc declarations), externals from package.json, tree-shaking preconditions, ESM output state, resolution traps, config factory + cache pitfalls
  "envoydev/claude-stack|angular-conventions" # Angular 17+/TS house conventions (signals, OnPush, a11y)
  "envoydev/claude-stack|angular-testing"  # Angular testing hub: TestBed/harness patterns, runner routing, exclusion catalog - practices only, the % bar is user-set via project-test-coverage-analyzer
  "envoydev/claude-stack|angular-material"   # Angular Material + CDK: selective imports, M3 theming, CDK primitives, harnesses
  "envoydev/claude-stack|angular-styling"    # Angular CSS/styling: ViewEncapsulation, :host, ::ng-deep ways-out, design tokens, responsive, a11y styling
  "envoydev/claude-stack|angular-security"   # Angular/web frontend security: XSS/DomSanitizer bypass, CSP, CSRF, no-secrets-in-bundle, token storage, SSR/TransferState
  "envoydev/claude-stack|ionic"            # house Ionic/Capacitor conventions: UI, nav, lifecycle, permissions, plugin sourcing + wrapping
  "envoydev/claude-stack|capacitor-release" # Ionic/Capacitor release pipeline: cap sync/build, iOS+Android signing, store submission, OTA, versioning, CI, symbols
  "envoydev/claude-stack|ionic-security"   # Ionic/Capacitor mobile security: Keychain/Keystore storage, deep-link validation, permissions, cleartext/WebView hardening
  "envoydev/claude-stack|csharp"           # C# house conventions - style, naming, async, logging, DI
  "envoydev/claude-stack|csharp-design-patterns" # all 23 GoF patterns with modern .NET 8+ forms
  "envoydev/claude-stack|dotnet"           # router mapping .NET work areas to specialist skills
  "envoydev/claude-stack|dotnet-architecture-tests" # architecture fitness tests: NetArchTest (default)/ArchUnitNET - layer+dependency+naming+isolation rules as build-failing tests
  "envoydev/claude-stack|dotnet-aspire"    # .NET Aspire local orchestration: AppHost, ServiceDefaults, service discovery, dashboard
  "envoydev/claude-stack|dotnet-authentication" # ASP.NET Core authn/authz: JWT/OIDC/Identity, policy-based authz, secrets
  "envoydev/claude-stack|dotnet-code-quality" # C# quality enforcement: CSharpier formatter ownership, SDK analyzers + AnalysisLevel, .editorconfig severity, TreatWarningsAsErrors (+ legacy batch promotion), Roslynator, CI gate
  "envoydev/claude-stack|dotnet-console-apps" # console-app interface surface: CLI arg parsing (System.CommandLine 2.0/Spectre.Console.Cli/Cocona) + bot-SDK integration (Telegram/Discord/Slack/exchange) in a BackgroundService
  "envoydev/claude-stack|dotnet-cryptography" # System.Security.Cryptography: SHA-2, AES-GCM, RSA/ECDSA, PBKDF2/Argon2id, constant-time compare
  "envoydev/claude-stack|dotnet-web-error-handling" # Result + ProblemDetails (RFC 9457) + IExceptionHandler + FluentValidation
  "envoydev/claude-stack|dotnet-grpc"      # gRPC: .proto/codegen, ASP.NET Core host, 4 streaming modes, JWT/mTLS, interceptors, health
  "envoydev/claude-stack|dotnet-hosted-services" # worker/background-service host: BackgroundService, ExecuteAsync trap, scoped scope, PeriodicTimer, shutdown, Channels
  "envoydev/claude-stack|dotnet-windows-service" # Windows Service SCM layer: AddWindowsService, budgets, non-zero-exit recovery, sc.exe install, gMSA/hardening, ServiceBase maintenance
  "envoydev/claude-stack|dotnet-messaging" # event-driven messaging: Wolverine (MIT)/MassTransit, outbox, sagas, RabbitMQ/Azure SB
  "envoydev/claude-stack|dotnet-migrate"   # safe migration workflow: EF schema, .NET upgrades, NuGet - rollback + verify per step
  "envoydev/claude-stack|dotnet-minimal-api" # minimal API endpoint mechanics: MapGroup, TypedResults, endpoint filters, binding
  "envoydev/claude-stack|dotnet-mvc-controllers" # controller-based Web API: [ApiController], attribute routing, ActionResult<T>, auto-400 filter, action filters, binding
  "envoydev/claude-stack|dotnet-openapi"   # OpenAPI doc (Swashbuckle / built-in .NET 9+) + Scalar docs UI
  "envoydev/claude-stack|dotnet-realtime"  # SignalR real-time: strongly-typed Hub<T>, IHubContext push, groups/presence, reconnection, JWT-over-querystring, Redis/Azure backplane
  "envoydev/claude-stack|dotnet-security"  # OWASP Top 10 (2021) -> .NET 8 mitigations; deprecated-pattern warnings
  "envoydev/claude-stack|dotnet-source-generators" # Roslyn IIncrementalGenerator authoring + built-in generators (GeneratedRegex/LoggerMessage/STJ)
  "envoydev/claude-stack|dotnet-testing"   # .NET test strategy: AAA, per-layer coverage, library routing
  "envoydev/claude-stack|dotnet-web-backend" # ASP.NET Core cross-cutting: HttpClientFactory, OpenAPI, observability
  "envoydev/claude-stack|dotnet-winforms"  # WinForms conventions: MVP/binding, disposal, GDI leaks, high-DPI, migration
  "envoydev/claude-stack|dotnet-wpf"       # WPF strict-MVVM conventions, bindings, virtualization
  "envoydev/claude-stack|postgres"         # PostgreSQL engine delta: index types, JSONB, SARGability, EXPLAIN, pooling
  "envoydev/claude-stack|sqlite"           # SQLite engine delta: WAL/single-writer, PRAGMAs, type affinity, limited ALTER
  "envoydev/claude-stack|dotnet-data-access" # EF Core + NHibernate ORM hub (references/): DbContext, tracking, N+1, projection
  "envoydev/claude-stack|dotnet-architecture" # architecture decision hub (references/): clean/ddd/vsa/modular/microservices
  "envoydev/claude-stack|markdown-style" # Markdown authoring / review: syntax canon (valid) + house style overlay, two-pass procedure
  "envoydev/claude-stack|docs-as-code" # docs-as-code authoring: Mermaid sequence/ER diagrams, ADRs (Nygard/MADR 4), C4 views - per-type references/
  "envoydev/claude-stack|ilspy-decompile" # decompile a .NET assembly (ilspycmd via dnx) to read real API/behavior - framework internals, NuGet source, pre-upgrade checks
  "envoydev/claude-stack|dotnet-project-setup" # .NET solution build spine (hub, references/): src/tests layout, .slnx, Directory.Build.props, global.json, central package management, dotnet-tool pinning
  "envoydev/claude-stack|dotnet-performance" # perf-aware .NET design (hub, references/): allocation/type design (struct vs class, Span, ValueTask) + serialization-format choice (STJ source-gen / Protobuf / MessagePack)
  "envoydev/claude-stack|dotnet-diagnostics" # measure/diagnose a live .NET process (hub, references/): BenchmarkDotNet microbenchmarks + crash/hang/OOM dump capture & first-look SOS analysis
  "envoydev/claude-stack|nx"               # Nx monorepo: project-graph nav + 'nx affected' scoping, generators, module-boundary tags; CLI over MCP; serena-vs-nx routing
)

# (2) Plugins "<plugin>@<marketplace>" (non-default marketplaces added first).
#     What each one EXECUTES, read from the packages on 2026-09-12 - the trust decision belongs
#     beside the manifest, not in an audit nobody re-opens:
#       superpowers        1 SessionStart hook, no timeout (600s default), prints its own SKILL.md
#                          as additionalContext. No network, no credential, no bin/, no deps. The
#                          plugin.json version is what actually pins an update (a marketplace entry
#                          version is ignored when both exist) - and on one machine that single
#                          version had carried THREE different source commits, so the version
#                          identifies the release, never the code that ran. ACCEPTED COST, stated
#                          rather than fixed: that injected SKILL.md (3,108 chars every session)
#                          tells the model to invoke a skill before ANY response, which is the
#                          opposite of the house capabilities rule's 'load a skill for the work at
#                          hand, never to answer a question'. It arrives by hook, so not invoking
#                          the skill does not avoid it and no house-side edit can win; the four
#                          methods the house actually cites (plan, TDD, debug, verify-before-done)
#                          are worth the collision. Revisit by dropping the plugin and inlining
#                          those four, the way the seat disciplines are already inlined.
#       claude-md-management  no hooks, no MCP, no deps. Both components EDIT CLAUDE.md and neither
#                          carries `disable-model-invocation`, so a side-effect entry is
#                          model-invocable; guard-cross-project-write.js covers writes outside the
#                          root, not an in-root rewrite of the instruction file itself.
#       csharp-lsp /       the packages hold a LICENSE and a README and nothing else. The whole
#       typescript-lsp     definition lives on the MARKETPLACE ENTRY under `strict: false` (which
#                          makes the entry the entire definition and a package plugin.json a
#                          load-failing conflict), including the `lspServers` block. An EMPTY plugin
#                          cache directory is therefore the correct install, not a failed one.
#                          The only executable is the language server the user installs by hand.
#       security-guidance  12 hook entries. Its SessionStart (timeout 180) creates a venv and runs
#                          `pip install claude-agent-sdk` - network egress to PyPI on every session
#                          start, no lockfile, no --ignore-scripts. Its Stop, SubagentStop and seven
#                          PostToolUse Bash entries spawn an inner model call through the Agent SDK,
#                          which is BILLED; ten of them are asyncRewake so they wake the model in the
#                          background rather than blocking the turn. No settings write, no egress
#                          beyond PyPI and api.anthropic.com.
#       claude-hud         no hooks, no MCP, no bin/. Its own /claude-hud:setup writes a statusLine
#                          into the ACCOUNT settings.json - user-invoked, not a hook. Ships ~41MB of
#                          node_modules. Third-party marketplace, so auto-update is OFF and this
#                          installer's update pass is the only thing that moves it.
#     Costs nothing here counts: a plugin's SessionStart injection and its skill descriptions are
#     always-on context that lint check 33 cannot see (it reads this repo, not the plugin cache) -
#     `/claude-stack:status` reports the installed number.
EXTRA_MARKETPLACES=(
  "jarrodwatts/claude-hud"
)
PLUGINS=(
  # "superpowers@claude-plugins-official"     # workflow skills: plan, TDD, debug, verify-before-done.
  #   NOT a pick any more: it is a HARD `dependencies` entry on claude-stack@claude-stack, so the
  #   core plugin installs and enables it (and Claude Code then REFUSES to disable it while the core
  #   is enabled - code.claude.com/docs/en/plugin-dependencies). The row stays here, commented,
  #   because three readers build their catalog from this block and 27 skills and agents cite it:
  #   stack-graph.js catalog.plugins, the parity lint's resolvable namespaces, the walk's plugin layer.
  "claude-md-management@claude-plugins-official" # audit + revise CLAUDE.md files
  "csharp-lsp@claude-plugins-official"      # inline Roslyn diagnostics on edit (complements serena nav); needs csharp-ls (dotnet tool install -g csharp-ls)
  "typescript-lsp@claude-plugins-official"  # same for Angular/TS work
  "security-guidance@claude-plugins-official" # security hooks: pattern warnings + LLM diff review on Stop/commit
  "claude-hud@claude-hud"                       # statusline HUD (global/user scope)
)
# The stack's OWN plugin deliveries, appended to PLUGINS only on the plugin route. Its marketplace is
# this repo, registered from CLAUDE_STACK_MARKETPLACE - a github slug by default, or a durable local
# path when the temp-project matrix proves the route against the working tree. A path that is deleted
# after the run would leave the plugin unresolvable in the next session, so the marketplace is never
# registered from the run's throwaway source snapshot.
STACK_MARKETPLACE="${CLAUDE_STACK_MARKETPLACE:-envoydev/claude-stack}"
STACK_PLUGINS=("claude-stack-hooks@claude-stack")
# The core entry's own `dependencies`, mirrored from the generated marketplace entry (the lint pins
# the two together, so a dependency added there is a red lint until it is added here). Installed
# EXPLICITLY only when the run enables no stack plugin at all - the both-switches-off copy route,
# where nothing would otherwise pull them and 27 citers would find the plugin absent. On the plugin
# route the core entry carries them and an explicit install here would only repeat the work.
CORE_DEP_PLUGINS=("superpowers@claude-plugins-official")

# (3) MCP servers as "name|args"; scope follows SCOPE.
#     @SERENA_CONTEXT@   -> resolved at install time to claude-code.
#     @MEMORY_DB_PATH@   -> resolved at install time to the memory db the --memory-level resolution picked.
#     \${CLAUDE_PROJECT_DIR:-.} stays LITERAL so Claude Code interpolates it at server launch.
#
# PERFORMANCE - network resolution is the cost of a slow new-session start, so it happens HERE
# (install/update), never at launch:
#   - install/update resolves each runtime's LATEST published version (below) and bakes it into the
#     registration. `install` SKIPS MCPs already registered, so the resolved version stays FROZEN
#     until you run `update` (which removes + re-adds -> re-resolves -> bumps). No versions are
#     hardcoded in this script - "latest at provision, frozen until next update".
#   - launch is fast because versions are PINNED (npx skips dist-tag resolution; uvx reuses its
#     cached env). Do NOT add --prefer-offline: with a freshly-resolved latest version, a stale npm
#     cache index reports "no matching version" and the server dies (-32000). The pin alone is the
#     speed-up; npx fetches the exact version once if the cache lacks it, then reuses it.
#   - serena runs from the pinned PyPI package (NOT git+https, which re-fetched the ref on every
#     launch - the biggest startup cost), web dashboard off (no HTTP server spun up).
#   - memory: --with numpy is injected because mcp-memory-service's sqlite_vec backend needs numpy
#     but doesn't declare it, so uvx's isolated env omits it -> "No module named 'numpy'" (-32000).
#   - offline at provision -> resolution yields empty -> the entry falls back to unpinned.
# Bounded fetches (npm_config_fetch_timeout / curl --max-time) so a dead network fails fast to the
# unpinned fallback instead of hanging on a single silent line.
_npm_latest()  { command -v npm >/dev/null 2>&1 && npm_config_fetch_timeout=15000 npm view "$1" version 2>/dev/null | tr -d '[:space:]'; }
_pypi_latest() { curl -fsSL --max-time 15 "https://pypi.org/pypi/$1/json" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['info']['version'])" 2>/dev/null; }
log "resolving latest MCP runtime versions (install/update network step)"
# '|| true' is REQUIRED: under `set -e` a failing command substitution (offline, or npm/curl/python3
# absent) aborts the whole run - these must fall through to empty -> unpinned, per the design above.
MCP_CONTEXT7_VER="$(_npm_latest @upstash/context7-mcp)" || true
MCP_PLAYWRIGHT_VER="$(_npm_latest @playwright/mcp)" || true
MCP_SERENA_VER="$(_pypi_latest serena-agent)" || true
MCP_MEMORY_VER="$(_pypi_latest mcp-memory-service)" || true
MCP_CHROME_DEVTOOLS_VER="$(_npm_latest chrome-devtools-mcp)" || true
MCP_APPIUM_VER="$(_npm_latest appium-mcp)" || true
# Version-pin suffix: "@1.2.3" when resolved, "" (unpinned fallback) when offline.
CTX7_PIN="${MCP_CONTEXT7_VER:+@$MCP_CONTEXT7_VER}"
PW_PIN="${MCP_PLAYWRIGHT_VER:+@$MCP_PLAYWRIGHT_VER}"
SERENA_PIN="${MCP_SERENA_VER:+@$MCP_SERENA_VER}"
CD_PIN="${MCP_CHROME_DEVTOOLS_VER:+@$MCP_CHROME_DEVTOOLS_VER}"
AP_PIN="${MCP_APPIUM_VER:+@$MCP_APPIUM_VER}"
# The memory pin is spelled '==<ver>' INSIDE the extras brackets ('mcp-memory-service[sqlite]==<ver>',
# FACT-EMBED) - not '@<ver>' like the others, which have no extras suffix to sit next to.
MEMORY_PIN="${MCP_MEMORY_VER:+==$MCP_MEMORY_VER}"
# Report what pinned vs. fell back to unpinned - the whole point of this step is 'frozen until update'.
for _pv in "context7:$MCP_CONTEXT7_VER" "playwright:$MCP_PLAYWRIGHT_VER" "serena:$MCP_SERENA_VER" "memory:$MCP_MEMORY_VER" \
           "chrome-devtools:$MCP_CHROME_DEVTOOLS_VER" "appium-mcp:$MCP_APPIUM_VER"; do
  _pn="${_pv%%:*}"; _pver="${_pv#*:}"
  if [ -n "$_pver" ]; then log "  pinned $_pn@$_pver"
  else log "  !! could not resolve $_pn latest - installing unpinned (re-run when online to pin it)"; fi
done

MEMORY_BACKEND="sqlite_vec"   # the only valid local backend; level (below) picks the db PATH

# --memory-level: where the memory MCP's own SQLite db lives (FACT-SCHEMA / cross-task-facts.md) -
# global ~/.memory-mcp/memory.db, scoped ~/.memory-mcp/memory_<space|default>.db, project
# <project>/.memory-mcp/memory.db. Given, that level's default path is used (refusing 'project' with
# no identifiable project root; 'project' with --scope global was refused with the other flags). Absent:
# an EXISTING registration keeps its MCP_MEMORY_SQLITE_PATH byte-for-byte - only the runtime extra +
# pragmas are upgraded below, never the path; no existing registration = global. A level change never
# copies or deletes a db - whichever file the old memories are in stays there, and the one log line
# below names both files (the guided commands quote it).
# Mirrors stack/hooks/memory.js's pathForLevel/levelOfPath/registeredDbPath, reimplemented here (not
# require()'d): this runs before the source snapshot's hooks are copied, and the .ps1 twin has no
# require() at all - each twin needs its own copy of the formula regardless.
# Joined with MEMORY_SEP, the separator _native_path answers with, so a path never mixes the two.
_memory_default_path() {  # $1 = level -> the db path that level resolves to
  case "$1" in
    global)  printf '%s%smemory.db' "$HOME_MEMORY_DIR" "$MEMORY_SEP" ;;
    scoped)  printf '%s%smemory_%s.db' "$HOME_MEMORY_DIR" "$MEMORY_SEP" "${SPACE:-default}" ;;
    project) printf '%s' "$MEMORY_PROJECT_DB" ;;
  esac
}
# The inverse - 'global'/'scoped'/'project' for a path matching one of the three shapes EXACTLY (never
# a prefix/substring match, so a foreign path is never mistaken for one of ours); empty otherwise.
_memory_level_of_path() {
  local p="$1"
  if [ -n "$MEMORY_PROJECT_DB" ] && [ "$p" = "$MEMORY_PROJECT_DB" ]; then printf 'project'; return; fi
  [ "$p" = "$HOME_MEMORY_DIR${MEMORY_SEP}memory.db" ] && { printf 'global'; return; }
  case "$p" in "$HOME_MEMORY_DIR$MEMORY_SEP"memory_*.db) printf 'scoped'; return ;; esac
  return 0
}
# The CURRENTLY REGISTERED db path, if any (mirrors memory.js's registeredDbPath). Project scope: the
# repo's .mcp.json first, else the account file (its user-scope entry, then this repo's local-scope
# one). User scope reads ONLY the account file's user-scope entry: a repo's .mcp.json - a project-level
# path an earlier project install wrote - must never become the account-wide path. The account file
# is ACCOUNT_CLAUDE_JSON (~/.claude.json for the default account). Prints nothing when there is no
# registration, node is missing, or a file cannot be read/parsed; never throws (every read is its own
# try/catch) - callers still guard the substitution, since a crashed node would exit non-zero.
_memory_registered_path() {
  command -v node >/dev/null 2>&1 || return 0
  node -e '
const fs=require("fs");const path=require("path");
const [scope,homeDir,accountFile,projectRoot]=process.argv.slice(1);
function expandHome(p){ if(typeof p!=="string"||!p) return p; let out=p;
  if(out==="~"||out.startsWith("~"+path.sep)||out.startsWith("~/")) out=path.join(homeDir,out.slice(1));
  return out.replace(/\$\{HOME\}/g,homeDir).replace(/\$HOME\b/g,homeDir); }
function readJson(f){ try{return JSON.parse(fs.readFileSync(f,"utf8"));}catch{return null;} }
function envPath(entry){ const p=entry&&entry.env&&entry.env.MCP_MEMORY_SQLITE_PATH;
  return typeof p==="string"&&p?path.normalize(expandHome(p)):null; }
const projectScope=scope==="project";
try{
  if(projectScope&&projectRoot){
    const mcp=readJson(path.join(projectRoot,".mcp.json"));
    const found=envPath(mcp&&mcp.mcpServers&&mcp.mcpServers.memory);
    if(found){ console.log(found); process.exit(0); }
  }
}catch{}
try{
  const account=readJson(accountFile);
  if(account){
    const userScope=envPath(account.mcpServers&&account.mcpServers.memory);
    if(userScope){ console.log(userScope); process.exit(0); }
    if(projectScope&&projectRoot){
      const projects=account.projects||{};
      const proj=projects[projectRoot]||projects[projectRoot.replace(/\\/g,"/")];
      const projScope=envPath(proj&&proj.mcpServers&&proj.mcpServers.memory);
      if(projScope){ console.log(projScope); process.exit(0); }
    }
  }
}catch{}
' "$CLAUDE_SCOPE" "$HOME" "$ACCOUNT_CLAUDE_JSON" "$MEMORY_TOPLEVEL" 2>/dev/null
}

MEMORY_EXISTING_PATH="$(_memory_registered_path)" || MEMORY_EXISTING_PATH=""
if [ -n "$MEMORY_LEVEL_FLAG" ]; then
  MEMORY_LEVEL="$MEMORY_LEVEL_FLAG"
  if [ "$MEMORY_LEVEL" = "project" ] && [ -z "$MEMORY_PROJECT_ROOT" ]; then
    usage >&2; echo "error: --memory-level project needs a project (not inside a git repo)" >&2; exit 1
  fi
  MEMORY_DB_PATH="$(_memory_default_path "$MEMORY_LEVEL")"
  # A flag that MOVES an existing registration: the db file is never copied, so name both files.
  if [ -n "$MEMORY_EXISTING_PATH" ] && [ "$MEMORY_EXISTING_PATH" != "$MEMORY_DB_PATH" ]; then
    _memory_old_level="$(_memory_level_of_path "$MEMORY_EXISTING_PATH")" || _memory_old_level=""
    [ -n "$_memory_old_level" ] || _memory_old_level="custom"
    log "memory: level $_memory_old_level -> $MEMORY_LEVEL: $MEMORY_DB_PATH (old memories stay in $MEMORY_EXISTING_PATH)"
  fi
else
  if [ -n "$MEMORY_EXISTING_PATH" ]; then
    MEMORY_DB_PATH="$MEMORY_EXISTING_PATH"
    MEMORY_LEVEL="$(_memory_level_of_path "$MEMORY_DB_PATH")" || MEMORY_LEVEL=""
    [ -n "$MEMORY_LEVEL" ] || MEMORY_LEVEL="custom"
    log "memory: no --memory-level given - keeping the existing registration's db path unchanged ($MEMORY_LEVEL): $MEMORY_DB_PATH"
  else
    MEMORY_LEVEL="global"
    MEMORY_DB_PATH="$(_memory_default_path global)"
  fi
fi

# FACT-EMBED: the '[sqlite]' extra is what gives real (ONNX, 384-dim) embeddings - without it the
# server hash-embeds the first launch and then REFUSES to start on every later one once the db holds
# rows. FACT-PRAGMA: the service's own busy_timeout default is 5000ms; MCP_MEMORY_SQLITE_PRAGMAS raises
# it (and the python-level connect timeout with it) - always added since 5000 < 15000. Both survive
# unquoted: read -ra below (and the verify step's own word-splitter) split on whitespace only, never
# glob-expand an array element, so '[sqlite]' and the two '=' in 'busy_timeout=15000' need no quoting.
MEMORY_ENTRY="memory|-e MCP_MEMORY_STORAGE_BACKEND=$MEMORY_BACKEND -e MCP_MEMORY_SQLITE_PATH=@MEMORY_DB_PATH@ -e MCP_MEMORY_SQLITE_PRAGMAS=busy_timeout=15000 -- uvx --with numpy --from mcp-memory-service[sqlite]${MEMORY_PIN} memory server"

# context7 runs REMOTE (the hosted server) by DEFAULT - no local process, and the key stays out of
# the registration: put CONTEXT7_API_KEY in the ACCOUNT settings.json "env" (<account>/settings.json -
# ~/.claude or the space's dir; or export it in the launch shell) and Claude Code expands
# ${CONTEXT7_API_KEY} in the header at launch, so .mcp.json holds no secret. A PROJECT-level
# .claude/settings.json or settings.local.json "env" value does NOT reach .mcp.json expansion (measured:
# it stays literal; it reaches only the MCP child process environment). Pass --context7 local for the local stdio server instead - keyless by default too,
# and CONTEXT7_BAKE_KEY=1 (with CONTEXT7_API_KEY) bakes --api-key into <repo>/.mcp.json (keep it uncommitted).
CONTEXT7_REMOTE_URL='https://mcp.context7.com/mcp'
CONTEXT7_REMOTE_HDR='CONTEXT7_API_KEY: ${CONTEXT7_API_KEY:-}'   # :- so an unset key sends an EMPTY header = keyless free tier (measured: a literal ${CONTEXT7_API_KEY} is rejected as an invalid key on every call, an empty value passes)

# sentry runs REMOTE only (the hosted MCP at mcp.sentry.dev) - no local process, no pin to resolve.
# The registration is CONSTANT and reads two values from the ACCOUNT settings.json "env" at launch
# (<account>/settings.json - ~/.claude or the space's dir; the launch shell works too; a project-level
# .claude/settings.json does NOT reach .mcp.json expansion - measured, it stays literal):
#   SENTRY_SLUG          -> https://mcp.sentry.dev/mcp/${SENTRY_SLUG} (org, or org/project - Sentry's
#                           recommended scoping; --sentry-slug seeds it)
#   SENTRY_ACCESS_TOKEN  -> `Authorization: Sentry-Bearer ${SENTRY_ACCESS_TOKEN}` under --sentry-auth
#                           token (default) - Sentry's documented direct-token mode for a personal/org API
#                           token; plain `Bearer` is the server's OAuth-issued token scheme and rejects an
#                           API token as invalid_token (measured: AUTH_HEADER_REJECTED / 401 under it)
# --sentry-auth oauth registers NO header instead, so Claude Code runs Sentry's browser consent flow on
# first connect - a set-but-wrong header disables that fallback, which is why the modes never mix.
# Why placeholders and not baked values: both values belong to the account, not the file, and the
# guided commands make the user fill them in. Unset, `${SENTRY_SLUG}` stays literal - the server
# accepts that path on tools/list and fails every call naming the variable, and `claude mcp list`
# prints 'Missing environment variables' - a diagnosable state, unlike `${SENTRY_SLUG:-}`, whose
# trailing slash the server 404s (both measured).
# update: --sentry-auth absent keeps the mode the existing registration carries (read back through
# `claude mcp get sentry`); an old plain-`Bearer` registration migrates to the fixed token header.
if [ "$ACTION" = "update" ] && [ -z "$SENTRY_AUTH" ] && command -v claude >/dev/null 2>&1; then
  _sentry_get="$(claude mcp get sentry 2>/dev/null || true)"
  if printf '%s\n' "$_sentry_get" | grep -q '^ *URL: https://mcp\.sentry\.dev/' && ! printf '%s\n' "$_sentry_get" | grep -q '^ *Authorization: '; then
    SENTRY_AUTH="oauth"   # a deliberately headerless registration stays headerless
  fi
fi
[ -n "$SENTRY_AUTH" ] || SENTRY_AUTH="token"
SENTRY_REMOTE_URL='https://mcp.sentry.dev/mcp/${SENTRY_SLUG}'
SENTRY_REMOTE_HDR='Authorization: Sentry-Bearer ${SENTRY_ACCESS_TOKEN}'
[ "$SENTRY_AUTH" = "oauth" ] && SENTRY_REMOTE_HDR=""
seed_account_env() {  # $1 = KEY $2 = VALUE - write env.KEY into the ACCOUNT settings.json (the file .mcp.json expansion reads); overwrite - a flag or an exported value is explicit
  # The value travels to node through the environment, not argv (argv is readable by every process on
  # the box); a secret-shaped KEY is logged by LENGTH, never by value; the file is rewritten only on a change.
  local settings="$CONFIG_DIR/settings.json"
  mkdir -p "$CONFIG_DIR"
  _SEED_VALUE="$2" node -e '
const fs=require("fs");const [p,k]=process.argv.slice(1);const v=process.env._SEED_VALUE;
let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){if(e.code!=="ENOENT")throw e}
d.env=d.env||{};const before=d.env[k];
if(before!==v){d.env[k]=v;fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");}
const shown=/(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$/.test(k)?`set (${v.length} chars)`:v;
console.log(before===v?`  ${k} already ${shown} in ${p}`:`  ${k}=${shown} written to ${p} env`);
' "$settings" "$1" || note_failure "could not write $1 into $settings"
}
# INSTALL + UPDATE, both scopes: every key the stack knows that THIS RUN was handed lands in the
# account file - the slug from --sentry-slug (else the launch environment), SENTRY_ACCESS_TOKEN and
# CONTEXT7_API_KEY from the launch environment. An exported value is as explicit as a flag, so it
# overwrites; a key the run was not handed is never touched, let alone cleared. Why the ACCOUNT file
# at project scope too: it is the one file whose env reaches the .mcp.json URL/header expansion
# (measured on 2.1.266 - the project's .claude/settings.json and settings.local.json leave the
# 'Missing environment variables' warning in place, the account file clears it), and 'add it there
# by hand' left a remote user with no terminal to do it in. A value never goes through a chat.
seed_account_keys() {
  local k v
  for k in SENTRY_SLUG SENTRY_ACCESS_TOKEN CONTEXT7_API_KEY; do
    if [ "$k" = SENTRY_SLUG ]; then v="$SENTRY_SLUG"; else v="${!k:-}"; fi
    [ -n "$v" ] && seed_account_env "$k" "$v"
  done
  return 0
}
account_key_state() {  # $1 = KEY -> "KEY=set (N chars)" or "KEY=absent" from the ACCOUNT settings.json - a length, never a value
  node -e '
const fs=require("fs");const [p,k]=process.argv.slice(1);let v="";
try{v=String((JSON.parse(fs.readFileSync(p,"utf8")).env||{})[k]??"")}catch{}
console.log(v.trim()?`${k}=set (${v.length} chars)`:`${k}=absent`);
' "$CONFIG_DIR/settings.json" "$1" 2>/dev/null || printf '%s=absent\n' "$1"
}
if [ "$CONTEXT7_MODE" = "local" ]; then
  CONTEXT7_SPEC="-- npx -y @upstash/context7-mcp${CTX7_PIN}"
  if [ -n "${CONTEXT7_BAKE_KEY:-}" ] && [ -n "${CONTEXT7_API_KEY:-}" ]; then
    CONTEXT7_SPEC="$CONTEXT7_SPEC --api-key $CONTEXT7_API_KEY"
    log "  !! baking CONTEXT7_API_KEY into the context7 registration; at project scope it lands in <repo>/.mcp.json - keep .mcp.json uncommitted (or use --context7 remote to keep the key out of the file)."
  fi
else
  CONTEXT7_SPEC="@HTTP@"
  if [ -n "${CONTEXT7_BAKE_KEY:-}" ]; then
    log "  !! CONTEXT7_BAKE_KEY is set but context7 is remote - it is ignored; pass --context7 local to bake, or add CONTEXT7_API_KEY to settings.json 'env'."
  fi
fi
CONTEXT7_ENTRY="context7|$CONTEXT7_SPEC"


MCPS=(
  "angular-cli|-- npx -y @angular/cli mcp" # angular-cli: only for Angular workspaces - comment out elsewhere (unpinned: matches the workspace ng).
  "serena|-e SERENA_HOME=.serena/home -- uvx --from serena-agent${SERENA_PIN} serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false --project-from-cwd" # LSP symbol navigation; per-project SERENA_HOME (.serena/home - gitignore it, holds ~327MB LSP) isolates serena's registry/memories/logs/LSP, no pooling across projects/accounts; --project-from-cwd self-activates the repo (.serena/project.yml in cwd) on launch; PyPI (not git), dashboard off
  "playwright|-- npx -y @playwright/mcp${PW_PIN} --user-data-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright --output-dir \${CLAUDE_PROJECT_DIR:-.}/.playwright/output" # drive a real browser for visual checks / web app verification - expanded after the selection into one playwright-<engine> server per kept browser
  "chrome-devtools|-- npx -y chrome-devtools-mcp${CD_PIN}" # OPT-IN browser/extension debug; drives a full Chrome (heavy) - comment out outside web projects; no WS-frame payloads
  "appium-mcp|-- npx -y appium-mcp${AP_PIN}" # OPT-IN native mobile E2E (official Appium MCP); embedded UiAutomator2/XCUITest drivers, needs Xcode and/or Android SDK + Java (heavy) - comment out outside Capacitor/Ionic mobile projects
  "sentry|@HTTP@" # OPT-IN Sentry error monitoring - hosted remote MCP (mcp.sentry.dev/mcp/${SENTRY_SLUG} - SENTRY_SLUG + SENTRY_ACCESS_TOKEN live in the ACCOUNT settings.json "env", expanded at launch; --sentry-slug seeds the slug); --sentry-auth token (default) sends `Sentry-Bearer ${SENTRY_ACCESS_TOKEN}`, oauth registers no header; comment out where the project has no Sentry
  "$MEMORY_ENTRY"  # memory: required, like serena/context7 (baseline-memory.md locks it in) - shared recall across sessions/projects; --memory-level picks where its db lives
  "$CONTEXT7_ENTRY"                           # up-to-date library/framework/SDK docs (beats recalled API knowledge)
)

# (4) Hooks (claude-code): copied into the repo from the run's source snapshot (stack/hooks/) on BOTH
# actions (per-hook fail-soft - a hook not yet upstream keeps its committed repo copy); on INSTALL each is
# also wired into .claude/settings.json. UPDATE refreshes the files and re-ensures the wiring (idempotent).
# Each entry: "filename::matcher::args" - args (if any) are appended to the hook command.
HOOKS=(
  "guard-protected-force-push.js::Bash|PowerShell::"         # block force-push to main/master/develop
  "guard-catastrophic-rm.js::Bash|PowerShell::"              # block recursive rm of /, ~, $HOME, the cwd or its parent (. / ..), a bare *, or several top-level dirs at once
  "guard-read-whole-file.js::Read::"              # block whole-file Read of a >200-line source file - locate via serena first; caps cumulative half-split reconstruction
  "guard-read-whole-file.js::Bash|PowerShell::"              # same gate on Bash: a bare `cat file.ts` of a large source file is the Read block routed through the shell
  "guard-secret-value.js::Read::"                 # block a Read of a file that HOLDS a credential (content-judged: a JSON/dotenv key matching environment.json's secret_key_pattern with a live value) - presence only via `node guard-secret-value.js --presence <file> [KEY ...]`
  "guard-secret-value.js::Bash|PowerShell::"                 # same gate on Bash: cat/jq/grep/an inline node read of such a file, `echo $SECRET`, a bare `env`, or a credential-shaped literal in the command - a prose rule that failed live (a JSON.stringify(s.env) printed a token)
  "guard-secret-value.js::Grep::"                 # the THIRD read route: a Grep with output_mode content PRINTS the matching lines - measured live, a blocked Bash read of a settings.json was followed 8s later by a content Grep of the same path that returned its lines (count / files_with_matches modes print no value and pass)
  "guard-unapproved-dispatch.js::Task|Agent::"    # block *-implementer dispatch without the docs-root flow/APPROVAL gate file (APPROVED/AUTO)
  "guard-ungated-commit.js::Bash|PowerShell::"               # block a non-trivial git commit without the docs-root flow/COMMIT-GATE receipt (VERIFIED/WAIVED), and a git push / gh pr merge without flow/PUSH-GATE (CLAUDE_STACK_PUSH_GATE=0 turns that half off)
  "guard-stop-contract.js::@Stop::"               # Stop event: block a turn ending on a decision-shaped question in prose - re-emit as AskUserQuestion (measured stalls 13min-37h); also carries the fresh-session offer, past the window's absolute trigger, re-armed at 1.5x growth
  "guard-stop-contract.js::@SubagentStop::"       # SubagentStop: hold ONCE a subagent that stops on a wait nobody will end (a first-person 'I'll wait for...' close or its own ScheduleWakeup call) while it started no background work of its own - the parent's history is not its situation (field report: a fork dropped its whole brief this way)
  "guard-stop-contract.js::AskUserQuestion::"  # PreToolUse AskUserQuestion: INJECT context into the ask being built - stale scope (an option naming repo/remote/job state with no fresh read this turn), a recommendation contradicting an un-actioned earlier prompt, the fresh-session offer for a flow whose every stop is a tool call, a live credential, and the house voice in the ask's own text. Presence only, never denies
  "guard-fresh-session-start.js::Skill::"        # PreToolUse Skill: block a deliberate orchestration run starting on another run's carried history past the window-scaled trigger - route it through an AskUserQuestion fresh-session choice
  "guard-fresh-session-start.js::@UserPromptSubmit::"   # the same run invoked as a SLASH COMMAND emits no Skill event at all (measured: 4 of 4 runs slash-injected, zero Skill events in 45 messages) - this route injects the ask, never denies (a UserPromptSubmit denial erases the prompt)
  "guard-fresh-session-start.js::@SessionStart:compact::"  # the harness just auto-compacted, which proves the session hit the ~390k ceiling at a moment a Stop may never come - inject the fresh-session ask there too
  "guard-fresh-session-start.js::@PreCompact::"          # before a compaction, write <docs-path>/flow/COMPACT-STATE - the live plan, the open flow stamps with their ages, the files this session wrote - with no model call; the compact SessionStart points at it
  "guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell::"  # an EXISTING lint / format / analyzer config, or a strictness setting in tsconfig / MSBuild, cannot be changed to get a check green - creating one passes; the CONFIG-EDIT-ALLOW receipt honours a wanted change, CLAUDE_STACK_CONFIG_PROTECT=0 turns it off
  "guard-cross-project-write.js::Write|Edit|NotebookEdit|Bash|PowerShell::"  # one session, one project: block a WRITE that lands outside the project root (reads/investigation untouched) - the change another repo needs is handed off as a task card
  "guard-answer-length.js::@UserPromptSubmit::"   # inject the answer budget (~3 sentences plus points) at the end of the turn's context - the short-answer rule mechanized
  "guard-answer-length.js::@SessionStart::"     # re-inject the budget after a COMPACTION rebuilds the context without it (measured absent for 277 of 366 messages in one session) - a startup/resume session gets it before the first prompt too
  "guard-answer-length.js::@Stop::"               # Stop event: block a wall-of-text answer (prose past the hard cap, no depth request in the user's message) - re-answer at budget
  "docs-session.js::@SessionStart::"              # the architecture docs as the session's starting point: merged branches' doc versions folded into mainline, then ORIENTATION.md, this branch's overrides and how to read by section
  "docs-session.js::@SubagentStart::"             # the same orientation for a dispatched subagent - SessionStart context never reaches one, plus the snapshot the finish ask compares against
  "docs-session.js::@SubagentStop::"              # the finish ask, per agent: what THAT agent changed, once - the seat that made the change is the only context that knows why
  "docs-session.js::Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep|Glob::"  # doc reads recorded; the FIRST change under a source root held until a covering section was read, that section handed over inline
  "docs-session.js::@Stop::"                      # once per session: a change that hit watch.json asks for the owning sections to be rewritten or confirmed
  "memory-session.js::@SessionStart::"            # push a compact slice of shared memory (own project, cross-project preferences/corrections, related projects) into the session's starting context - engine memory.js copied beside it, not itself wired
  "monitor-session.js::@PostToolUse::"           # a live monitor that never denies: the same call repeated 5 times with identical input, over 20 files written in one turn, the context at 80% of the fresh-session trigger - one row each, injected only when CLAUDE_STACK_MONITOR=inject
  "monitor-session.js::@UserPromptSubmit::"      # a new turn: the monitor's per-turn counts reset
  "instrument-tool-usage.js::.*::"                # wired env-gated: a sh test skips the node spawn unless CLAUDE_STACK_INSTRUMENT=1 (seeded "0" in settings env - flip it for a measured run; see README)
)
# ONE switch for the whole route change. true (the default from 1.0.0) means the fifteen hooks
# arrive through the claude-stack-hooks PLUGIN: nothing is copied into .claude/hooks/, nothing is
# wired in .claude/settings.json, and an existing install's copies and wirings are pruned in the same
# run that enables the plugin - so the window where neither route fires is zero. The plugin's own
# copies stand down while a project still wires a copied twin (stack/hooks/hook-prelude.js), which is
# what keeps a half-updated project from firing every guard twice. Set to false to keep the 0.2.x
# copy route, which is what the temp-project matrix uses to prove both.
HOOKS_VIA_PLUGIN="${CLAUDE_STACK_HOOKS_VIA_PLUGIN:-true}"

# The same switch for the MCP servers (Phase 6). true (the default from 1.0.0) means the eight
# catalog servers arrive through the plugins NAMED for them - serena, context7, memory, playwright,
# angular-cli, chrome-devtools, appium-mcp, sentry - so this script registers nothing and an existing
# install's stack registrations are REMOVED in the same run that enables the plugins. The plugin
# route is what makes the servers per-project without a per-project file: <repo>/.mcp.json stops
# being a stack-owned artifact and holds only what the project itself added. Set to false to keep
# the 0.2.x `claude mcp add` route, which is what the temp-project matrix uses to prove both.
MCPS_VIA_PLUGIN="${CLAUDE_STACK_MCPS_VIA_PLUGIN:-true}"
# The three servers that can never be dropped are hard `dependencies` of the CORE plugin entry, so
# Claude Code installs them with it whatever this switch says. That makes them plugin-only whenever
# the core is enabled at all - registering them as well would run each one twice and pay both sets
# of tool schemas every session. They come back to .mcp.json only on the FULL copy route, where no
# plugin route is on and the core is never enabled.
MCPS_LOCKED="serena context7 memory"
_core_plugin_on() {
  [ "$HOOKS_VIA_PLUGIN" = "true" ] || [ "$SKILLS_VIA_PLUGIN" = "true" ] || [ "$MCPS_VIA_PLUGIN" = "true" ]
}
_is_locked_mcp() { case " $MCPS_LOCKED " in *" $1 "*) return 0 ;; esac; return 1; }
# The servers this run registers under their BARE names - the ones a tool name must be spelled for.
_bare_named_mcps() {
  [ "$MCPS_VIA_PLUGIN" = "true" ] && return 0
  local entry name
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"
    _is_locked_mcp "$name" && _core_plugin_on && continue
    printf '%s\n' "$name"
  done
}

# The manifest as SHIPPED, taken before any selection filter narrows HOOKS. The stamp records these
# names so a later --installed-only run can tell a hook the user DROPPED (shipped then, absent now)
# from one this release ADDED (not shipped then) - on disk the two look the same.
HOOKS_CATALOG=(${HOOKS[@]+"${HOOKS[@]}"})

# The MCP manifest as SHIPPED, for the same reason: the selection filter below narrows MCPS to what
# THIS project picked, and the plugin-route retirement has to name every server the stack ever
# registered here - including the ones this run did not select, which an earlier install may well
# have written into .mcp.json.
MCPS_CATALOG=(${MCPS[@]+"${MCPS[@]}"})

# settings.json permissions.deny (claude-code): hard-block Read of secret-bearing files. Wired into
# .claude/settings.json alongside the hooks on INSTALL (idempotent, union-merged - a consuming project's
# own deny entries are preserved). Bare globs match at any depth (gitignore semantics).
# It reaches the Read TOOL ONLY. The claim that Claude Code also applies a Read() deny to recognized
# Bash reads (cat/head/tail/sed) stood here for releases and is FALSE - refuted live: an account
# carrying `Read(**/config.json)` returned the content of two Bash `cat`s of a config.json with zero
# denial strings. A shell read of a denied file is not blocked by anything here; that route is
# covered by baseline-security.md's behavioral rule and by the Stop-time credential branch in
# guard-stop-contract.js.
# The ACCOUNT settings.json (~/.claude and ~/.claude-<space>, plus settings.local.json) was on this
# list for releases because the stack's own design fills it with credentials (SENTRY_ACCESS_TOKEN,
# CONTEXT7_API_KEY), and a session had cat-ed one whole as its first tool call. It left the list once
# guard-secret-value.js judged that file by CONTENT on the Read route and the shell route alike
# (a deny entry covers the Read tool only - measured above) and gained the SECRET-READ-ALLOW
# receipt: a deny entry has no such override, so it stripped the user of the read they had just
# consented to, and a remote user cannot open the file in a terminal they do not have. The four old
# entries are RETIRED_DENY below - dropped from an existing install on every run, exactly those
# strings, a project's own entries untouched. The PROJECT-level settings.json was never denied: it
# carries the hook wiring a session legitimately inspects.
# Stack-specific secret/config globs stay a per-project addition (the CLAUDE.md template's authoring
# outline prompts the fill-in; baseline-security.md keeps the behavioral rule).
# The settings.json deny-list is a Claude Code feature (no equivalent elsewhere).
SECRET_DENY=(
  "Read(.env)"
  "Read(.env.*)"
  "Read(*.pem)"
  "Read(*.pfx)"
  "Read(*.p12)"
  "Read(*.key)"
)
RETIRED_DENY=(   # written by releases up to 0.2.62 - dropped on every install/update, exact strings only
  "Read(~/.claude/settings.json)"
  "Read(~/.claude/settings.local.json)"
  "Read(~/.claude-*/settings.json)"
  "Read(~/.claude-*/settings.local.json)"
)

# (5) Subagents (claude-code): specialist agents copied into .claude/agents/ from the run's source clone
# (agents/) on BOTH actions (per-agent fail-soft - an agent not yet upstream keeps its committed repo copy).
# Claude Code auto-discovers .claude/agents/*.md; no settings.json wiring needed. (Cursor's twins of these
# live in the cursor-stack repo.)
AGENTS=(
  "dotnet-build-error-resolver.md"   # implement phase (sonnet/high): dotnet build -> categorize errors -> minimal fix loop (serena/csharp-lsp), capped
  "dotnet-test-failure-resolver.md"  # implement phase (sonnet/high): dotnet test -> red->green repair loop, anti-reward-hacking guard, capped
  "ng-build-error-resolver.md"       # implement phase (sonnet/high): ng build -> minimal fix loop (serena/LSP), capped
  "angular-test-resolver.md"         # implement phase (sonnet/high): ng test/Jest -> red->green repair loop, anti-reward-hacking, capped
  "architecture-analyzer.md"                 # analysis support (sonnet/low): read-only per-module characterizer (purpose/surface/deps/patterns/smells) - the architecture + test-coverage captures fan it out, also independently callable
  "test-coverage-analyzer.md"             # analysis phase (sonnet/medium): read-only per-surface coverage characterizer - the project-test-coverage-analyzer skill fans it out over the raw results; never runs the suite
  "code-style-analyzer.md"                # analysis phase (sonnet/medium): read-only per-language style characterizer - the project-code-style-analyzer skill fans it out per language and merges docs/code-style/CODE-STYLE.md + the generated project-code-style rule from its structured reports
  "related-project-analyzer.md"           # analysis support (sonnet/medium): read-only sibling-repo characterizer (name/relation/first_read/seam, URL siblings shallow-cloned to scratch) - the project-related-context skill fans it out per sibling and merges docs/related-projects/RELATED-PROJECTS.md
  "ci-failure-diagnoser.md"          # analysis phase (opus/high - a bounded catalogue match over structured CI logs, one notch under the runtime diagnoser's open-ended root-cause search): read-only CI red-run diagnosis via gh - categorize, local repro, route
  "runtime-failure-diagnoser.md"               # analysis phase (opus/xhigh): read-only bug diagnosis from logs/errors/screenshots - root cause + route, no fix
  "evidence-gatherer.md"             # diagnosis support (sonnet/low): read-only - a diagnoser dispatches it to reproduce/confirm and return a compact digest, keeping log volume off the opus seat
  "security-auditor.md"              # analysis phase (opus/xhigh): read-only cross-stack security posture audit - OWASP/CWE punch-list routed to implementers, complements /security-review
  "integration-reviewer.md"          # final gate (opus/xhigh): read-only cross-domain integration review - contract consistency, assembled build/test/migration, the commit gate no single-stack verifier is
  # Per-domain specialist team (10 stacks x designer/implementer/verifier) + architect analysis agents above; model/effort pinned in frontmatter
  "aspnet-solution-designer.md"      # design phase (opus/xhigh): ASP.NET Core architecture + plan + test strategy, decomposes into parallel tasks
  "aspnet-implementer.md"            # build phase (sonnet/medium): builds one ASP.NET task - code + tests
  "aspnet-verifier.md"               # verify phase (sonnet/xhigh): gates the ASP.NET build vs plan + quality, punch-list back
  "web-angular-solution-designer.md"     # design phase (opus/xhigh): Angular architecture + plan + test strategy, decomposes
  "web-angular-implementer.md"           # build phase (sonnet/medium): builds one Angular task - code + tests
  "web-angular-verifier.md"              # verify phase (sonnet/xhigh): gates the Angular build vs plan + quality
  "wpf-solution-designer.md"         # design phase (opus/xhigh): WPF strict-MVVM architecture + plan + test strategy, decomposes
  "wpf-implementer.md"               # build phase (sonnet/medium): builds one WPF task - code + tests
  "wpf-verifier.md"                  # verify phase (sonnet/xhigh): gates the WPF build vs plan + quality
  "console-solution-designer.md"     # design phase (opus/xhigh): headless .NET (Generic Host worker/bot/daemon/CLI) architecture + plan + test strategy, decomposes
  "console-implementer.md"           # build phase (sonnet/medium): builds one console/worker task - code + tests
  "console-verifier.md"              # verify phase (sonnet/xhigh): gates the console/worker build vs plan + quality
  "ionic-angular-solution-designer.md"      # design phase (opus/xhigh): Ionic/Capacitor architecture + plan + test strategy, decomposes
  "ionic-angular-implementer.md"            # build phase (sonnet/medium): builds one mobile task - code + tests
  "ionic-angular-verifier.md"               # verify phase (sonnet/xhigh): gates the mobile build vs plan + quality
  "data-solution-designer.md"        # design phase (opus/xhigh): schema/data-model architecture + plan + test strategy, decomposes
  "data-implementer.md"              # build phase (sonnet/medium): builds one data task - SQL + migration tests
  "data-verifier.md"                 # verify phase (sonnet/xhigh): gates the data build vs plan + quality
  "devops-solution-designer.md"      # design phase (opus/xhigh): Docker/CI/CD/deploy architecture + plan + validation strategy, decomposes
  "devops-implementer.md"            # build phase (sonnet/medium): builds one devops task - Dockerfile/workflow/deploy + local validation
  "devops-verifier.md"               # verify phase (sonnet/xhigh): gates the devops build vs plan + quality
  "browser-extension-solution-designer.md" # design phase (opus/xhigh): MV3 extension architecture (SW/content/UI topology, message contract, permissions) + plan + test strategy, decomposes
  "browser-extension-implementer.md" # build phase (sonnet/medium): builds one extension task - code + tests
  "browser-extension-verifier.md"    # verify phase (sonnet/xhigh): gates the extension build vs plan + quality
  "windows-service-solution-designer.md" # design phase (opus/xhigh): SCM recovery/budget/identity topology + plan + test strategy, decomposes
  "windows-service-implementer.md" # build phase (sonnet/medium): builds one Windows Service task - code + tests
  "windows-service-verifier.md" # verify phase (sonnet/xhigh): gates the Windows Service build vs plan + quality
  "winforms-solution-designer.md"    # design phase (opus/xhigh): WinForms MVP seam / binding / disposal topology + plan + test strategy, decomposes
  "winforms-implementer.md"          # build phase (sonnet/medium): builds one WinForms task - code + tests
  "winforms-verifier.md"             # verify phase (sonnet/xhigh): gates the WinForms build vs plan + quality
)

# Skills and agents arrive through the per-stack PLUGINS instead of being copied into .claude/. Which
# plugins a project enables is COMPUTED from what it picked (scripts/selection-plugins.js, over the
# same placement meta/plugin-entries.json is generated from), so a project carries its own closure
# and nothing else. What no plugin carries - the EXTRAS, the items no stack's closure reaches - is
# still copied, because there is no plugin that would hold it. Set to false to keep the 0.2.x copy
# route, which is what the temp-project matrix uses to prove both.
SKILLS_VIA_PLUGIN="${CLAUDE_STACK_SKILLS_VIA_PLUGIN:-true}"

# The manifests as SHIPPED, taken before the selection filter narrows them (the HOOKS_CATALOG
# pattern). On the plugin route these are the names a run PRUNES from .claude/skills and
# .claude/agents: a copy the stack itself shipped, now carried by a plugin. A file neither manifest
# names is the project's own and is never touched.
SKILLS_CATALOG=(${SKILLS[@]+"${SKILLS[@]}"})
AGENTS_CATALOG=(${AGENTS[@]+"${AGENTS[@]}"})

# (6) Path-scoped rules (claude-code): copied into .claude/rules/ from the run's source clone (rules/)
# on BOTH actions - lazy-load on matching file reads; conventions stay with the convention-gate hook,
# rules carry only glob-scoped routing.
# NOTE: baseline-project-related-context.md, baseline-project-architecture.md and
# baseline-project-agent-capabilities.md are GENERATED per-project (by /project-related-context,
# /project-architecture-analyzer and /project-agent-capabilities) - NEVER add those names to this
# manifest (the copy would overwrite the generated copies); nothing prunes the rules dir, so
# they survive update.
CLAUDE_RULES=(
  # Always-on baseline (no paths) - loads every session like CLAUDE.md; one job per file, comment out what a project doesn't want.
  "baseline-interaction.md"    # communication + evaluating-proposals + planning (merged by exclusion affinity)
  "baseline-quality-gates.md"  # code-quality + definition-of-done (merged by exclusion affinity)
  "baseline-security.md"
  "baseline-git.md"
  "baseline-navigation.md"
  "baseline-docs-root.md"      # generated-docs root resolution (CLAUDE_STACK_DOCS_PATH)
  "baseline-memory.md"        # what goes to the memory MCP - locks it in, like baseline-navigation locks serena
  # Path-scoped routing
  "markdown-docs.md"          # markdown-style routing, path-scoped **/*.md
  "javascript-conventions.md"  # JS-family conventions, path-scoped js/jsx/mjs/cjs
  "dotnet-repair-agents.md"   # .NET repair-loop routing, path-scoped cs/csproj/sln/xaml
  "angular-repair-agents.md"  # Angular repair-loop routing, path-scoped
  # Convention rules (soft, glob auto-attach) - each points ONE file family at its house-style skill; replaced the require-convention-skill hard gate.
  "typescript-conventions.md" # ts/js family -> typescript (framework-agnostic baseline)
  "angular-conventions.md"    # Angular file shapes -> angular-conventions (Angular/Ionic projects only)
  "angular-styling-conventions.md" # scss/css -> angular-styling (Angular/Ionic projects only)
  "csharp-conventions.md"     # c#: .cs -> csharp (backend, desktop, console)
  "wpf-conventions.md"        # wpf: .xaml -> dotnet-wpf
  "winforms-conventions.md"   # winforms: .Designer.cs -> dotnet-winforms
  "sql-conventions.md"        # sql: .sql -> database-conventions
  "devops-conventions.md"     # rest (devops): Dockerfile/compose/workflow -> devops
)

# --- --installed-only: derive the selection from the install target -------
# The update fast path: refresh exactly what is on disk, adding nothing. The
# file-based layers come from the target dirs (generated project-owned files
# excluded - the captures rewrite those, not the stack), mcps from the
# project's .mcp.json (global mode has no file to read - MCP refresh is skipped
# there); plugins are machine-level and left to 'claude plugin update' or the
# guided commands. The derived set is closed through stack-select.js when it is
# reachable next to this script (a checkout or an extracted snapshot), so a
# dependency a NEW release introduced still installs; a bare curl-piped run has
# no graph and refreshes the disk set as-is. User-authored files are safe by
# construction: the manifest filter below only ever intersects with stack
# items, so a name the manifests do not carry is never installed or removed.
if [ "$INSTALLED_ONLY" = true ]; then
  _IO_TMP="$(mktemp -d)"
  SELECTION="$_IO_TMP/selection.txt"
  case "$CLAUDE_SCOPE" in user) _io_claude="$CONFIG_DIR" ;; *) _io_claude="$PWD/.claude" ;; esac
  {
    for d in "$_io_claude"/skills/*/; do [ -f "${d}SKILL.md" ] && printf 'skill %s\n' "$(basename "$d")" || true; done
    for f in "$_io_claude"/agents/*.md; do [ -f "$f" ] && printf 'agent %s\n' "$(basename "${f%.md}")" || true; done
    for f in "$_io_claude"/rules/*.md; do
      [ -f "$f" ] || continue; _io_b="$(basename "${f%.md}")"
      case "$_io_b" in baseline-project-*|project-code-style) continue ;; esac
      printf 'rule %s\n' "$_io_b"
    done
    for f in "$_io_claude"/hooks/*.js; do
      [ -f "$f" ] || continue; _io_b="$(basename "${f%.js}")"
      case "$_io_b" in inject-code-style|docs|memory|hook-prelude|fresh-session) continue ;; esac   # docs.js/memory.js are engines and hook-prelude.js the shared gate module - none is a hook
      printf 'hook %s\n' "$_io_b"
    done
    if [ "$CLAUDE_SCOPE" = "project" ] && [ -f "$PWD/.mcp.json" ] && command -v node >/dev/null 2>&1; then
      # playwright-<engine> servers are ONE manifest entry (playwright), expanded again after the selection
      node -e 'const s=new Set();for(const n of Object.keys((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mcpServers)||{}))s.add("mcp "+n.replace(/^playwright-(chrome|msedge|firefox|webkit)$/,"playwright"));for(const l of s)console.log(l)' "$PWD/.mcp.json" 2>/dev/null || true
    elif command -v claude >/dev/null 2>&1; then
      # No .mcp.json to read (a global install, or a project whose config the CLI owns): ask the CLI
      # which servers are registered. Names are intersected with the MCPS manifest by the selection
      # filter below, so a claude.ai-managed or hand-added server is never touched.
      claude mcp list 2>/dev/null | sed -n 's/^\([A-Za-z0-9_.-]*\):[[:space:]].*/mcp \1/p' | sed -E 's/^mcp playwright-(chrome|msedge|firefox|webkit)$/mcp playwright/' | awk '!seen[$0]++' || true
    fi
    # Plugins are machine-level, so they are derived from the CLI listing rather than from a
    # project directory - without this the fast path filtered PLUGINS to empty and 'update' never
    # ran `claude plugin update` on anything. Run from the project dir, the listing carries this
    # project's plugins plus the user-scoped ones (claude-hud); duplicates are collapsed.
    if command -v claude >/dev/null 2>&1; then
      _io_known=""; for _io_p in ${PLUGINS[@]+"${PLUGINS[@]}"}; do _io_known="$_io_known ${_io_p%%@*}"; done
      claude plugin list 2>/dev/null \
        | awk -v known=" $_io_known " '{for(i=1;i<=NF;i++) if($i ~ /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$/){split($i,a,"@"); if(index(known," " a[1] " ")) print "plugin " a[1]}}' \
        | sort -u || true
    fi
  } > "$SELECTION"
  # The CLI could not be read (absent, or an unexpected listing shape): fall back to the manifest's
  # plugin set. Safe on this path because --installed-only is update-only and `claude plugin update`
  # updates an installed plugin and never installs a missing one.
  if ! grep -q '^plugin ' "$SELECTION"; then
    for _io_p in ${PLUGINS[@]+"${PLUGINS[@]}"}; do printf 'plugin %s\n' "${_io_p%%@*}" >> "$SELECTION"; done
  fi
  # The nothing-installed guard tests the FILE layers only. A bare `grep -q .` could never fail here:
  # the plugin fallback directly above appends a line for every manifest plugin, so a derivation that
  # found zero skills, agents, rules and hooks still carried lines and the run continued to a stamped
  # no-op update. Plugins are machine-level and mcps come from .mcp.json; neither is evidence that
  # THIS target has an install.
  grep -qE '^(skill|agent|rule|hook) ' "$SELECTION" || { echo "error: --installed-only found nothing installed under $_io_claude - run '$0 install' (or the /claude-stack:setup command) first" >&2; rm -rf "$_IO_TMP"; exit 1; }
  _io_script_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
  # Skills and agents live in the stack's own PLUGINS on that route, so the disk scan above saw only
  # the EXTRAS. The rest is recovered from the stack plugins this machine carries for THIS project,
  # expanded to their items by the same placement the installer enables them from - the route-aware
  # inventory shape hooks were given first (hooks-inventory-route). Without it an update read a
  # plugin-native install as 'no skills, no agents' and dropped every per-stack plugin it had.
  # It runs AFTER the nothing-installed guard on purpose: a machine-level plugin listing is no
  # evidence that THIS project has an install, and the guard is the only thing that says so.
  _io_sp=""
  for _io_c in "$_io_script_dir/../selection-plugins.js" "${SOURCE_DIR:+$SOURCE_DIR/scripts/selection-plugins.js}"; do
    if [ -n "$_io_c" ] && [ -f "$_io_c" ]; then _io_sp="$_io_c"; break; fi
  done
  if [ "$SKILLS_VIA_PLUGIN" = "true" ] && [ -n "$_io_sp" ] && command -v node >/dev/null 2>&1 && command -v claude >/dev/null 2>&1; then
    _io_stack_pl="$(claude plugin list 2>/dev/null \
      | awk '{for(i=1;i<=NF;i++) if($i ~ /^claude-stack[A-Za-z0-9_.-]*@[A-Za-z0-9_.-]+$/){split($i,a,"@"); print a[1]}}' \
      | grep -v '^claude-stack-hooks$' | sort -u | paste -sd, - || true)"
    if [ -n "$_io_stack_pl" ]; then
      node "$_io_sp" --items "$_io_stack_pl" 2>/dev/null | while IFS= read -r _io_l; do
        [ -n "$_io_l" ] && ! grep -qxF "$_io_l" "$SELECTION" && printf '%s\n' "$_io_l" >> "$SELECTION"
        true
      done
      log "installed-only: skills and agents read from the plugins ($_io_stack_pl)"
    fi
  fi
  # A hook the release ADDED reaches an existing install ONLY here. The derivation above lists what
  # is on DISK, so a newly shipped guard was invisible to every update - measured: the v0.2.20
  # commit gate reached zero of three consuming projects, every run surfacing it as an FYI the user
  # exited past while the same runs refreshed the rule text it exists to enforce. Hooks are
  # therefore an all-or-nothing layer on this path: an install that HAS hooks gets every shipped
  # one. The exception is a deliberate drop - a hook named in the PREVIOUS run's stamp and absent
  # from disk now was removed through configure, and stays removed.
  if grep -q '^hook ' "$SELECTION"; then
    # No stamp, or one written before this key existed, leaves _io_prev empty - and an empty
    # 'shipped then' set means every absent hook reads as new and is adopted once. That is the
    # intended first-update behaviour: the stamp this run writes then records the catalog, so a
    # drop made after it sticks. `|| true` because set -e would kill the run on a missing stamp.
    _io_prev="$(sed -n 's/^shipped-hooks: //p' "$_io_claude/claude-stack.stamp" 2>/dev/null | head -1 || true)"
    for _io_e in ${HOOKS_CATALOG[@]+"${HOOKS_CATALOG[@]}"}; do
      _io_n="${_io_e%%::*}"; _io_n="${_io_n%.js}"
      if grep -qxF "hook $_io_n" "$SELECTION"; then continue; fi
      case ",$_io_prev," in
        *",$_io_n,"*) log "installed-only: hook $_io_n was dropped from this install - leaving it out" ; continue ;;
      esac
      printf 'hook %s\n' "$_io_n" >> "$SELECTION"
      log "installed-only: adopting hook $_io_n - shipped by this release and absent here"
    done
  fi
  # The always-on baseline (meta/recommendations.json `always.rules` / `always.mcps`) is adopted the
  # same way: a rule or server every install carries reached an existing one ONLY here - measured, a
  # pre-memory install updated to this release gained the start hook but never baseline-memory.md or
  # the memory server, the rule and the server the switch-off of Claude's own memory depends on. A
  # layer this install does not carry at all (no rule, or no server, found above) stays absent. There
  # is NO drop exception here, unlike hooks: the always set is locked, like serena, so an always item
  # absent from disk is adopted whatever the previous stamp says - a stamp that named the shipped list
  # once read as a drop of everything a standalone run had failed to adopt, and memory never arrived.
  # The file sits next to this script (a checkout or an extracted snapshot) or in --source; a bare
  # curl-piped run has neither and adopts nothing - the import gate below then keeps memory on, and
  # the next run that finds the file adopts.
  _io_recs=""
  for _io_c in "$_io_script_dir/../../meta/recommendations.json" "${SOURCE_DIR:+$SOURCE_DIR/meta/recommendations.json}"; do
    if [ -n "$_io_c" ] && [ -f "$_io_c" ]; then _io_recs="$_io_c"; break; fi
  done
  if [ -n "$_io_recs" ] && command -v node >/dev/null 2>&1; then
    for _io_cat in rule mcp; do
      grep -q "^$_io_cat " "$SELECTION" || continue
      _io_always="$(node -e 'try{const a=(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).always||{})[process.argv[2]];if(Array.isArray(a))console.log(a.join(" "));}catch{}' "$_io_recs" "${_io_cat}s" 2>/dev/null || true)"
      for _io_n in $_io_always; do
        if grep -qxF "$_io_cat $_io_n" "$SELECTION"; then continue; fi
        printf '%s %s\n' "$_io_cat" "$_io_n" >> "$SELECTION"
        log "installed-only: adopting $_io_cat $_io_n - always shipped by this release and absent here"
      done
    done
  fi
  # No hooks on disk must stay no hooks: the filter's no-hook-lines special case
  # would otherwise install all of them.
  grep -q '^hook ' "$SELECTION" || HOOKS=()
  _io_sel_js="$_io_script_dir/../stack-select.js"
  _io_graph="$_io_script_dir/../../meta/stack-graph.json"
  if command -v node >/dev/null 2>&1 && [ -f "$_io_sel_js" ] && [ -f "$_io_graph" ]; then
    node -e 'const fs=require("fs");const cat={skill:"skills",plugin:"plugins",mcp:"mcps",agent:"agents",rule:"rules",hook:"hooks"};const sel={skills:[],plugins:[],mcps:[],agents:[],rules:[],hooks:[]};for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){const m=l.trim().match(/^(\S+)\s+(.+)$/);if(m&&cat[m[1]])sel[cat[m[1]]].push(m[2]);}fs.writeFileSync(process.argv[2],JSON.stringify(sel))' "$SELECTION" "$_IO_TMP/raw.json"
    if node "$_io_sel_js" --selection "$_IO_TMP/raw.json" --graph "$_io_graph" --emit "$_IO_TMP/closed.txt" > "$_IO_TMP/closure.log" 2>&1; then
      SELECTION="$_IO_TMP/closed.txt"
      while IFS= read -r _io_l; do log "installed-only: $_io_l"; done < "$_IO_TMP/closure.log"
    else
      log "installed-only: closure failed - refreshing the disk set as-is ($(head -1 "$_IO_TMP/closure.log" 2>/dev/null))"
    fi
  else
    log "installed-only: stack-select.js not reachable next to this script - refreshing the disk set as-is (new upstream dependencies are not auto-carried; run from a checkout or use the /claude-stack:update command)"
  fi
fi

# --- Selection subset filter (Component B) --------------------------------
# With --selection <file>, keep only the SKILLS / PLUGINS / MCPS / AGENTS /
# CLAUDE_RULES entries whose name appears in the file (one 'category name' per
# line; '#' comments and blank lines ignored). HOOKS are never filtered - they
# are foundational. --print-plan prints the resolved per-category set and exits
# (a dry run) before any prerequisite or install step runs.
if [ -n "$SELECTION" ]; then
  [ -f "$SELECTION" ] || { printf 'selection file not found: %s\n' "$SELECTION" >&2; exit 1; }

  _sel_has() { grep -qxF "$1 $2" "$SELECTION"; }   # 0 if 'category name' is a line

  _f=(); for e in ${SKILLS[@]+"${SKILLS[@]}"};             do _sel_has skill  "${e#*|}"                                    && _f+=("$e"); done; SKILLS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${PLUGINS[@]+"${PLUGINS[@]}"};           do _sel_has plugin "${e%%@*}"                                   && _f+=("$e"); done; PLUGINS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${MCPS[@]+"${MCPS[@]}"};                 do _sel_has mcp    "${e%%|*}"                                   && _f+=("$e"); done; MCPS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${AGENTS[@]+"${AGENTS[@]}"};             do n="${e%%::*}"; _sel_has agent "${n%.md}"                     && _f+=("$e"); done; AGENTS=(${_f[@]+"${_f[@]}"})
  _f=(); for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do n="${e%%::*}"; _sel_has rule  "${n%.md}"                     && _f+=("$e"); done; CLAUDE_RULES=(${_f[@]+"${_f[@]}"})
  # Hooks joined the selection with the guided walk's hooks layer. A selection with no
  # 'hook' lines predates that layer - keep its install-every-hook behavior unchanged.
  if grep -q '^hook ' "$SELECTION"; then
    _f=(); for e in ${HOOKS[@]+"${HOOKS[@]}"};             do n="${e%%::*}"; _sel_has hook  "${n%.js}"                     && _f+=("$e"); done; HOOKS=(${_f[@]+"${_f[@]}"})
  fi
fi

if [ "$PRINT_PLAN" = true ]; then
  printf 'plan skills:';  for e in ${SKILLS[@]+"${SKILLS[@]}"};             do printf ' %s' "${e#*|}";                 done; printf '\n'
  printf 'plan plugins:'; for e in ${PLUGINS[@]+"${PLUGINS[@]}"};           do printf ' %s' "${e%%@*}";                done; printf '\n'
  printf 'plan mcps:';    for e in ${MCPS[@]+"${MCPS[@]}"};                 do printf ' %s' "${e%%|*}";                done; printf '\n'
  printf 'plan agents:';  for e in ${AGENTS[@]+"${AGENTS[@]}"};             do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  printf 'plan rules:';   for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  # dedupe display: one hook wired on two tools is still one hook in the plan
  printf 'plan hooks:';   _seen=""; for e in ${HOOKS[@]+"${HOOKS[@]}"};     do n="${e%%::*}"; case " $_seen " in *" $n "*) continue ;; esac; _seen="$_seen $n"; printf ' %s' "${n%.js}"; done; printf '\n'
  [ -n "${_IO_TMP:-}" ] && rm -rf "$_IO_TMP"   # the EXIT trap is installed further down - clean the --installed-only scratch here
  exit 0
fi

# project level: the db lives INSIDE the project, self-ignored so it is never committed - a
# '.memory-mcp/.gitignore' holding '*' only when absent (FACT-GITIGNORE: neither twin otherwise ever
# writes to a project's .gitignore; this file lives fully inside the folder it ignores, so that
# precedent is untouched - the project's own .gitignore is never opened). Also covers a KEPT existing
# path that happens to already be project-shaped. After the --print-plan exit: a dry run writes nothing.
if [ "$MEMORY_LEVEL" = "project" ] && [ -n "$MEMORY_PROJECT_ROOT" ]; then
  mkdir -p "$MEMORY_PROJECT_ROOT/.memory-mcp"
  [ -f "$MEMORY_PROJECT_ROOT/.memory-mcp/.gitignore" ] || printf '*\n' > "$MEMORY_PROJECT_ROOT/.memory-mcp/.gitignore"
fi

# --- playwright: one server per browser engine --------------------------------------------------
# A Playwright MCP server drives ONE browser, fixed at launch (`--browser`; @playwright/mcp 0.0.80 has
# no tool to switch it - measured), so the manifest's single `playwright` entry expands HERE, after the
# selection, into playwright-chrome / -msedge / -firefox / -webkit: each an explicit --browser and its
# own profile folder, because a persistent profile belongs to one engine. Every later step (add,
# refresh, verify, the settings approvals) sees the real server names. Which one is ON is the user's
# `/mcp enable` / `disable` - the run writes no toggle state and only prints the lines to run when
# --playwright-enabled names the engine to keep on.
# Kept set: the flag, else what is registered - project scope reads .mcp.json, user scope the CLI
# listing; a legacy `playwright` server counts as its --browser engine (none = chrome) - else chrome.
_pw_registered() {
  if [ "$CLAUDE_SCOPE" = "project" ]; then
    [ -f "$PWD/.mcp.json" ] && command -v node >/dev/null 2>&1 || return 0
    node -e '
const fs=require("fs");let s={};try{s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).mcpServers||{}}catch{}
for(const [n,v] of Object.entries(s)){const m=n.match(/^playwright-(chrome|msedge|firefox|webkit)$/);if(m){console.log(m[1]);continue}
if(n==="playwright"){const a=(v&&v.args)||[];const i=a.indexOf("--browser");const eq=a.find(x=>/^--browser=/.test(x));console.log(i>=0?a[i+1]:eq?eq.slice(10):"chrome")}}' "$PWD/.mcp.json" 2>/dev/null || true
  elif command -v claude >/dev/null 2>&1; then
    # the chrome fallback runs FIRST: after the engine substitution the line no longer carries
    # --browser, so the other order printed chrome beside every named engine (measured)
    claude mcp list 2>/dev/null | sed -n -E 's/^playwright-(chrome|msedge|firefox|webkit):.*/\1/p; /^playwright:/{/--browser/!s/.*/chrome/p;s/.*--browser[= ]([a-z]+).*/\1/p;}' || true
  fi
}
_pw_args_for() {  # $1 = manifest args $2 = engine -> the engine's args: --browser after the package, profile/<engine>
  local -a words; local out="" w prev=""
  read -ra words <<<"$1"
  for w in "${words[@]}"; do
    [ "$prev" = "--user-data-dir" ] && w="$w/$2"
    out="$out $w"
    case "$w" in @playwright/mcp*) out="$out --browser $2" ;; esac
    prev="$w"
  done
  printf '%s' "${out# }"
}
PW_MIGRATED=""
if printf '%s\n' ${MCPS[@]+"${MCPS[@]}"} | grep -q '^playwright|'; then
  if [ -z "$PLAYWRIGHT_BROWSERS" ]; then
    _pw_have=" $(_pw_registered | tr '\n' ' ') "
    [ -n "$PLAYWRIGHT_ENABLED" ] && _pw_have="$_pw_have$PLAYWRIGHT_ENABLED "
    for _pw_e in $PW_ENGINES_ALL; do case "$_pw_have" in *" $_pw_e "*) PLAYWRIGHT_BROWSERS="$PLAYWRIGHT_BROWSERS $_pw_e" ;; esac; done
    PLAYWRIGHT_BROWSERS="${PLAYWRIGHT_BROWSERS# }"
    [ -n "$PLAYWRIGHT_BROWSERS" ] || PLAYWRIGHT_BROWSERS="chrome"
  fi
  _f=()
  for e in ${MCPS[@]+"${MCPS[@]}"}; do
    if [ "${e%%|*}" = "playwright" ]; then
      for _pw_e in $PLAYWRIGHT_BROWSERS; do _f+=("playwright-$_pw_e|$(_pw_args_for "${e#*|}" "$_pw_e")"); done
    else _f+=("$e"); fi
  done
  MCPS=(${_f[@]+"${_f[@]}"})
fi

# ===========================================================================
# SOURCE SNAPSHOT - the ONE revision every artifact in a run comes from
# ===========================================================================
# Every file the stack installs (skills, hooks, agents, rules, the CLAUDE.md template) lives in
# this one repo, so a run takes ONE source snapshot and copies out of it: the rolling 'latest'
# release archive (.github/workflows/release.yml republishes it on every push to main, with a
# RELEASE-SOURCE file inside naming the exact commit), falling back to a shallow git clone when
# no release is reachable (a fork without releases, a blocked CDN, the brief window while the
# workflow recreates the release). Why one snapshot and not the per-file
# raw.githubusercontent.com fetches this replaced:
#   - ATOMIC. An archive or clone is a single revision. The raw URLs are per-file and CDN-cached
#     (a push takes ~5 min to propagate), so a raw run could mix revisions - and then
#     claude-stack.stamp, which records the revision this install came from, would be a lie. The
#     snapshot makes the stamp true by construction.
#   - CHEAP. One download replaces ~50 round trips (the HOOKS + AGENTS + CLAUDE_RULES arrays).
# Fail-soft, like the fetches were: no source (archive AND clone failed) means callers keep the
# copies already on disk and the run carries on. STACK_SHA stays empty, which is what suppresses
# the stamp write.
#
# --source <dir> hands in a source the CALLER already fetched (an extracted release archive or a
# git checkout). That is the plugin path: the setup / configure skills must download anyway (they
# need stack-select.js, stack-graph.json, the CLAUDE.md template and the stamp diff before the
# install runs), so they pass that same source here and the guided run costs ONE download instead
# of two. A caller-provided dir is borrowed, never deleted. Standalone (no --source) is
# unchanged: the script fetches its own source and cleans it up.
STACK_REPO_URL="${STACK_SKILLS_REPO:-https://github.com/envoydev/claude-stack}"
STACK_SRC=""            # the source worktree; empty until stack_src runs
STACK_SHA=""            # the exact commit every artifact this run installs was copied from
STACK_REF=""            # the branch that commit is the tip of (whatever the source's HEAD is)
STACK_SRC_TRIED=false   # memoises the OUTCOME, so a dead source costs one fetch attempt, not one per caller
STACK_SRC_OWNED=false   # true only when WE fetched it - the EXIT trap removes ours, never the caller's
STACK_SRC_ROOT=""       # the temp dir an owned fetch lives in (the EXIT trap's removal target)

# THE SOURCE IS WHAT CLAUDE CODE ALREADY CACHED.
# Every marketplace entry shares this repo's root as its `source`, so installing the core plugin
# leaves the WHOLE repo at <config>/plugins/cache/<marketplace>/claude-stack/<version> - measured on
# a real install: stack/rules, stack/CLAUDE.template.md, the two hook engines, meta/, scripts/ and
# RELEASE-SOURCE are all there. That is the same snapshot the installer used to download, fetched
# once per release by the CLI itself, so the stack keeps no second cache of its own. The archive and
# clone routes below remain for the two paths that have no plugin cache to read: the copy route
# (both VIA_PLUGIN switches off) and a machine with no `claude` CLI.
_stack_plugin_cache() {
  # Prints the newest valid version directory of the core plugin's cache entry, or nothing.
  # 'Newest' is by sort -V over the directory names, which ARE the release versions the CLI writes.
  local base="$CONFIG_DIR/plugins/cache" mkt dir v best=""
  [ -d "$base" ] || return 0
  for mkt in "$base"/*; do
    [ -d "$mkt/claude-stack" ] || continue
    for dir in "$mkt"/claude-stack/*; do
      _stack_src_valid "$dir" || continue
      v="$(basename "$dir")"
      if [ -z "$best" ] || [ "$(printf '%s\n%s\n' "$(basename "$best")" "$v" | sort -V | tail -1)" = "$v" ]; then best="$dir"; fi
    done
  done
  [ -n "$best" ] && printf '%s' "$best"
  return 0
}

# The one validity test every source route shares: a directory counts as the stack only when it
# carries both trees, so an interrupted write is rejected rather than half-installed.
_stack_src_valid() { [ -d "$1/stack/skills" ] && [ -d "$1/stack/agents" ]; }

_cleanup_stack_src() {
  if $STACK_SRC_OWNED && [ -n "$STACK_SRC_ROOT" ]; then rm -rf "$STACK_SRC_ROOT"; fi
  [ -n "${_IO_TMP:-}" ] && rm -rf "$_IO_TMP"
  return 0
}
trap _cleanup_stack_src EXIT

stack_src() {
  # Resolves on the first call; every later caller reuses the worktree. Returns non-zero (never
  # aborts) when the source is unavailable, so each caller applies its own fail-soft.
  # Memoise BOTH outcomes: five steps call this, and without the failure latch an offline run
  # would pay five download timeouts and report five failures for one root cause.
  [ -n "$STACK_SRC" ] && return 0
  $STACK_SRC_TRIED && return 1
  STACK_SRC_TRIED=true

  if [ -n "$SOURCE_DIR" ]; then
    # Borrowed source. Sanity-check it IS the stack (a wrong --source would otherwise 'install'
    # nothing and report 117 per-file failures), then read its revision: a git checkout carries
    # it in HEAD, an extracted release archive in its RELEASE-SOURCE file.
    if [ ! -d "$SOURCE_DIR/stack/skills" ] || [ ! -d "$SOURCE_DIR/stack/agents" ]; then
      note_failure "--source '$SOURCE_DIR' is not a claude-stack checkout (no stack/skills + stack/agents) - stack source unavailable"
      return 1
    fi
    STACK_SRC="$SOURCE_DIR"; STACK_SRC_OWNED=false
    STACK_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
    STACK_REF="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$STACK_SHA" ]; then
      # Stamp the URL the caller actually cloned from, not our default - they may have used a fork.
      STACK_REPO_URL="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || echo "$STACK_REPO_URL")"
      # an SSH remote is no browsable URL for the stamp's compare line - spell it as https
      STACK_REPO_URL="$(printf '%s' "$STACK_REPO_URL" | sed -E 's#^(ssh://)?git@([^:/]+)[:/](.+)$#https://\2/\3#; s#\.git$##')"
    elif [ -f "$SOURCE_DIR/RELEASE-SOURCE" ]; then
      STACK_SHA="$(sed -n 's/^sha: //p' "$SOURCE_DIR/RELEASE-SOURCE" | head -1)"
      STACK_REF="$(sed -n 's/^ref: //p' "$SOURCE_DIR/RELEASE-SOURCE" | head -1)"
    fi
    if [ -z "$STACK_SHA" ]; then
      log "source: $SOURCE_DIR (provided; no git checkout or RELEASE-SOURCE - no revision, so no stamp)"
    else
      log "source: $SOURCE_DIR (provided) @ ${STACK_REF:-?} $(printf '%.12s' "$STACK_SHA")"
    fi
    return 0
  fi

  # What the CLI already cached: no probe, no download, and it is the exact snapshot the enabled
  # plugins are running from, so the seed and the plugins can never be two different releases.
  local cached; cached="$(_stack_plugin_cache)"
  if [ -n "$cached" ]; then
    STACK_SRC="$cached"; STACK_SRC_OWNED=false
    STACK_SHA="$(sed -n 's/^sha: //p' "$STACK_SRC/RELEASE-SOURCE" 2>/dev/null | head -1 || true)"
    STACK_REF="$(sed -n 's/^ref: //p' "$STACK_SRC/RELEASE-SOURCE" 2>/dev/null | head -1 || true)"
    log "source: plugin cache $STACK_SRC @ ${STACK_REF:-?} $(printf '%.12s' "${STACK_SHA:-unknown}") (no download)"
    return 0
  fi

  # Release archive: one asset is one revision, and no git is needed to take it.
  local tmp; tmp="$(mktemp -d)"
  local url="$STACK_REPO_URL/releases/latest/download/claude-stack.tar.gz"
  if command -v curl >/dev/null 2>&1 &&
     curl -fsSL "$url" -o "$tmp/claude-stack.tar.gz" 2>/dev/null &&
     mkdir -p "$tmp/repo" &&
     tar -xzf "$tmp/claude-stack.tar.gz" -C "$tmp/repo" 2>/dev/null &&
     _stack_src_valid "$tmp/repo"; then
    STACK_SRC="$tmp/repo"; STACK_SRC_ROOT="$tmp"; STACK_SRC_OWNED=true
    STACK_SHA="$(sed -n 's/^sha: //p' "$tmp/repo/RELEASE-SOURCE" 2>/dev/null | head -1)"
    STACK_REF="$(sed -n 's/^ref: //p' "$tmp/repo/RELEASE-SOURCE" 2>/dev/null | head -1)"
    log "source: $url @ ${STACK_REF:-?} $(printf '%.12s' "${STACK_SHA:-unknown}")"
    return 0
  fi
  rm -rf "$tmp"

  # Fallback: a shallow clone - a fork without releases, a blocked release CDN, a local test path.
  # Pinned to main: the release branch is what installs deliver, never the default branch
  # (development lands on develop).
  command -v git >/dev/null 2>&1 || { note_failure "release archive unreachable and git not found - stack source unavailable"; return 1; }
  tmp="$(mktemp -d)"
  if ! git clone --depth 1 -b main "$STACK_REPO_URL" "$tmp" >/dev/null 2>&1; then
    rm -rf "$tmp"
    # Nothing networked answered, and the plugin cache above was empty too - which is the only
    # offline source now, and the one an ordinary machine has.
    note_failure "release archive and clone of $STACK_REPO_URL both failed, and no plugin cache is present - stack source unavailable (nothing refreshed; existing copies kept)"
    return 1
  fi
  STACK_SRC="$tmp"; STACK_SRC_ROOT="$tmp"; STACK_SRC_OWNED=true
  STACK_SHA="$(git -C "$tmp" rev-parse HEAD 2>/dev/null)"
  STACK_REF="$(git -C "$tmp" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  log "source: $STACK_REPO_URL (clone fallback) @ ${STACK_REF:-?} $(printf '%.12s' "${STACK_SHA:-unknown}")"
  return 0
}

# ===========================================================================
# INSTALL - skills re-add UNCONDITIONALLY (clean copy each run); MCPs and plugins SKIP if already present
# ===========================================================================
# The plugins that carry THIS project's picked skills and agents, plus the EXTRAS no plugin carries.
# Computed once per run from the post-selection manifests by scripts/selection-plugins.js, which
# reads the same placement the marketplace entries are generated from - so the installer can never
# enable a set that disagrees with what the marketplace actually ships.
# Fail-soft, and the fallback is the whole 0.2.x route: without node, without a source snapshot, or
# on any error, SKILLS_VIA_PLUGIN drops to false and everything is copied as before. An install that
# cannot compute its plugin set still ends with a working stack.
_STACK_PLUGINS_RESOLVED=false
STACK_SEL_PLUGINS=()
STACK_RUN_PLUGINS=()
PLUGIN_EXTRA_SKILLS=()
PLUGIN_EXTRA_AGENTS=()
resolve_stack_plugins() {
  [ "$_STACK_PLUGINS_RESOLVED" = true ] && return 0
  _STACK_PLUGINS_RESOLVED=true
  # Either route needs the closure: the skills/agents live in the per-stack entries and, from
  # Phase 6, so do the MCP servers - one plugin named for each catalog server.
  [ "$SKILLS_VIA_PLUGIN" = "true" ] || [ "$MCPS_VIA_PLUGIN" = "true" ] || return 0
  local why=""
  command -v node >/dev/null 2>&1 || why="node not found"
  [ -n "$why" ] || stack_src || why="no source snapshot"
  [ -n "$why" ] || [ -f "$STACK_SRC/scripts/selection-plugins.js" ] || why="selection-plugins.js is not in this source"
  if [ -n "$why" ]; then
    SKILLS_VIA_PLUGIN=false
    MCPS_VIA_PLUGIN=false; _refresh_retired_mcps
    log "  !! $why - skills, agents and MCP servers stay on the copy route"
    return 0
  fi
  local tmp entry name out
  tmp="$(mktemp -d)" || { SKILLS_VIA_PLUGIN=false; return 0; }
  {
    if [ "$SKILLS_VIA_PLUGIN" = "true" ]; then
      for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do printf 'skill %s\n' "${entry#*|}"; done
      for entry in ${AGENTS[@]+"${AGENTS[@]}"}; do name="${entry%%::*}"; printf 'agent %s\n' "${name%.md}"; done
    fi
    # The selection's MCP picks are names, one per catalog row; selection-plugins.js folds the two
    # expanded families (playwright-<engine>, context7-<remote|local>) back onto their one plugin.
    if [ "$MCPS_VIA_PLUGIN" = "true" ]; then
      for entry in ${MCPS[@]+"${MCPS[@]}"}; do printf 'mcp %s\n' "${entry%%|*}"; done
      # The local context7 transport is its OWN entry beside the hosted one - two servers in one
      # plugin both load, so the local mode adds a plugin rather than swapping a server. The hosted
      # one stays installed because the core depends on it; the summary prints the /mcp disable line.
      [ "$CONTEXT7_MODE" = "local" ] && printf 'mcp context7-local\n'
    fi
  } > "$tmp/selection.txt"
  if ! out="$(node "$STACK_SRC/scripts/selection-plugins.js" --selection "$tmp/selection.txt" 2>"$tmp/err")"; then
    SKILLS_VIA_PLUGIN=false
    MCPS_VIA_PLUGIN=false; _refresh_retired_mcps
    log "  !! plugin set not computed ($(head -1 "$tmp/err" 2>/dev/null)) - skills, agents and MCP servers stay on the copy route"
    rm -rf "$tmp"; return 0
  fi
  while IFS= read -r name; do [ -n "$name" ] && STACK_SEL_PLUGINS+=("$name"); done <<EOF
$out
EOF
  out="$(node "$STACK_SRC/scripts/selection-plugins.js" --selection "$tmp/selection.txt" --copy 2>/dev/null || true)"
  while IFS= read -r name; do
    case "$name" in
      "skill "*) PLUGIN_EXTRA_SKILLS+=("${name#skill }") ;;
      "agent "*) PLUGIN_EXTRA_AGENTS+=("${name#agent }") ;;
    esac
  done <<EOF
$out
EOF
  rm -rf "$tmp"
  log "plugins carry ${#STACK_SEL_PLUGINS[@]} entr(ies); extras copied: ${#PLUGIN_EXTRA_SKILLS[@]} skill(s), ${#PLUGIN_EXTRA_AGENTS[@]} agent(s)"
}

_is_extra() {  # $1 = name, rest = the extras list -> 0 when the name is one of them
  local want="$1"; shift
  local n; for n in "$@"; do [ "$n" = "$want" ] && return 0; done
  return 1
}

install_skills() {
  # Copy each selected skills/<name>/ out of the run's clone into the scope dest - all house
  # skills live in ONE repo, so a plain copy fully reproduces what the skills CLI used to stage;
  # no npx/network-registry dependency. On the plugin route only the EXTRAS travel this way.
  resolve_stack_plugins
  stack_src || { note_failure "skills not installed"; return 0; }   # fail-soft: skip, never abort
  local name dest entry
  local -a copy_skills=()
  case "$CLAUDE_SCOPE" in user) dest="$CONFIG_DIR/skills" ;; *) dest="$PWD/.claude/skills" ;; esac
  mkdir -p "$dest"
  if [ "$SKILLS_VIA_PLUGIN" = "true" ]; then
    # Prune BEFORE the plugins are enabled in the same run: a leftover copy SHADOWS the plugin's own
    # (spike S6) with no error and no sign in the transcript. Only names the shipped manifest carries
    # are pruned, so a skill folder this stack never installed - the project's own - is left alone.
    for entry in ${SKILLS_CATALOG[@]+"${SKILLS_CATALOG[@]}"}; do
      name="${entry#*|}"
      _is_extra "$name" ${PLUGIN_EXTRA_SKILLS[@]+"${PLUGIN_EXTRA_SKILLS[@]}"} && continue
      [ -d "$dest/$name" ] && { rm -rf "$dest/$name"; log "  skill pruned (now carried by a plugin): $name"; }
    done
    copy_skills=(${PLUGIN_EXTRA_SKILLS[@]+"${PLUGIN_EXTRA_SKILLS[@]}"})
  else
    for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do copy_skills+=("${entry#*|}"); done
  fi
  for name in ${copy_skills[@]+"${copy_skills[@]}"}; do
    if [ -d "$STACK_SRC/stack/skills/$name" ]; then
      rm -rf "$dest/$name"; cp -R "$STACK_SRC/stack/skills/$name" "$dest/$name"
      log "skill [$CLAUDE_SCOPE]: $name -> $dest/$name"
    else
      note_failure "skill '$name' not found in $STACK_REPO_URL"
    fi
  done
}

# Claude Code registers claude-plugins-official itself only on its first INTERACTIVE launch
# (code.claude.com/docs/en/plugins), so an install before that failed every official plugin with 'not
# found in marketplace' (measured on a fresh config). Register it (a no-op when present) and refresh it
# so a stale clone knows the plugins this release names. Fail-soft both ways.
ensure_official_marketplace() {
  claude plugin marketplace add anthropics/claude-plugins-official >/dev/null 2>&1 || true
  claude plugin marketplace update claude-plugins-official >/dev/null 2>&1 || true
}

# The stack's OWN plugin names for this run, with its marketplace registered - shared by install,
# update and the --skills-only fast path, which on this route can no longer be a pure file copy:
# it PRUNES the copies, so a run that skipped the enable would leave the project with neither.
# Fills the GLOBAL STACK_RUN_PLUGINS - a nameref would be cleaner and macOS still ships bash 3.2.
_stack_plugin_set() {
  STACK_RUN_PLUGINS=()
  resolve_stack_plugins      # may drop SKILLS_VIA_PLUGIN / MCPS_VIA_PLUGIN to false, so it runs before the test below
  [ "$HOOKS_VIA_PLUGIN" = "true" ] || [ "$SKILLS_VIA_PLUGIN" = "true" ] || [ "$MCPS_VIA_PLUGIN" = "true" ] || return 0
  claude plugin marketplace add "$STACK_MARKETPLACE" >/dev/null 2>&1 || true
  claude plugin marketplace update claude-stack >/dev/null 2>&1 || true
  if [ "$HOOKS_VIA_PLUGIN" = "true" ]; then STACK_RUN_PLUGINS+=(${STACK_PLUGINS[@]+"${STACK_PLUGINS[@]}"}); fi
  # ONE closure list for both routes: resolve_stack_plugins fed it skill/agent lines only when
  # SKILLS_VIA_PLUGIN is on and mcp lines only when MCPS_VIA_PLUGIN is, so whatever it holds is
  # exactly what this combination of routes needs enabled.
  if [ "$SKILLS_VIA_PLUGIN" = "true" ] || [ "$MCPS_VIA_PLUGIN" = "true" ]; then
    STACK_RUN_PLUGINS+=(${STACK_SEL_PLUGINS[@]+"${STACK_SEL_PLUGINS[@]}"})
  fi
}

# The core's dependency plugins, but only when this run enables no stack plugin - see
# CORE_DEP_PLUGINS. Fills a GLOBAL because macOS still ships bash 3.2, which has no namerefs.
CORE_DEPS_NEEDED=()
_core_deps_needed() {
  CORE_DEPS_NEEDED=()
  [ ${#STACK_RUN_PLUGINS[@]} -eq 0 ] || return 0
  CORE_DEPS_NEEDED=(${CORE_DEP_PLUGINS[@]+"${CORE_DEP_PLUGINS[@]}"})
  return 0
}

# A stack entry cannot ENABLE while one of the core's hard dependencies is set to false at a scope
# with higher precedence than this one - the one documented enable failure whose symptom ('plugin
# ... failed') names nothing the user can act on (code.claude.com/docs/en/plugin-dependencies).
# Printed once, and only for a dependency the listing actually shows as disabled, so a run that
# failed for an unrelated reason is not sent chasing it.
_DEP_LOCK_HINT_SHOWN=false
_dep_lock_hint() {
  case "$1" in *@claude-stack) ;; *) return 0 ;; esac
  [ "$_DEP_LOCK_HINT_SHOWN" = false ] || return 0
  local listing dep name
  listing="$(_plugin_scan)"
  [ -n "$listing" ] || return 0
  for dep in ${CORE_DEP_PLUGINS[@]+"${CORE_DEP_PLUGINS[@]}"}; do
    name="${dep%%@*}"
    [ "$(_plugin_field "$listing" "$name" 4)" = "no" ] || continue
    _DEP_LOCK_HINT_SHOWN=true
    log "     $name is DISABLED and $1 depends on it - enable it first: claude plugin enable $dep --scope $(_plugin_field "$listing" "$name" 3)"
  done
  return 0
}

# Put the SOURCE on disk before anything asks for it, by letting the CLI fetch it: installing the
# core entry leaves the whole repo in the plugin cache, which is what stack_src reads. Only runs
# when the plugin route is on, the CLI exists and no cache is there yet - so it is a no-op on every
# run after the first, and the archive download below it stays as the fail-soft.
_bootstrap_stack_source() {
  # Read the normalised route flags, never the env again: one rule, one home.
  [ "$HOOKS_VIA_PLUGIN" = "true" ] || [ "$SKILLS_VIA_PLUGIN" = "true" ] || return 0
  command -v claude >/dev/null 2>&1 || return 0
  [ -n "$SOURCE_DIR" ] && return 0
  [ -z "$(_stack_plugin_cache)" ] || return 0
  ensure_official_marketplace
  claude plugin marketplace add "$STACK_MARKETPLACE" >/dev/null 2>&1 || true
  claude plugin marketplace update claude-stack >/dev/null 2>&1 || true
  log "source: fetching the core plugin so its cache can serve this run"
  claude plugin install "claude-stack@claude-stack" --scope "$CLAUDE_SCOPE" -y >/dev/null 2>&1 || true
  return 0
}

install_plugins() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  ensure_official_marketplace
  for mp in ${EXTRA_MARKETPLACES[@]+"${EXTRA_MARKETPLACES[@]}"}; do claude plugin marketplace add "$mp" 2>/dev/null || true; done
  # The stack's own marketplace, and the plugins it serves. Registered BEFORE the loop so the
  # hooks plugin resolves in the same run that prunes the copied hooks it replaces.
  local -a _plugins=(${PLUGINS[@]+"${PLUGINS[@]}"})
  _stack_plugin_set
  _plugins+=(${STACK_RUN_PLUGINS[@]+"${STACK_RUN_PLUGINS[@]}"})
  _core_deps_needed; _plugins+=(${CORE_DEPS_NEEDED[@]+"${CORE_DEPS_NEEDED[@]}"})
  for p in ${_plugins[@]+"${_plugins[@]}"}; do
    # claude-hud is a statusline HUD - force USER scope regardless of $CLAUDE_SCOPE. A project-scoped
    # install + the global statusline enable mismatch, so every OTHER project warns "plugin not cached".
    pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac
    log "plugin [$pscope]: $p"
    claude plugin install "$p" --scope "$pscope" -y || { note_failure "plugin $p failed"; _dep_lock_hint "$p"; }   # -y: the marketplace-command consent prompt cannot be answered when stdin/stdout is not a TTY (the guided commands run this non-interactively)
  done
}

_mcp_argv() {  # $1 = manifest args -> spec_words: the argv for `claude mcp add`, path tokens resolved per word
  # Split into argv words FIRST, then resolve @SERENA_CONTEXT@ / @MEMORY_DB_PATH@ inside each word -
  # so a resolved path that contains a space (a home dir like '/Users/Jane Doe', or a --memory-level
  # project root under one) stays ONE argument instead of splitting into two. read -ra
  # splits on whitespace into an array AND disables glob expansion, so a bare '*' in the spec is passed
  # literally, never expanded - which is also why MEMORY_DB_PATH travels as a placeholder token here
  # rather than pre-substituted into the manifest string before this split.
  local i
  read -ra spec_words <<<"$1"
  for i in "${!spec_words[@]}"; do
    spec_words[i]="${spec_words[i]//@SERENA_CONTEXT@/$SERENA_CTX}"
    spec_words[i]="${spec_words[i]//@MEMORY_DB_PATH@/$MEMORY_DB_PATH}"
  done
}

_mcp_register() {  # $1 = name $2 = manifest args - the `claude mcp add` call for ONE server; 0 = added
  # The single add site for install, update and the user-scope repair retry: three copies of this
  # argv used to drift apart (the update copy resolved its argv before the @HTTP@ branch that ignores it).
  local name="$1" args="$2" url hdr
  local -a spec_words
  if [ "$args" = "@HTTP@" ]; then
    # remote (hosted) server - url/header keyed by name: sentry, else context7. An EMPTY header
    # (sentry --sentry-auth oauth) registers with no --header at all, so the OAuth fallback stays on.
    if [ "$name" = "sentry" ]; then url="$SENTRY_REMOTE_URL"; hdr="$SENTRY_REMOTE_HDR"
    else url="$CONTEXT7_REMOTE_URL"; hdr="$CONTEXT7_REMOTE_HDR"; fi
    if [ -n "$hdr" ]; then claude mcp add --transport http --scope "$CLAUDE_SCOPE" "$name" "$url" --header "$hdr"
    else                   claude mcp add --transport http --scope "$CLAUDE_SCOPE" "$name" "$url"; fi
    return $?
  fi
  _mcp_argv "$args"
  claude mcp add --scope "$CLAUDE_SCOPE" "$name" "${spec_words[@]}"
}

# The playwright servers this run no longer keeps - a legacy `playwright` and every dropped engine - go
# away on both actions (they are stack names: install would otherwise leave them live beside the new
# ones). The CLI route runs first; at project scope the stack-owned .mcp.json entry is then removed
# directly, because a `remove` that did not take exits 0 like one that did (see the verify pass).
prune_playwright_servers() {
  # PLUGIN ROUTE: the four engines are declared in the one `playwright` plugin and the user keeps
  # one enabled with /mcp disable, so there is no per-engine registration to drop. The retirement
  # above already removes any the copy route left behind.
  [ "$MCPS_VIA_PLUGIN" = "true" ] && return 0
  [ -n "$PLAYWRIGHT_BROWSERS" ] || return 0
  local name drop=""
  for name in playwright playwright-chrome playwright-msedge playwright-firefox playwright-webkit; do
    case " $(printf 'playwright-%s ' $PLAYWRIGHT_BROWSERS)" in *" $name "*) continue ;; esac
    drop="$drop $name"
  done
  if [ "$CLAUDE_SCOPE" = "project" ]; then
    [ -f "$PWD/.mcp.json" ] || return 0
    # the names present BEFORE the CLI remove are the ones reported: a remove that worked left the
    # node step nothing to find, so the removal went unreported (measured with the real CLI)
    local present=""
    for name in $drop; do grep -q "\"$name\"" "$PWD/.mcp.json" && present="$present $name"; done
    [ -n "$present" ] || return 0
    for name in $present; do claude mcp remove "$name" -s project >/dev/null 2>&1; done
    node -e '
const fs=require("fs");const [p,...gone]=process.argv.slice(1);let d;try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{process.exit(0)}
const s=d.mcpServers||{};const left=gone.filter(n=>n in s);
if(left.length){for(const n of left)delete s[n];fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n")}
for(const n of gone)console.log("  mcp removed: "+n+(n==="playwright"?" (now one server per browser engine)":" (engine dropped)"))' "$PWD/.mcp.json" $present || true
  else
    for name in $drop; do
      claude mcp get "$name" >/dev/null 2>&1 && claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 && log "  mcp removed: $name"
    done
  fi
  return 0
}

install_mcps() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  # PLUGIN ROUTE: the servers come from the plugins named for them, so this script registers none.
  # It still PRUNES, because an install over a 0.2.x project is exactly where the stack's old
  # registrations have to come out - leaving them would run every server twice, once from
  # .mcp.json and once from the plugin, and pay both sets of tool schemas on every session.
  if [ "$MCPS_VIA_PLUGIN" = "true" ]; then
    prune_retired_mcps
    log "mcp: carried by the plugins (serena, context7, memory, and the picks) - nothing registered here"
    return 0
  fi
  prune_retired_mcps   # the locked three, when the core plugin carries them (see MCPS_LOCKED)
  local entry name args
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    if _is_locked_mcp "$name" && _core_plugin_on; then
      log "  mcp $name: carried by the core plugin's dependencies - not registered here"
      continue
    fi
    # 'already configured' skips the ADD, never the verify pass below: a name registered by an older
    # release answers `mcp get` in its OLD shape, so an install over such a project must still repair it.
    if claude mcp get "$name" >/dev/null 2>&1; then echo "  mcp $name already configured - skipping"; continue; fi
    log "mcp [$CLAUDE_SCOPE]: $name"
    _mcp_register "$name" "$args" || note_failure "mcp $name failed"
  done
}

# ---------------------------------------------------------------------------
# (3b) MCP VERIFY - read back what actually landed, repair what drifted (install AND update).
# `claude mcp add` over an existing server name prints 'already exists' and EXITS 0, so a `remove`
# that did not take - an old CLI, a scope mismatch, a registration shadowing from another scope - is
# indistinguishable from a successful rewrite: the run reports the server refreshed and the stale
# registration survives forever (measured on a consuming project still carrying the pre-0.2.34 stdio
# sentry entry, SENTRY_HOST and all). The CLI stays the happy path; this pass checks the RESULT.
#   project scope: .mcp.json is the stack-owned file - parsed directly (no spawn) and rewritten entry
#                  by entry where the shape differs from the manifest. A server the project added by
#                  hand is not a stack name and is never read, compared or written.
#   user scope:    the registration lives in the account config, which this script never hand-edits -
#                  the check runs through `claude mcp get`, a mismatch is retried once through the
#                  CLI, and anything still wrong after that is reported, never silently accepted.
# ---------------------------------------------------------------------------
MCP_REPAIRS=0

_mcp_expect_line() {  # $1 = name $2 = manifest args -> one TAB-separated line: name, kind, shape words
  local name="$1" args="$2" url hdr w
  local -a spec_words
  if [ "$args" = "@HTTP@" ]; then
    if [ "$name" = "sentry" ]; then url="$SENTRY_REMOTE_URL"; hdr="$SENTRY_REMOTE_HDR"
    else url="$CONTEXT7_REMOTE_URL"; hdr="$CONTEXT7_REMOTE_HDR"; fi
    printf '%s\thttp\t%s\t%s\n' "$name" "$url" "$hdr"
    return 0
  fi
  _mcp_argv "$args"
  printf '%s\tstdio' "$name"
  for w in ${spec_words[@]+"${spec_words[@]}"}; do printf '\t%s' "$w"; done
  printf '\n'
}

# The expected shape is computed from the SAME manifest words `claude mcp add` is given, so a pin
# bumped this run is itself a mismatch and the entry is rewritten - the refresh becomes verified.
_MCP_VERIFY_PY='
import json, sys
path, repaired_out = sys.argv[1], sys.argv[2]
try:
    raw = open(path, "r", encoding="utf-8-sig").read()
except FileNotFoundError:
    raw = ""
except OSError as e:
    print("  !! .mcp.json unreadable (%s) - MCP registrations were not verified" % e); sys.exit(0)
try:
    data = json.loads(raw) if raw.strip() else {}
except ValueError:
    print("  !! .mcp.json is not valid JSON - MCP registrations were not verified; fix it and re-run"); sys.exit(0)
if not isinstance(data, dict): data = {}
servers = data.get("mcpServers")
if not isinstance(servers, dict): servers = {}
def describe(e):
    if not isinstance(e, dict): return "absent"
    if e.get("type") == "http" or e.get("url"): return "was http %s" % e.get("url", "?")
    return "was stdio %s" % " ".join([str(e.get("command", "?"))] + [str(a) for a in (e.get("args") or [])][:3])
changed = []
for line in sys.stdin.read().splitlines():
    if not line.strip(): continue
    f = line.split("\t")
    name, kind, rest = f[0], f[1], f[2:]
    if kind == "http":
        url = rest[0] if rest else ""
        hdr = rest[1] if len(rest) > 1 else ""
        want = {"type": "http", "url": url}
        if hdr:
            k, _, v = hdr.partition(":")
            want["headers"] = {k.strip(): v.strip()}
    else:
        env, i = {}, 0
        while i + 1 < len(rest) and rest[i] == "-e":
            k, _, v = rest[i + 1].partition("=")
            env[k] = v
            i += 2
        if i < len(rest) and rest[i] == "--": i += 1
        want = {"type": "stdio", "command": rest[i] if i < len(rest) else "", "args": rest[i + 1:], "env": env}
    have = servers.get(name)
    if have == want: continue
    servers[name] = want
    changed.append((name, describe(have)))
if changed:
    data["mcpServers"] = servers
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    with open(repaired_out, "w", encoding="utf-8") as fh:
        fh.write("".join(n + "\n" for n, _ in changed))
    for name, was in changed:
        print("  mcp repaired: %s (%s)" % (name, was))
'

_verify_mcps_project() {
  local tmpin tmpout entry name args line _scope_line
  tmpin="$(mktemp)"; tmpout="$(mktemp)"
  : > "$tmpout"
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    # A locked server the core plugin carries has no registration to verify, and writing the shape
    # back would put the entry the prune just removed straight back into the file.
    _is_locked_mcp "$name" && _core_plugin_on && continue
    _mcp_expect_line "$name" "$args" >> "$tmpin"
  done
  # `claude mcp add --scope project` writes <cwd>/.mcp.json - the same file this reads back.
  python3 -c "$_MCP_VERIFY_PY" "$PWD/.mcp.json" "$tmpout" < "$tmpin" || log "  !! MCP verify failed - registrations were not checked"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    MCP_REPAIRS=$((MCP_REPAIRS + 1))
    # A repaired entry that `mcp get` still resolves at another scope is SHADOWED - the file is
    # right and the other registration wins at launch. Report it; removing someone else's
    # registration is not drift repair.
    _scope_line="$(claude mcp get "$name" 2>/dev/null | sed -n 's/^ *Scope: *//p' | head -1)"
    if [ -n "$_scope_line" ] && ! printf '%s' "$_scope_line" | grep -qi 'project'; then
      log "  !! mcp $name is also registered at another scope, which wins over .mcp.json - remove it with: claude mcp remove $name -s user (or -s local)"
    fi
  done < "$tmpout"
  rm -f "$tmpin" "$tmpout"
}

_mcp_get_shape() {  # $1 = name -> 'http|<url>' / 'stdio|<command> <args>' as `claude mcp get` reports it ('' when unreadable)
  claude mcp get "$1" 2>/dev/null | awk '
    /^ *Type: /    { t = $2 }
    /^ *URL: /     { u = $2 }
    /^ *Command: / { c = $2 }
    /^ *Args: /    { sub(/^ *Args: */, ""); a = $0 }
    END { if (t == "http") printf "http|%s", u; else if (t != "") printf "stdio|%s %s", c, a }'
}

_mcp_shape_norm() { printf '%s' "$1" | sed -E 's/\$\{([A-Za-z_][A-Za-z0-9_]*):-[^}]*\}/${\1}/g'; }

_verify_mcps_user() {
  local entry name args line kind want have
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    # A locked server the core plugin carries is not registered at all, so there is nothing to read
    # back and a 'drifted' verdict here would re-add the entry the prune just removed.
    _is_locked_mcp "$name" && _core_plugin_on && continue
    line="$(_mcp_expect_line "$name" "$args")"
    kind="$(printf '%s' "$line" | cut -f2)"
    if [ "$kind" = "http" ]; then
      want="http|$(printf '%s' "$line" | cut -f3)"
    else
      # 'stdio|<command> <args>' - the env pairs and the -- separator are not in `mcp get`'s Command/Args lines.
      want="stdio|$(printf '%s' "$line" | cut -f3- | tr '\t' '\n' | awk '/^-e$/{skip=1;next} skip{skip=0;next} /^--$/{next} {printf "%s%s", (n++?" ":""), $0}')"
    fi
    # `claude mcp get` PRINTS a stored `${VAR:-default}` as `${VAR}` (CLI 2.1.272 - the stored entry keeps
    # the default), so both sides compare with the default dropped; as printed, every playwright server
    # read as drifted on every global run and failed it (measured).
    want="$(_mcp_shape_norm "$want")"
    have="$(_mcp_shape_norm "$(_mcp_get_shape "$name")")"
    [ -z "$have" ] && continue                     # an older CLI, or a server the account config does not expose - nothing to compare against
    [ "$have" = "$want" ] && continue
    log "  mcp shape drifted at user scope: $name - re-registering"
    claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 || true
    _mcp_register "$name" "$args" >/dev/null 2>&1 || true
    have="$(_mcp_shape_norm "$(_mcp_get_shape "$name")")"
    if [ -n "$have" ] && [ "$have" != "$want" ]; then
      note_failure "mcp $name could not be brought to the current shape at user scope - remove it by hand (claude mcp remove $name -s user) and re-run"
    else
      MCP_REPAIRS=$((MCP_REPAIRS + 1)); log "  mcp repaired: $name (user scope)"
    fi
  done
}

verify_mcps() {
  [ "$CLAUDE_MISSING" = true ] && return 0
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }
  # PLUGIN ROUTE: there is no stack registration left to read back. Running this pass anyway would
  # be worse than useless - it rewrites .mcp.json entries to the manifest shape, which is precisely
  # what the run just removed.
  [ "$MCPS_VIA_PLUGIN" = "true" ] && return 0
  if [ "$CLAUDE_SCOPE" = "project" ]; then
    command -v python3 >/dev/null 2>&1 || { log "  !! python3 not found - MCP registrations were not verified"; return 0; }
    _verify_mcps_project
  else
    _verify_mcps_user
  fi
  return 0
}

# _install_from_src <subdir> <label> <dest-dir> <executable?> <file...>
# Shared body of the hook/agent/rule steps: copy each named file out of the run's clone. Per-file
# fail-soft (a file not yet upstream keeps its committed copy), and an unchanged file is reported
# 'current' rather than rewritten, so a no-op run leaves mtimes alone.
_install_from_src() {
  local subdir="$1" label="$2" dest_dir="$3" exec_bit="$4"; shift 4
  stack_src || { note_failure "$label refresh SKIPPED - stack source unavailable; the existing copies are unchanged"; return 0; }
  local file src dest
  for file in "$@"; do
    src="$STACK_SRC/$subdir/$file"
    [ -f "$src" ] || { note_failure "$label '$file' not found in $STACK_REPO_URL"; continue; }
    dest="$dest_dir/$file"; mkdir -p "$(dirname "$dest")"
    if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
      # Unchanged content can still have lost its exec bit (a re-clone, a checkout that dropped the mode) - re-assert it.
      [ "$exec_bit" = "exec" ] && [ ! -x "$dest" ] && chmod +x "$dest"
      log "  $label current: $file"; continue
    fi
    cp "$src" "$dest"
    [ "$exec_bit" = "exec" ] && chmod +x "$dest"
    log "  $label installed -> $file"
  done
}

download_hooks() {  # copy each hook file into the repo; per-hook fail-soft (keeps repo copy)
  local root entry file; local -a files=()
  if [ "$HOOKS_VIA_PLUGIN" = "true" ]; then
    # The thirteen WIRED hooks move to the plugin. The two ENGINES do not: docs.js and memory.js are
    # CLIs the model runs by path (`node .claude/hooks/docs.js`), named in 22 skill, agent, rule and
    # command bodies that are SHARED with cursor-stack, which has no plugin system. Copying them is
    # what keeps that one route working on both stacks; model-windows.json rides along because the
    # copied engines' neighbours read it. Nothing here is wired, so nothing fires twice.
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping hooks"; return 0; }
    _install_from_src stack/hooks hook "$root/.claude/hooks" noexec docs.js memory.js model-windows.json
    log "  hooks: the fifteen via the claude-stack-hooks plugin; the docs and memory engines copied"
    return 0
  fi
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping hooks"; return 0; }
  for entry in ${HOOKS[@]+"${HOOKS[@]}"}; do file="${entry%%::*}"; files+=("$file"); done   # empty-array-safe on bash 3.2 (macOS /bin/bash) under set -u
  _install_from_src stack/hooks hook "$root/.claude/hooks" exec ${files[@]+"${files[@]}"}
  # The shared gate module every hook requires. Copied beside them so CLAUDE_STACK_HOOKS_OFF works on
  # this route too - without it every hook takes the fail-open catch on every single invocation.
  [ ${#files[@]} -eq 0 ] || _install_from_src stack/hooks hook "$root/.claude/hooks" noexec hook-prelude.js
  # the fresh-session engine both fresh-session hooks require from their own directory
  [ ${#files[@]} -eq 0 ] || _install_from_src stack/hooks hook "$root/.claude/hooks" noexec fresh-session.js
  # the fresh-session hooks' model -> context window table: data, not a wired hook, so no exec bit -
  # copied only beside a hook that reads it
  case " ${files[*]-} " in
    *" guard-stop-contract.js "*|*" guard-fresh-session-start.js "*)
      _install_from_src stack/hooks hook "$root/.claude/hooks" noexec model-windows.json ;;
  esac
  # the docs hook's engine: required by docs-session.js from its own directory, and run by the model as
  # `node .claude/hooks/docs.js` - copied only beside the hook
  case " ${files[*]-} " in
    *" docs-session.js "*) _install_from_src stack/hooks hook "$root/.claude/hooks" noexec docs.js ;;
  esac
  # the memory hook's engine: required by memory-session.js from its own directory - copied only
  # beside the hook, same split as docs.js beside docs-session.js.
  case " ${files[*]-} " in
    *" memory-session.js "*) _install_from_src stack/hooks hook "$root/.claude/hooks" noexec memory.js ;;
  esac
}

download_agents() {  # copy each subagent .md into .claude/agents/; per-agent fail-soft (keeps repo copy)
  local root entry name
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping agents"; return 0; }
  resolve_stack_plugins
  if [ "$SKILLS_VIA_PLUGIN" != "true" ]; then
    _install_from_src stack/agents agent "$root/.claude/agents" no ${AGENTS[@]+"${AGENTS[@]}"}
    return 0
  fi
  # Same two moves as the skills: prune what a plugin now carries (a stale copy shadows it), copy
  # only the extras. A seat file the shipped manifest never named is the project's own.
  for entry in ${AGENTS_CATALOG[@]+"${AGENTS_CATALOG[@]}"}; do
    name="${entry%%::*}"
    _is_extra "${name%.md}" ${PLUGIN_EXTRA_AGENTS[@]+"${PLUGIN_EXTRA_AGENTS[@]}"} && continue
    [ -f "$root/.claude/agents/$name" ] && { rm -f "$root/.claude/agents/$name"; log "  agent pruned (now carried by a plugin): $name"; }
  done
  local -a extra=()
  for name in ${PLUGIN_EXTRA_AGENTS[@]+"${PLUGIN_EXTRA_AGENTS[@]}"}; do extra+=("$name.md"); done
  if [ ${#extra[@]} -gt 0 ]; then
    _install_from_src stack/agents agent "$root/.claude/agents" no "${extra[@]}"
  fi
}

download_rules() {  # copy each rule .md into .claude/rules/; per-rule fail-soft (keeps repo copy)
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping rules"; return 0; }
  _install_from_src stack/rules rule "$root/.claude/rules" no ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}
  stamp_docs_root_rule "$root"
}

stamp_docs_root_rule() {  # replace __DOCS_ROOT__ in the copied baseline-docs-root.md with the CURRENT env value (settings.json, else the default) - runs on install AND update, so the stamp always tracks the env
  local root="$1" rule="$1/.claude/rules/baseline-docs-root.md"
  [ -f "$rule" ] || return 0
  python3 - "$rule" "$root/.claude/settings.json" <<'PY' || log "  !! docs-root stamp failed on $rule - the rule keeps the env-wins fallback (that RULE file is the write target, not the install stamp)"
import json, sys
rule, settings = sys.argv[1], sys.argv[2]
val = ".claude/docs"
try:
    _env = json.load(open(settings)).get("env", {})
    # the pre-0.2.43 key is still read: an install stamped before the rename landed
    v = _env.get("CLAUDE_STACK_DOCS_PATH", "") or _env.get("CLAUDE_DOCS_PATH", "")
    if v: val = v
except Exception:
    pass
s = open(rule, encoding="utf-8").read()
open(rule, "w", encoding="utf-8").write(s.replace("__DOCS_ROOT__", val))
PY
}

_resolve_docs_root() {  # $1 = repo root - print the resolved docs-path value: settings.json CLAUDE_STACK_DOCS_PATH, else the pre-0.2.43 CLAUDE_DOCS_PATH key, else the default - same resolution stamp_docs_root_rule stamps into the rule
  local root="$1"
  python3 - "$root/.claude/settings.json" <<'PY'
import json, sys
settings = sys.argv[1]
val = ".claude/docs"
try:
    env = json.load(open(settings)).get("env", {})
    v = env.get("CLAUDE_STACK_DOCS_PATH", "") or env.get("CLAUDE_DOCS_PATH", "")
    if v: val = v
except Exception:
    pass
print(val)
PY
}

_migrate_docs_file() {  # $1 = old absolute path, $2 = new absolute path, $3 = label for the log line - ABSENT-ONLY: never overwrites an existing new file, never touches a missing old one (a plain rename/move, so content is unchanged)
  local old="$1" new="$2" label="$3"
  [ -f "$old" ] || return 0
  if [ -e "$new" ]; then
    log "  docs migration ($label): $new already exists - $old left in place, nothing overwritten"
    return 0
  fi
  mkdir -p "$(dirname "$new")"
  mv "$old" "$new"
  log "  docs migration ($label): ${old##*/} -> $new"
}

_switch_on_docs_domain() {  # $1 = domain folder, $2 = the doc its capture writes there - ABSENT-ONLY: when that doc exists and the folder holds no watch.json, write the minimal one ({} - declares nothing, adds no source root to the gate), which is what makes the folder a domain the engine sees. Never overwrites a watch.json (any content, any validity), never creates the folder. Keyed on the doc at its NEW path, so an install an EARLIER run migrated is switched on too; the capture's next run replaces {} with its real entries.
  local dir="$1" doc="$2"
  [ -f "$dir/$doc" ] || return 0
  if [ -e "$dir/watch.json" ] || [ -L "$dir/watch.json" ]; then return 0; fi   # -L: a dangling link is still theirs
  # A doc an older capture wrote carries no section ids; once the folder is a domain `docs.js lint` flags each
  # section. Said HERE rather than fixed: seed-ids would rewrite the project's docs across every domain.
  local note=""
  if grep -qE '^#{2,4}[[:space:]]' "$dir/$doc" 2>/dev/null && ! grep -qiE '<!--[[:space:]]*id:' "$dir/$doc" 2>/dev/null; then
    note=" - its sections predate section ids, so 'docs.js lint' flags them until 'node .claude/hooks/docs.js seed-ids' or the capture's next run"
  fi
  if { printf '{}\n' > "$dir/watch.json"; } 2>/dev/null; then
    log "  docs domain: ${dir##*/}/ switched on - watch.json written ({}; the capture's next run fills in its entries)$note"
  else
    log "  !! docs domain: could not write $dir/watch.json - ${dir##*/}/ stays invisible to the docs engine until its capture re-runs"
  fi
}

migrate_docs_domains() {  # INSTALL + UPDATE: three absent-only moves onto the docs-domain layout - a file a capture used to write at the OLD path now writes at the NEW one, so an existing install's file is relocated once, byte-identical, and never overwrites a file already at the new path. Touches nothing else: related-context/ keeps every sibling-repo working paper - the capture's own drop-box for cross-repo plans, change requests, issue notes - exactly where it is; only the orientation doc this capture wrote moves out of it.
  local root docs_root base
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  command -v python3 >/dev/null || { log "  !! python3 not found - skipping docs-domain migration (move by hand if upgrading: PROJECT-CODE-STYLE.md -> code-style/CODE-STYLE.md, architecture/ASSESSMENT.md -> quality/ASSESSMENT.md, related-context/PROJECT-RELATED-CONTEXT.md -> related-projects/RELATED-PROJECTS.md)"; return 0; }
  docs_root="$(_resolve_docs_root "$root")"
  base="$root/${docs_root%/}"
  _migrate_docs_file "$base/PROJECT-CODE-STYLE.md" "$base/code-style/CODE-STYLE.md" "code style"
  _migrate_docs_file "$base/architecture/ASSESSMENT.md" "$base/quality/ASSESSMENT.md" "architecture quality"
  _migrate_docs_file "$base/related-context/PROJECT-RELATED-CONTEXT.md" "$base/related-projects/RELATED-PROJECTS.md" "related projects"
  # The engine sees a folder as a domain only when it holds a watch.json (architecture/ alone is grandfathered),
  # so a moved doc was invisible until its capture re-ran. Only these two: quality/ is recomputed every run and
  # related-context/ is a drop box for sibling-repo papers - both are watch-less BY DESIGN, and a watch.json there
  # would silently make each a domain.
  _switch_on_docs_domain "$base/code-style" CODE-STYLE.md
  _switch_on_docs_domain "$base/related-projects" RELATED-PROJECTS.md
}

seed_claude_md() {  # INSTALL: lay down a starter .claude/CLAUDE.md from the template when the project has none (never clobber a filled one)
  local root dest src
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || { log "  !! not in a git repo - skipping CLAUDE.md"; return 0; }
  # Auto-loaded from either ./CLAUDE.md or ./.claude/CLAUDE.md - skip if EITHER exists so we never leave two copies.
  if [ -f "$root/CLAUDE.md" ] || [ -f "$root/.claude/CLAUDE.md" ]; then log "  CLAUDE.md: already present - left as-is (finish its authoring outline if not done)"; return 0; fi
  stack_src || { log "  !! stack source unavailable - create .claude/CLAUDE.md by hand from CLAUDE.template.md"; return 0; }
  src="$STACK_SRC/stack/CLAUDE.template.md"
  [ -f "$src" ] || { note_failure "CLAUDE.template.md not found in $STACK_REPO_URL"; return 0; }
  dest="$root/.claude/CLAUDE.md"; mkdir -p "$root/.claude"
  cp "$src" "$dest"
  # Stamp the H1 placeholder with the repo folder name - the same __TOKEN__ convention as
  # stamp_docs_root_rule, and the seed runs once, so a hand-written title is never clobbered.
  python3 - "$dest" "$(basename "$root")" <<'PY' 2>/dev/null || log "  !! CLAUDE.md: project-name stamp failed - replace the __PROJECT_NAME__ H1 by hand"
import sys
dest, name = sys.argv[1], sys.argv[2]
s = open(dest, encoding="utf-8").read()
open(dest, "w", encoding="utf-8").write(s.replace("__PROJECT_NAME__", name))
PY
  log "  CLAUDE.md: seeded to .claude/CLAUDE.md - write the project top from its authoring-outline comment, and keep the '.claude/*' + '!.claude/CLAUDE.md' gitignore lines so it stays committed"
}

# INSTALL + UPDATE: seed .serena/project.yml with the languages actually in this repo.
# serena's --project-from-cwd only RESOLVES the root (a .serena/project.yml, else a .git). It DOES
# auto-generate a config for a root that has none - but not one to rely on: verified in serena
# 1.7.0 (serena/config/serena_config.py), ProjectConfigAutoGenerationMode.ASYNCHRONOUS writes the
# language list EMPTY and fills it from a background thread, and _determine_project_language_servers
# enables only the single TOP language by file count when it is not interactive - so a C#+Angular
# repo gets one server, and a lookup racing the background pass gets none (measured in a consuming
# C# project: serena nav dead, the session fell back to grep). Seeding makes it deterministic and
# multi-language before the first symbol lookup. Detection is deliberately narrow - project files
# only, depth 4, no network - and a key that already carries entries is never rewritten, so a
# hand-tuned config survives every update. Ids are serena's own (project.template.yml).
_serena_ignores='[".serena", ".claude", ".playwright"]'
_serena_has_entries() {  # $1 = file, $2 = key alternation - true when a key carries a NON-EMPTY list
  awk -v keys="$2" '
    BEGIN { n = split(keys, k, "|"); for (i = 1; i <= n; i++) want[k[i]] = 1 }
    /^[[:space:]]*[a-z_]+[[:space:]]*:/ {
      key = $0; sub(/^[[:space:]]*/, "", key); sub(/[[:space:]]*:.*$/, "", key)
      rest = $0; sub(/^[^:]*:[[:space:]]*/, "", rest)
      pending = 0
      if (key in want) { if (rest ~ /\[[[:space:]]*[^][[:space:]]/) { found = 1 } else if (rest == "") pending = 1 }
      next
    }
    pending && /^[[:space:]]*-[[:space:]]*[^[:space:]]/ { found = 1; pending = 0 }
    END { exit(found ? 0 : 1) }' "$1" 2>/dev/null
}
_serena_detect_langs() {  # $1 = repo root - print the detected ids, one per line (empty = detected nothing)
  local root="$1"
  find "$root" -maxdepth 4 \( -name '*.sln' -o -name '*.slnx' -o -name '*.csproj' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -1 | grep -q . && echo csharp
  # serena's typescript server handles plain JavaScript too, so a package.json-only or .js-only
  # repo takes it as well - without this a JS project detected nothing and got no seed at all.
  find "$root" -maxdepth 4 \( -name 'tsconfig*.json' -o -name 'package.json' -o -name '*.ts' -o -name '*.tsx' \
    -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -1 | grep -q . && echo typescript
  return 0
}
# Both list keys are ensured the same way, and NEITHER is ever appended when the key already
# exists: serena's own auto-generated config ships `language_servers: []` / `ignored_paths: []`,
# and a second key of the same name is a duplicate-key YAML error, not an override. An empty key
# is rewritten in place; a key carrying entries is hand-tuned and left alone.
_serena_set_list_key() {  # $1 = project.yml, $2 = key, $3 = value, $4 = comment line
  local cfg="$1" key="$2" value="$3" comment="$4"
  _serena_has_entries "$cfg" "$key" && return 0
  if grep -Eq "^[[:space:]]*$key[[:space:]]*:" "$cfg"; then
    sed -i.stackbak "s|^[[:space:]]*$key[[:space:]]*:.*|$key: $value|" "$cfg" && rm -f "$cfg.stackbak"
    log "  serena: $key set to $value (was empty)"
  else
    printf '\n# Added by claude-stack: %s\n%s: %s\n' "$comment" "$key" "$value" >> "$cfg"
    log "  serena: $key $value appended to project.yml"
  fi
}
# firefox / webkit are Playwright's own builds, not a browser the machine already has: download each kept
# one through the server's OWN bundled playwright (`npx -p @playwright/mcp@<pin> playwright`), so the build
# matches the version the server launches. chrome / msedge use the installed browser. Fail-soft.
ensure_playwright_browser() {
  local e
  for e in $PLAYWRIGHT_BROWSERS; do
    case "$e" in firefox|webkit) ;; *) continue ;; esac
    log "playwright: downloading the $e build the server launches"
    if ! command -v npx >/dev/null 2>&1 || ! npx -y -p "@playwright/mcp${PW_PIN}" playwright install "$e"; then
      log "  !! could not download $e - run by hand: npx -y -p @playwright/mcp${PW_PIN} playwright install $e"
    fi
  done
}
seed_serena_project() {
  printf '%s\n' ${MCPS[@]+"${MCPS[@]}"} | grep -q '^serena|' || return 0   # serena not in this selection
  local root cfg langs list name
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0           # not a repo - serena has no root to bind either
  cfg="$root/.serena/project.yml"
  if [ -f "$cfg" ]; then
    if _serena_has_entries "$cfg" 'language_servers|languages'; then
      log "  serena: project.yml already names its language servers - left as-is"
    else
      langs="$(_serena_detect_langs "$root")"
      if [ -n "$langs" ]; then
        list="$(printf '%s\n' $langs | sed 's/^/"/;s/$/"/' | paste -sd, - | sed 's/,/, /g')"
        _serena_set_list_key "$cfg" language_servers "[$list]" "serena writes this key empty (async) or with only the single top language."
      else
        log "  serena: no C#/TypeScript/JS sources found - language_servers left to serena's own detection"
      fi
    fi
    # ALWAYS, independent of the languages branch: an install predating this key, and every config
    # serena generated itself, otherwise keeps indexing .serena/home - measured on a 14-file
    # fixture, 126 files attempted and 112 failed, every one inside the language-server directory.
    _serena_set_list_key "$cfg" ignored_paths "$_serena_ignores" ".serena holds the ~327MB of language servers, .claude the stack files, .playwright the MCP browser profile - none are project source."
    return 0
  fi
  langs="$(_serena_detect_langs "$root")"
  # language_servers has no default in serena's schema, so a file without it fails to load: with
  # nothing detected, write nothing and let serena generate its own.
  [ -n "$langs" ] || { log "  serena: no C#/TypeScript/JS sources found - left project.yml to serena's own detection"; return 0; }
  list="$(printf '%s\n' $langs | sed 's/^/"/;s/$/"/' | paste -sd, - | sed 's/,/, /g')"
  name="$(basename "$root")"
  mkdir -p "$root/.serena"
  cat > "$cfg" <<SERENA_YML
# Seeded by claude-stack. serena binds this repo via --project-from-cwd; the config it would
# auto-generate instead is written with an EMPTY language list in async mode and with only the
# single top language otherwise, so it is stated here explicitly. Detected from the files in this
# repo at install time; edit freely - a key that carries entries is never rewritten by an update.
# The C# (Roslyn) server needs .NET 10+; serena installs it itself when the runtime is not on
# PATH, into SERENA_HOME (.serena/home, ~327MB - keep .serena ignored).
project_name: "$name"
language_servers: [$list]
# .serena holds SERENA_HOME (the language servers, ~327MB of DLLs and node_modules),
# .claude the stack's own files, .playwright the browser profile/traces the playwright MCP
# writes - none of them project source. Without this line serena's indexer walks into them:
# measured on a 14-file fixture it tried 126 files and failed 112, every one of them inside
# .serena/home.
ignored_paths: $_serena_ignores
SERENA_YML
  log "  serena: seeded .serena/project.yml (project_name=$name, language_servers=[$list])"
}

# ===========================================================================
# INSTALL STAMP - which revision this install came from
# ===========================================================================
# Claude Code has no per-artifact version: `version:` is in the plugin.json schema and NOWHERE else
# (not skills, not agents, not rules, not hooks - an added key there parses but is ignored). So the
# stack versions the INSTALL, not the file: one stamp naming the commit every artifact was copied
# from. That is what /claude-stack:configure diffs against to answer 'what changed since I
# installed?' - exactly, for every artifact, with nothing to hand-bump:
#     <repo>/compare/<sha>...main  (the GitHub compare view / API)
# Machine-local by design (it describes THIS checkout's install) and already covered by the
# '.claude/*' gitignore line the run prints.
stack_version_from() {
  # The stack's ONE version: an extracted release archive carries it in RELEASE-SOURCE; a git
  # checkout reads it from the plugin manifest - the same file the marketplace serves from main,
  # so the stamp, the release, and the marketplace always name the same version.
  # '|| true': a source with neither file (a bare checkout) yields an empty version - under set -e +
  # pipefail the failing sed would otherwise abort the run inside write_stamp.
  { sed -n 's/^version: //p' "$1/RELEASE-SOURCE" 2>/dev/null | head -1 | grep .; } ||
    sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/setup-plugin/.claude-plugin/plugin.json" 2>/dev/null | head -1 || true
}

write_stamp() {
  # No SHA means no source resolved this run (the archive download and the clone fallback both
  # failed, and every step fail-softly kept its existing copy). Stamping then would claim an
  # install that did not occur, and a wrong stamp is worse than none - so leave any previous
  # stamp untouched.
  [ -n "$STACK_SHA" ] || { log "  stamp: skipped - no source revision resolved this run"; return 0; }
  local dir dest root version
  version="$(stack_version_from "$STACK_SRC")"
  case "$CLAUDE_SCOPE" in
    user) dir="$CONFIG_DIR" ;;
    # Prefer the repo root - that is where hooks/agents/rules land. Outside a repo fall back to
    # $PWD, which is where install_skills puts .claude/skills: the stamp belongs next to whatever
    # this run actually installed, and a skills-only install into a plain directory still gets one.
    *)    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
          [ -n "$root" ] || root="$PWD"
          dir="$root/.claude" ;;
  esac
  mkdir -p "$dir"; dest="$dir/claude-stack.stamp"
  # The hook FILE names this release SHIPS (one entry per file, not per matcher) - the catalog, not
  # this run's subset. --installed-only reads it back to separate a hook the user dropped through
  # configure (shipped then, absent now) from one that did not exist when this install was made
  # (not shipped then) - on disk the two are identical, and only the second may be adopted.
  local _stamp_hooks="" _sh_e _sh_n _sh_seen=""
  for _sh_e in ${HOOKS_CATALOG[@]+"${HOOKS_CATALOG[@]}"}; do
    _sh_n="${_sh_e%%::*}"; _sh_n="${_sh_n%.js}"
    case ",$_sh_seen," in *",$_sh_n,"*) continue ;; esac
    _sh_seen="$_sh_seen,$_sh_n"; _stamp_hooks="${_stamp_hooks:+$_stamp_hooks,}$_sh_n"
  done
  # The locked baseline (the snapshot's meta/recommendations.json `always.rules` / `always.mcps`) this
  # install actually CARRIES as the run ends: rule files under the repo's .claude/rules (where every
  # scope's rules land), servers in this project's .mcp.json or, at global scope, the account's
  # registration file. What is on disk, never what shipped - and no run reads it back as a drop: the
  # always set is locked, so --installed-only adopts an absent item every time. (The shipped list
  # recorded here once made the next update read everything a standalone run failed to adopt as
  # dropped.) Empty when the snapshot or node cannot say.
  local _stamp_always="" _stamp_always_rules="" _stamp_always_mcps="" _stamp_rules_dir="" _stamp_mcp_file
  _stamp_rules_dir="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -z "$_stamp_rules_dir" ] || _stamp_rules_dir="$_stamp_rules_dir/.claude/rules"
  case "$CLAUDE_SCOPE" in user) _stamp_mcp_file="$ACCOUNT_CLAUDE_JSON" ;; *) _stamp_mcp_file="$PWD/.mcp.json" ;; esac
  # A server is CARRIED either way: registered in that file, or riding the plugin named for it. On
  # the plugin route there is no .mcp.json at all, and a stamp that only read the file would record
  # an install with none of the locked three - which is the opposite of what it is for.
  if command -v node >/dev/null 2>&1 && [ -f "$STACK_SRC/meta/recommendations.json" ]; then
    _stamp_always="$(node -e 'const fs=require("fs"),path=require("path");const [recs,mcpFile,settings,rulesDir]=process.argv.slice(1);
let a={},s={},p={};try{a=JSON.parse(fs.readFileSync(recs,"utf8")).always||{};}catch{}try{s=JSON.parse(fs.readFileSync(mcpFile,"utf8")).mcpServers||{};}catch{}
try{p=JSON.parse(fs.readFileSync(settings,"utf8")).enabledPlugins||{};}catch{}
const fam=(n)=>String(n).replace(/^playwright-.*/,"playwright").replace(/^context7-local$/,"context7");
const plugins=new Set(Object.keys(p).map((k)=>fam(k.split("@")[0])));
const list=(x)=>(Array.isArray(x)?x:[]);
console.log(list(a.rules).filter((r)=>rulesDir&&fs.existsSync(path.join(rulesDir,r+".md"))).join(","));
console.log(list(a.mcps).filter((m)=>Object.prototype.hasOwnProperty.call(s,m)||plugins.has(m)).join(","));' "$STACK_SRC/meta/recommendations.json" "$_stamp_mcp_file" "${_stamp_rules_dir:+${_stamp_rules_dir%/rules}/settings.json}" "$_stamp_rules_dir" 2>/dev/null || true)"
    _stamp_always_rules="$(printf '%s\n' "$_stamp_always" | sed -n 1p)"
    _stamp_always_mcps="$(printf '%s\n' "$_stamp_always" | sed -n 2p)"
  fi
  cat > "$dest" <<STAMP
# claude-stack install stamp - machine-local, written by claude-stack.sh / claude-stack.ps1.
# The revision every artifact of this install was copied from. To see what changed since:
#   open $STACK_REPO_URL/compare/$STACK_SHA...main
# /claude-stack:configure reports exactly this diff. Then re-run the installer's
# '$ACTION' action (or that skill) to take the changes.
source: $STACK_REPO_URL
ref: $STACK_REF
sha: $STACK_SHA
version: $version
installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
action: $ACTION
scope: $CLAUDE_SCOPE
shipped-hooks: $_stamp_hooks
installed-always-rules: $_stamp_always_rules
installed-always-mcps: $_stamp_always_mcps
STAMP
  log "  stamp: $dest @ $(printf '%.12s' "$STACK_SHA")"
}

wire_hooks_settings() {  # INSTALL + UPDATE: ensure the hook PreToolUse blocks + secret-read deny-list + mcp allow-list are in settings.json (idempotent)
  local root settings; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  # On the plugin route the stack wires nothing: every shipped hook name is already in RETIRED_HOOKS
  # (appended at load), and the RETIRED pass below is what DROPS an older install's wirings. The
  # deny-list and mcp allow-list passes still run - they are not hook wirings.
  local -a wire_hooks=() hooks_off=() off_args=()
  if [ "$HOOKS_VIA_PLUGIN" = "true" ]; then
    # The walk's hooks layer still asks; on the plugin route its answer becomes the HOOKS_OFF value
    # rather than a copy list - the hooks it did NOT pick. Only a selection that CARRIES hook lines
    # counts as an answer: `update --installed-only` reads the hooks off DISK, and on this route
    # there are none, which would otherwise read as 'the user dropped all fifteen'.
    if [ -n "${SELECTION:-}" ] && [ -f "$SELECTION" ] && grep -q '^hook ' "$SELECTION"; then
      # A hook wired on two events has two catalog rows, so de-duplicate: the value is a list of
      # hook NAMES, and a name repeated twice is the same hook read twice.
      local _c _s _hit _seen=""
      for _c in ${HOOKS_CATALOG[@]+"${HOOKS_CATALOG[@]}"}; do
        _c="${_c%%::*}"
        case " $_seen " in *" $_c "*) continue;; esac
        _seen="$_seen $_c"; _hit=false
        for _s in ${HOOKS[@]+"${HOOKS[@]}"}; do [ "${_s%%::*}" = "$_c" ] && { _hit=true; break; }; done
        [ "$_hit" = true ] || hooks_off+=("$_c")
      done
      off_args=(--HOOKS-OFF ${hooks_off[@]+"${hooks_off[@]}"})
    fi
  else
    wire_hooks=(${HOOKS[@]+"${HOOKS[@]}"})
  fi
  settings="$root/.claude/settings.json"; mkdir -p "$(dirname "$settings")"
  command -v python3 >/dev/null || { log "  !! python3 not found - wire hooks into settings.json by hand"; return 0; }
  # NB: program via -c (not `python3 - <<heredoc`): a pipe + heredoc both target stdin and the pipe
  # wins, so a heredoc program would never run. -c frees stdin for the piped hook specs.
  local prog; prog=$(cat <<'PY'
import json, os, subprocess, sys
path = sys.argv[1]
deny_specs, mcp_names, retired_hooks, retired_deny, versioning_flag, hooks_off, bucket = [], [], [], [], [], [], None
memory_db, sentry_auth, mcp_off = [], [], []
hooks_answered = False
for a in sys.argv[2:]:
    if a == "--VERSIONING": bucket = versioning_flag; continue
    if a == "--MEMORY-DB": bucket = memory_db; continue
    if a == "--SENTRY-AUTH": bucket = sentry_auth; continue
    if a == "--DENY": bucket = deny_specs; continue
    if a == "--MCP": bucket = mcp_names; continue
    if a == "--MCP-OFF": bucket = mcp_off; continue
    if a == "--RETIRED": bucket = retired_hooks; continue
    if a == "--RETIRED-DENY": bucket = retired_deny; continue
    if a == "--HOOKS-OFF": bucket = hooks_off; hooks_answered = True; continue
    if bucket is not None: bucket.append(a)
specs = []
HOOK_TIMEOUT = 10   # seconds - see the note below; the default would be 600
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    file, matcher, args = (line.split("::", 2) + ["", ""])[:3]
    if not matcher:
        continue
    # The placeholder is QUOTED so a project path with a space survives the shell (the hooks docs:
    # 'explicitly quote path placeholders'); `legacy` is the unquoted text earlier installs wired,
    # rewritten in place below so an update never leaves two entries for one hook.
    tail = (" " + args) if args else ""
    # Every hook here does <30ms of work (measured: 22-25ms, almost all of it the node spawn), but
    # a `command` hook with no timeout takes Claude Code's 600s default - so one stalled subprocess
    # (guard-protected-force-push and guard-ungated-commit both shell out to git, and a stuck
    # index.lock or a slow network mount hangs `git rev-parse`) freezes the session for ten minutes.
    # 10s is ~400x the measured cost and still fails fast.
    cmd = '"$CLAUDE_PROJECT_DIR/.claude/hooks/' + file + '"' + tail
    legacy = "$CLAUDE_PROJECT_DIR/.claude/hooks/" + file + tail
    if file == "instrument-tool-usage.js":
        # env-gated: the sh test costs ~nothing when off; node spawns only under CLAUDE_STACK_INSTRUMENT=1
        gate = '[ "$CLAUDE_STACK_INSTRUMENT" != "1" ] || '
        cmd, legacy = gate + cmd, gate + legacy
    specs.append((matcher, cmd, legacy))
if os.path.exists(path):
    # Refuse to touch a settings.json that does not parse: falling back to {} would REPLACE the project's
    # whole file (permissions, statusLine, env) with just the stack's entries.
    try:
        data = json.load(open(path))
    except Exception as exc:
        print("  !! settings.json is not valid JSON (%s) - left untouched; fix it and re-run" % exc, file=sys.stderr)
        sys.exit(1)
    if not isinstance(data, dict):
        print("  !! settings.json top level is not an object - left untouched", file=sys.stderr)
        sys.exit(1)
else:
    data = {}
changed = False
# Migrate the unquoted command text earlier installs wired (same file, any event) to the quoted form.
for matcher, command, legacy in specs:
    for entries in data.get("hooks", {}).values():
        for e in entries:
            for h in e.get("hooks", []):
                if h.get("command") == legacy:
                    h["command"] = command; changed = True
# Backfill the timeout onto entries an earlier install wrote bare (they carry the 600s default).
_ours = {c for _, c, _ in specs} | {l for _, _, l in specs}
for entries in data.get("hooks", {}).values():
    for e in entries:
        for h in e.get("hooks", []):
            if h.get("command") in _ours and h.get("timeout") != HOOK_TIMEOUT:
                h["timeout"] = HOOK_TIMEOUT; changed = True
# Prune OUR hook file from a PreToolUse matcher this version no longer wires (guard-stop-contract's
# retired AskUserQuestion entry): the plugin route applies meta/migrations.json, the script route must
# match, or the legacy entry survives every update with a freshly backfilled timeout (measured).
# Keyed on the SELECTED specs, so a hook the user de-selected keeps its entries (configure's job).
_ours_files = {c.split("/.claude/hooks/")[-1].split('"')[0] for _, c, _ in specs}
_pairs = {(m, c) for m, c, _ in specs if not m.startswith("@")}
_pre = data.get("hooks", {}).get("PreToolUse", [])
for e in list(_pre):
    for h in list(e.get("hooks", [])):
        c = h.get("command", "")
        if "/.claude/hooks/" in c and c.split("/.claude/hooks/")[-1].split('"')[0] in _ours_files and (e.get("matcher", ""), c) not in _pairs:
            e["hooks"].remove(h); changed = True
    if not e.get("hooks"):
        _pre.remove(e); changed = True
# Unwire a hook file this stack RETIRED (its file is pruned in the same run): keyed on the file name
# across EVERY event, since a retired hook may have been wired outside PreToolUse (inject-code-style
# ran on a prompt event). Left wired, the entry keeps spawning a command whose file no longer exists.
for ev_name, entries in list(data.get("hooks", {}).items()):
    for e in list(entries):
        for h in list(e.get("hooks", [])):
            c = h.get("command", "")
            if "/.claude/hooks/" in c and c.split("/.claude/hooks/")[-1].split('"')[0] in retired_hooks:
                e["hooks"].remove(h); changed = True
        if not e.get("hooks"):
            entries.remove(e); changed = True
    if not entries:
        del data["hooks"][ev_name]; changed = True
# "@<Event>" matchers wire a non-PreToolUse lifecycle event (e.g. @Stop - no matcher key there).
# "@<Event>:<matcher>" is the same with a matcher, which some events DO key on: SessionStart's
# source (`compact` / `startup` / `resume`) is the one this stack uses. Without the matcher the
# entry fires on every session start, which is not what the fresh-session offer is for.
for matcher, command, legacy in specs:
    if matcher.startswith("@"):
        ev_name, _, ev_matcher = matcher[1:].partition(":")
        ev = data.setdefault("hooks", {}).setdefault(ev_name, [])
        if any(h.get("command", "") == command for e in ev for h in e.get("hooks", []) if e.get("matcher", "") == ev_matcher):
            continue
        entry = {"hooks": [{"type": "command", "command": command, "timeout": HOOK_TIMEOUT}]}
        if ev_matcher:
            entry["matcher"] = ev_matcher
        ev.append(entry)
        changed = True
        continue
    cur = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
    # Keyed on (matcher, command): one hook file wired on two tools (guard-read-whole-file on Read AND Bash)
    # is two entries - keying on the command alone dropped the second (measured: no install ever carried
    # the Bash matcher).
    have = {(e.get("matcher", ""), h.get("command", "")) for e in cur for h in e.get("hooks", [])}
    if (matcher, command) in have:
        continue
    cur.append({"matcher": matcher, "hooks": [{"type": "command", "command": command, "timeout": HOOK_TIMEOUT}]})
    changed = True
# permissions.deny: union-merge the secret-file Read blocks, preserving any the project already set.
deny = data.setdefault("permissions", {}).setdefault("deny", [])
for rule in deny_specs:
    if rule not in deny:
        deny.append(rule); changed = True
# Entries this stack once wrote and no longer does (RETIRED_DENY): drop exactly those strings, so an
# update clears what an older install seeded - a project's own entry is never touched.
for rule in [r for r in deny if r in retired_deny]:
    deny.remove(rule); changed = True
    print("  settings.json: dropped retired deny entry %s" % rule)
# NO permissions.allow seed for the gate stamps, deliberately. The hooks require a write to
# <docs-root>/flow/APPROVAL and /COMMIT-GATE, and under the default docs root those sit inside
# `.claude/` - a PROTECTED path. Protected-path writes are never auto-approved outside
# bypassPermissions, and the safety check runs BEFORE settings allow-rules, so an Edit()/Write()
# entry here is a silent no-op (measured: one project's runs were refused on every route and
# DELEGATED mode silently degraded to inline for a whole 12-stage run). The working levers are the
# prompt's own 'allow Claude to edit its own settings for this session' option, or a
# CLAUDE_STACK_DOCS_PATH outside `.claude/`. The flows carry the ask-fallback for the refusal case.
# enabledMcpjsonServers: pre-approve exactly the project .mcp.json servers we register, so no per-launch
# trust prompt - never blanket enableAllProjectMcpServers. Union-merged; an unlisted name is a harmless no-op.
enabled = data.setdefault("enabledMcpjsonServers", [])
for name in mcp_names:
    if name not in enabled:
        enabled.append(name); changed = True
# ... and DROP the names this run unregistered. A server carried by a plugin is trusted through the
# plugin, never through this list, so a leftover entry names a `.mcp.json` server that no longer
# exists - dead config that reads like a working knob. A name the run still registers is never in
# this list (the two buckets are disjoint by construction).
for name in mcp_off:
    if name in enabled:
        enabled.remove(name); changed = True
        print("  settings.json: dropped enabledMcpjsonServers entry %s (no longer registered here)" % name)
# Environment keys this stack RENAMED: carry the user's VALUE to the new name and drop the old
# key, BEFORE the absent-only seeds below - seeding first would write the default over a value the
# user had set under the old name. One pair per rename; keep the list identical in both installer
# twins and in meta/migrations.json (the plugin route applies it from there).
env = data.setdefault("env", {})
for _old, _new in (("CLAUDE_DOCS_PATH", "CLAUDE_STACK_DOCS_PATH"),):
    if _old in env:
        if _new not in env and env[_old] != "":
            env[_new] = env[_old]
        del env[_old]
        changed = True
        print("  settings.json env: %s renamed to %s" % (_old, _new))
# Environment keys this stack RETIRED: nothing reads them any more, so they are DROPPED rather than
# carried - a dead key in the env block reads as a knob that still works. The value is never moved
# anywhere. A key that still means something OUTSIDE this stack carries the seed it is dropped at,
# so a value the user set by hand is theirs and stays. Same list in both installer twins and in
# meta/migrations.json (the plugin route applies it from there).
for _key, _only_when in (("CLAUDE_STACK_FRESH_SESSION_PCT", None),
                         ("CLAUDE_STACK_CONTEXT_WINDOW", None),
                         ("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "40")):
    if _key in env and (_only_when is None or env[_key] == _only_when):
        del env[_key]
        changed = True
        print("  settings.json env: %s removed (%s)" % (_key, "retired - nothing reads it" if _only_when is None else "the old stack seed %s - the default applies" % _only_when))
# Environment keys whose SEEDED DEFAULT turned out to be WRONG: clear the key when its value is
# still exactly that seed - a value the user set by hand is theirs and is never touched. Keep any
# entry identical in both installer twins and in meta/migrations.json.
# CLAUDE_STACK_FRESH_SESSION_DEFAULT: seeded 250000 until 0.2.67. That trigger sat ABOVE a 200k
# window entirely, so on the tier this DEFAULT case exists for - a window that cannot be read at all
# - the gate could never fire and silently did not exist. The seed is absent-only and ctxThreshold()
# clamps a too-large trigger only when the window is KNOWN, which by definition it is not here, so
# nothing else will ever correct an install carrying it (measured 2026-09-12: 3 of 3 current-shape
# installs still on 250000).
for _key, _bad_seed, _to in (("CLAUDE_STACK_FRESH_SESSION_DEFAULT", "250000", "180000"),):
    if env.get(_key) == _bad_seed:
        env[_key] = _to
        changed = True
        print("  settings.json env: %s reset to %s (auto-detect)" % (_key, _to))
# NOT seeded: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE. It is Claude Code's own auto-compaction trigger,
# not a stack setting, and this installer wrote 40 into every project - a value nobody chose.
# An install that already carries it keeps it; the stack simply no longer owns the key.
# generated-docs root: the authoritative value the baseline-docs-root rule resolves at session start.
# Forward slashes on every OS (Node hooks and the model resolve them fine on Windows).
if "CLAUDE_STACK_DOCS_PATH" not in env:
    env["CLAUDE_STACK_DOCS_PATH"] = ".claude/docs"; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_PATH seeded (.claude/docs)")
# how those docs are VERSIONED - a DECISION, not a guess: "git" = they are committed and git versions
# them per branch (writes land in the doc file, nothing is ever written under <docs-path>/.branches/),
# "local" = the machine-local overlay, where a feature branch's sections live under
# <docs-path>/.branches/<branch>/ until it merges. --docs-versioning WRITES the value it is given, over one
# already there; without it the key is seeded only when ABSENT, by the one rule docs.js keptOutOfGit(),
# stamp-docs-root.js and the ps1 twin share (a table-driven test runs all four over the same repos): "local"
# only when the docs are kept OUT of git - no domain is tracked AND either (a) a domain exists or (b) git
# ignores the docs root - else "git", a fresh project whose docs root is not ignored included. A tracked domain
# wins over an ignored root. From then on the SETTING wins even where the repo disagrees - a doc write is never
# silently untracked or silently local - and `docs.js status` plus the session-start block say so.
# `or "/"`: at the filesystem root the project root is the empty string, and an empty cwd raises
# FileNotFoundError - which would abandon the whole settings write over a probe whose answer is optional.
# The pathspec is right either way ("" + "/docs/architecture").
def _dtracked(_root, _dir):
    return subprocess.call(["git", "ls-files", "--error-unmatch", "--", _dir], cwd=_root or "/",
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
# `<docs>/` with the trailing slash, relative to the root: git answers check-ignore for a path that does not
# exist yet, but a directory-only pattern (".claude/docs/") matches the bare name only once the folder exists.
def _dignored(_root, _rel):
    return bool(_rel) and subprocess.call(["git", "check-ignore", "-q", "--", _rel + "/"], cwd=_root or "/",
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
_vflag = (versioning_flag or [""])[0]
if _vflag:
    _vold = env.get("CLAUDE_STACK_DOCS_VERSIONING")
    if _vold != _vflag:
        env["CLAUDE_STACK_DOCS_VERSIONING"] = _vflag; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_VERSIONING %s -> '%s' (--docs-versioning%s)" % (
        "absent" if _vold is None else "'%s'" % _vold, _vflag, ", unchanged" if _vold == _vflag else ""))
elif "CLAUDE_STACK_DOCS_VERSIONING" not in env:
    # Forward slashes DELIBERATELY, also on Windows: os.path.join would emit '\' under a Windows python and hand
    # git a mixed-separator pathspec (C:/repo\docs\code-style), which can fail to match - and a false negative
    # here seeds `local` over committed docs, the exact silent switch this seed exists to prevent.
    _droot = os.path.dirname(os.path.dirname(path)).replace("\\", "/").rstrip("/")
    _dparts = [p for p in env["CLAUDE_STACK_DOCS_PATH"].replace("\\", "/").split("/") if p]
    _dbase = "/".join([_droot] + _dparts)
    # Every DOMAIN is probed, never architecture/ alone: a watch.json is what makes a folder a domain
    # (architecture/ is grandfathered in without one), so a project documented only in code-style/,
    # decisions/ or related-projects/ is an ordinary shape. Same rule as docs.js domains(), reserved
    # names and all; a watch-less folder like quality/ is no domain and no vote.
    try:
        _dnames = sorted(_d for _d in os.listdir(_dbase)
                         if not _d.startswith(".") and _d not in ("references", "history")
                         and os.path.isdir(os.path.join(_dbase, _d))
                         and (_d == "architecture" or os.path.exists(os.path.join(_dbase, _d, "watch.json"))))
    except OSError:
        _dnames = []
    _committed = any(_dtracked(_droot, "%s/%s" % (_dbase, _d)) for _d in _dnames)
    _kept_out = not _committed and (bool(_dnames) or _dignored(_droot, "/".join(_dparts)))
    env["CLAUDE_STACK_DOCS_VERSIONING"] = "local" if _kept_out else "git"; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_VERSIONING seeded (%s)" % env["CLAUDE_STACK_DOCS_VERSIONING"])
# The memory db path and the sentry auth mode are what the PLUGIN route's launcher and headers
# helper read - a plugin MCP entry cannot expand a PROJECT env key (measured), but a launcher whose
# cwd is the project can read this file itself. Written, not seeded: both track a choice this run
# just made, so a level change or an auth switch has to land or the server keeps the old one.
if memory_db and memory_db[0] and env.get("CLAUDE_STACK_MEMORY_DB") != memory_db[0]:
    env["CLAUDE_STACK_MEMORY_DB"] = memory_db[0]; changed = True
    print("  settings.json env: CLAUDE_STACK_MEMORY_DB -> %s" % memory_db[0])
if sentry_auth and sentry_auth[0] and env.get("CLAUDE_STACK_SENTRY_AUTH") != sentry_auth[0]:
    env["CLAUDE_STACK_SENTRY_AUTH"] = sentry_auth[0]; changed = True
    print("  settings.json env: CLAUDE_STACK_SENTRY_AUTH -> %s" % sentry_auth[0])
# instrumentation switch: the wired instrument hook runs only when this is "1" - seeded off.
if "CLAUDE_STACK_INSTRUMENT" not in env:
    env["CLAUDE_STACK_INSTRUMENT"] = "0"; changed = True
    print("  settings.json env: CLAUDE_STACK_INSTRUMENT seeded (0)")
# publish gate: `git push` / `gh pr merge` need a flow/PUSH-GATE receipt like a commit does.
# Seeded ON - across four audited sessions every push and merge passed every guard, one of them
# putting 40 files on a shared `develop`. "0" for a repo whose remote is already gated.
if "CLAUDE_STACK_PUSH_GATE" not in env:
    env["CLAUDE_STACK_PUSH_GATE"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_PUSH_GATE seeded (1)")
if "CLAUDE_STACK_DOCS_BLOCK" not in env:
    env["CLAUDE_STACK_DOCS_BLOCK"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_BLOCK seeded (1)")
if "CLAUDE_STACK_DOCS_GATE" not in env:
    env["CLAUDE_STACK_DOCS_GATE"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_GATE seeded (1)")
if "CLAUDE_STACK_DOCS_ASK" not in env:
    env["CLAUDE_STACK_DOCS_ASK"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_DOCS_ASK seeded (1)")
# Absent-only, and this is where the walk's hooks LAYER lands once the set stopped being copied:
# the hooks the selection did NOT pick arrive as --HOOKS-OFF and become the value, so the answer the
# user gave at install time still decides which guards run. Empty means every hook runs.
_off = ",".join(hooks_off)
if hooks_answered:
    # A walk answered the hooks layer THIS run - that answer wins over the stored value, the one
    # exception to absent-only seeding (the user is looking at the question as it is asked).
    if env.get("CLAUDE_STACK_HOOKS_OFF") != _off:
        env["CLAUDE_STACK_HOOKS_OFF"] = _off; changed = True
        print("  settings.json env: CLAUDE_STACK_HOOKS_OFF = %s" % (_off if _off else "(empty - every hook runs)"))
elif "CLAUDE_STACK_HOOKS_OFF" not in env:
    env["CLAUDE_STACK_HOOKS_OFF"] = ""; changed = True
    print("  settings.json env: CLAUDE_STACK_HOOKS_OFF seeded (empty - every hook runs)")
# rotate ask: the stop contract asks once per credential exposure; "0" turns the ask off.
if "CLAUDE_STACK_ROTATE_ASK" not in env:
    env["CLAUDE_STACK_ROTATE_ASK"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_ROTATE_ASK seeded (1)")
# config protection: an existing check config cannot be weakened to pass the check; "0" turns it off.
if "CLAUDE_STACK_CONFIG_PROTECT" not in env:
    env["CLAUDE_STACK_CONFIG_PROTECT"] = "1"; changed = True
    print("  settings.json env: CLAUDE_STACK_CONFIG_PROTECT seeded (1)")
# session monitor: "log" writes its rows and injects nothing (the observation week), "inject" also
# hands each note back to the model, "0" is off.
if "CLAUDE_STACK_MONITOR" not in env:
    env["CLAUDE_STACK_MONITOR"] = "log"; changed = True
    print("  settings.json env: CLAUDE_STACK_MONITOR seeded (log)")
# fresh-session gate - one ABSOLUTE trigger per window tier, seeded so both are visible and
# tunable in one place. They replace CLAUDE_STACK_FRESH_SESSION_PCT, a percentage that was inert
# at its default on both real tiers (200k x 40% fell under the floor, 1M x 40% sat over the
# ceiling), so the clamps decided and the knob lied about what it controlled. That key is retired
# outright - nothing reads it any more; `0` on ALL THREE keys below is the off switch.
# 400,000 on the 1M tier is deliberately ABOVE the harness's own auto-compaction (387,619-397,171
# measured), so there the SessionStart compact route carries the offer - lower it to be asked first.
if "CLAUDE_STACK_FRESH_SESSION_1M" not in env:
    env["CLAUDE_STACK_FRESH_SESSION_1M"] = "400000"; changed = True
    print("  settings.json env: CLAUDE_STACK_FRESH_SESSION_1M seeded (400000)")
if "CLAUDE_STACK_FRESH_SESSION_200K" not in env:
    env["CLAUDE_STACK_FRESH_SESSION_200K"] = "150000"; changed = True
    print("  settings.json env: CLAUDE_STACK_FRESH_SESSION_200K seeded (150000)")
# ... and the trigger for every OTHER case: a window the hooks cannot read (the settings `model`
# has no row in hooks/model-windows.json and no fallback is set) and one that is neither named size. 180,000 is REACHABLE on a 200k
# window - at 250,000 it sat above that window entirely and the gate could never fire there.
if "CLAUDE_STACK_FRESH_SESSION_DEFAULT" not in env:
    env["CLAUDE_STACK_FRESH_SESSION_DEFAULT"] = "180000"; changed = True
    print("  settings.json env: CLAUDE_STACK_FRESH_SESSION_DEFAULT seeded (180000)")
# the window the hooks use for a model hooks/model-windows.json does not list - the table is the only
# other source, so this answers only for an unlisted model.
if "CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW" not in env:
    env["CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW"] = "1000000"; changed = True
    print("  settings.json env: CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW seeded (1000000)")
# WHICH trigger applies comes from the session model's row in hooks/model-windows.json, else
# CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW above, else the DEFAULT trigger. The old
# CLAUDE_STACK_CONTEXT_WINDOW knob is retired - it was seeded "1000000", which declared a 1M window
# on every install and killed the gate on every account that was not 1M (ten confirmations across
# four projects), and its replacement seeds ("" then "AUTO") only ever meant 'detect'.
if changed:
    json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
    print("  settings.json: hooks + secret deny-list + mcp allow-list + env defaults ensured")
else:
    print("  settings.json: hooks + secret deny-list + mcp allow-list + env defaults already present - unchanged")
PY
)
  # Pre-approve exactly what this run registered in .mcp.json - which on the plugin route is
  # nothing, and on the copy route is the droppable picks only (a server carried by a plugin is
  # trusted through its plugin). Everything else comes OUT: a leftover entry names a `.mcp.json`
  # server that no longer exists, which reads like a working knob.
  local -a mcp_names mcp_off; mcp_names=(); mcp_off=()
  local _m _n
  while IFS= read -r _m; do [ -n "$_m" ] && mcp_names+=("$_m"); done <<EOF
$(_bare_named_mcps)
EOF
  for _m in ${MCPS[@]+"${MCPS[@]}"}; do
    _n="${_m%%|*}"                                       # server name = the token before the first '|'
    case " ${mcp_names[*]-} " in *" $_n "*) ;; *) mcp_off+=("$_n") ;; esac
  done
  mcp_off+=(${RETIRED_MCPS[@]+"${RETIRED_MCPS[@]}"})
  printf '%s\n' ${wire_hooks[@]+"${wire_hooks[@]}"} | python3 -c "$prog" "$settings" --DENY "${SECRET_DENY[@]}" --MCP ${mcp_names[@]+"${mcp_names[@]}"} --MCP-OFF ${mcp_off[@]+"${mcp_off[@]}"} --RETIRED ${RETIRED_HOOKS[@]+"${RETIRED_HOOKS[@]}"} --RETIRED-DENY "${RETIRED_DENY[@]}" ${off_args[@]+"${off_args[@]}"} --VERSIONING "$DOCS_VERSIONING" --MEMORY-DB "$MEMORY_DB_PATH" --SENTRY-AUTH "${SENTRY_AUTH:-token}" || log "  !! settings.json wiring failed"
}

# ---------------------------------------------------------------------------
# MEMORY IMPORT + SWITCH-OFF (once): after the memory MCP is registered AND baseline-memory.md has
# landed, migrate Claude's own per-project auto-memory notes into it (scripts/memory-import.js, run from
# the run's SOURCE snapshot - it lives in scripts/, never copied into the project), then flip
# autoMemoryEnabled off in THIS repo's project .claude/settings.json - at global scope too. The rule
# and the start hook land per repo, so the account settings.json would silence the memory of every
# other project of the account, none of which has the rule telling Claude to save to the server.
# Runs ONCE - skipped once that file already holds autoMemoryEnabled:false. A global scope run with no
# identifiable project (not inside a git repo) has nothing to import from and is skipped, logged.
# ---------------------------------------------------------------------------
MEMORY_SWITCHED_OFF=false   # this repo's settings hold autoMemoryEnabled:false after the import step
_memory_target_settings() {
  if [ -n "$MEMORY_TOPLEVEL" ]; then printf '%s/.claude/settings.json' "$MEMORY_TOPLEVEL"; fi
  return 0
}

# $1 = settings file path -> prints "true"/"false"/"absent"/"malformed" ('absent' also covers a
# missing file - nothing has switched Claude's own memory off yet).
_memory_autodetect_state() {
  node -e '
const fs=require("fs");
try{
  const raw=fs.readFileSync(process.argv[1],"utf8");
  let d; try{d=JSON.parse(raw);}catch(e){console.log("malformed");process.exit(0);}
  if(!d||typeof d!=="object"||Array.isArray(d)){console.log("malformed");process.exit(0);}
  console.log(Object.prototype.hasOwnProperty.call(d,"autoMemoryEnabled")?String(d.autoMemoryEnabled):"absent");
}catch(e){ console.log(e.code==="ENOENT"?"absent":"malformed"); }
' "$1" 2>/dev/null
}

# $1 = settings file path - merge autoMemoryEnabled:false in, leaving every other key untouched.
# Refuses (logs, writes nothing) on a file that fails to parse as a JSON object - the install continues.
_memory_write_switch_off() {
  node -e '
const fs=require("fs");const path=require("path");
const p=process.argv[1];
let d={};
try{
  const raw=fs.readFileSync(p,"utf8");
  if(raw.trim()){ d=JSON.parse(raw); }
}catch(e){
  if(e.code!=="ENOENT"){ console.log("  !! "+p+" is not valid JSON - autoMemoryEnabled left untouched; fix it and re-run"); process.exit(1); }
}
if(typeof d!=="object"||d===null||Array.isArray(d)){ console.log("  !! "+p+" top level is not an object - autoMemoryEnabled left untouched"); process.exit(1); }
d.autoMemoryEnabled=false;
fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n");
console.log("  settings.json: autoMemoryEnabled set to false ("+p+")");
' "$1"
}

import_memory_notes() {
  command -v claude >/dev/null 2>&1 || return 0   # CLAUDE_MISSING already reported elsewhere
  if [ -z "$MEMORY_TOPLEVEL" ]; then
    log "memory: global install scope with no identifiable project (not inside a git repo) - skipping the notes import; Claude's own memory stays on"
    return 0
  fi
  local target; target="$(_memory_target_settings)" || target=""
  [ -n "$target" ] || return 0
  local state; state="$(_memory_autodetect_state "$target")" || state=""
  if [ "$state" = "false" ]; then MEMORY_SWITCHED_OFF=true; return 0; fi   # already switched off - never re-run
  # The gate: Claude's own memory goes off only where its replacement is complete - the memory server
  # in this run's MCP set AND baseline-memory.md (the rule telling Claude to save to it) in its rule
  # set and actually on disk. Without either, the notes stay where Claude reads them.
  local e has_server=false has_rule=false
  for e in ${MCPS[@]+"${MCPS[@]}"}; do case "${e%%|*}" in memory) has_server=true ;; esac; done
  for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do case "${e%%::*}" in baseline-memory.md) has_rule=true ;; esac; done
  if [ "$has_server" != true ]; then
    log "memory: the notes import was skipped - the memory MCP is not part of this install; Claude's own memory stays on"; return 0
  fi
  if [ "$has_rule" != true ]; then
    log "memory: the notes import was skipped - baseline-memory.md is not part of this install; Claude's own memory stays on"; return 0
  fi
  if [ ! -f "$MEMORY_TOPLEVEL/.claude/rules/baseline-memory.md" ]; then
    log "  !! memory: baseline-memory.md did not land in $MEMORY_TOPLEVEL/.claude/rules - the notes import was skipped; Claude's own memory stays on until a run delivers it"
    return 0
  fi
  command -v node >/dev/null 2>&1 || { log "  !! node not found - the memory notes import was skipped; Claude's own memory stays on until it succeeds"; return 0; }
  command -v uvx  >/dev/null 2>&1 || { log "  !! uvx not found - the memory notes import was skipped; Claude's own memory stays on until it succeeds"; return 0; }
  stack_src || { log "  !! stack source unavailable - the memory notes import was skipped; Claude's own memory stays on until it succeeds"; return 0; }
  local importer="$STACK_SRC/scripts/memory-import.js"
  [ -f "$importer" ] || { log "  !! $importer not found in the source snapshot - memory notes import skipped"; return 0; }
  # --config-dir only for an EXPLICIT account (CLAUDE_CONFIG_DIR, which a space exports): the default
  # account's registrations live at ~/.claude.json, not inside ~/.claude, and the importer resolves that
  # default itself.
  local -a acct_args=()
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then acct_args=(--config-dir "$CONFIG_DIR"); fi
  log "memory: importing Claude's existing notes into the memory MCP (first run downloads the embedding model, ~1 min)"
  # sits in an `if` DELIBERATELY: this runs under `set -euo pipefail`, and a plain (non-conditional)
  # failing call here would abort the whole install instead of falling through to the fail-soft log line.
  if node "$importer" --project-root "$MEMORY_TOPLEVEL" ${acct_args[@]+"${acct_args[@]}"}; then
    if _memory_write_switch_off "$target"; then MEMORY_SWITCHED_OFF=true; fi   # fail-soft: a malformed settings file refuses the write and logs, the install still continues
  else
    log "  !! memory notes import failed - Claude's own memory stays ON until a later run imports successfully"
  fi
  return 0
}

# ===========================================================================
# UPDATE - bring everything to latest
# ===========================================================================
# Renamed/retired upstream names: their old files left the manifests, so the refresh loops never clear
# them - a leftover skill keeps auto-activating next to its successor, a leftover agent stays dispatchable
# under the old @agent-name (and the capabilities capture inventories it). Only names this stack itself
# once installed; an absent one is a no-op. The guided /claude-stack:update prunes from the stamp
# compare instead - these lists are the script path's equivalent. Unquoted on purpose: the parity lint
# reads the quoted manifest blocks only.
RETIRED_SKILLS=(frontend mobile project-task-flow project-task-cycle project-capabilities project-failure-signatures typescript-testing data-security dotnet-error-handling mobile-security)
RETIRED_RULES=(baseline-agents-skills.md baseline-code-quality.md baseline-communication.md baseline-definition-of-done.md baseline-evaluating-proposals.md baseline-mcp-tools.md baseline-planning.md baseline-related-projects.md house-baseline.md web-conventions.md aspnet-conventions.md)
RETIRED_HOOKS=(require-convention-skill.js inject-code-style.js)
# The plugin route retires the whole COPY catalog: the same two passes that undo an upstream removal
# (prune_retired_hooks drops the file, wire_hooks_settings drops the settings.json wiring) are what
# migrate a 0.2.x install off its copied hooks. Appended HERE, at load, because update_hooks prunes
# BEFORE it wires - an append inside wire_hooks_settings would reach the prune one run too late.
if [ "$HOOKS_VIA_PLUGIN" = "true" ]; then
  for _e in ${HOOKS_CATALOG[@]+"${HOOKS_CATALOG[@]}"}; do RETIRED_HOOKS+=("${_e%%::*}"); done
  unset _e
fi
RETIRED_AGENTS=(angular-solution-designer.md angular-implementer.md angular-verifier.md mobile-solution-designer.md mobile-implementer.md mobile-verifier.md dotnet-windows-service-solution-designer.md dotnet-windows-service-implementer.md dotnet-windows-service-verifier.md code-analyzer.md issue-diagnoser.md)
# MCP servers this stack no longer ships AT ALL. Empty today, and it is the mechanism that matters:
# skills, agents, rules and hooks each got a retired list; MCPs never did, so a server the stack
# dropped stayed registered in every existing install and kept injecting its tool schemas on every
# session (measured: 24 playwright schemas re-injected into a headless backend project). A server
# the stack still SHIPS but this project no longer needs is a different question - that is
# /claude-stack:validate's whole-stack-absent pass, not a retirement.
RETIRED_MCPS=()
# The plugin route retires the whole REGISTRATION catalog, the same way HOOKS_VIA_PLUGIN retires the
# copied hooks: the servers now arrive through the plugins named for them, so every stack name this
# script ever wrote into .mcp.json must come back OUT in the run that enables those plugins, or the
# project runs each server twice - once from the file and once from the plugin - and pays both sets
# of tool schemas on every session. Appended HERE, at load, because update_mcps prunes before it
# would otherwise register. The playwright family is expanded by hand: the catalog carries one
# `playwright` row but an install may have written any of the four per-engine names.
# Rebuildable, not a one-shot append: resolve_stack_plugins can still drop the run back to the
# registration route (no node, no snapshot), and a RETIRED_MCPS frozen at load would then unregister
# the very servers that route is about to write. It is called once here and once from that fallback.
_MCPS_RETIRED_AUTHORED=(${RETIRED_MCPS[@]+"${RETIRED_MCPS[@]}"})
_refresh_retired_mcps() {
  RETIRED_MCPS=(${_MCPS_RETIRED_AUTHORED[@]+"${_MCPS_RETIRED_AUTHORED[@]}"})
  local e
  if [ "$MCPS_VIA_PLUGIN" != "true" ]; then
    # Copy route, but the core plugin is still on (hooks or skills): its dependencies already carry
    # the locked three, so any registration of them this script ever wrote has to come out.
    _core_plugin_on && for e in $MCPS_LOCKED; do RETIRED_MCPS+=("$e"); done
    return 0
  fi
  for e in ${MCPS_CATALOG[@]+"${MCPS_CATALOG[@]}"}; do RETIRED_MCPS+=("${e%%|*}"); done
  RETIRED_MCPS+=(playwright-chrome playwright-msedge playwright-firefox playwright-webkit)
}
_refresh_retired_mcps
# Plugins this stack no longer ships AT ALL. Empty today, and as with RETIRED_MCPS it is the
# MECHANISM that matters: skills, agents, rules, hooks and MCPs each have a retired list and plugins
# had none, so a plugin the stack dropped stayed installed AND ENABLED on every existing machine
# forever - the same re-injection cost class the MCP list was created to fix, and worse, because a
# plugin can ship a SessionStart hook that injects thousands of characters into every session and
# every subagent (measured 2026-09-12: two curated plugins injecting 8,337 chars per session, one of
# them 5,229 more per subagent, none of it visible to `claude plugin details`, to the always-on lint
# budget, or to /claude-stack:status). Entries are the bare plugin NAME, without the @marketplace
# suffix the PLUGINS block carries. A plugin the stack still SHIPS but this project does not need is
# a different question - that is /claude-stack:validate's whole-stack-absent pass, not a retirement.
RETIRED_PLUGINS=(
  "ponytail"   # dropped from PLUGINS in 0.2.7x (the audit remediation); never joined this list until 0.2.85
)

remove_skills() {  # rm -rf each manifest skill under the scope dest, so update starts from a clean slate
  local dest entry name
  case "$CLAUDE_SCOPE" in user) dest="$CONFIG_DIR/skills" ;; *) dest="$PWD/.claude/skills" ;; esac
  log "skills [$CLAUDE_SCOPE]: removing ${#SKILLS[@]} for clean reinstall"
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    name="${entry#*|}"
    rm -rf "$dest/$name"
  done
  for name in ${RETIRED_SKILLS[@]+"${RETIRED_SKILLS[@]}"}; do
    [ -d "$dest/$name" ] && { rm -rf "${dest:?}/$name"; log "  skill pruned (retired upstream): $name"; }
  done
  return 0
}

prune_retired_agents() {  # UPDATE: drop the known old agent names (RETIRED_AGENTS above)
  local root name; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  for name in ${RETIRED_AGENTS[@]+"${RETIRED_AGENTS[@]}"}; do
    [ -f "$root/.claude/agents/$name" ] && { rm -f "$root/.claude/agents/$name"; log "  agent pruned (retired upstream): $name"; }
  done
  return 0
}

prune_retired_rules() {  # UPDATE: drop the known old rule names (RETIRED_RULES above)
  # A leftover rule is worse than a leftover skill: a pathless baseline-*.md is loaded into EVERY
  # session and subagent, so a retired copy keeps shipping guidance its replacement already merged
  # (measured on a real install: 7 of 14 rule files were names this release no longer ships).
  local root name; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  for name in ${RETIRED_RULES[@]+"${RETIRED_RULES[@]}"}; do
    [ -f "$root/.claude/rules/$name" ] && { rm -f "$root/.claude/rules/$name"; log "  rule pruned (retired upstream): $name"; }
  done
  return 0
}

prune_retired_hooks() {  # UPDATE: drop the known old hook names (RETIRED_HOOKS above)
  # The file only - wire_hooks_settings drops the matching settings.json entries in the same run
  # (a wired command whose file is gone spawns a failure on every matching tool call).
  local root name; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  for name in ${RETIRED_HOOKS[@]+"${RETIRED_HOOKS[@]}"}; do
    [ -f "$root/.claude/hooks/$name" ] && { rm -f "$root/.claude/hooks/$name"; log "  hook pruned (retired upstream): $name"; }
  done
  return 0
}

update_skills() {
  # Fresh clone + copy - the same as install (the copy overwrites), just cleared first.
  remove_skills
  install_skills
}

# `claude plugin list --json` -> one 'name<TAB>version<TAB>scope' line per INSTALLED stack plugin.
# The listing is machine-global: an entry carries projectPath for a project-scoped install, so this
# keeps THIS project's rows plus the account-level (user/local) ones and drops a sibling repo's.
# An older CLI without --json prints nothing parseable -> no lines -> the caller keeps its defaults.
_PLUGIN_SCAN_PY='
import json, sys, os
cwd = os.path.realpath(sys.argv[1])
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
rows = d.get("installed", []) if isinstance(d, dict) else d
best = {}
for e in rows if isinstance(rows, list) else []:
    if not isinstance(e, dict): continue
    name = str(e.get("id", "")).split("@")[0]
    if not name: continue
    pp = e.get("projectPath")
    if pp and os.path.realpath(str(pp)) != cwd: continue
    rank = 0 if pp else 1                       # this project first, then the account-level rows
    if name not in best or rank < best[name][0]:
        best[name] = (rank, str(e.get("version", "?")), str(e.get("scope", "")), "yes" if e.get("enabled", True) else "no")
for name, (_, ver, scope, enabled) in best.items():
    print("%s\t%s\t%s\t%s" % (name, ver, scope, enabled))
'
_plugin_scan() {  # -> name<TAB>version<TAB>scope lines; empty when the CLI or python3 cannot answer
  command -v python3 >/dev/null 2>&1 || return 0
  claude plugin list --json 2>/dev/null | python3 -c "$_PLUGIN_SCAN_PY" "$PWD" 2>/dev/null || true
}
_plugin_field() {  # $1 = scan output $2 = name $3 = field index (2=version, 3=scope, 4=enabled)
  printf '%s\n' "$1" | awk -F'\t' -v n="$2" -v f="$3" '$1 == n { print $f; exit }'
}

prune_retired_plugins() {  # UPDATE: uninstall the known retired plugin names (RETIRED_PLUGINS above)
  local listing name pscope
  listing="$1"
  for name in ${RETIRED_PLUGINS[@]+"${RETIRED_PLUGINS[@]}"}; do
    [ -n "$(_plugin_field "$listing" "$name" 2)" ] || continue      # not installed here - nothing to do
    pscope="$(_plugin_field "$listing" "$name" 3)"; [ -n "$pscope" ] || pscope="$CLAUDE_SCOPE"
    claude plugin uninstall "$name" --scope "$pscope" -y >/dev/null 2>&1 \
      && log "  plugin pruned (retired upstream) [$pscope]: $name"
  done
  return 0
}

update_plugins() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  ensure_official_marketplace
  claude plugin marketplace update 2>/dev/null || true            # refresh marketplaces first
  local before after p name pscope v1 v2
  local -a _all=(${PLUGINS[@]+"${PLUGINS[@]}"})
  # The stack's OWN plugins travel this same loop on update - installed when absent, enabled when
  # parked, then updated. Without it an update pruned the copied hooks, skills and agents and
  # enabled nothing in their place: `claude plugin update` is a no-op on a plugin that is not
  # installed, so the run ended with neither route live.
  _stack_plugin_set
  _all+=(${STACK_RUN_PLUGINS[@]+"${STACK_RUN_PLUGINS[@]}"})
  _core_deps_needed; _all+=(${CORE_DEPS_NEEDED[@]+"${CORE_DEPS_NEEDED[@]}"})
  before="$(_plugin_scan)"
  prune_retired_plugins "$before"
  for p in ${_all[@]+"${_all[@]}"}; do
    name="${p%%@*}"
    # The plugin's OWN scope, read from the listing: `claude plugin update --scope <other>` is a
    # silent no-op, so passing the INSTALL's scope left every user-scoped plugin on its old version
    # under a project install. The manifest default (claude-hud is user-scope, the rest follow the
    # run) only applies when the listing cannot say.
    pscope="$(_plugin_field "$before" "$name" 3)"
    if [ -z "$pscope" ]; then
      pscope="$CLAUDE_SCOPE"; case "$p" in claude-hud@*) pscope="user" ;; esac
    fi
    # UPDATE alone cannot adopt: `claude plugin update` is a no-op on a plugin that is not
    # installed, and says nothing about one that is installed but DISABLED. So a selection that
    # ADDED a plugin left it absent or parked, and this function's own log line - 'not installed -
    # /claude-stack:configure adds it' - was false, since configure runs this very function
    # (measured: two added plugins still `disabled` after the run, recovered by hand over 8
    # messages and ~1.05M of context).
    if [ -z "$(_plugin_field "$before" "$name" 2)" ]; then
      log "plugin install [$pscope]: $p"
      claude plugin install "$p" --scope "$pscope" -y 2>&1 | tail -1 || true
    elif [ "$(_plugin_field "$before" "$name" 4)" = "no" ]; then
      log "plugin enable [$pscope]: $p (installed but disabled)"
      claude plugin enable "$p" --scope "$pscope" 2>&1 | tail -1 || true
    fi
    log "plugin update [$pscope]: $p"
    claude plugin update "$p" --scope "$pscope" -y 2>&1 | tail -1 || true   # -y for the same non-TTY reason as install
  done
  # Read the versions back: `claude plugin update` reports success whether or not anything moved.
  after="$(_plugin_scan)"
  [ -n "$before$after" ] || return 0
  for p in ${_all[@]+"${_all[@]}"}; do
    name="${p%%@*}"
    v1="$(_plugin_field "$before" "$name" 2)"; v2="$(_plugin_field "$after" "$name" 2)"
    if [ -z "$v2" ]; then log "  plugin $name: NOT installed - the install above did not take (is the marketplace reachable?)"
    elif [ "$(_plugin_field "$after" "$name" 4)" = "no" ]; then log "  plugin $name: $v2 but DISABLED - 'claude plugin enable $p' turns it back on"
    elif [ "$v1" != "$v2" ] && [ -n "$v1" ]; then log "  plugin $name: $v1 -> $v2"
    else log "  plugin $name: $v2 (already newest)"; fi
  done
}

prune_retired_mcps() {  # UPDATE: unregister the known retired server names (RETIRED_MCPS above)
  local name
  for name in ${RETIRED_MCPS[@]+"${RETIRED_MCPS[@]}"}; do
    claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 && log "  mcp pruned (retired upstream): $name"
  done
  return 0
}

update_mcps() {
  command -v claude >/dev/null 2>&1 || { CLAUDE_MISSING=true; return 0; }   # fail-soft: skip, never abort the run
  prune_retired_mcps
  # PLUGIN ROUTE: the prune above IS the update - `claude plugin update` refreshed the entries, and
  # the pins they carry are release-time values from meta/mcp-pins.json, so there is nothing to
  # re-resolve and nothing to re-register.
  if [ "$MCPS_VIA_PLUGIN" = "true" ]; then
    log "mcp: carried by the plugins - registrations pruned, nothing re-registered"
    return 0
  fi
  # Every npm / PyPI entry is pinned at install and bumps here via remove + re-add; angular-cli stays
  # unpinned by design (it must match the workspace ng), the hosted servers (context7 remote, sentry)
  # have nothing to pin, and an offline lookup degrades to the unpinned form. An add that lands on a
  # name the remove did not clear exits 0 without writing - verify_mcps is what makes this stick.
  local entry name args
  for entry in ${MCPS[@]+"${MCPS[@]}"}; do
    name="${entry%%|*}"; args="${entry#*|}"
    if _is_locked_mcp "$name" && _core_plugin_on; then
      log "  mcp $name: carried by the core plugin's dependencies - not re-registered here"
      continue
    fi
    log "mcp refresh [$CLAUDE_SCOPE]: $name"
    claude mcp remove "$name" -s "$CLAUDE_SCOPE" >/dev/null 2>&1 || true
    _mcp_register "$name" "$args" || note_failure "mcp $name failed"
  done
}

update_hooks() { prune_retired_hooks; download_hooks; wire_hooks_settings; }   # UPDATE: refresh hook files + re-ensure the settings.json wiring (idempotent - a new hook block, deny rule, or env key ships to updated projects too)
update_agents() { prune_retired_agents; download_agents; } # UPDATE: drop retired names, refresh subagent files
update_rules() { prune_retired_rules; download_rules; }   # UPDATE: drop retired names, refresh rule files

# ===========================================================================
# KEEP-PINS (--keep-pins) - preserve local model/effort frontmatter edits across the refresh.
# The agent fetch and the skills clean-reinstall reset every file to upstream, wiping a per-project
# model/effort re-pin. With --keep-pins the values are snapshotted BEFORE the refresh and re-applied
# AFTER it - only keys present in both the old local file and the refreshed one (no add/remove), and
# the local value always wins over an upstream pin change (the flag cannot tell the two apart).
# ===========================================================================
_fm_pin() {  # $1=file $2=key -> print the key's value from the leading frontmatter block ('' if absent)
  awk -v k="$2" '
    NR==1 { if ($0 !~ /^---[[:space:]]*$/) exit; next }
    /^---[[:space:]]*$/ { exit }
    index($0, k":") == 1 { sub("^"k":[[:space:]]*", ""); sub(/[[:space:]]+$/, ""); print; exit }
  ' "$1" 2>/dev/null
}

_fm_set_pin() {  # $1=file $2=key $3=value - rewrite the key's line INSIDE the frontmatter block only
  local tmp; tmp="$(mktemp)"
  awk -v k="$2" -v v="$3" '
    NR==1 && /^---[[:space:]]*$/ { fm=1; print; next }
    fm==1 && /^---[[:space:]]*$/ { fm=2; print; next }
    fm==1 && index($0, k":") == 1 { print k": "v; next }
    { print }
  ' "$1" > "$tmp" && mv "$tmp" "$1"
}

_pin_files() {  # print every locally-installed pin-bearing target: manifest agents + skill SKILL.md files
  local root file entry skills_dir
  root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  for file in ${AGENTS[@]+"${AGENTS[@]}"}; do
    [ -f "$root/.claude/agents/$file" ] && printf '%s\n' "$root/.claude/agents/$file"
  done
  if [ "$SCOPE" = "project" ]; then skills_dir="$root/.claude/skills"; else skills_dir="$CONFIG_DIR/skills"; fi
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    [ -f "$skills_dir/${entry#*|}/SKILL.md" ] && printf '%s\n' "$skills_dir/${entry#*|}/SKILL.md"
  done
}

PIN_DIR=""
snapshot_pins() {  # --keep-pins: record each installed agent/skill file's model/effort before the refresh
  $KEEP_PINS || return 0
  PIN_DIR="$(mktemp -d)"
  local f key m e count=0
  while IFS= read -r f; do
    m="$(_fm_pin "$f" model)"; e="$(_fm_pin "$f" effort)"
    [ -z "$m" ] && [ -z "$e" ] && continue
    key="$(printf '%s' "$f" | tr '/' '_')"   # flatten the path -> one snapshot file per target
    printf 'model=%s\neffort=%s\n' "$m" "$e" > "$PIN_DIR/$key"
    count=$((count + 1))
  done < <(_pin_files)
  log "keep-pins: snapshotted model/effort from $count file(s)"
}

restore_pins() {  # --keep-pins: re-apply every snapshotted value the refresh changed
  $KEEP_PINS || return 0
  [ -n "$PIN_DIR" ] || return 0
  local f key k saved cur disp kept=0
  while IFS= read -r f; do
    key="$(printf '%s' "$f" | tr '/' '_')"
    [ -f "$PIN_DIR/$key" ] || continue
    case "$f" in
      */.claude/agents/*) disp="agents/${f##*/.claude/agents/}" ;;
      */skills/*)         disp="skills/${f##*/skills/}" ;;
      *)                  disp="$f" ;;
    esac
    for k in model effort; do
      saved="$(sed -n "s/^$k=//p" "$PIN_DIR/$key")"
      [ -n "$saved" ] || continue
      cur="$(_fm_pin "$f" "$k")"
      if [ -n "$cur" ] && [ "$cur" != "$saved" ]; then
        _fm_set_pin "$f" "$k" "$saved"; kept=$((kept + 1))
        log "  pin kept: $disp $k=$saved (upstream: $cur)"
      fi
    done
  done < <(_pin_files)
  rm -rf "$PIN_DIR"; PIN_DIR=""
  log "keep-pins: re-applied $kept local pin value(s)"
}

prune_agents_cache() {
  # Legacy cleanup: an npx-skills-era install staged an agent-neutral .agents/ store. The git-copy
  # install_skills never creates one, so this is a no-op on a fresh install and only matters for a
  # project upgrading from the old flow. Guard: keep it if any skill entry under .claude/skills is a
  # symlink (a symlinked tree still depends on .agents/; removing it would dangle).
  local root d; root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -d "$root/.agents" ] || return 0
  local has_symlink=false
  for d in "$root/.claude/skills"; do
    [ -d "$d" ] || continue
    if find "$d" -maxdepth 1 -type l 2>/dev/null | grep -q .; then has_symlink=true; break; fi
  done
  if $has_symlink; then
    log "  kept .agents/ - a skills tree has symlinks that still depend on it"
  else
    rm -rf "$root/.agents" && log "  pruned .agents/ (skills are real per-agent copies)"
  fi
}

# ===========================================================================
# DISPATCH
# ===========================================================================
# --skills-only: run ONLY the skill step and exit, before any prerequisite check or claude-CLI-
# dependent step (testability - drives just the git-copy with no claude/gh/network dependency).
if [ "$SKILLS_ONLY" = true ]; then
  if [ "$ACTION" = "install" ]; then install_skills; else update_skills; fi
  # On the plugin route the skills layer IS the plugins: the step above pruned the copies, so
  # enabling them here is what keeps the flag from leaving a project with neither. It stays
  # fail-soft and CLI-free on the copy route, which is what the flag was built for.
  if [ "$SKILLS_VIA_PLUGIN" = "true" ] && command -v claude >/dev/null 2>&1; then
    # The core entry DEPENDS on superpowers, so its marketplace has to be registered first or every
    # stack plugin fails with 'Dependency ... not found' - measured on this path, which is the one
    # place that installs plugins without going through install_plugins.
    ensure_official_marketplace
    _stack_plugin_set
    for _so_p in ${STACK_RUN_PLUGINS[@]+"${STACK_RUN_PLUGINS[@]}"}; do
      log "plugin [$CLAUDE_SCOPE]: $_so_p"
      claude plugin install "$_so_p" --scope "$CLAUDE_SCOPE" -y || note_failure "plugin $_so_p failed"
    done
  fi
  write_stamp   # a skills-only run still installs FROM a revision - record it
  exit 0
fi

prerequisites_check
install_github_cli

# COPY ROUTE ONLY. Everything the stack ships names an MCP tool by its PLUGIN spelling,
# `mcp__plugin_<plugin>_<server>__<tool>` - because from 1.0.0 every stack server arrives through a
# plugin named for it. With CLAUDE_STACK_MCPS_VIA_PLUGIN=false the servers are registered in
# .mcp.json under their BARE names instead, and those tool names would resolve to nothing: an agent
# `tools:` allowlist written the plugin way silently drops the tool, and a `ToolSearch select:` line
# written that way silently finds none. So the copied files are re-spelled back, in place, right
# after the copies land. One sed per file, only on files that carry the string.
# The skills and agents a PLUGIN carries cannot be re-spelled - they are read from the plugin cache,
# not from .claude/ - so the mixed combination is reported rather than half-fixed.
downconvert_mcp_tool_names() {
  local bare
  bare="$(_bare_named_mcps | tr '\n' ' ')"
  [ -n "${bare// /}" ] || return 0            # every server this run set up rides a plugin
  if [ "$SKILLS_VIA_PLUGIN" = "true" ]; then
    log "  !! these servers are registered under their bare names but the skills and agents come from the plugins, which name the plugin spelling: ${bare% } - set CLAUDE_STACK_SKILLS_VIA_PLUGIN=false too, or leave them on the plugin route"
    return 0
  fi
  local root skills
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"
  case "$CLAUDE_SCOPE" in user) skills="$CONFIG_DIR/skills" ;; *) skills="$PWD/.claude/skills" ;; esac
  BARE_MCPS="$bare" python3 - "$skills" "$root/.claude/agents" "$root/.claude/rules" "$root/.claude/hooks" <<'DOWNCONV' || log "  !! copy route: the MCP tool-name re-spelling failed - the copied files keep the plugin spelling"
import os, re, sys
# Only the servers THIS run registered under a bare name. The three locked ones ride the core
# plugin's dependencies whenever any plugin route is on, so on a hooks-only copy route their tool
# names must stay plugin-spelled while the droppable picks are re-spelled - re-spelling everything
# was the bug this list exists to prevent.
bare = set(os.environ.get("BARE_MCPS", "").split())
if not bare:
    raise SystemExit(0)
# One plugin carries one server under the SAME name, so the two halves are the same word; matching
# them separately, rather than with a backreference that BSD sed does not honour, keeps this
# portable - and the SERVER half is the name a registration actually writes.
pat = re.compile(r"mcp__plugin_[A-Za-z0-9][A-Za-z0-9.-]*_([A-Za-z0-9][A-Za-z0-9.-]*)__")
sub = lambda m: ("mcp__%s__" % m.group(1)) if m.group(1) in bare else m.group(0)
n = 0
for target in sys.argv[1:]:
    for dirpath, _dirs, files in os.walk(target):
        for name in files:
            if not name.endswith((".md", ".mdc", ".js", ".json", ".txt")):
                continue
            path = os.path.join(dirpath, name)
            try:
                body = open(path, encoding="utf-8").read()
            except Exception:
                continue
            fixed = pat.sub(sub, body)
            if fixed != body:
                open(path, "w", encoding="utf-8").write(fixed)
                n += 1
if n:
    print("  copy route: MCP tool names re-spelled to the registered server names in %d file(s)" % n)
DOWNCONV
  return 0
}

# claude-only steps fail soft (command -v claude) if the CLI is not installed.
snapshot_pins   # --keep-pins only: no-op without the flag (install re-adds skills unconditionally too, so both actions refresh)
if [ "$ACTION" = "install" ]; then
  _bootstrap_stack_source; install_skills; install_plugins; prune_playwright_servers; install_mcps; verify_mcps; seed_account_keys; download_hooks; wire_hooks_settings; download_agents; download_rules; import_memory_notes; migrate_docs_domains; seed_claude_md; seed_serena_project; ensure_playwright_browser; downconvert_mcp_tool_names
else
  _bootstrap_stack_source; update_skills; update_plugins; prune_playwright_servers; update_mcps; verify_mcps; seed_account_keys; update_hooks; update_agents; update_rules; import_memory_notes; migrate_docs_domains; seed_serena_project; ensure_playwright_browser; downconvert_mcp_tool_names
fi
restore_pins
write_stamp   # after every copy step, so the stamp only ever names a revision that fully landed

prune_agents_cache
echo
log "done: $ACTION [scope=$SCOPE, account=$CONFIG_DIR, agent=$AGENT]"
_hook_files=0; _seen=""   # count hook FILES (a hook wired on two tools is one hook), matching the plan (ten hooks today)
for _e in ${HOOKS[@]+"${HOOKS[@]}"}; do _n="${_e%%::*}"; case " $_seen " in *" $_n "*) continue ;; esac; _seen="$_seen $_n"; _hook_files=$((_hook_files + 1)); done
_summary="  installed/refreshed this run - skills=${#SKILLS[@]}, plugins=${#PLUGINS[@]}, mcps=${#MCPS[@]}, hooks=$_hook_files, agents=${#AGENTS[@]}, rules=${#CLAUDE_RULES[@]}"
_summary="$_summary; memory=$MEMORY_LEVEL ($MEMORY_DB_PATH)"
[ -n "$SPACE" ] && _summary="$_summary; space=$SPACE"
# Always stated, both ways: a run that RESET the pins to catalog defaults printed no line at all, so
# the close had nothing to cite and asserted the reset from memory instead.
if [ "$KEEP_PINS" = true ]; then _summary="$_summary; keep-pins=on"; else _summary="$_summary; keep-pins=off (agent model/effort pins reset to catalog defaults)"; fi
[ "$MCP_REPAIRS" -gt 0 ] && _summary="$_summary; mcp registrations repaired=$MCP_REPAIRS"
[ -n "$PLAYWRIGHT_BROWSERS" ] && _summary="$_summary; playwright=$(printf '%s' "$PLAYWRIGHT_BROWSERS" | tr ' ' ',')"
log "$_summary; context7=$CONTEXT7_MODE"
# The counts above are the SELECTION this run wrote, not a listing of .claude/ - generated
# project-owned files and names this release no longer ships are neither refreshed nor counted
# (a real install compared its 14 rule FILES against rules=4 and read it as a silent drop).
[ "$INSTALLED_ONLY" = true ] && log "  (a directory listing can be larger: generated project files and any 'unknown:' name above are left untouched)"
if [ "$CLAUDE_MISSING" = true ]; then
  log "  !! claude CLI absent - plugins, MCPs, and settings.json wiring were SKIPPED (install it, then re-run)"
fi
if [ "$FAIL_COUNT" -gt 0 ]; then
  log "  !! $FAIL_COUNT item(s) failed above - re-run '$ACTION' to retry"
fi

log "next steps:"
# Each capture line is gated on the artifact it would produce being ABSENT - an update used to tell a
# project that already holds all three generated rules to go capture them, ~175 tokens of log tail
# re-read on every run. The serena line beside them was already gated this way.
_gen_rules="$(git rev-parse --show-toplevel 2>/dev/null || printf %s "$PWD")/.claude/rules"
# This one is gated on the SEED still being unfilled, not on the file's absence: the installer has
# just written it, so the file always exists by the time these lines print.
grep -q 'Fill-in block - delete once done' "$(git rev-parse --show-toplevel 2>/dev/null || printf %s "$PWD")/.claude/CLAUDE.md" 2>/dev/null && log "  - write your project's CLAUDE.md top from the template's authoring-outline comment (framework, stack, conventions, secret/config globs) - install seeds a starter from the template when the project has none; the claude-md-management plugin can help audit it"
[ -f "$_gen_rules/baseline-project-related-context.md" ] || log "  - if this repo has sibling projects (a backend/frontend pair, a consumed package), run /project-related-context with their paths/URLs - it generates the awareness rule (baseline-project-related-context.md) + related-projects/RELATED-PROJECTS.md under the docs root"
[ -f "$_gen_rules/baseline-project-architecture.md" ] && [ -f "$_gen_rules/project-code-style.md" ] || log "  - once oriented, run the other two captures the CLAUDE.md rules table names: /project-architecture-analyzer (architecture/ARCHITECTURE.md + awareness rule) and /project-code-style-analyzer (code-style/CODE-STYLE.md under the docs root + the generated path-scoped style rule)"
[ -f "$_gen_rules/baseline-project-agent-capabilities.md" ] || log "  - run /project-agent-capabilities LAST - it inventories the installed skills/agents/MCPs and generates baseline-project-agent-capabilities.md (re-run after update or a manifest trim)"
if printf '%s\n' ${MCPS[@]+"${MCPS[@]}"} | grep -q '^serena|'; then
  log "  - index the codebase for serena ONCE (a few seconds to a few minutes; the first run also downloads the language server): SERENA_HOME=.serena/home uvx --from serena-agent serena project index - re-run it after a large refactor, a branch switch that moves many files, or whenever symbol lookups start missing things"
fi
log "  - restart Claude Code (or reopen the project) to load the new MCPs, hooks, and settings"
# A global install switches Claude's own memory off only where the memory rule and start hook landed -
# this repo - so the card says so rather than letting 'global' read as 'every project'.
if [ "$CLAUDE_SCOPE" = "user" ] && [ "$MEMORY_SWITCHED_OFF" = true ]; then
  log "  - memory: Claude's own memory is off in this repo only ($(_memory_target_settings)) - a global install lands the memory rule and start hook per repo, so every other project of this account keeps its own memory until an install or update runs there"
fi
# One line, only when this run was TOLD which engine stays on (setup / configure): an update never
# re-asks the user to toggle what they may already have toggled.
if [ -n "$PLAYWRIGHT_ENABLED" ] && [ -n "$PLAYWRIGHT_BROWSERS" ]; then
  _pw_off=""; for _pw_e in $PLAYWRIGHT_BROWSERS; do [ "$_pw_e" = "$PLAYWRIGHT_ENABLED" ] || _pw_off="$_pw_off, /mcp disable playwright-$_pw_e"; done
  [ -n "$_pw_off" ] && log "  - playwright: keep playwright-$PLAYWRIGHT_ENABLED on - run once in Claude Code: ${_pw_off#, } (switch any time with /mcp enable / disable)"
fi
# Both context7 entries are installed in local mode (the hosted one is a dependency of the core and
# cannot be dropped), and both servers load until one is switched off. Its own `if`, not the
# playwright one above: that block only runs when this run was told which engine stays on.
if [ "$CONTEXT7_MODE" = "local" ] && [ "$MCPS_VIA_PLUGIN" = "true" ]; then
  log "  - context7: the local transport is on - run once in Claude Code: /mcp disable context7 (or leave both and pay two sets of doc tools)"
fi
[ "$PREREQ_MISSING" = true ] && log "  - install the missing prerequisites flagged above, then re-run"
# The key report reads the ACCOUNT file back - a length or absent, never a value - so the close says
# what actually landed; the project-level settings.json never reaches .mcp.json expansion (measured).
if [ "$CONTEXT7_MODE" = "remote" ]; then
  _c7="$(account_key_state CONTEXT7_API_KEY)"
  case "$_c7" in
    *=set*) log "  - context7 key: $_c7 in $CONFIG_DIR/settings.json env" ;;
    *) log "  - context7 key: $_c7 in $CONFIG_DIR/settings.json env - the keyless free tier works; for higher rate limits export CONTEXT7_API_KEY and re-run (the run writes it into that ACCOUNT file), or add it to that file's 'env' by hand, or re-run with --context7 local" ;;
  esac
fi
if printf '%s\n' ${MCPS[@]+"${MCPS[@]}"} | grep -q '^sentry|'; then
  _ss="$(account_key_state SENTRY_SLUG)"
  case "$_ss" in
    *=set*) log "  - sentry slug: $_ss in $CONFIG_DIR/settings.json env" ;;
    *) log "  - sentry slug: $_ss in $CONFIG_DIR/settings.json env - the URL needs it: re-run with --sentry-slug <org>[/<project>] (or export SENTRY_SLUG), or add it to that file's 'env' by hand" ;;
  esac
  if [ "$SENTRY_AUTH" = "token" ]; then
    _st="$(account_key_state SENTRY_ACCESS_TOKEN)"
    case "$_st" in
      *=set*) log "  - sentry token: $_st in $CONFIG_DIR/settings.json env" ;;
      *) log "  - sentry token: $_st in $CONFIG_DIR/settings.json env - export SENTRY_ACCESS_TOKEN (a personal/org API token) in the launch shell and re-run (the run writes it into that ACCOUNT file), paste it into the snippet below, or re-run with --sentry-auth oauth for the browser consent flow"
         # Only when the key is ABSENT. These lines used to sit after `esac`, so a run that had just
         # reported `SENTRY_ACCESS_TOKEN=set (71 chars)` still told the user to paste one in.
         # The token never goes through a chat, and not through a shell argument either (it would
         # land in the history file). getpass reads it from the terminal without echoing; the file
         # is written by this snippet, not by anything that can log the value.
         log "      the token never travels through a chat, and does not belong in a shell argument. Paste it into this:"
         log "      python3 -c \"import getpass,json,pathlib;f=pathlib.Path('$CONFIG_DIR/settings.json');d=json.loads(f.read_text() or '{}') if f.exists() else {};d.setdefault('env',{})['SENTRY_ACCESS_TOKEN']=getpass.getpass('token (not echoed): ');f.parent.mkdir(parents=True,exist_ok=True);f.write_text(json.dumps(d,indent=2))\"" ;;
    esac
  else log "  - sentry is registered with no header: the first use opens Sentry's consent flow in the browser via /mcp"; fi
fi
[ "$INSTALL_GITHUB_CLI" = true ] && log "  - run 'gh auth login' if gh is not yet authenticated (needed before PRs/issues)"

# Reminder: stack-generated, machine-local artifacts that should NOT be committed.
cat <<'GITIGNORE'

Add these stack-generated, machine-local artifacts to the project's .gitignore (or .git/info/exclude):
  .serena          serena per-project state: registry, cache, language servers (SERENA_HOME=.serena/home)
  .claude/*        Claude Code project config + local state (settings.local.json, hooks) - ignore the contents...
  !.claude/CLAUDE.md   ...but TRACK the project instructions: they live at .claude/CLAUDE.md and must be committed (git can only re-include a file if the parent dir is not wholesale-ignored, hence '.claude/*' not '.claude/')
  .slopwatch       dotnet-slopwatch output
  .playwright      playwright MCP user-data-dir + output (screenshots, traces)
  .mcp.json        generated MCP server config (machine-local)

The generated-docs root is CLAUDE_STACK_DOCS_PATH in .claude/settings.json env (seeded '.claude/docs') -
generated docs inherit the .claude ignore above and are machine-local: not committed, not shared,
re-captured after a fresh clone. To share them with the team, set CLAUDE_STACK_DOCS_PATH to a committed
path (e.g. 'docs', forward slashes on every OS) and track <docs-path>/superpowers/ too.
CLAUDE_STACK_DOCS_VERSIONING (same env block) says how every capture's docs are versioned - 'git' when
they are committed (git versions them per branch), 'local' for the machine-local overlay under
<docs-path>/.branches/. The install seeds 'local' only when the docs are already kept out of git (no
domain tracked, and a domain exists or git ignores the docs root), else 'git' - so a project that adds
the .claude ignore above AFTER this run still reads 'git': re-run update with --docs-versioning local.
Moving the docs to a committed path takes --docs-versioning git.

The same env block carries the fresh-session gate's three knobs (seeded, absent-only, so a
hand-edited value survives every update):
  CLAUDE_STACK_FRESH_SESSION_1M    the per-message TOKENS a session on a 1M window may carry
                                   before an orchestration run is offered a fresh one (default
                                   400000; 0 = off). Above the harness's own auto-compaction, so
                                   lower it to be asked before the harness decides for you
  CLAUDE_STACK_FRESH_SESSION_200K  the same trigger on a 200k window (default 150000; 0 = off)
  CLAUDE_STACK_FRESH_SESSION_DEFAULT
                                   the same trigger for every other case - a window the hooks
                                   cannot read, or one that is neither of those sizes (default
                                   180000; 0 = off)
Which one applies comes from ONE table: the session's model in .claude/hooks/model-windows.json
(replaced on every update). An unlisted model takes CLAUDE_STACK_DEFAULT_CONTEXT_WINDOW (default
1000000); remove that key and an unlisted model takes the DEFAULT trigger.
CLAUDE_STACK_FRESH_SESSION_PCT and CLAUDE_STACK_CONTEXT_WINDOW are retired; nothing reads them.
GITIGNORE
