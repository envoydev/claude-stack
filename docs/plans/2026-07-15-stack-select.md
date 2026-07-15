# Component D - `stack-select.js` (closure + prerequisites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency Node helper `scripts/stack-select.js` that is the deterministic brain of the setup skill: (1) `computeClosure` expands a raw skills/agents/rules selection into a dependency-complete install set using `stack-graph.json` (Component A); (2) `evaluatePrereqs` checks a curated prerequisite map against a detected environment; (3) a CLI that emits an installer selection file (consumed by Component B's `--selection`) and prints a prereq report.

**Architecture:** Pure functions (`computeClosure`, `evaluatePrereqs`) are unit-tested against the real committed `stack-graph.json` and synthetic env blobs. A thin impure `detectEnvironment` shells out to probe binaries/env-vars. The CLI ties closure -> installer-selection-file + prereq-report, so the setup skill (Component C) just calls it. This is a scope refinement of the design: Component D absorbs the closure computation (the direct consumer of Component A) alongside the prereq evaluator, leaving Component C as pure plugin/skill orchestration.

**Tech Stack:** Node.js CommonJS, `node --test`, zero new dependencies (Node built-ins only).

## Global Constraints

- Node CommonJS, `'use strict'`. Zero new npm dependencies.
- House voice in comments: single dashes, single quotes, no em-dashes.
- Public repo: no private names or absolute personal paths in tracked files.
- Closure edges (directional; skills never pull skills): rule -> skill, rule -> agent, agent -> skill, agent -> agent (to fixpoint), and every kept skill/agent/rule -> its mcps + plugins (required, non-deselectable).
- The emitted installer selection file uses Component B's format exactly: one `category name` per line, categories `skill|plugin|mcp|agent|rule`, LF line endings.
- Prereq severities: `blocker` (a kept item will not work without it) vs `warning` (soft/optional). Phase 1 (hard, always) prereqs are blockers.
- Do NOT push. Commit locally only on branch `feat/stack-graph`.

## File Structure

- `scripts/stack-select.js` (create) - `computeClosure`, `evaluatePrereqs`, `detectEnvironment`, the prereq map, and a CLI.
- `scripts/stack-select.test.js` (create) - unit tests for the two pure functions + a CLI integration test.

---

### Task 1: `computeClosure`

**Files:**
- Create: `scripts/stack-select.js` (this task adds `computeClosure` + module.exports)
- Test: `scripts/stack-select.test.js`

**Interfaces:**
- Produces:
  - `computeClosure(graph, raw)` where `graph` is the parsed `stack-graph.json` and `raw` is `{ skills?: string[], agents?: string[], rules?: string[] }`. Returns `{ skills: string[], agents: string[], rules: string[], mcps: string[], plugins: string[], reasons: { [name]: string } }` - all arrays sorted; `reasons` maps each closure-added name to a one-line why.

- [ ] **Step 1: Write the failing test**

Create `scripts/stack-select.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');
const graph = require('./stack-graph.json');

test('an agent pulls its declared skills and plugins', () => {
    const c = computeClosure(graph, { agents: ['aspnet-implementer'] });
    for (const s of ['csharp', 'dotnet-web-backend', 'dotnet-testing'])
    {
        assert.ok(c.skills.includes(s), `expected skill ${s} pulled by aspnet-implementer`);
    }
    assert.ok(c.plugins.includes('ponytail'), 'aspnet-implementer pulls the ponytail plugin');
    assert.match(c.reasons['csharp'], /aspnet-implementer/);
});

test('a rule pulls its skills', () => {
    const c = computeClosure(graph, { rules: ['csharp-conventions'] });
    assert.ok(c.skills.includes('csharp'));
    assert.match(c.reasons['csharp'], /csharp-conventions/);
});

test('a kept skill makes its mcps required', () => {
    const c = computeClosure(graph, { skills: ['project-capabilities'] });
    for (const m of ['serena', 'context7', 'sentry', 'memory', 'playwright', 'angular-cli', 'chrome-devtools', 'appium-mcp'])
    {
        assert.ok(c.mcps.includes(m), `expected mcp ${m} required by project-capabilities`);
    }
});

test('user-chosen items carry no reason; only closure-added ones do', () => {
    const c = computeClosure(graph, { skills: ['csharp'] });
    assert.ok(c.skills.includes('csharp'));
    assert.strictEqual(c.reasons['csharp'], undefined, 'a directly chosen item is not a closure add');
});

test('empty selection yields empty closure', () => {
    const c = computeClosure(graph, {});
    assert.deepStrictEqual(c, { skills: [], agents: [], rules: [], mcps: [], plugins: [], reasons: {} });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/stack-select.test.js`
