# Component A - `stack-graph.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit and CI-verify a committed `scripts/stack-graph.json` describing the stack's dependency edges (agent->skill, rule->skill/agent, and skill/agent/rule->mcp/plugin), generated from the same sources the lint already reads.

**Architecture:** A new `scripts/stack-graph.js` module builds the graph by reusing `lint-skills.js`'s manifest parsers (exposed via a small export refactor). It runs standalone (`--write` regenerates the committed JSON) and `lint-skills.js` gains one check that fails on drift, so the graph is a generated artifact CI keeps honest - never hand-maintained.

**Tech Stack:** Node.js (built-in `node --test`), `js-yaml` (already a devDependency), zero new dependencies.

## Global Constraints

- Node scripts are CommonJS (`'use strict'`, `require`), matching `lint-skills.js`.
- Zero new npm dependencies - only `js-yaml` (already present) and Node built-ins.
- House voice in any prose/comments: single dashes, single quotes, no em-dashes.
- Public repo: no private names or absolute personal paths in any tracked file.
- The closure edges are directional and skills never pull other skills: agent->skill, rule->skill, rule->agent, and skill/agent/rule->mcp, skill/agent/rule->plugin. The graph records exactly these.
- Committed graph path is exactly `scripts/stack-graph.json`, serialized as 2-space-indented JSON with a trailing newline.
- Do not commit or push until the user explicitly says to (per `baseline-git`). Each task's "Commit" step stages + commits locally only.

---

## File Structure

- `scripts/lint-skills.js` (modify) - guard `main()` behind `require.main === module` and add a `module.exports` block so the parsers are importable; add one drift check (check 20).
- `scripts/stack-graph.js` (create) - the graph builder + CLI (`--write` / verify).
- `scripts/stack-graph.json` (create, generated) - the committed artifact.
- `scripts/stack-graph.test.js` (create) - `node --test` unit tests for the builder.
- `scripts/lint-skills.test.js` (create) - a test proving `require('./lint-skills.js')` does not run the linter.
- `package.json` (modify) - add a `test` script and a `graph` script.

---

### Task 1: Make `lint-skills.js` importable without running

**Files:**
- Modify: `scripts/lint-skills.js:1194` (the trailing `main();` call) and add an export block just before it.
- Test: `scripts/lint-skills.test.js`

**Interfaces:**
- Produces: `module.exports` from `lint-skills.js` with:
  - `paths` - object of the resolved path constants: `{ ROOT, SKILLS_DIR, CLAUDE_SH, CLAUDE_PS1, AGENTS_DIR, CLAUDE_RULES_DIR }`
  - `parseManifest(file, quote, blockStart)` -> `{ active: Map, commented: Map }`
  - `parseStringArray(file, quote, blockStart)` -> `string[]`
  - `parseFlatBlock(file, quote, blockStart, sep)` -> `{ active: Set, commented: Set }`
  - `localSkillDirs()` -> `string[]`
  - `NON_SKILL_TOKENS` - the `Set`

- [ ] **Step 1: Write the failing test**

Create `scripts/lint-skills.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('requiring lint-skills does not run the linter and exposes parsers', () => {
    const lint = require('./lint-skills.js');
    assert.strictEqual(typeof lint.parseFlatBlock, 'function');
    assert.strictEqual(typeof lint.parseManifest, 'function');
    assert.strictEqual(typeof lint.parseStringArray, 'function');
    assert.strictEqual(typeof lint.localSkillDirs, 'function');
    assert.ok(lint.NON_SKILL_TOKENS instanceof Set);
    assert.ok(lint.paths && typeof lint.paths.SKILLS_DIR === 'string');
    // localSkillDirs reads the real skills/ dir - proves the paths resolve.
    assert.ok(lint.localSkillDirs().length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lint-skills.test.js`
Expected: FAIL - the current file ends with a bare `main();` (so requiring it runs the whole linter and prints its report), and `module.exports` is undefined, so `lint.parseFlatBlock` is `undefined`.

- [ ] **Step 3: Add the export block and guard `main()`**

In `scripts/lint-skills.js`, replace the final line:

