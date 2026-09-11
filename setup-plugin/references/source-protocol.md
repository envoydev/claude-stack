# The one-download protocol - shared by the setup, update, configure, and validate commands

The four downloading commands (`/claude-stack:setup` - fresh install, `/claude-stack:update` -
refresh + prune, `/claude-stack:configure` - adjust the selection, `/claude-stack:validate` -
reconcile to the project; `status` never downloads) drive their whole run from ONE
source snapshot. This file is the shared contract; each command's numbered steps say WHEN to
apply it, this file says WHAT holds. It lives at the plugin root's `references/` and the commands
cite it as `${CLAUDE_PLUGIN_ROOT}/references/source-protocol.md` - commands and references ship
together in the plugin.

## One release archive is the entire download - and only once per RELEASE

The snapshot is CACHED under the account dir at `<config>/cache/stack-source/<repo>/<version>`, so
the archive is fetched once per release rather than once per run: the second project you install
into, and the `configure` you run an hour later, take the cached copy. What makes that safe is that
the entry is keyed by the release VERSION and the run always asks the release host which version is
newest first - a `HEAD` of `/releases/latest`, whose redirect names the tag (measured: 0.3s for the
probe against ~1.8s for the 1.4MB archive, and 0.1s to copy the extracted 5.4MB snapshot off disk).
There is no TTL to age out and no window where a run silently installs last week's stack: a new
release wins the moment it is published, because the version the probe names is the only entry the
run will reuse.

The run still works in its own `$TMP/repo`, copied from the cache - not read in place. A copy costs
0.1s and buys two things: an `update` landing a new release mid-run cannot pull files out from under
this one, and cleanup stays exactly what it was (`rm -rf "$TMP"` - the cache is not inside it).

On a first run for a release, the snapshot may still cost nothing: Claude Code's own clone of the
marketplace repo, at `<config>/plugins/marketplaces/claude-stack`, is a FULL checkout of this repo -
`scripts/`, `meta/`, `stack/` and all, not just the `setup-plugin/` subdir it serves as the plugin
(measured: 7.1MB on disk). It is used ONLY when its plugin manifest carries the exact version the
probe just named: the clone moves when the user refreshes the marketplace, not when a release is
published, so a version match is the one thing that proves it is the release the archive would be.

```bash
TMP=$(mktemp -d)
REPO_URL=https://github.com/envoydev/claude-stack
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CACHE="$CFG/cache/stack-source/$(printf '%s' "$REPO_URL" | tr -c 'A-Za-z0-9' '-' | cut -c1-80)"
MKT="$CFG/plugins/marketplaces/claude-stack"
VER=$(curl -fsS -o /dev/null -I -m 10 -w '%{redirect_url}' "$REPO_URL/releases/latest" 2>/dev/null | sed -n 's|.*/releases/tag/v\{0,1\}||p')
SRC=""
if [ -n "$VER" ] && [ -d "$CACHE/$VER/stack/skills" ] && [ -d "$CACHE/$VER/stack/agents" ]; then SRC="$CACHE/$VER"; fi
if [ -z "$SRC" ] && [ -n "$VER" ] && [ -d "$MKT/stack/skills" ] &&
   grep -q "\"version\": \"$VER\"" "$MKT/setup-plugin/.claude-plugin/plugin.json" 2>/dev/null; then SRC="$MKT"; fi
if [ -n "$SRC" ]; then
  cp -R "$SRC" "$TMP/repo"; rm -rf "$TMP/repo/.git"     # cache or clone: nothing is downloaded
  [ -f "$TMP/repo/RELEASE-SOURCE" ] || printf 'sha: %s\nref: main\nversion: %s\nsource: marketplace-clone\n' \
    "$(git -C "$MKT" rev-parse HEAD)" "$VER" > "$TMP/repo/RELEASE-SOURCE"   # a clone has no RELEASE-SOURCE
else
  curl -fsSL "$REPO_URL/releases/latest/download/claude-stack.tar.gz" -o "$TMP/claude-stack.tar.gz"
  mkdir -p "$TMP/repo" && tar -xzf "$TMP/claude-stack.tar.gz" -C "$TMP/repo"
  VER=$(sed -n 's/^version: //p' "$TMP/repo/RELEASE-SOURCE" | head -1)   # the archive's own version, authoritative
fi
if [ -n "$VER" ] && [ ! -d "$CACHE/$VER/stack/skills" ]; then            # promote for the next run
  mkdir -p "$CACHE" && rm -rf "$CACHE/.dl.$$" \
    && cp -R "$TMP/repo" "$CACHE/.dl.$$" && mv "$CACHE/.dl.$$" "$CACHE/$VER" 2>/dev/null || rm -rf "$CACHE/.dl.$$"
fi
```