Expected: FAIL with `Cannot find module './stack-select.js'`.

- [ ] **Step 3: Write `computeClosure`**

Create `scripts/stack-select.js`:

```js
#!/usr/bin/env node
// The deterministic brain of the setup skill: expand a raw skills/agents/rules
// selection into a dependency-complete install set (computeClosure), and check
// a curated prerequisite map against a detected environment (evaluatePrereqs).
// Reads the committed stack-graph.json (Component A); emits an installer
// selection file for claude-stack.sh --selection (Component B).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Expand raw = { skills?, agents?, rules? } into the dependency-complete set.
// Edges (skills never pull skills): rule -> skill/agent, agent -> skill/agent
// (to fixpoint), then every kept skill/agent/rule -> its mcps/plugins.
function computeClosure(graph, raw)
{
    const skills = new Set(raw.skills || []);
    const agents = new Set(raw.agents || []);
    const rules = new Set(raw.rules || []);
    const reasons = {};
    const note = (name, why) => { if (!reasons[name]) reasons[name] = why; };

    for (const r of rules)
    {
        const node = graph.rules[r];
        if (!node) continue;
        for (const s of node.skills) if (!skills.has(s)) { skills.add(s); note(s, `required by rule ${r}`); }
        for (const a of node.agents) if (!agents.has(a)) { agents.add(a); note(a, `required by rule ${r}`); }
    }

    const queue = [...agents];
    while (queue.length)
    {
        const a = queue.shift();
        const node = graph.agents[a];
        if (!node) continue;
        for (const s of node.skills) if (!skills.has(s)) { skills.add(s); note(s, `required by agent ${a}`); }
        for (const a2 of node.agents) if (!agents.has(a2)) { agents.add(a2); note(a2, `required by agent ${a}`); queue.push(a2); }
    }

    const mcps = new Set();
    const plugins = new Set();
    const pull = (node, why) =>
    {
        if (!node) return;
        for (const m of node.mcps) if (!mcps.has(m)) { mcps.add(m); note(m, why); }
        for (const p of node.plugins) if (!plugins.has(p)) { plugins.add(p); note(p, why); }
    };
    for (const s of skills) pull(graph.skills[s], `required by skill ${s}`);
    for (const a of agents) pull(graph.agents[a], `required by agent ${a}`);
    for (const r of rules) pull(graph.rules[r], `required by rule ${r}`);

    const sort = set => [...set].sort();
    return { skills: sort(skills), agents: sort(agents), rules: sort(rules), mcps: sort(mcps), plugins: sort(plugins), reasons };
}

module.exports = { computeClosure };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/stack-select.test.js`
Expected: PASS (5 tests). If the `project-capabilities` mcp assertion fails, confirm Component A's graph still records all 8 (it was fixed in commit `14ef8ff`).

- [ ] **Step 5: Commit**

```bash
git add scripts/stack-select.js scripts/stack-select.test.js
git commit -m "$(printf 'feat(scripts): add computeClosure to stack-select.js\n\n  Added the dependency-closure expander: a raw skills/agents/rules selection pulls required skills/agents and makes every referenced mcp/plugin required, with a reason per closure add.\n  Covered agent/rule/skill closure edges and the empty case with node --test.')"
```

---

### Task 2: `evaluatePrereqs` + the prerequisite map

