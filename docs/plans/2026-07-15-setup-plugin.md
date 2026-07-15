# Component C - `claude-stack-setup` plugin + `setup-claude-stack` skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin (published from this repo as its own marketplace) that ships one skill, `setup-claude-stack`, which bootstraps the stack into a target project: detect OS + analyse the project, ask the scalar choices, fetch the tools, run `stack-select.js` (Component D) to close the selection + check prerequisites, present an editable manifest, and run `claude-stack.{sh,ps1} --selection` (Component B).

**Architecture:** The repo root gains a `.claude-plugin/marketplace.json` so `claude plugin marketplace add envoydev/agents-stack` works; it lists one plugin whose `source` is the subdir `./claude/setup-plugin`, so the plugin bundles ONLY the setup skill (not the repo's 64 house skills). The skill is an orchestration runbook; all deterministic logic already lives in the tested `stack-select.js`. A committed `recommendations.json` maps detected stacks to a seed selection, validated against `stack-graph.json` so a renamed agent/rule can never rot silently.

**Tech Stack:** JSON manifests, a Markdown SKILL.md + command, Node `node --test` for manifest + recommendation validation. Zero new npm dependencies. Claude-only (Cursor has no plugin format - a Cursor twin is a deferred follow-up).

## Global Constraints

- Node CommonJS for any test code; zero new npm dependencies.
- House voice in all prose/comments: single dashes, single quotes, no em-dashes.
- Public repo: no private names or absolute personal paths in any tracked file. Owner/author fields use `envoydev` + the GitHub URL, never a personal email.
- The plugin bundles ONLY `claude/setup-plugin/**` - it must NOT pull the repo's `skills/` house skills. The marketplace `source` is the subdir `./claude/setup-plugin`.
- The setup skill is manual-only (`disable-model-invocation: true`) - it is a deliberate `/claude-stack` action, never auto-fired.
- The stack is fetched at runtime from `https://raw.githubusercontent.com/envoydev/agents-stack/main/...` - so the skill only works end to end once the branch is merged to `main` (the runtime fetch targets `main`). This is expected; note it in the skill.
- `recommendations.json` names (agents, rules, skills) must all resolve in `scripts/stack-graph.json`; the Task 2 test enforces this.
- Do NOT push. Commit locally only on branch `feat/stack-graph`.

## File Structure

- `.claude-plugin/marketplace.json` (create) - the marketplace manifest at repo root.
- `claude/setup-plugin/.claude-plugin/plugin.json` (create) - the plugin manifest.
- `claude/setup-plugin/commands/claude-stack.md` (create) - the `/claude-stack` entry point.
- `claude/setup-plugin/skills/setup-claude-stack/SKILL.md` (create) - the orchestration skill.
- `claude/setup-plugin/skills/setup-claude-stack/references/recommendations.json` (create) - stack -> seed selection map.
- `scripts/setup-plugin.test.js` (create) - manifest + recommendation validation.
- `README.md` (modify) - add the plugin install instructions.

---

### Task 1: plugin + marketplace scaffolding

**Files:**
- Create: `.claude-plugin/marketplace.json`, `claude/setup-plugin/.claude-plugin/plugin.json`, `claude/setup-plugin/commands/claude-stack.md`
- Test: `scripts/setup-plugin.test.js`

**Interfaces:**
- Produces: a marketplace named `agents-stack` with one plugin `claude-stack-setup` whose `source` is `./claude/setup-plugin`; install path `claude plugin install claude-stack-setup@agents-stack`.

- [ ] **Step 1: Write the failing test**

Create `scripts/setup-plugin.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'claude', 'setup-plugin');

test('marketplace.json is valid and points at the setup-plugin subdir', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.strictEqual(mp.name, 'agents-stack');
    assert.ok(Array.isArray(mp.plugins) && mp.plugins.length === 1);
    const p = mp.plugins[0];
    assert.strictEqual(p.name, 'claude-stack-setup');
    assert.strictEqual(p.source, './claude/setup-plugin');
    assert.ok(typeof p.description === 'string' && p.description.trim() !== '');
});

test('plugin.json is valid and the command exists', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(pj.name, 'claude-stack-setup');
    assert.ok(typeof pj.version === 'string' && pj.version.trim() !== '');
    assert.ok(typeof pj.description === 'string' && pj.description.trim() !== '');
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'claude-stack.md')), 'the /claude-stack command exists');
});
// Note: the bundled SKILL.md is asserted in Task 3's test additions (it lands there).

test('no tracked plugin file leaks an email address', () => {
    for (const rel of ['.claude-plugin/marketplace.json', 'claude/setup-plugin/.claude-plugin/plugin.json'])
    {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/@agents-stack|@main/g, '')), `${rel} must not contain an email`);
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/setup-plugin.test.js`
Expected: FAIL - the manifest and skill/command files do not exist yet.

- [ ] **Step 3: Create the marketplace manifest**

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "agents-stack",
  "owner": {
    "name": "envoydev",
    "url": "https://github.com/envoydev"
  },
  "metadata": {
    "description": "Personal Claude Code + Cursor agent stack - the setup plugin that bootstraps skills, agents, rules, hooks, and MCP servers into a project.",
    "version": "0.1.0"
  },
  "plugins": [
    {
      "name": "claude-stack-setup",
      "source": "./claude/setup-plugin",
      "description": "Bootstrap the personal Claude Code stack into a project: analyse it, curate a dependency-complete selection, check prerequisites, and run the installer.",
      "category": "development",
      "tags": ["setup", "installer", "skills", "agents", "mcp", "bootstrap"]
    }
  ]
}
```

- [ ] **Step 4: Create the plugin manifest**

Create `claude/setup-plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "claude-stack-setup",
  "description": "Bootstrap the personal Claude Code stack into a project: analyse it, curate a dependency-complete selection, check prerequisites, and run the installer.",
  "version": "0.1.0",
  "author": {
    "name": "envoydev",
    "url": "https://github.com/envoydev"
  },
  "commands": [
    "./commands/claude-stack.md"
  ],
  "homepage": "https://github.com/envoydev/agents-stack",
  "repository": "https://github.com/envoydev/agents-stack",
  "license": "MIT",
  "keywords": ["setup", "installer", "bootstrap", "skills", "agents", "mcp", "claude-code"]
}
```

- [ ] **Step 5: Create the command entry point**

Create `claude/setup-plugin/commands/claude-stack.md`:

```markdown
---
description: Bootstrap the personal Claude Code stack into this project (runs the setup-claude-stack skill).
---