Windows (PowerShell). **Invoke it as a FILE, never as a double-quoted `-Command` string.** The
Bash tool on Windows is Git Bash, so it expands `$TMP`, `$Ver`, `$Src` - every `$Name` in the body -
BEFORE pwsh ever sees them, and the snippet collapses into a command referring to variables that no
longer exist. Write the block to a file and run it:

```bash
cat > "$TMP/step.ps1" <<'PS1'
... the PowerShell below, verbatim ...
PS1
pwsh -NoProfile -File "$TMP/step.ps1"
```

A quoted heredoc (`<<'PS1'`) is what keeps bash out of the body; `pwsh -Command '<single quotes>'`
works for a one-liner with no embedded quote. Measured: this collision cost three runs across two
projects, one of them re-downloading the whole 1.4MB archive after `$TMP` came out empty.

```powershell
$TMP = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TMP -Force | Out-Null
$RepoUrl = 'https://github.com/envoydev/claude-stack'
$Slug = [regex]::Replace($RepoUrl, '[^A-Za-z0-9]', '-')
$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Cache = Join-Path (Join-Path $ConfigDir 'cache/stack-source') $Slug
$Mkt = Join-Path $ConfigDir 'plugins/marketplaces/claude-stack'
$Ver = ''
try {
  $r = Invoke-WebRequest -Uri "$RepoUrl/releases/latest" -Method Head -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  if ([string]$r.BaseResponse.RequestMessage.RequestUri -match '/releases/tag/v?(.+)$') { $Ver = $Matches[1] }
} catch { }
$Src = ''
if ($Ver -and (Test-Path -LiteralPath (Join-Path $Cache "$Ver/stack/skills"))) { $Src = Join-Path $Cache $Ver }
elseif ($Ver -and (Test-Path -LiteralPath (Join-Path $Mkt 'stack/skills')) -and
        ((Get-Content -LiteralPath (Join-Path $Mkt 'setup-plugin/.claude-plugin/plugin.json') -Raw) -match ('"version"\s*:\s*"' + [regex]::Escape($Ver) + '"'))) { $Src = $Mkt }
if ($Src) {
  Copy-Item -LiteralPath $Src -Destination "$TMP/repo" -Recurse                      # nothing is downloaded
  Remove-Item -LiteralPath "$TMP/repo/.git" -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath "$TMP/repo/RELEASE-SOURCE")) {                    # a clone has none
    # WriteAllText, never Set-Content: this file lands in the shared cache and both twins parse it
    # line by line - Set-Content would write CRLF (a stray CR on every value) and, on PS 5.1, a BOM.
    [System.IO.File]::WriteAllText("$TMP/repo/RELEASE-SOURCE",
      "sha: $(& git -C $Mkt rev-parse HEAD)`nref: main`nversion: $Ver`nsource: marketplace-clone`n",
      (New-Object System.Text.UTF8Encoding($false)))
  }
} else {
  Invoke-WebRequest -Uri "$RepoUrl/releases/latest/download/claude-stack.zip" -OutFile "$TMP/claude-stack.zip"
  Expand-Archive -LiteralPath "$TMP/claude-stack.zip" -DestinationPath "$TMP/repo"
  $Ver = ((Get-Content "$TMP/repo/RELEASE-SOURCE" | Where-Object { $_ -match '^version: ' }) -replace '^version: ', '').Trim()
}
if ($Ver -and -not (Test-Path -LiteralPath (Join-Path $Cache "$Ver/stack/skills"))) {
  New-Item -ItemType Directory -Path $Cache -Force | Out-Null
  Copy-Item -LiteralPath "$TMP/repo" -Destination (Join-Path $Cache $Ver) -Recurse -Force -ErrorAction SilentlyContinue
}
```

Both installer twins read and write this same cache - and take the same marketplace clone - from
`stack_src` / `Get-StackSrc`, so a script install reuses what a guided walk fetched and the other
way round. `STACK_SOURCE_CACHE=0` in the environment turns the whole thing off - always-fresh temp
download, the behaviour before the cache. A cache that cannot be written (a read-only or full
`$HOME`) is never fatal: the run keeps the copy it just downloaded and carries on.

