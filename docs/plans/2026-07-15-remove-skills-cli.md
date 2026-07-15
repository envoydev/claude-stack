# Remove the skills CLI (git-copy skill install) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `skills.sh` CLI (`npx skills add`) as the skill-install mechanism in all four installers, replacing it with a direct git-clone + copy of `skills/<name>/` into the target skills dir; drop `skill-lock.json`; repoint all docs to the plugin/installers.

**Architecture:** All 64 skills come from `envoydev/agents-stack` (zero third-party repos), so a plain copy fully reproduces what the CLI did. Each installer clones the repo (`--depth 1`) to a temp dir once, then copies each selected `skills/<name>/` into the destination (`<cwd>/.claude/skills` or `.cursor/skills` for project scope, `$CONFIG_DIR/skills` for global). The clone URL is overridable via `STACK_SKILLS_REPO` (default the GitHub repo) so it is testable against a local checkout. This gives real copies directly - simpler than the CLI's symlinked `.agents/` staging, and for Cursor it collapses the current npx-then-copy two-step into one.

**Tech Stack:** Bash (macOS 3.2, `set -euo pipefail`, nounset-safe), PowerShell 5.1+/7, Markdown docs. No `npx`/`skills.sh` dependency; `git` is already a prerequisite.

## Global Constraints

- `.sh` stays macOS bash 3.2 safe, nounset-safe (`${arr[@]+"${arr[@]}"}`). `.sh`/`.ps1` and claude/cursor twins stay in parity where content is shared.
- Skill destinations must match where `npx skills add` put them: project scope → `<cwd>/.claude/skills` (Claude) or `<cwd>/.cursor/skills` (Cursor); global scope → `$CONFIG_DIR/skills`.
- The SKILLS manifest format (`"envoydev/agents-stack|<name>"`) and the Component B `--selection` filtering are unchanged - install just reads the skill name after `|`.
- Fail-soft like the rest of the installer: a failed clone or a missing skill dir calls `note_failure`/`log` and continues, never aborts.
- `STACK_SKILLS_REPO` overrides the clone URL (default `https://github.com/envoydev/agents-stack`) for testing.
- House voice: single dashes, single quotes, no em-dashes. `npm run lint` must stay clean.
- Do NOT push. Commit locally only on branch `feat/configurable-docs-root` (this change rides the same branch to avoid installer conflicts with the docs-root work).

## File Structure

- `claude/claude-stack.sh` (modify) - git-copy `install_skills`/`update_skills`/`remove_skills`; drop `skill-lock.json` from the gitignore reminder; drop the `npx`-for-skills note.
- `cursor/cursor-stack.sh` (modify) - same; also remove the now-redundant npx-then-copy step (the direct copy replaces it).
- `claude/claude-stack.ps1`, `cursor/cursor-stack.ps1` (modify) - the PowerShell twins.
- `README.md`, `claude/README.md`, `cursor/README.md`, `CLAUDE.md`, `claude/claude-stack.html`, `cursor/cursor-stack.html`, `claude/CLAUDE.template.md`, `cursor/AGENTS.template.md` (modify) - repoint `npx skills add` to the plugin/installers; remove `skills.sh`/`skill-lock.json` mentions.
- `.gitignore` (modify) - drop the `skills-lock.json`/`skill-lock.json` entry.
- `scripts/skill-install.test.js` (create) - integration test: point `STACK_SKILLS_REPO` at the local repo, run the installer's skill copy for a 2-skill selection, assert the dirs land.

---

### Task 1: git-copy skill install in both `.sh` installers

**Files:**
- Modify: `claude/claude-stack.sh`, `cursor/cursor-stack.sh`
- Test: `scripts/skill-install.test.js`

**Interfaces:**
- Produces: `install_skills` that clones `${STACK_SKILLS_REPO:-<github>}` and copies each selected `skills/<name>/` into the scope-correct dest; a `--print-plan`-compatible, network-free path is NOT required (skills install genuinely needs the repo).

- [ ] **Step 1: Write the failing integration test**

Create `scripts/skill-install.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'claude', 'claude-stack.sh');

// Invoke ONLY the skill-copy logic by sourcing the installer's function in a
// subshell with a stubbed environment, cloning from the LOCAL repo (no network).
function runSkillCopy(names) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skinst-'));
    const sel = path.join(work, 'sel.txt');
    fs.writeFileSync(sel, names.map(n => `skill ${n}`).join('\n') + '\n');
    // Drive the real installer's skill step in an isolated cwd, cloning the local repo.
    execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', sel, '--skills-only'], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: ROOT, HOME: work },
    });
    return work;
}

test('install copies exactly the selected skills into .claude/skills', () => {
    const work = runSkillCopy(['csharp', 'typescript']);
    try
    {
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'csharp', 'SKILL.md')), 'csharp copied');
        assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'typescript', 'SKILL.md')), 'typescript copied');
        assert.ok(!fs.existsSync(path.join(work, '.claude', 'skills', 'dotnet-grpc')), 'unselected skill not copied');
    }
    finally
    {
        fs.rmSync(work, { recursive: true, force: true });
    }
});
```