```js
main();
```

with:

```js
module.exports = {
    paths: { ROOT, SKILLS_DIR, CLAUDE_SH, CLAUDE_PS1, AGENTS_DIR, CLAUDE_RULES_DIR },
    parseManifest,
    parseStringArray,
    parseFlatBlock,
    localSkillDirs,
    NON_SKILL_TOKENS,
};

if (require.main === module)
{
    main();
}
```

(`ROOT`, `SKILLS_DIR`, `CLAUDE_SH`, `CLAUDE_PS1`, `AGENTS_DIR`, `CLAUDE_RULES_DIR` are already declared as `const` at the top of the file; this only references them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lint-skills.test.js`
Expected: PASS.

- [ ] **Step 5: Verify the linter still runs standalone**

Run: `node scripts/lint-skills.js`
Expected: `lint-skills: clean (...)` - unchanged behavior when invoked directly.

- [ ] **Step 6: Commit**

```bash
git add scripts/lint-skills.js scripts/lint-skills.test.js
git commit -m "$(printf 'refactor(scripts): make lint-skills importable\n\n  Guarded main() behind require.main so requiring the module does not run the linter.\n  Exported the manifest parsers and path constants for reuse by the stack-graph builder.')"
```

---

### Task 2: Build the dependency graph

**Files:**
- Create: `scripts/stack-graph.js`
- Test: `scripts/stack-graph.test.js`

**Interfaces:**
- Consumes: the Task 1 exports from `./lint-skills.js` (`paths`, `parseFlatBlock`, `localSkillDirs`).
- Produces:
  - `buildStackGraph()` -> the graph object:
    ```
    {
      generatedBy: 'stack-graph',
      skills: { [name]: { mcps: string[], plugins: string[] } },
      agents: { [name]: { skills: string[], skillsSource: 'frontmatter'|'body'|'none',
                          agents: string[], mcps: string[], plugins: string[] } },
      rules:  { [name]: { skills: string[], agents: string[], mcps: string[],
                          plugins: string[], paths: string[] } },
      catalog: { mcps: string[], plugins: string[] }
    }
    ```
  - `serialize(graph)` -> `string` (2-space JSON + trailing newline)
  - `GRAPH_FILE` -> absolute path to `scripts/stack-graph.json`
  - `readCommitted()` -> `string | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/stack-graph.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildStackGraph } = require('./stack-graph.js');

const graph = buildStackGraph();

test('agent skill edges come from the declared skills: frontmatter', () => {
    const a = graph.agents['aspnet-solution-designer'];
    assert.ok(a, 'aspnet-solution-designer must be in the graph');
    assert.strictEqual(a.skillsSource, 'frontmatter');
    for (const s of ['dotnet', 'dotnet-web-backend', 'dotnet-testing', 'project-solution-design'])
    {
        assert.ok(a.skills.includes(s), `expected agent->skill edge to ${s}`);
    }
});

test('rule skill edges resolve from the rule body', () => {
    const r = graph.rules['csharp-conventions'];
    assert.ok(r, 'csharp-conventions must be in the graph');
    assert.ok(r.skills.includes('csharp'), 'csharp-conventions -> csharp');
    assert.deepStrictEqual(r.paths, ['**/*.cs']);
});

test('every edge target exists in a catalog (no dangling references)', () => {
    const skills = new Set(Object.keys(graph.skills));
    const agents = new Set(Object.keys(graph.agents));
    const mcps = new Set(graph.catalog.mcps);
    const plugins = new Set(graph.catalog.plugins);
    for (const [name, node] of Object.entries(graph.agents))
    {
        for (const s of node.skills) assert.ok(skills.has(s), `${name} -> unknown skill ${s}`);
        for (const a of node.agents) assert.ok(agents.has(a), `${name} -> unknown agent ${a}`);
        for (const m of node.mcps) assert.ok(mcps.has(m), `${name} -> unknown mcp ${m}`);
        for (const p of node.plugins) assert.ok(plugins.has(p), `${name} -> unknown plugin ${p}`);
    }
});