**Carry `$TMP` in a MARKER FILE KEYED BY THE PROJECT, and address every run artifact through it.**
Each Bash call is its own shell, so a `TMP=$(mktemp -d)` set in one call is gone by the next and
every run invents its own way of remembering it. The marker name is DERIVED, never a fixed path:
two Claude Code sessions on one machine run these commands concurrently in different projects, and
a shared `/tmp/claude-stack-run.path` hands the second run's `$TMP` to the first - measured: an
installer log came back holding the other session's lines, and the other session's cleanup step
deleted the still-live `$TMP` out from under a run in progress. Derive the key from the project
root, which is stable across every call of one run and different for every project:

```bash
MARK="/tmp/claude-stack-run.$(printf '%s' "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" | tr -c 'A-Za-z0-9' '-' | cut -c1-80).path"
TMP=$(mktemp -d); printf '%s\n' "$TMP" > "$MARK"                      # first call
TMP=$(cat "$MARK"); [ -d "$TMP/repo" ] || echo "STALE MARKER"          # every later call
TMP_WIN=$(cygpath -w "$TMP" 2>/dev/null || printf '%s' "$TMP")         # Windows spelling, empty-safe
```

**Two spellings, one temp dir.** The Bash tool on Windows is Git Bash, so `$TMP` is `/tmp/tmp.XXXX`
- a path the Read tool, `pwsh` and a native `node` cannot open at all ('File does not exist', with
the run's real cwd `C:\...` printed underneath). Every SHELL path stays `$TMP`; the moment a path
leaves the shell - the Read tool, a `pwsh -File`, a node argv - it is `$TMP_WIN`, resolved once
above and never re-derived mid-run (measured: three sessions each paid 2 API messages, 209k-233k
cache-read apiece, rediscovering `cygpath -w` by failing first).

The staleness check is part of the idiom: a marker left behind by an earlier run points at a `$TMP`
that no longer exists, and every later step then writes into a path with no directory. On `STALE
MARKER`, download again from the top rather than continuing.

Every artifact this run writes or reads - `raw.json`, `selection.txt`, `select.out`, `final.json` -
is named as `"$TMP/<file>"`, never bare. A bare relative name resolves against whatever cwd the
shell drifted to, and the six sites that carried one were saved only by a model choosing an absolute
path on its own initiative. PowerShell keeps `$TMP` the same way, in a marker keyed the same way:

```powershell
$Root = (git rev-parse --show-toplevel 2>$null); if (-not $Root) { $Root = (Get-Location).Path }
$Mark = Join-Path ([System.IO.Path]::GetTempPath()) ('claude-stack-run.' + (($Root -replace '[^A-Za-z0-9]','-')) + '.path')
```

**Every PowerShell block on this page reaches pwsh through the BASH tool, so it is written to a
`.ps1` and run with `pwsh -NoProfile -File`, never passed inline to a double-quoted `-Command`.**
Bash expands `$Root`, `$Mark`, `$TMP` inside double quotes before pwsh ever sees them, so the
snippet arrives with its variables already blanked and fails on a ParserError that reads like a
PowerShell bug and is not one. Three confirmed instances across two projects, each costing several
turns. Single-quoting a `-Command` works for a ONE-LINER; anything multi-line goes to a file:

```bash
cat > "$TMP/step.ps1" <<'PS1'
<the PowerShell above, verbatim - bash never touches a quoted heredoc body>
PS1
pwsh -NoProfile -File "$TMP/step.ps1"
```

- The archive is the newest release - the repo's release workflow republishes it on every
  release merge to `main`, tagged `v<version>` from the plugin manifest, so the release version
  always equals the plugin/marketplace version; the `releases/latest/download/...` URLs above
  always resolve to the newest one. `main` is the RELEASE branch (development lands on
  `develop`, so an install never picks up unreleased work) - one self-consistent snapshot, whose
  `RELEASE-SOURCE` file names the exact commit and version it was built from. The `raw.githubusercontent.com` URLs are
  per-file and sit behind a CDN that serves a cached copy for ~5 min after a push, so raw can
  hand back a stale installer or a skewed mix of versions. Never fetch anything from a raw URL -
  not even as a fallback.
- **Fallback when the download fails** (no release reachable, a proxy, the moment the workflow
  is recreating the release): `git clone --depth 1 -b main https://github.com/envoydev/claude-stack
  "$TMP/repo"` - the same one-snapshot contract, just fetched with git. Keep the `-b main` pin:
  the fallback must deliver the release branch, never whatever the default branch happens to be.
  If both fail, the marketplace clone above is the last resort - it is the only source that needs
  no network at all, so on an offline machine take it even though no probe could confirm its
  version, and SAY that in your narration (name the version its manifest carries). If that is
  missing too, say so and stop; never assemble a source from raw URLs.
- Never write the archive, the extracted repo, or your working files into the project tree.

## Check the plugin itself is current

The tooling always comes fresh from the snapshot, but YOUR numbered steps ship with the
installed plugin - so compare versions right after the download: the snapshot's is the
`version:` line in `$TMP/repo/RELEASE-SOURCE`; the running plugin's comes from the CLI, in the
same call:

```bash
claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.id==="claude-stack@claude-stack");console.log(p?`plugin: ${p.version} ${p.enabled?"enabled":"DISABLED"}`:"plugin: not installed")})'
```

**Do NOT read `${CLAUDE_PLUGIN_ROOT}` from the shell to find it.** That variable is expanded into a
command's markdown at injection time, but it is NOT in the Bash tool's environment - a command that
reads it inside the shell gets an empty string, and the check silently skips itself every time
(measured: the same `no CLAUDE_PLUGIN_ROOT` line in five sessions across four projects, so the
currency check had never once run). No CLI, or no `claude-stack` row -> drop the check and emit NO line about it. 'Skip silently' as prose
produced a narration line about skipping, which is the same cost as the check (measured). When they differ, size the gap before deciding: ONE release behind is a report line and the run
CONTINUES - the tooling is the snapshot's and is current either way, so the only risk is that these
numbered steps lag it by one release (measured: a run that asked instead spent 5 turns on two
meta-asks and ended telling the user to restart, with zero reconciliation done). A MULTI-release
gap is worth the ask: say so, recommend `claude plugin marketplace update claude-stack` then
`claude plugin update claude-stack`, and offer to continue anyway. The plugin cache is keyed by version
(`~/.claude/plugins/cache/claude-stack/claude-stack/<version>/`), so after an update the old
version dirs are inert leftovers - safe to delete, keeping only the dir the update installed. When
that listing shows MORE THAN ONE version dir, the run's CLOSE-OUT carries one line offering the
sweep - the count, the keeper, and the `rm -rf` it would run - and deletes only on an explicit yes
(measured: a run's own `find` listed 14 stale dirs, 0.2.34 through 0.2.62, and never mentioned one
of them).
And if an update ever does NOT change the running content (a same-version re-release - the trap
every release now avoids by bumping), the hard reset is `claude plugin uninstall claude-stack`
then `claude plugin install claude-stack@claude-stack`, which rebuilds the cache from the
marketplace.

## Narrate, don't trace

The run must read as a guided installer, not a terminal log. The user sees every tool call's
header, so keep the machinery to as few, small calls as possible and put ALL meaning in your own
narration lines between them:

- ONE quiet call per recompute: write the working file(s) and run `stack-select.js` in a single
  short command - with its output redirected to a file (`> "$TMP/select.out" 2>&1`), never to the
  terminal: the tool-result preview would otherwise dump the whole `required:`/`orphan:` wall
  into the chat. Read the file to parse; the visible result of the call should be empty or one
  count line. Never a call per file, never a re-run to re-read what you already have.
- Never paste tool output (`required:`/`orphan:` dumps, file listings, diffs) into the chat - the
  tables and banners you compose ARE the presentation; raw lines are your input, not the user's.
- Between steps, one narration line in this shape - what just closed, what is being computed,
  what comes next:

```
Final rule set: the 10 recommended (customize round confirmed no changes). Folding into raw.json and recomputing the agents layer's locked set.
24 locked skills. Computing the extras list (release catalog minus locked) before presenting the table.
```

- Machinery that produces no decision (mktemp, downloads, cleanup) gets no narration beyond the
  protocol's own one-liners; a failure is narrated with its consequence, never a stack trace.
- **Few calls means ONE call, not a parallel batch.** The snapshot resolution and any prerequisite
  probe go in a SINGLE Bash call - two fired in parallel are two approval prompts at once on a
  project with an empty `allowedTools`, and that is a doubled chance of a no (measured: both
  rejected, the run abandoned; the retry collapsed download + mkdir + tar into one call and was
  approved).
- **Never re-run a command to re-read a result that is still in context.** A digression does not
  expire an earlier tool result - it is in the same window and is re-sent on every later call
  either way, so re-printing it buys nothing and costs a whole round trip (measured: ~119k of
  re-sent context for output the session already held).
- A long file you need to CONSULT rather than quote - the CLAUDE template, a catalog - is read
  into `$TMP` and narrated as a summary line, never `cat`-ed into the chat (measured: 8,045 raw
  chars of template where one line was needed).

## Use the tools from the snapshot

Everything comes out of `$TMP/repo`:
- the installer - `scripts/os/claude-stack.sh` on `darwin`/`linux`, `scripts/os/claude-stack.ps1` on
  Windows (via `pwsh`)
- `scripts/stack-select.js` and `meta/stack-graph.json` (selection closure + prerequisite check)
- the `meta/` catalogs - `recommendations.json`, `evidence.json`, `judgment.json` (seeds, the
  evidence-scan signals, the judgment gates)
- `stack/CLAUDE.template.md` (the CLAUDE.md fill-in / reconcile step)
- `RELEASE-SOURCE` - the snapshot's commit (the `configure` and `update` commands compare the stamp against it
  via the GitHub compare API; an archive has no git history to diff locally)

