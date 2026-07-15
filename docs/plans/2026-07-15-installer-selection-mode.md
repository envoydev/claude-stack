# Component B - installer `--selection` subset mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `claude-stack.sh` and `claude-stack.ps1` a `--selection <file>` flag that installs only the listed skills / plugins / MCPs / agents / rules (a curated subset instead of the whole set), plus a `--print-plan` dry-run that prints the resolved per-category set and exits.

**Architecture:** Both installers already define all their arrays (`SKILLS`, `PLUGINS`, `MCPS`, `AGENTS`, `CLAUDE_RULES`, `HOOKS`) before the install/update action runs. We filter those arrays ONCE, right after they are defined, so every downstream install AND update loop honors the selection with no per-loop edits. `HOOKS` is never filtered - hooks are foundational. Component C (the setup skill) writes the selection file; this component only consumes it.

**Tech Stack:** POSIX-ish Bash (must run on macOS bash 3.2 with `set -euo pipefail`), PowerShell 5.1+/7. Tests via Node's built-in `node --test` spawning the shells.

## Global Constraints

- The `.sh` MUST run on macOS bash 3.2.57: no associative arrays (`declare -A`), no `${var,,}`, no `mapfile`. Array expansion must be nounset-safe under `set -euo pipefail`: use the `${arr[@]+"${arr[@]}"}` idiom so an empty array never trips `unbound variable`.
- `.sh` and `.ps1` are twins and stay in parity (the lint enforces structural parity of the shared arrays; keep the new flag and behavior mirrored).
- Selection file format: one `category name` per line, a single ASCII space between the two tokens, LF line endings. Categories: `skill`, `plugin`, `mcp`, `agent`, `rule`. Lines that are blank or start with `#` are ignored. Component C writes this file.
- Selection semantics: filter-to-listed. An entry whose name is not listed is dropped. A category with zero lines installs NOTHING for that category (Component C always writes the full closure, so this is not a foot-gun in the real flow; `--print-plan` makes it visible). `HOOKS` is never filtered.
- Name extraction per category (the array entry -> its selectable name):
  - skill: `"repo|skill"` -> the part AFTER the first `|`
  - plugin: `"plugin@marketplace"` -> the part BEFORE `@`
  - mcp: `"name|args"` -> the part BEFORE the first `|`
  - agent: `"name.md"` or `"name.md::tail"` -> strip a `::` tail, then strip `.md`
  - rule: same as agent
- Absent `--selection` = today's behavior exactly (install everything). Fully backward compatible.
- `--print-plan` prints five `plan <category>: <space-separated names>` lines to stdout and exits 0, BEFORE any prerequisite check or install step.
- House voice in comments: single dashes, single quotes, no em-dashes.
- Do NOT push. Commit locally only on the current branch.

## File Structure

- `claude/claude-stack.sh` (modify) - add `SELECTION`/`PRINT_PLAN` defaults, two arg-parse cases, the filter+print-plan block after the `CLAUDE_RULES=(...)` definition (the `)` at line 525), and two usage lines.
- `claude/claude-stack.ps1` (modify) - the PowerShell twin: `-Selection`/`-PrintPlan` params, the mirrored filter+print-plan block after the `$ClaudeRules = @(...)` definition (line 557), and the mirrored usage lines.
- `scripts/selection.test.js` (create) - `node --test` spawning `bash claude/claude-stack.sh ... --print-plan` to assert filtering; a pwsh arm that runs only if `pwsh` is on PATH and otherwise logs a visible SKIP.

---

### Task 1: `--selection` + `--print-plan` in `claude-stack.sh`

**Files:**
- Modify: `claude/claude-stack.sh` - defaults near the other flag defaults (before the `while [ $# -gt 0 ]` loop at line 97); two cases inside that `case "$1" in` block (lines 98-106); the filter block after line 525; two usage lines in the `usage()` heredoc (near lines 49-53).
- Test: `scripts/selection.test.js`

**Interfaces:**
- Produces: a `--print-plan` stdout contract of exactly five lines, each `^plan (skills|plugins|mcps|agents|rules): ` followed by space-separated names (possibly empty). Task 2 (the ps1 twin) must produce the identical contract.

- [ ] **Step 1: Write the failing test**