Invoke the `setup-claude-stack` skill and follow it exactly to bootstrap the agents-stack into the current project. Run in the project root. Do not skip the selection-review or prerequisite gates.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test scripts/setup-plugin.test.js`
Expected: all three tests PASS (marketplace valid, plugin.json + command valid, no email leak). The bundled `SKILL.md` is asserted separately in Task 3.

- [ ] **Step 7: Commit**

```bash
git add .claude-plugin/marketplace.json claude/setup-plugin/.claude-plugin/plugin.json claude/setup-plugin/commands/claude-stack.md scripts/setup-plugin.test.js
git commit -m "$(printf 'feat(plugin): scaffold the claude-stack-setup plugin + marketplace\n\n  Added the repo marketplace.json and the claude-stack-setup plugin manifest sourced from the claude/setup-plugin subdir, plus the /claude-stack command.\n  Added manifest-validation tests (the bundled SKILL.md lands in a later task).')"
```

---

### Task 2: the recommendations map

**Files:**
- Create: `claude/setup-plugin/skills/setup-claude-stack/references/recommendations.json`
- Test: `scripts/setup-plugin.test.js` (append)

**Interfaces:**
- Consumes: `scripts/stack-graph.json` (all names must resolve there); `computeClosure` from `scripts/stack-select.js`.
- Produces: `recommendations.json` shape `{ always: Seed, stacks: { <stackKey>: Seed } }` where `Seed = { agents?: string[], rules?: string[], skills?: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/setup-plugin.test.js`:

```js
const { computeClosure } = require('./stack-select.js');
const graph = require('./stack-graph.json');

const RECS = path.join(PLUGIN_DIR, 'skills', 'setup-claude-stack', 'references', 'recommendations.json');

test('every recommendation name resolves in the dependency graph', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const agentKeys = new Set(Object.keys(graph.agents));
    const ruleKeys = new Set(Object.keys(graph.rules));
    const skillKeys = new Set(Object.keys(graph.skills));
    const seeds = [recs.always, ...Object.values(recs.stacks)];
    for (const seed of seeds)
    {
        for (const a of seed.agents || []) assert.ok(agentKeys.has(a), `recommendation agent '${a}' not in graph`);
        for (const r of seed.rules || []) assert.ok(ruleKeys.has(r), `recommendation rule '${r}' not in graph`);
        for (const s of seed.skills || []) assert.ok(skillKeys.has(s), `recommendation skill '${s}' not in graph`);
    }
});