This requires a `--skills-only` action flag (below) so the test runs just the skill step, not the whole install (which needs `claude`/network).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/skill-install.test.js`
Expected: FAIL - `--skills-only` and the git-copy do not exist yet (the installer errors on the unknown flag or still tries `npx`).

- [ ] **Step 3: Add the `--skills-only` flag**

In `claude/claude-stack.sh`, add a `SKILLS_ONLY=false` default and a `--skills-only) SKILLS_ONLY=true; shift ;;` arg case (next to `--selection`). At the dispatch (`if [ "$ACTION" = "install" ]; then install_skills; install_plugins; ...`), short-circuit when `SKILLS_ONLY` is true to run ONLY `install_skills` and return. Mirror in `cursor-stack.sh`.

- [ ] **Step 4: Replace `install_skills` with git-copy (claude)**

In `claude/claude-stack.sh`, replace the `install_skills` body with:

```sh
install_skills() {
  command -v git >/dev/null 2>&1 || { note_failure "git not found - skills not installed"; return 0; }
  local repo_url tmp name dest entry
  repo_url="${STACK_SKILLS_REPO:-https://github.com/envoydev/agents-stack}"
  case "$CLAUDE_SCOPE" in user) dest="$CONFIG_DIR/skills" ;; *) dest="$PWD/.claude/skills" ;; esac
  tmp="$(mktemp -d)"
  if ! git clone --depth 1 "$repo_url" "$tmp" >/dev/null 2>&1; then
    note_failure "clone of $repo_url failed - skills not installed"; rm -rf "$tmp"; return 0
  fi
  mkdir -p "$dest"
  for entry in ${SKILLS[@]+"${SKILLS[@]}"}; do
    name="${entry#*|}"
    if [ -d "$tmp/skills/$name" ]; then
      rm -rf "$dest/$name"; cp -R "$tmp/skills/$name" "$dest/$name"
      log "skill [$CLAUDE_SCOPE]: $name -> $dest/$name"
    else
      note_failure "skill '$name' not found in $repo_url"
    fi
  done
  rm -rf "$tmp"
}
```

- [ ] **Step 5: Simplify `update_skills` / `remove_skills` (claude)**

`update_skills` becomes a fresh clone + copy - the same as install (the copy overwrites). Make `update_skills` call `install_skills` (or share a helper). `remove_skills` (previously `npx skills remove`) becomes: `rm -rf` each manifest skill dir under the scope dest (so a refresh clears stale skills before the re-copy) - keep it nounset-safe. Remove the `npx skills remove` line and the stale symlink-vs-copy comments.

- [ ] **Step 6: Same for `cursor-stack.sh`**

Replace `install_skills` with the git-copy, dest `<cwd>/.cursor/skills` (project) or `$CONFIG_DIR/skills` (global). REMOVE the separate npx-then-copy step (lines ~398-409, the `.cursor/skills` copy from the `.agents/` store) - the git-copy writes `.cursor/skills` directly. Update `update_skills`/`remove_skills` the same way. Keep the `AGENT` var only if still used elsewhere; the copy no longer needs `--agent`.

- [ ] **Step 7: Run the test + syntax checks**

Run: `node --test scripts/skill-install.test.js` (expected PASS), then `bash -n claude/claude-stack.sh && bash -n cursor/cursor-stack.sh` (syntax ok).

- [ ] **Step 8: Commit**

```bash
git add claude/claude-stack.sh cursor/cursor-stack.sh scripts/skill-install.test.js
git commit -m "$(printf 'feat(installer): install skills by git-copy instead of the skills CLI (.sh)\n\n  Replaced npx skills add/remove with a depth-1 clone of the stack repo and a direct copy of the selected skills into the scope dest, dropping the skills.sh dependency.\n  Added a --skills-only path and a local-repo integration test; collapsed Cursor two-step copy into the direct copy.')"
```

---

### Task 2: the PowerShell twins

**Files:**
- Modify: `claude/claude-stack.ps1`, `cursor/cursor-stack.ps1`

- [ ] **Step 1: Mirror the git-copy in `claude-stack.ps1`**

Replace the `Install-Skills` (npx) logic with a `git clone --depth 1 $repoUrl $tmp` (`$repoUrl = $env:STACK_SKILLS_REPO ?? 'https://github.com/envoydev/agents-stack'`) then `Copy-Item -Recurse` each selected `skills/<name>` into `<cwd>\.claude\skills` (project) or `$ConfigDir\skills` (global). Add the `-SkillsOnly` switch mirroring `--skills-only`. Simplify Update/Remove the same way. Fail-soft with `Add-Failure`.

- [ ] **Step 2: Mirror in `cursor-stack.ps1`**

Same, dest `.cursor\skills`; remove the redundant npx-then-copy step.

- [ ] **Step 3: Verify - parse both, run the suite with pwsh**

Run (pwsh available):
```bash
PATH="/private/tmp/claude-501/-Users-mac-Programming-Projects-Personal-agents-stack/d35bfb1e-2605-445b-88b0-c48222fd43da/scratchpad/pwsh:$PATH" pwsh -NoProfile -Command "\$null = [System.Management.Automation.Language.Parser]::ParseFile('claude/claude-stack.ps1', [ref]\$null, [ref]\$null); \$null = [System.Management.Automation.Language.Parser]::ParseFile('cursor/cursor-stack.ps1', [ref]\$null, [ref]\$null); 'ps1 parse ok'"
node --test scripts/skill-install.test.js
```
Expected: `ps1 parse ok` and the `.sh` test still passes.

- [ ] **Step 4: Commit**

```bash
git add claude/claude-stack.ps1 cursor/cursor-stack.ps1
git commit -m "$(printf 'feat(installer): install skills by git-copy instead of the skills CLI (.ps1)\n\n  Mirrored the depth-1 clone + Copy-Item skill install into both PowerShell installers, with a -SkillsOnly switch and the STACK_SKILLS_REPO override.\n  Kept the .ps1 twins in parity with the .sh git-copy.')"
```

---

### Task 3: doc sweep + gitignore + lint/parity

**Files:**
- Modify: `README.md`, `claude/README.md`, `cursor/README.md`, `CLAUDE.md`, `claude/claude-stack.html`, `cursor/cursor-stack.html`, `claude/CLAUDE.template.md`, `cursor/AGENTS.template.md`, `.gitignore`

- [ ] **Step 1: Repoint the skill-install docs**

Across the READMEs, `CLAUDE.md`, both HTMLs, and the templates: replace `npx skills add envoydev/agents-stack …` install instructions and any `skills.sh` / `skills CLI` mentions with the plugin/installer path (`claude plugin marketplace add envoydev/agents-stack` + `claude plugin install claude-stack-setup@agents-stack`, or run the installer directly). Update `CLAUDE.md`'s opening 'Skills install via `npx skills add`' line to describe the git-copy install. Keep the SKILLS inventory/counts accurate.

- [ ] **Step 2: Remove the lock file references**

Remove the `skill-lock.json` / `skills-lock.json` line from the installers' gitignore reminder blocks (both `.sh` and `.ps1`) and from `.gitignore` itself. (The install no longer produces a lock file.)

- [ ] **Step 3: Lint + parity**

Run: `npm run lint`
Expected: clean. If the lint's HTML/README skill-count or `npx skills` assumptions trip, fix the doc, not the lint - unless the lint itself asserts a now-removed `npx skills` string, in which case update that assertion and note it.

- [ ] **Step 4: Commit**

```bash
git add README.md claude/README.md cursor/README.md CLAUDE.md claude/claude-stack.html cursor/cursor-stack.html claude/CLAUDE.template.md cursor/AGENTS.template.md .gitignore
git commit -m "$(printf 'docs: repoint skill install off the skills CLI to the plugin/installers\n\n  Replaced the npx skills add instructions and skills.sh mentions across the READMEs, CLAUDE.md, both HTML inventories, and the templates with the plugin/installer path.\n  Dropped the skill-lock.json gitignore entry now that no lock file is produced.')"
```

---

## Self-Review

**Spec coverage:**
- `skills.sh`/`npx skills add` removed from the install mechanism in all four installers - Tasks 1-2. Covered.
- `skill-lock.json` gone - Task 3 Step 2. Covered.
- Docs repointed to the plugin/installers - Task 3 Step 1. Covered.
- Git-copy from `envoydev/agents-stack` with scope-correct dest + fail-soft + `STACK_SKILLS_REPO` override - Task 1. Covered.
- Testable without network (local-repo clone) - Task 1 test. Covered.

**Placeholder scan:** none - all code and doc edits are concrete.

**Type consistency:** `STACK_SKILLS_REPO`, `--skills-only`/`-SkillsOnly`, the dest logic (`$PWD/.claude/skills` project, `$CONFIG_DIR/skills` global), and the `skills/<name>/` source path are used identically across the `.sh`, `.ps1`, and the test.

## Note

Rides the `feat/configurable-docs-root` branch (both changes edit the installers; same-branch avoids conflicts). The Cursor twin of the setup plugin remains a separate deferred item.
