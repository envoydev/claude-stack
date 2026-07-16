# The one-download protocol - shared by the setup, update, and configure skills

All three plugin skills (`setup` - fresh install, `update` - refresh + prune, `configure` -
adjust the selection) drive their whole run from ONE source snapshot. This file is the shared
contract; each skill's numbered steps say WHEN to apply it, this file says WHAT holds. It lives
under the `setup` skill's `references/` and the siblings cite it by path - the skills always
ship together in the plugin.

## One release archive is the entire download

```bash
TMP=$(mktemp -d)
curl -fsSL https://github.com/envoydev/claude-stack/releases/latest/download/claude-stack.tar.gz -o "$TMP/claude-stack.tar.gz"
mkdir -p "$TMP/repo" && tar -xzf "$TMP/claude-stack.tar.gz" -C "$TMP/repo"
```

Windows (PowerShell):

```powershell
$TMP = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TMP -Force | Out-Null
Invoke-WebRequest -Uri https://github.com/envoydev/claude-stack/releases/latest/download/claude-stack.zip -OutFile "$TMP/claude-stack.zip"
Expand-Archive -LiteralPath "$TMP/claude-stack.zip" -DestinationPath "$TMP/repo"
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
  If both fail, say so and stop; never assemble a source from raw URLs.
- Never write the archive, the extracted repo, or your working files into the project tree.

## Use the tools from the snapshot

Everything comes out of `$TMP/repo`:
- the installer - `scripts/claude-stack.sh` on `darwin`/`linux`, `scripts/claude-stack.ps1` on
  Windows (via `pwsh`)
- `scripts/stack-select.js` and `scripts/stack-graph.json` (selection closure + prerequisite check)
- `templates/CLAUDE.template.md` (the CLAUDE.md fill-in / reconcile step)
- `RELEASE-SOURCE` - the snapshot's commit (the `configure` skill compares the stamp against it
  via the GitHub compare API; an archive has no git history to diff locally)

Run every later `node`/`bash` step against these snapshot copies - never re-fetch one from a raw
URL; the snapshot is already the newest, consistent copy, and it is the copy the installer runs
from.

## Hand the same snapshot to the installer

Pass `--source "$TMP/repo"` (`-Source` on Windows) when running the installer's action. That is
what keeps a guided run at ONE download instead of two, and it guarantees the run lands the same
revision the skill's earlier steps inspected. The installer copies out of `$TMP/repo`, writes the
`claude-stack.stamp` naming that revision (from `RELEASE-SOURCE`, or the checkout's HEAD when the
fallback cloned), and never deletes a source it was handed - cleanup is the skill's job, below.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP"` (PowerShell: `Remove-Item -Recurse -Force $TMP`). The archive, the extracted
repo, and the working files you wrote next to them (`raw.json`, `selection.txt`) live there and
nothing else will remove them - the installer only cleans up a source IT fetched, never the one
you passed via `--source`. Do this on EVERY exit path, not just the happy one - each skill's
final step lists its own exit cases. Then confirm the project tree holds only installed
artifacts - no archive, no extracted repo, no `raw.json`/`selection.txt`, no installer copy.