Run every later `node`/`bash` step against these snapshot copies - never re-fetch one from a raw
URL; the snapshot is already the newest, consistent copy, and it is the copy the installer runs
from.

**Read them through the Bash tool, never the Read tool - and never interpolate `$TMP` into a
program's string literal.** On Windows `$TMP` is a Git Bash path (`/tmp/tmp.XXXX`): the Read tool
cannot open that spelling at all, and a `node -e` body that embeds it turns `\repo\meta` into
`repometa`, because `\r` is an escape. Both cost whole turns to rediscover - five sessions,
roughly 882k tokens between them. So:

- a catalog or JSON file -> `cat "$TMP/repo/meta/<file>.json"` or a `jq` projection of it
- a script that needs the path -> pass it as an ARGUMENT (`node "$TMP/repo/scripts/x.js" --snapshot
  "$TMP/repo"`), which every tool in the snapshot accepts; never build the path inside the program
- genuinely needing the Windows spelling -> `"$(cygpath -w "$TMP")"`, once, into a variable

## Hand the same snapshot to the installer

Pass `--source "$TMP/repo"` (`-Source` on Windows) when running the installer's action. That is
what keeps a guided run at ONE download instead of two, and it guarantees the run lands the same
revision the command's earlier steps inspected. The installer copies out of `$TMP/repo`, writes the
`claude-stack.stamp` naming that revision (from `RELEASE-SOURCE`, or the checkout's HEAD when the
fallback cloned), and never deletes a source it was handed - cleanup is the command's job, below.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP" "$MARK"` (PowerShell: `Remove-Item -Recurse -Force $TMP, $Mark`) - the MARKER goes
with the temp dir it names, or the next run in this project reads a path that no longer exists.
This is also why the cache lives OUTSIDE `$TMP`, under the account dir: the line above is
unchanged by the cache and must stay that way - never add the cache to it, or the next run pays the
download again. Entries age out on their own (a promote drops siblings older than a week), so there
is nothing here to tidy. The
archive, the extracted repo, and the working files you wrote next to them (`raw.json`,
`selection.txt`) live there and nothing else will remove them - the installer only cleans up a source IT fetched, never the one
you passed via `--source`. Do this on EVERY exit path, not just the happy one - each command's
final step lists its own exit cases.

**After cleanup, a stack-owned file is still one `cat` away - in the CACHE, not in a new download.**
The promoted entry sits at `<config>/cache/stack-source/<repo-slug>/<version>`, holding the same
tree `$TMP/repo` did. When a later turn needs one file from it (a catalog, a template, a hook's
header), read it there. Measured: a run deleted its snapshot, then seven minutes later pulled the
whole 1.4MB archive again to read one 75-line file, after looking in the plugin cache - which ships
`setup-plugin/` only and has no `stack/` at all. Then confirm the project tree holds only installed
artifacts - no archive, no extracted repo, no `raw.json`/`selection.txt`, no installer copy.