Create `scripts/selection.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SH = path.join(__dirname, '..', 'claude', 'claude-stack.sh');
const PS1 = path.join(__dirname, '..', 'claude', 'claude-stack.ps1');

function writeSelection(lines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'));
    const file = path.join(dir, 'selection.txt');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return { dir, file };
}

function planLine(out, category) {
    const m = out.match(new RegExp(`^plan ${category}:(.*)$`, 'm'));
    assert.ok(m, `missing 'plan ${category}:' line in output`);
    return m[1].trim().split(/\s+/).filter(Boolean);
}

function runShPlan(lines) {
    const { dir, file } = writeSelection(lines);
    try
    {
        return execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', file, '--print-plan'],
            { encoding: 'utf8' });
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('sh: selection filters each category to the listed names', () => {
    const out = runShPlan([
        'skill csharp', 'skill dotnet',
        'agent aspnet-implementer',
        'mcp serena',
        'plugin superpowers',
        'rule csharp-conventions',
    ]);
    const skills = planLine(out, 'skills');
    assert.ok(skills.includes('csharp'), 'csharp kept');
    assert.ok(skills.includes('dotnet'), 'dotnet kept');
    assert.ok(!skills.includes('angular-conventions'), 'unlisted skill dropped');
    assert.deepStrictEqual(planLine(out, 'agents'), ['aspnet-implementer']);
    assert.deepStrictEqual(planLine(out, 'mcps'), ['serena']);
    assert.deepStrictEqual(planLine(out, 'plugins'), ['superpowers']);
    assert.deepStrictEqual(planLine(out, 'rules'), ['csharp-conventions']);
});

test('sh: a category with no lines installs nothing for it', () => {
    const out = runShPlan(['skill csharp']);
    assert.deepStrictEqual(planLine(out, 'mcps'), []);
    assert.deepStrictEqual(planLine(out, 'agents'), []);
    assert.deepStrictEqual(planLine(out, 'plugins'), []);
    assert.deepStrictEqual(planLine(out, 'rules'), []);
});

test('sh: script parses with no syntax errors', () => {
    const r = spawnSync('bash', ['-n', SH], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
});

// The ps1 twin can only be exercised where PowerShell is installed. Run it if
// pwsh is present; otherwise log a visible SKIP so the gap is never silent.
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
test('ps1: selection filters each category (pwsh required)', { skip: hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped' }, () => {
    const { dir, file } = writeSelection([
        'skill csharp', 'agent aspnet-implementer', 'mcp serena', 'plugin superpowers', 'rule csharp-conventions',
    ]);
    try
    {
        const out = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project', '-Selection', file, '-PrintPlan'],
            { encoding: 'utf8' });
        assert.ok(planLine(out, 'skills').includes('csharp'));
        assert.deepStrictEqual(planLine(out, 'agents'), ['aspnet-implementer']);
        assert.deepStrictEqual(planLine(out, 'mcps'), ['serena']);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/selection.test.js`
Expected: the `sh:` tests FAIL - `claude-stack.sh` does not yet understand `--selection`/`--print-plan`, so it either errors on the unknown flag or never prints `plan ...:` lines. (The `bash -n` test may already pass; the ps1 test SKIPs.)

- [ ] **Step 3: Add the defaults and arg-parse cases**

In `claude/claude-stack.sh`, near where `SPACE`, `SCOPE_FLAG`, `CONTEXT7_MODE`, `INSTALL_GITHUB_CLI`, `KEEP_PINS` are initialized (just before the `while [ $# -gt 0 ]` loop at line 97), add:

```sh
SELECTION=""
PRINT_PLAN=false
```

Then inside the `case "$1" in` block (with the other `--flag` cases, lines 98-106), add:

```sh
    --selection)   _flag_val "$1" "${2:-}"; SELECTION="$2";     shift 2 ;;
    --selection=*) SELECTION="${1#*=}";                          shift ;;
    --print-plan)  PRINT_PLAN=true;                              shift ;;
```

- [ ] **Step 4: Add the filter + print-plan block**

In `claude/claude-stack.sh`, immediately AFTER the `CLAUDE_RULES=( ... )` array's closing `)` (line 525) and before the function definitions that follow, add:

```sh
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
fi

if [ "$PRINT_PLAN" = true ]; then
  printf 'plan skills:';  for e in ${SKILLS[@]+"${SKILLS[@]}"};             do printf ' %s' "${e#*|}";                 done; printf '\n'
  printf 'plan plugins:'; for e in ${PLUGINS[@]+"${PLUGINS[@]}"};           do printf ' %s' "${e%%@*}";                done; printf '\n'
  printf 'plan mcps:';    for e in ${MCPS[@]+"${MCPS[@]}"};                 do printf ' %s' "${e%%|*}";                done; printf '\n'
  printf 'plan agents:';  for e in ${AGENTS[@]+"${AGENTS[@]}"};             do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  printf 'plan rules:';   for e in ${CLAUDE_RULES[@]+"${CLAUDE_RULES[@]}"}; do n="${e%%::*}"; printf ' %s' "${n%.md}"; done; printf '\n'
  exit 0
fi
```