test('the aspnet seed closes to its .NET vertical', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const seed = recs.stacks['aspnet'];
    assert.ok(seed, 'an aspnet stack recommendation exists');
    const closed = computeClosure(graph, { agents: [...(recs.always.agents || []), ...(seed.agents || [])], rules: [...(recs.always.rules || []), ...(seed.rules || [])] });
    assert.ok(closed.skills.includes('csharp'), 'aspnet closure pulls csharp');
    assert.ok(closed.skills.includes('dotnet-web-backend'), 'aspnet closure pulls the web hub');
});

test('the always block seeds the cross-cutting agents and baseline rules', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    for (const r of ['baseline-interaction', 'baseline-security', 'baseline-git'])
    {
        assert.ok((recs.always.rules || []).includes(r), `always seeds ${r}`);
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/setup-plugin.test.js`
Expected: the new tests FAIL - `recommendations.json` does not exist yet.

- [ ] **Step 3: Build `recommendations.json` from the REAL repo names**

Do NOT hand-guess names. Derive them from the repo so the graph-resolution test passes:
- List the agents: `ls claude/agents/*.md` -> the per-stack trios are `<stack>-solution-designer|implementer|verifier` for stacks `aspnet, angular, wpf, console, mobile, data, devops`; the resolvers are `dotnet-build-error-resolver, dotnet-test-failure-resolver, ng-build-error-resolver, angular-test-resolver`; the cross-cutting are `ci-failure-diagnoser, issue-diagnoser, security-auditor, integration-reviewer`; support seats `evidence-gatherer, code-analyzer, code-style-analyzer, related-project-analyzer`.
- List the rules: `ls claude/rules/*.md` -> baselines `baseline-*`, convention rules `<lang>-conventions`, repair routers `dotnet-repair-agents / angular-repair-agents`, `markdown-docs`.

Create `claude/setup-plugin/skills/setup-claude-stack/references/recommendations.json` with:
- `always.agents`: the 4 cross-cutting + 4 support seats.
- `always.rules`: the 5 `baseline-*` rules + `markdown-docs`.
- `stacks.aspnet`: agents = the aspnet trio + the two dotnet resolvers; rules = `csharp-conventions, dotnet-repair-agents`.
- `stacks.angular`: agents = the angular trio + `ng-build-error-resolver, angular-test-resolver`; rules = `typescript-conventions, angular-conventions, angular-styling-conventions, angular-repair-agents`.
- `stacks.wpf`: agents = the wpf trio + the two dotnet resolvers; rules = `csharp-conventions, wpf-conventions, dotnet-repair-agents`.
- `stacks.console`: agents = the console trio + the two dotnet resolvers; rules = `csharp-conventions, dotnet-repair-agents`.
- `stacks.mobile`: agents = the mobile trio; rules = `typescript-conventions, angular-conventions`.
- `stacks.data`: agents = the data trio; rules = `sql-conventions`.
- `stacks.devops`: agents = the devops trio; rules = `devops-conventions`.

Use ONLY names that appear on disk / in `scripts/stack-graph.json`. After writing, run `node -e` to cross-check each name against the graph and fix any that do not resolve (a name that fails the Step 1 test is a real typo - correct it to the on-disk name, do not delete the test).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/setup-plugin.test.js`
Expected: the recommendation tests PASS (the SKILL.md test still fails until Task 3).

- [ ] **Step 5: Commit**

```bash
git add claude/setup-plugin/skills/setup-claude-stack/references/recommendations.json scripts/setup-plugin.test.js
git commit -m "$(printf 'feat(plugin): add the stack recommendation map\n\n  Added recommendations.json mapping detected stacks to a seed selection (agents + rules), plus an always-on cross-cutting set, all resolved from real graph names.\n  Tested that every name resolves in stack-graph.json and that the aspnet seed closes to its .NET vertical.')"
```

---

### Task 3: the `setup-claude-stack` skill + README wiring

**Files:**
- Create: `claude/setup-plugin/skills/setup-claude-stack/SKILL.md`
- Modify: `README.md` (add the plugin install section), `scripts/setup-plugin.test.js` (append the skill-exists + frontmatter test)

**Interfaces:**
- Consumes: `recommendations.json` (Task 2), the fetched `stack-select.js`/`stack-graph.json`/`claude-stack.{sh,ps1}`.

- [ ] **Step 0: Append the skill test (write it before the skill, watch it fail)**

Append to `scripts/setup-plugin.test.js`:

```js
test('the setup skill exists with valid manual-only frontmatter', () => {
    const skill = path.join(PLUGIN_DIR, 'skills', 'setup-claude-stack', 'SKILL.md');
    assert.ok(fs.existsSync(skill), 'SKILL.md exists');
    const fm = fs.readFileSync(skill, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(fm, 'has frontmatter');
    assert.match(fm[1], /name:\s*setup-claude-stack/, 'name is setup-claude-stack');
    assert.match(fm[1], /disable-model-invocation:\s*true/, 'manual-only');
});
```

Run `node --test scripts/setup-plugin.test.js` and confirm this new test FAILS (the SKILL.md does not exist yet).

- [ ] **Step 1: Create the skill**

Create `claude/setup-plugin/skills/setup-claude-stack/SKILL.md`:

````markdown
---
name: setup-claude-stack
description: "Bootstrap the personal agents-stack into the CURRENT project - detect the OS + analyse the project, ask the scalar install choices, fetch the tools, curate a dependency-complete selection with a prerequisite check, and run the installer. Trigger by invoking /claude-stack or 'set up the claude stack here'. Runs the installer against a curated subset; not for editing the stack source itself."
disable-model-invocation: true
---

# Set up the Claude stack in this project

You are bootstrapping the agents-stack into the CURRENT project. Work in the project root, in order, and drive it interactively: ask the scalar choices, always show the resolved selection and the prerequisite report before installing, and never install past an unmet blocker. The deterministic work is done by `stack-select.js`; you orchestrate.

Everything is fetched from `https://raw.githubusercontent.com/envoydev/agents-stack/main`. Use a temp working dir (e.g. `mktemp -d`) for the fetched tools; never write them into the project.

## 1. Preconditions
- Confirm the cwd is the target project's root and it is a git repo. If not, stop and ask.

## 2. Detect the OS and analyse the project
- OS: on `darwin`/`linux` use `claude-stack.sh`; on Windows use `claude-stack.ps1` (via `pwsh`).
- Detect stacks by artifact and record which apply:
  - `*.csproj` / `*.sln` -> .NET. Split by content: a `Microsoft.NET.Sdk.Web` project -> `aspnet`; `<UseWPF>true` -> `wpf`; otherwise `console`.
  - `angular.json` -> `angular`; `ionic.config.json` / `capacitor.config.*` -> `mobile`.
  - `Dockerfile` / `.github/workflows/` -> `devops`; `*.sql` / a migrations folder -> `data`.
- A project can match several. Report the detected stacks and let the user confirm/adjust before proceeding.

## 3. Ask the scalar choices
Ask with the question tool (one screen): scope (`project` default / `global`), space (optional account name), context7 transport (`remote` default / `local`), install the GitHub CLI? (default no), keep local pins? (`--keep-pins`, default no).

## 4. Fetch the tools
Into the temp dir, download from `.../main`: the right installer (`claude/claude-stack.sh` or `claude/claude-stack.ps1`), `scripts/stack-select.js`, and `scripts/stack-graph.json`.

## 5. Build the recommended selection and close it
- Read this skill's `references/recommendations.json`. Union `always` with the seed of each confirmed stack into a raw selection `{ agents: [...], rules: [...], skills: [...] }`; write it to `raw.json` in the temp dir.
- Run: `node stack-select.js --selection raw.json --graph stack-graph.json --emit selection.txt --check [--context7-local] [--github-cli]`
  - `--context7-local` only when the user chose context7 `local`; `--github-cli` only when they opted in.
  - It prints `required: <name> - <why>` (closure adds) and `BLOCKER: ...` / `warning: ...` lines, and writes `selection.txt` (the installer selection file).

## 6. Present the selection for review
Show the closed selection grouped by category (skills / agents / rules / mcps / plugins). Mark each closure-added item as required and show its reason from the `required:` lines. Let the user deselect items they directly chose (not the required closure adds); if they remove a required item, re-run step 5 and it returns with its reason. Re-emit `selection.txt` after any edit.

## 7. Prerequisite gate
- Blockers: list each with its fix. Ask: fix them now and continue, or drop the affected items from the selection (re-run step 5). Never install past a blocker.
- Warnings: list them and proceed.

## 8. Run the installer
- Unix: `bash claude-stack.sh install --scope <scope> --selection selection.txt [--space <name>] [--context7 local|remote] [--github-cli] [--keep-pins]`
- Windows: `pwsh -File claude-stack.ps1 install -Scope <scope> -Selection selection.txt [-Space <name>] [-Context7 local|remote] [-GitHubCli] [-KeepPins]` - the ps1 handles the serena/TypeScript-on-Windows patch itself.

## 9. Post-check
Report what still needs a hand: LSP tools (`csharp-ls` via `dotnet tool install -g csharp-ls` on a .NET setup), the `/claude-hud:setup` statusline step, and that the first `claude plugin install` may prompt to trust. Finally, surface the installer's own gitignore reminder so the stack-generated artifacts are not committed.

## Do not
- Do not install the full set - always go through the selection. Do not skip the review or the prerequisite gate. Do not write fetched tools into the project tree. Do not commit anything on the user's behalf.
````

- [ ] **Step 2: Verify the skill's documented `stack-select.js` command actually works**

Run this smoke check (uses the committed local scripts, mirroring what the skill runs against the fetched copies):

```bash
tmp=$(mktemp -d)
node -e "const r=require('./claude/setup-plugin/skills/setup-claude-stack/references/recommendations.json'); const s=r.stacks.aspnet, a=r.always; require('fs').writeFileSync(process.argv[1], JSON.stringify({agents:[...(a.agents||[]),...(s.agents||[])], rules:[...(a.rules||[]),...(s.rules||[])]}))" "$tmp/raw.json"
node scripts/stack-select.js --selection "$tmp/raw.json" --graph scripts/stack-graph.json --emit "$tmp/selection.txt"
grep -q '^skill csharp$' "$tmp/selection.txt" && echo "OK: emitted selection includes csharp"
rm -rf "$tmp"
```
Expected: `OK: emitted selection includes csharp`. This proves the skill's step-5 command and the recommendation map produce a valid installer selection file.

- [ ] **Step 3: Add the README install section**

In `README.md`, add a short section documenting the plugin (place it near the existing install/skills documentation):

```markdown
## Bootstrapping a project with the setup plugin

Install the setup plugin once, then run it inside any project to install a curated subset of the stack:

```
claude plugin marketplace add envoydev/agents-stack
claude plugin install claude-stack-setup@agents-stack
```

Then, in a target project, run `/claude-stack` (the `setup-claude-stack` skill): it detects the OS, analyses the project, checks prerequisites, lets you review a dependency-complete selection, and runs the installer against just that subset. The installer scripts and `stack-select.js` remain the source of truth; the plugin is the guided front end.
```

- [ ] **Step 4: Full suite + lint**

Run: `PATH="/private/tmp/claude-501/-Users-mac-Programming-Projects-Personal-agents-stack/d35bfb1e-2605-445b-88b0-c48222fd43da/scratchpad/pwsh:$PATH" npm test && npm run lint`
Expected: every `node --test` file passes (including all of `scripts/setup-plugin.test.js` now that the SKILL.md exists), then `lint-skills: clean (...)`. If the lint reports the new skill as missing from the SKILLS manifest, STOP and report - the setup skill lives under `claude/setup-plugin/`, not `skills/`, so the lint should not see it; a failure means a carve-out is needed.

- [ ] **Step 5: Commit**

```bash
git add claude/setup-plugin/skills/setup-claude-stack/SKILL.md README.md scripts/setup-plugin.test.js
git commit -m "$(printf 'feat(plugin): add the setup-claude-stack orchestration skill\n\n  Added the SKILL.md that detects the project, curates a dependency-complete selection via stack-select.js, checks prerequisites, and runs the installer against the subset.\n  Documented the plugin install flow in the README and added the skill-frontmatter test.')"
```

---

## Self-Review

**Spec coverage (Component C):**
- Plugin published from the repo marketplace, bundling only the setup skill (subdir source) - Task 1. Covered.
- `setup-claude-stack` skill runs the full flow (detect, ask, fetch, close via stack-select.js, review, prereq gate, install, post-check) - Task 3 SKILL.md. Covered.
- Deterministic closure + prereqs delegated to Component D; installer subset via Component B; graph from Component A - Tasks 2-3 wiring. Covered.
- Editable-manifest selection UX + required-but-deselected re-add with a reason - Task 3 steps 6-7. Covered.
- Recommendation map validated against the graph (no silent rot) - Task 2. Covered.

**Placeholder scan:** none - manifests and SKILL.md are complete; `recommendations.json` is specified by construction rule + a resolution test, not left as a stub.

**Type consistency:** the plugin name `claude-stack-setup`, marketplace name `agents-stack`, skill name `setup-claude-stack`, and command `claude-stack` are used consistently across the manifests, the install docs, and the test. `recommendations.json` shape (`always` + `stacks.<key>` with `agents/rules/skills`) is identical between Task 2's builder, its test, and Task 3's smoke check.

**Known deferral (not silent):** the skill's end-to-end runtime fetch targets `main`, so a real bootstrap only works after this branch merges. The manifests, recommendation map, and the stack-select command are all tested here against local files; the fetch itself is a one-line `curl` documented in the skill and not unit-tested.

---

## Note - this is the final component

After C lands, all four components (A graph, B installer subset, D closure+prereqs, C plugin+skill) are complete. Remaining follow-ups are the deferred Minors recorded during A/B/D (the C#/TS -> LSP-plugin graph edges, CLI friendly errors, and a Cursor twin of the setup delivery).
