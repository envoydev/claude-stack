# The one-clone protocol - shared by the setup and configure skills

Both plugin skills (`setup` - fresh install - and its sibling `configure` - update) drive their
whole run from ONE shallow clone. This file is the shared contract; each skill's numbered steps
say WHEN to apply it, this file says WHAT holds. It lives under the `setup` skill's `references/`
and the `configure` skill cites it by path - the two skills always ship together in the plugin.

## One shallow clone is the entire download

```bash
TMP=$(mktemp -d); git clone --depth 1 https://github.com/envoydev/claude-stack "$TMP/repo"
```

- The clone is the tip of `main` as one self-consistent snapshot. The
  `raw.githubusercontent.com` URLs are per-file and sit behind a CDN that serves a cached copy
  for ~5 min after a push, so raw can hand back a stale installer or a skewed mix of versions.
  Never fetch anything from a raw URL - not even as a fallback.
- `git` is a hard prerequisite (the installer needs it regardless, and without it there is
  nothing to install or update FROM): if it is missing, say so and stop.
- Never write the clone or your working files into the project tree.

## Use the tools from the clone

Everything comes out of `$TMP/repo`:
- the installer - `scripts/claude-stack.sh` on `darwin`/`linux`, `scripts/claude-stack.ps1` on
  Windows (via `pwsh`)
- `scripts/stack-select.js` and `scripts/stack-graph.json` (selection closure + prerequisite check)
- `templates/CLAUDE.template.md` (the CLAUDE.md fill-in / reconcile step)
- the git history (the `configure` skill fetches the stamped commit here to diff what changed)

Run every later `node`/`bash` step against these clone copies - never re-fetch one from a raw
URL; the clone is already the newest, consistent copy, and it is the copy the installer runs from.

## Hand the same clone to the installer

Pass `--source "$TMP/repo"` (`-Source` on Windows) when running the installer's action. That is
what keeps a guided run at ONE clone instead of two, and it guarantees the run lands the same
revision the skill's earlier steps inspected. The installer copies out of `$TMP/repo`, writes the
`claude-stack.stamp` naming that revision, and never deletes a source it was handed - cleanup is
the skill's job, below.

## Clean up the temp dir - ALWAYS

`rm -rf "$TMP"` (PowerShell: `Remove-Item -Recurse -Force $TMP`). The clone plus the working
files you wrote next to it (`raw.json`, `selection.txt`) live there and nothing else will remove
them - the installer only cleans up a clone IT took, never the one you passed via `--source`. Do
this on EVERY exit path, not just the happy one - each skill's final step lists its own exit
cases. Then confirm the project tree holds only installed artifacts - no clone, no
`raw.json`/`selection.txt`, no installer copy.