- [ ] **Step 5: Add the usage lines**

In the `usage()` heredoc (near lines 49-53), add these two lines alongside the other flag docs:

```sh
  --selection <file>       install ONLY the skills/plugins/mcps/agents/rules named in <file> (one 'category name' per line); hooks always install
  --print-plan             with --selection, print the resolved per-category install set and exit (dry run)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test scripts/selection.test.js`
Expected: the three `sh:` tests PASS; the `ps1:` test SKIPs (pwsh absent). If a `sh:` test errors because the script exits before printing (e.g. an env prerequisite fails on this machine), STOP and report - do not move the block earlier than line 525 without confirming all arrays are defined at the new point.

- [ ] **Step 7: Verify backward compatibility (no selection = no behavior change)**

Run: `bash -n claude/claude-stack.sh && echo "syntax ok"`
Expected: `syntax ok`. (A full no-selection install is not run here - it would mutate the machine; the `bash -n` parse plus the unchanged default path cover it.)

- [ ] **Step 8: Commit**

```bash
git add claude/claude-stack.sh scripts/selection.test.js
git commit -m "$(printf 'feat(installer): add --selection subset mode to claude-stack.sh\n\n  Filtered the SKILLS/PLUGINS/MCPS/AGENTS/CLAUDE_RULES arrays to a selection file so a curated subset installs; hooks always install.\n  Added a --print-plan dry run and node --test coverage spawning the script.')"
```

---

### Task 2: mirror `-Selection` + `-PrintPlan` in `claude-stack.ps1`

**Files:**
- Modify: `claude/claude-stack.ps1` - add `[string]$Selection = ''` and `[switch]$PrintPlan` to the `param(...)` block (lines 65-87); add the mirrored filter+print-plan block after the `$ClaudeRules = @(...)` definition (line 557), before the action dispatch; add the two mirrored usage lines wherever the ps1 documents its flags.
- Test: `scripts/selection.test.js` already contains the pwsh arm (Task 1 Step 1) - no new test file.

**Interfaces:**
- Consumes: the same selection file format and the same five-line `plan <category>:` stdout contract defined in Task 1. The output must match the sh output byte-for-byte in shape (same prefixes, space-separated names).

- [ ] **Step 1: Confirm the pwsh test arm exists and its current state**

Run: `node --test scripts/selection.test.js`
Expected: `ps1:` test currently SKIPs if pwsh is absent, or (if pwsh is present) FAILS because `-Selection`/`-PrintPlan` are not yet parameters. Either way, this is the RED baseline for Task 2.

- [ ] **Step 2: Add the params**

In `claude/claude-stack.ps1`, in the `param(...)` block (lines 65-87), alongside `[string]$Space`, `[string]$Scope`, `[switch]$KeepPins`, add:

```powershell
  [string]$Selection = '',

  [switch]$PrintPlan
```

(Place a comma after the preceding parameter as required by PowerShell `param()` syntax.)

- [ ] **Step 3: Add the mirrored filter + print-plan block**

In `claude/claude-stack.ps1`, immediately after the `$ClaudeRules = @( ... )` array (line 557) and before the action dispatch, add:

```powershell
# --- Selection subset filter (Component B twin of claude-stack.sh) --------
# With -Selection <file>, keep only the entries whose name appears in the file
# (one 'category name' per line; '#' comments and blank lines ignored). Hooks
# are never filtered. -PrintPlan prints the resolved set and exits (dry run).
if ($Selection) {
  if (-not (Test-Path $Selection)) { Write-Error "selection file not found: $Selection"; exit 1 }
  $sel = @{}
  foreach ($line in Get-Content $Selection) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $p = $t -split '\s+', 2
    if ($p.Count -eq 2) { $sel["$($p[0]) $($p[1])"] = $true }
  }
  $SelHas = { param($cat, $name) $sel.ContainsKey("$cat $name") }

  $Skills      = @($Skills      | Where-Object { & $SelHas 'skill'  (($_ -replace '^[^|]*\|', '')) })
  $Plugins     = @($Plugins     | Where-Object { & $SelHas 'plugin' (($_ -split '@', 2)[0]) })
  $Mcps        = @($Mcps        | Where-Object { & $SelHas 'mcp'    (($_ -split '\|', 2)[0]) })
  $Agents      = @($Agents      | Where-Object { & $SelHas 'agent'  ((($_ -split '::', 2)[0]) -replace '\.md$', '') })
  $ClaudeRules = @($ClaudeRules | Where-Object { & $SelHas 'rule'   ((($_ -split '::', 2)[0]) -replace '\.md$', '') })
}

if ($PrintPlan) {
  'plan skills: '  + (($Skills      | ForEach-Object { ($_ -replace '^[^|]*\|', '') }) -join ' ')
  'plan plugins: ' + (($Plugins     | ForEach-Object { ($_ -split '@', 2)[0] }) -join ' ')
  'plan mcps: '    + (($Mcps        | ForEach-Object { ($_ -split '\|', 2)[0] }) -join ' ')
  'plan agents: '  + (($Agents      | ForEach-Object { ((($_ -split '::', 2)[0]) -replace '\.md$', '') }) -join ' ')
  'plan rules: '   + (($ClaudeRules | ForEach-Object { ((($_ -split '::', 2)[0]) -replace '\.md$', '') }) -join ' ')
  exit 0
}
```

- [ ] **Step 4: Add the mirrored usage lines**

Wherever `claude-stack.ps1` documents its flags (its help/usage text mirroring the sh `usage()`), add the `-Selection <file>` and `-PrintPlan` descriptions with the same wording as Task 1 Step 5.

- [ ] **Step 5: Verify - test + parity lint**

Run: `node --test scripts/selection.test.js`
Expected: if pwsh is present, the `ps1:` test PASSES with output matching the sh contract; if pwsh is absent, it SKIPs with the visible reason (a known, logged coverage gap - the sh arm plus the lint parity check below are the net until pwsh is available).

Run: `npm run lint`
Expected: `lint-skills: clean (...)` - the shared arrays are unchanged, so twin parity holds.

- [ ] **Step 6: Commit**

```bash
git add claude/claude-stack.ps1
git commit -m "$(printf 'feat(installer): mirror --selection subset mode in claude-stack.ps1\n\n  Added -Selection and -PrintPlan as the PowerShell twin of the claude-stack.sh subset filter, same file format and plan output contract.\n  Kept the .sh/.ps1 pair in parity (lint clean).')"
```

---

## Self-Review

**Spec coverage (Component B of the design):**
- `--selection <file>` on both `.sh` and `.ps1`, filtering `SKILLS`/`PLUGINS`/`MCPS`/`AGENTS`/`CLAUDE_RULES` - Tasks 1 and 2. Covered.
- Line-oriented `category name` file format, `#`/blank ignored - Global Constraints + both filter blocks. Covered.
- `HOOKS` never filtered - both filter blocks omit it. Covered.
- Absent flag = install-everything (backward compatible) - the block is inside `if [ -n "$SELECTION" ]` / `if ($Selection)`. Covered.
- A listed name absent from an array is a skip (dropped, not an error) - the filter keeps only matches; unmatched selection lines simply match nothing. Covered. (Note: the design mentioned a skip-with-warning for a listed-but-absent name; this plan drops silently and instead surfaces the full resolved set via `--print-plan`, which is the more useful signal. Flag for the reviewer if the warning is required.)
- Installer stays dumb; closure computed by the skill (C) - this component only filters. Covered.
- `.sh`/`.ps1` parity - Task 2 mirrors Task 1; lint parity checked. Covered.

**Placeholder scan:** none - all code and commands are concrete.

**Type consistency:** the five-line `plan <category>:` stdout contract is defined once (Task 1 Interfaces) and asserted identically for both shells in `scripts/selection.test.js`. Name-extraction rules match between the Global Constraints table, the sh block, and the ps1 block (skill = after `|`, plugin = before `@`, mcp = before `|`, agent/rule = strip `::` tail then `.md`).

**Known coverage gap (not silent):** the `.ps1` behavioral test only runs where `pwsh` is installed; on a machine without it the arm SKIPs with a printed reason. Until then, the `.sh` behavioral tests, `bash -n`, the lint twin-parity check, and code review are the net for the ps1 twin.

---

## Note on the remaining components

Per the design's A -> B -> D -> C order, after B lands the next plans are:
- **D** - the prerequisite map + evaluator in `stack-select.js`.
- **C** - the `claude-stack` plugin + `setup-claude-stack` skill wiring A/B/D into the interactive flow.