test('an agent never lists itself as an agent edge', () => {
    for (const [name, node] of Object.entries(graph.agents))
    {
        assert.ok(!node.agents.includes(name), `${name} lists itself`);
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/stack-graph.test.js`
Expected: FAIL with `Cannot find module './stack-graph.js'`.

- [ ] **Step 3: Write the graph builder**

Create `scripts/stack-graph.js`:

```js
#!/usr/bin/env node
// Build the stack dependency graph (scripts/stack-graph.json) from the same
// sources the lint reads. Edges are directional and skills never pull skills:
//   agent  -> skill (declared skills: frontmatter, else body backtick mentions)
//   rule   -> skill / agent (body backtick mentions) + paths from frontmatter
//   skill/agent/rule -> mcp / plugin (body backtick mentions)
// Mentions are BACKTICKED tokens only (the same reliable signal the lint uses),
// so prose words like the English 'memory' never create a false edge.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const lint = require('./lint-skills.js');

const { ROOT, SKILLS_DIR, AGENTS_DIR, CLAUDE_RULES_DIR, CLAUDE_SH } = lint.paths;
const GRAPH_FILE = path.join(ROOT, 'scripts', 'stack-graph.json');

function frontmatterBlock(text)
{
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : null;
}

function bodyAfterFrontmatter(text)
{
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    return m ? m[1] : text;
}

// Every distinct backticked token in the text (content between a pair of
// backticks, trimmed). Catalog membership - not a shape regex - decides what is
// an edge, so single-word MCPs (`serena`, `context7`) resolve as well as
// hyphenated ones (`angular-cli`).
function backtickedTokens(text)
{
    return new Set([...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()));
}

function catalogs()
{
    const skills = new Set(lint.localSkillDirs());
    const agents = new Set(fs.existsSync(AGENTS_DIR)
        ? fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
        : []);
    const mcpBlock = lint.parseFlatBlock(CLAUDE_SH, '"', 'MCPS=(', '|');
    const pluginBlock = lint.parseFlatBlock(CLAUDE_SH, '"', 'PLUGINS=(', '@');
    const mcps = new Set([...mcpBlock.active, ...mcpBlock.commented]);
    const plugins = new Set([...pluginBlock.active, ...pluginBlock.commented]);
    return { skills, agents, mcps, plugins };
}

function categorize(tokens, cat)
{
    const pick = set => [...tokens].filter(t => set.has(t)).sort();
    return { skills: pick(cat.skills), agents: pick(cat.agents), mcps: pick(cat.mcps), plugins: pick(cat.plugins) };
}

function skillFiles(name)
{
    const files = [path.join(SKILLS_DIR, name, 'SKILL.md')];
    const refs = path.join(SKILLS_DIR, name, 'references');
    if (fs.existsSync(refs))
    {
        files.push(...fs.readdirSync(refs).filter(f => f.endsWith('.md')).map(f => path.join(refs, f)));
    }

    return files.filter(fs.existsSync);
}

function buildStackGraph()
{
    const cat = catalogs();
    const graph = {
        generatedBy: 'stack-graph',
        skills: {},
        agents: {},
        rules: {},
        catalog: { mcps: [...cat.mcps].sort(), plugins: [...cat.plugins].sort() },
    };

    for (const name of [...cat.skills].sort())
    {
        const tokens = new Set();
        for (const f of skillFiles(name))
        {
            for (const t of backtickedTokens(fs.readFileSync(f, 'utf8'))) tokens.add(t);
        }

        const c = categorize(tokens, cat);
        graph.skills[name] = { mcps: c.mcps, plugins: c.plugins };
    }

    for (const name of [...cat.agents].sort())
    {
        const text = fs.readFileSync(path.join(AGENTS_DIR, name + '.md'), 'utf8');
        const fmText = frontmatterBlock(text);
        let declared = [];
        let source = 'none';
        if (fmText)
        {
            let meta = null;
            try { meta = yaml.load(fmText); } catch { meta = null; }
            if (meta && Array.isArray(meta.skills))
            {
                declared = meta.skills.filter(s => cat.skills.has(s));
                source = 'frontmatter';
            }
        }

        const c = categorize(backtickedTokens(bodyAfterFrontmatter(text)), cat);
        let skills = declared;
        if (source !== 'frontmatter')
        {
            skills = c.skills;
            source = c.skills.length ? 'body' : 'none';
        }

        graph.agents[name] = {
            skills: [...skills].sort(),
            skillsSource: source,
            agents: c.agents.filter(a => a !== name),
            mcps: c.mcps,
            plugins: c.plugins,
        };
    }

    if (fs.existsSync(CLAUDE_RULES_DIR))
    {
        for (const file of fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')).sort())
        {
            const name = file.replace(/\.md$/, '');
            const text = fs.readFileSync(path.join(CLAUDE_RULES_DIR, file), 'utf8');
            const fmText = frontmatterBlock(text);
            let paths = [];
            if (fmText)
            {
                try
                {
                    const meta = yaml.load(fmText);
                    if (meta && Array.isArray(meta.paths)) paths = meta.paths;
                }
                catch { /* check 18 in the lint already flags bad rule YAML */ }
            }

            const c = categorize(backtickedTokens(bodyAfterFrontmatter(text)), cat);
            graph.rules[name] = { skills: c.skills, agents: c.agents, mcps: c.mcps, plugins: c.plugins, paths };
        }
    }

    return graph;
}

function serialize(graph)
{
    return JSON.stringify(graph, null, 2) + '\n';
}

function readCommitted()
{
    return fs.existsSync(GRAPH_FILE) ? fs.readFileSync(GRAPH_FILE, 'utf8') : null;
}

module.exports = { buildStackGraph, serialize, GRAPH_FILE, readCommitted };

if (require.main === module)
{
    const out = serialize(buildStackGraph());
    if (process.argv.includes('--write'))
    {
        fs.writeFileSync(GRAPH_FILE, out);
        console.log(`stack-graph: wrote ${path.relative(ROOT, GRAPH_FILE)}`);
    }
    else if (readCommitted() !== out)
    {
        console.error('stack-graph: committed scripts/stack-graph.json is stale - run `node scripts/stack-graph.js --write`');
        process.exit(1);
    }
    else
    {
        console.log('stack-graph: committed graph is in sync.');
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/stack-graph.test.js`
Expected: PASS - all four tests green. If `aspnet-solution-designer`'s edges fail, confirm its `skills:` frontmatter still lists those four skills (Task depends on that declared data).

- [ ] **Step 5: Commit**

```bash
git add scripts/stack-graph.js scripts/stack-graph.test.js
git commit -m "$(printf 'feat(scripts): add the stack dependency-graph builder\n\n  Added scripts/stack-graph.js building agent/rule/skill dependency edges from declared frontmatter and backticked body mentions.\n  Covered it with node --test cases for the declared-skill, rule, dangling-reference, and self-edge invariants.')"
```

---

### Task 3: Commit the generated graph and fail lint on drift

**Files:**
- Create: `scripts/stack-graph.json` (generated by `--write`)
- Modify: `scripts/lint-skills.js` (add check 20 near the end of `main()`, before the warnings/findings output block around line 1168)
- Modify: `package.json` (add `graph` and `test` scripts)
- Test: extend `scripts/stack-graph.test.js`

**Interfaces:**
- Consumes: `buildStackGraph`, `serialize`, `readCommitted` from Task 2.
- Produces: a lint finding string `stack-graph: scripts/stack-graph.json is stale ...` when the committed JSON differs from a fresh build.

- [ ] **Step 1: Generate the committed graph**

Run: `node scripts/stack-graph.js --write`
Expected: `stack-graph: wrote scripts/stack-graph.json`, and the file now exists.

- [ ] **Step 2: Write the failing lint-drift test**

Append to `scripts/stack-graph.test.js`:

```js
const { serialize, readCommitted } = require('./stack-graph.js');

test('the committed stack-graph.json is in sync with a fresh build', () => {
    assert.strictEqual(readCommitted(), serialize(buildStackGraph()),
        'run `node scripts/stack-graph.js --write` and commit the result');
});
```

Run: `node --test scripts/stack-graph.test.js`
Expected: PASS (Step 1 just wrote it fresh). This test now guards drift for the test suite.

- [ ] **Step 3: Add the drift check to the lint**

In `scripts/lint-skills.js`, inside `main()`, immediately before the `if (warnings.length > 0)` block (around line 1168), add:

```js
    // 20. The committed dependency graph (scripts/stack-graph.json) must match a
    //     fresh build from the current skills/agents/rules/manifests. Lazy-require
    //     avoids a load-time cycle (stack-graph.js requires this module back).
    const stackGraph = require('./stack-graph.js');
    if (stackGraph.readCommitted() !== stackGraph.serialize(stackGraph.buildStackGraph()))
    {
        flag('stack-graph: scripts/stack-graph.json is stale - run `node scripts/stack-graph.js --write` and commit it');
    }
```

- [ ] **Step 4: Verify lint passes with the in-sync graph**

Run: `node scripts/lint-skills.js`
Expected: `lint-skills: clean (...)` with exit 0 (the committed graph matches).

- [ ] **Step 5: Verify lint fails on drift**

Run:
```bash
node -e "const fs=require('fs');const p='scripts/stack-graph.json';const g=JSON.parse(fs.readFileSync(p));g.generatedBy='TAMPERED';fs.writeFileSync(p,JSON.stringify(g,null,2)+'\n')"
node scripts/lint-skills.js; echo "exit=$?"
```
Expected: a `LINT: stack-graph: scripts/stack-graph.json is stale ...` line and `exit=1`.

Then restore it:
```bash
node scripts/stack-graph.js --write
node scripts/lint-skills.js
```
Expected: clean again.

- [ ] **Step 6: Add the npm scripts**

In `package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "lint": "node scripts/lint-skills.js",
    "graph": "node scripts/stack-graph.js --write",
    "test": "node --test scripts/"
  },
```

- [ ] **Step 7: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all `node --test` cases pass, then `lint-skills: clean (...)`.

- [ ] **Step 8: Commit**

```bash
git add scripts/stack-graph.json scripts/lint-skills.js scripts/stack-graph.test.js package.json
git commit -m "$(printf 'feat(scripts): commit stack-graph.json and fail lint on drift\n\n  Committed the generated scripts/stack-graph.json dependency graph.\n  Added lint check 20 so a stale committed graph fails the build, plus npm graph and test scripts.')"
```

---

## Self-Review

**Spec coverage (Component A of the design):**
- Committed `stack-graph.json` at `scripts/stack-graph.json` - Task 3 Step 1. Covered.
- Generated + validated by the lint, `--write` to update, fail-on-drift - Task 3 Steps 3-5. Covered.
- Edge derivation: agent->skill prefers `skills:` frontmatter with a recorded source, falls back to body mention - Task 2 builder + test. Covered.
- rule->skill/agent + `paths` from frontmatter - Task 2 builder + test. Covered.
- skill/agent/rule->mcp/plugin from backtick mentions (catalog-driven so single-word MCPs resolve) - Task 2 builder + dangling-reference test. Covered.
- Schema shape matches the spec sketch (`skills`/`agents`/`rules`/`catalog`, `skillsSource`) - Task 2 Interfaces. Covered.

**Placeholder scan:** none - every step has runnable code or an exact command.

**Type consistency:** `buildStackGraph`/`serialize`/`readCommitted`/`GRAPH_FILE` names are identical across Tasks 2 and 3 and the lint check. The export names in Task 1 (`parseFlatBlock`, `localSkillDirs`, `paths`) match their uses in Task 2.

---

## Note on the remaining components

This plan is Component A only. Per the design's A -> B -> D -> C build order, the next plans (written after A lands and is verified) are:
- **B** - `--selection <file>` subset mode on `claude-stack.{sh,ps1}`.
- **D** - the prerequisite map + evaluator inside the `stack-select.js` helper.
- **C** - the `claude-stack` plugin scaffolding + `setup-claude-stack` skill wiring A/B/D into the interactive flow.

Each is independently testable and gets its own plan document.