**Files:**
- Modify: `scripts/stack-select.js` (add the prereq map + `evaluatePrereqs`, extend exports)
- Test: `scripts/stack-select.test.js` (append)

**Interfaces:**
- Consumes: `computeClosure` output shape (uses `.skills`, `.mcps`, `.plugins`).
- Produces:
  - `evaluatePrereqs(selection, env, options)` where `selection` is a closure result, `env` is `{ bins: { [name]: boolean }, envs: { [name]: boolean } }`, `options` is `{ context7Local?: boolean, githubCli?: boolean }`. Returns `{ blockers: Array<{need,how,because?}>, warnings: Array<{need,how,because?}>, ok: boolean }`.
  - `HARD_PREREQS`, `SCOPED_PREREQS` (exported for the test to introspect).

- [ ] **Step 1: Write the failing test**

Append to `scripts/stack-select.test.js`:

```js
const { evaluatePrereqs } = require('./stack-select.js');

const fullEnv = { bins: { node: true, npx: true, git: true, claude: true, uvx: true, dotnet: true, 'csharp-ls': true }, envs: { SENTRY_ACCESS_TOKEN: true, CONTEXT7_API_KEY: true } };
const emptyEnv = { bins: {}, envs: {} };

test('phase-1 hard prereqs are blockers when the binary is absent', () => {
    const r = evaluatePrereqs({ skills: [], mcps: [], plugins: [] }, emptyEnv, {});
    const needs = r.blockers.map(b => b.need).join(' ');
    for (const label of ['Node.js', 'git', 'Claude Code CLI', 'uv (uvx)'])
    {
        assert.ok(needs.includes(label), `expected hard blocker ${label}`);
    }
    assert.strictEqual(r.ok, false);
});

test('a selected sentry mcp without its token is a blocker; with it, clean', () => {
    const sel = { skills: [], mcps: ['sentry'], plugins: [] };
    const missing = evaluatePrereqs(sel, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(missing.blockers.some(b => /Sentry/i.test(b.need)), 'sentry token blocker');
    const present = evaluatePrereqs(sel, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: { SENTRY_ACCESS_TOKEN: true } }, {});
    assert.ok(!present.blockers.some(b => /Sentry/i.test(b.need)), 'sentry token satisfied');
});

test('a .NET skill without the dotnet SDK is a blocker', () => {
    const r = evaluatePrereqs({ skills: ['dotnet-web-backend'], mcps: [], plugins: [] }, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(r.blockers.some(b => /\.NET SDK/.test(b.need)), 'dotnet SDK blocker for a dotnet-* skill');
});

test('full env with no risky selection is clean', () => {
    const r = evaluatePrereqs({ skills: ['csharp'], mcps: [], plugins: [] }, fullEnv, {});
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.blockers, []);
});

test('chrome-devtools mcp missing Chrome is a warning, not a blocker', () => {
    const r = evaluatePrereqs({ skills: [], mcps: ['chrome-devtools'], plugins: [] }, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(r.warnings.some(w => /Chrome/i.test(w.need)));
    assert.ok(!r.blockers.some(b => /Chrome/i.test(b.need)));
    assert.strictEqual(r.ok, true, 'a warning alone keeps ok true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/stack-select.test.js`
Expected: the new tests FAIL - `evaluatePrereqs` is not exported yet.

- [ ] **Step 3: Add the prereq map + `evaluatePrereqs`**

In `scripts/stack-select.js`, before the `module.exports` line, add:

```js
// Phase 1 - always required, a miss is a hard blocker.
const HARD_PREREQS = [
    { bin: 'node', need: 'Node.js', how: 'install Node.js (https://nodejs.org)' },
    { bin: 'git', need: 'git', how: 'install git' },
    { bin: 'claude', need: 'Claude Code CLI', how: 'npm install -g @anthropic-ai/claude-code' },
    { bin: 'uvx', need: 'uv (uvx)', how: 'install uv (https://docs.astral.sh/uv/)' },
];

// Phase 2 - only checked when 'when' matches the closed selection / options.
// severity: 'blocker' (a kept item will not work) or 'warning' (soft/optional).
const SCOPED_PREREQS = [
    { when: { mcp: 'sentry' }, env: 'SENTRY_ACCESS_TOKEN', severity: 'blocker', need: 'Sentry token', how: 'export SENTRY_ACCESS_TOKEN=...' },
    { when: { plugin: 'csharp-lsp' }, bin: 'csharp-ls', severity: 'blocker', need: 'csharp-ls tool', how: 'dotnet tool install -g csharp-ls' },
    { when: { skillPrefix: 'dotnet' }, bin: 'dotnet', severity: 'blocker', need: '.NET SDK', how: 'install the .NET SDK (https://dotnet.microsoft.com)' },
    { when: { skillPrefix: 'csharp' }, bin: 'dotnet', severity: 'blocker', need: '.NET SDK', how: 'install the .NET SDK (https://dotnet.microsoft.com)' },
    { when: { mcp: 'chrome-devtools' }, bin: 'chrome', severity: 'warning', need: 'Chrome / Chromium', how: 'install Google Chrome or Chromium' },
    { when: { mcp: 'appium-mcp' }, bin: 'appium', severity: 'warning', need: 'Appium + native SDKs', how: 'install Appium and the Xcode / Android SDK / Java toolchain' },
    { when: { option: 'context7Local' }, env: 'CONTEXT7_API_KEY', severity: 'warning', need: 'context7 API key', how: 'export CONTEXT7_API_KEY=... (or use --context7 remote)' },
    { when: { option: 'githubCli' }, bin: 'brew', severity: 'warning', need: 'Homebrew', how: 'install Homebrew to auto-install the GitHub CLI (macOS)' },
];

function evaluatePrereqs(selection, env, options)
{
    options = options || {};
    const bins = env.bins || {};
    const envs = env.envs || {};
    const skills = new Set(selection.skills || []);
    const mcps = new Set(selection.mcps || []);
    const plugins = new Set(selection.plugins || []);

    const matches = when =>
    {
        if (when.mcp) return mcps.has(when.mcp);
        if (when.plugin) return plugins.has(when.plugin);
        if (when.skillPrefix) return [...skills].some(s => s.startsWith(when.skillPrefix));
        if (when.option) return !!options[when.option];
        return false;
    };

    const blockers = [];
    const warnings = [];
    const seen = new Set();
    const add = (bucket, p) =>
    {
        const key = p.need;
        if (seen.has(key)) return;
        seen.add(key);
        bucket.push({ need: p.need, how: p.how, ...(p.because ? { because: p.because } : {}) });
    };

    for (const p of HARD_PREREQS)
    {
        if (!bins[p.bin]) add(blockers, p);
    }

    for (const p of SCOPED_PREREQS)
    {
        if (!matches(p.when)) continue;
        const present = p.env ? envs[p.env] : bins[p.bin];
        if (present) continue;
        add(p.severity === 'blocker' ? blockers : warnings, p);
    }

    return { blockers, warnings, ok: blockers.length === 0 };
}
```

Then update the exports line to:

```js
module.exports = { computeClosure, evaluatePrereqs, HARD_PREREQS, SCOPED_PREREQS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/stack-select.test.js`
Expected: all tests PASS (Task 1's 5 + Task 2's 5).

- [ ] **Step 5: Commit**

```bash
git add scripts/stack-select.js scripts/stack-select.test.js
git commit -m "$(printf 'feat(scripts): add evaluatePrereqs + prerequisite map to stack-select.js\n\n  Added a two-phase prerequisite check: hard binaries (node/git/claude/uvx) plus selection-scoped needs (sentry token, .NET SDK, LSP tool, browser/native, context7 key, homebrew) split into blockers and warnings.\n  Covered hard blockers, selection-scoped blocker/warning, and the clean case with node --test.')"
```

---

### Task 3: `detectEnvironment` + CLI + installer integration

**Files:**
- Modify: `scripts/stack-select.js` (add `detectEnvironment`, `emitSelectionFile`, a CLI `main`, extend exports)
- Test: `scripts/stack-select.test.js` (append a CLI integration test)

**Interfaces:**
- Consumes: `computeClosure`, `evaluatePrereqs` from Tasks 1-2; the installer `claude/claude-stack.sh --selection ... --print-plan` from Component B.
- Produces:
  - `detectEnvironment()` -> `{ bins: {...}, envs: {...} }` (impure; probes PATH + `process.env`).
  - `emitSelectionFile(closure)` -> the installer selection-file string (Component B format).
  - CLI: `node stack-select.js --selection <raw.json> [--graph <path>] [--emit <file>] [--check] [--context7-local] [--github-cli]`.

- [ ] **Step 1: Write the failing integration test**

Append to `scripts/stack-select.test.js`:

```js
const { emitSelectionFile } = require('./stack-select.js');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

test('emitSelectionFile produces Component B selection lines', () => {
    const text = emitSelectionFile({ skills: ['csharp'], agents: ['aspnet-implementer'], rules: ['csharp-conventions'], mcps: ['serena'], plugins: ['ponytail'] });
    const lines = text.trim().split('\n');
    assert.ok(lines.includes('skill csharp'));
    assert.ok(lines.includes('agent aspnet-implementer'));
    assert.ok(lines.includes('mcp serena'));
    assert.ok(lines.includes('plugin ponytail'));
    assert.ok(lines.includes('rule csharp-conventions'));
});

test('CLI closure -> emitted file -> installer --print-plan agrees', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
    const rawFile = path.join(dir, 'raw.json');
    const selFile = path.join(dir, 'selection.txt');
    fs.writeFileSync(rawFile, JSON.stringify({ agents: ['aspnet-implementer'] }));
    try
    {
        execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--emit', selFile], { encoding: 'utf8' });
        const emitted = fs.readFileSync(selFile, 'utf8');
        // aspnet-implementer pulls csharp (a skill) - the emitted file must list it
        assert.ok(emitted.split('\n').includes('skill csharp'));

        const sh = path.join(__dirname, '..', 'claude', 'claude-stack.sh');
        const plan = execFileSync('bash', [sh, 'install', '--scope', 'project', '--selection', selFile, '--print-plan'], { encoding: 'utf8' });
        const planSkills = (plan.match(/^plan skills:(.*)$/m) || [,''])[1].trim().split(/\s+/);
        assert.ok(planSkills.includes('csharp'), 'installer plan reflects the closed selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/stack-select.test.js`
Expected: the new tests FAIL - `emitSelectionFile` and the CLI do not exist yet.

- [ ] **Step 3: Add `detectEnvironment`, `emitSelectionFile`, and the CLI**

In `scripts/stack-select.js`, add before `module.exports`:

```js
// Impure - probe the current machine. bins: is the command on PATH; envs: is
// the variable set and non-empty. Kept thin; the pure evaluator is the tested
// part. Extend the probe lists as the prereq map grows.
function detectEnvironment()
{
    const BINS = ['node', 'npx', 'git', 'claude', 'uvx', 'dotnet', 'csharp-ls', 'chrome', 'appium', 'brew'];
    const ENVS = ['SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY'];
    const bins = {};
    for (const b of BINS)
    {
        try { execFileSync('command', ['-v', b], { stdio: 'ignore', shell: '/bin/bash' }); bins[b] = true; }
        catch { bins[b] = false; }
    }
    const envs = {};
    for (const e of ENVS) envs[e] = typeof process.env[e] === 'string' && process.env[e].trim() !== '';
    return { bins, envs };
}

function emitSelectionFile(closure)
{
    const lines = [];
    for (const s of closure.skills || []) lines.push(`skill ${s}`);
    for (const a of closure.agents || []) lines.push(`agent ${a}`);
    for (const m of closure.mcps || []) lines.push(`mcp ${m}`);
    for (const p of closure.plugins || []) lines.push(`plugin ${p}`);
    for (const r of closure.rules || []) lines.push(`rule ${r}`);
    return lines.join('\n') + '\n';
}

function main(argv)
{
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
    const has = name => argv.includes(name);
    const rawFile = arg('--selection');
    if (!rawFile) { console.error('usage: stack-select.js --selection <raw.json> [--graph <path>] [--emit <file>] [--check] [--context7-local] [--github-cli]'); process.exit(2); }
    const graphPath = arg('--graph') || path.join(__dirname, 'stack-graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
    const closure = computeClosure(graph, raw);

    const emit = arg('--emit');
    if (emit) fs.writeFileSync(emit, emitSelectionFile(closure));

    for (const [name, why] of Object.entries(closure.reasons)) console.log(`required: ${name} - ${why}`);

    if (has('--check'))
    {
        const report = evaluatePrereqs(closure, detectEnvironment(), { context7Local: has('--context7-local'), githubCli: has('--github-cli') });
        for (const b of report.blockers) console.log(`BLOCKER: ${b.need} -> ${b.how}`);
        for (const w of report.warnings) console.log(`warning: ${w.need} -> ${w.how}`);
        if (!report.ok) process.exit(1);
    }
}
```

Update the exports and add the CLI guard:

```js
module.exports = { computeClosure, evaluatePrereqs, detectEnvironment, emitSelectionFile, HARD_PREREQS, SCOPED_PREREQS };

if (require.main === module) main(process.argv.slice(2));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/stack-select.test.js`
Expected: all tests PASS. The integration test spawns the CLI and then `claude-stack.sh --print-plan`; it needs `node` and `bash` (present). If the installer step exits non-zero before printing, STOP and report - do not weaken the assertion.

- [ ] **Step 5: Full suite + lint**

Run: `PATH="/private/tmp/claude-501/-Users-mac-Programming-Projects-Personal-agents-stack/d35bfb1e-2605-445b-88b0-c48222fd43da/scratchpad/pwsh:$PATH" node --test scripts/ && npm run lint`
Expected: every `node --test` file passes (including the earlier selection + stack-graph tests), then `lint-skills: clean (...)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/stack-select.js scripts/stack-select.test.js
git commit -m "$(printf 'feat(scripts): add detectEnvironment, selection emit, and CLI to stack-select.js\n\n  Added a thin environment probe, an installer selection-file emitter in the Component B format, and a CLI that expands a raw selection and optionally checks prerequisites.\n  Added an integration test proving the emitted selection drives claude-stack.sh --print-plan.')"
```

---

## Self-Review

**Spec coverage (Component D + the closure it absorbs):**
- `computeClosure` over the Component A graph, with the exact closure edges and a reason per add - Task 1. Covered.
- Two-phase prerequisite check (hard + selection-scoped), blockers vs warnings, curated map - Task 2. Covered.
- `detectEnvironment` (thin probe), installer selection-file emit (Component B format), CLI wiring - Task 3. Covered.
- Ties to Component A (reads `stack-graph.json`) and Component B (emitted file drives `--print-plan`) - Task 3 integration test. Covered.

**Placeholder scan:** none - all code and commands are concrete.

**Type consistency:** `computeClosure` output shape (`skills/agents/rules/mcps/plugins/reasons`) is consumed unchanged by `evaluatePrereqs` (reads `skills/mcps/plugins`) and `emitSelectionFile` (reads all five arrays). `env` shape (`{bins,envs}`) is produced by `detectEnvironment` and consumed by `evaluatePrereqs` identically. `options` (`context7Local`, `githubCli`) names match between the CLI flags, `main`, and `evaluatePrereqs`.

---

## Note on the remaining component

After D lands, the final plan is **C** - the `claude-stack` plugin scaffolding + the `setup-claude-stack` skill that: detects OS + analyses the project, asks the scalar choices, downloads the installer, calls `stack-select.js` (this component) to close the selection and check prereqs, presents the editable manifest, and runs `claude-stack.{sh,ps1} --selection`.
