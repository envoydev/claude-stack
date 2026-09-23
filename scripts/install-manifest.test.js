'use strict';
// THE MANIFEST LOADER - Phase 7, T4b.
//
// One assertion carries this file: what the loader renders is character-for-character what the sh
// twin declares. The JSON is generated from that twin and the ps1 is checked against it, so this
// closes the loop - the Node seed reads the same six lists the shipping installer does, in the same
// spellings, and a drift in either direction is a red test rather than a silent difference.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { loadManifest } = require('./install/manifest.js');
const { readBlock, normalize } = require('./build-manifest.js');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');

test('manifest: every list renders back to the sh twin\'s own entries', () =>
{
    const m = loadManifest(ROOT);
    // Only the rows the twin SEEDS: a commented row is `active: false` in the JSON and parked here.
    const fromTwin = (opener) => readBlock(SH, opener, '"').filter((e) => e.active !== false).map((e) => e.value);
    for (const [key, opener] of [['skills', 'SKILLS=('], ['agents', 'AGENTS=('], ['rules', 'CLAUDE_RULES=('], ['hooks', 'HOOKS=('], ['plugins', 'PLUGINS=(']])
        assert.deepStrictEqual(m[key], fromTwin(opener), `${key} drifted from the twin`);

    // The MCP args are the ONE deliberate rewrite: JSON has no `$` expansion, so an install-time
    // shell variable travels as the `@PLACEHOLDER@` token the argv resolver already understands.
    // Compared through the same normaliser that wrote them. Two rows the twin writes as a shell
    // VARIABLE reference (the memory and context7 entries, both assembled above the block) are
    // compared by NAME, which is the one thing both spellings agree on.
    const twinMcps = fromTwin('MCPS=(');
    assert.strictEqual(m.mcps.length, twinMcps.length, 'the twin and the JSON ship a different number of servers');
    twinMcps.forEach((value, i) =>
    {
        if (/^\$[A-Za-z_]/.test(value))
        {
            const name = m.mcps[i].split('|')[0];
            assert.match(value.toUpperCase(), new RegExp(`\\$${name.toUpperCase().replace(/-/g, '_')}_ENTRY`),
                `the variable row ${value} does not name ${name}`);
            return;
        }
        assert.strictEqual(m.mcps[i], normalize(value, 'mcps'), `mcp row ${i} drifted from the twin`);
    });
});

test('manifest: an active:false row is SHIPPED but not seeded', () =>
{
    const m = loadManifest(ROOT);
    const parked = (m.rows.plugins || []).filter((r) => r.active === false).map((r) => r.id);
    assert.ok(parked.length, 'the fixture lost its parked row - superpowers is a core dependency, not a pick');
    for (const id of parked)
    {
        assert.ok(!m.plugins.includes(id), `${id} is seeded although it is parked`);
        assert.ok(m.catalogs.plugins.includes(id), `${id} left the catalog - the stamp and --installed-only both read it`);
    }
});

test('manifest: the hook and mcp CATALOGS are never narrowed', () =>
{
    const m = loadManifest(ROOT);
    assert.deepStrictEqual(m.catalogs.hooks, m.hooks, 'no hook is parked today, so the two lists must match exactly');
    assert.strictEqual(m.catalogs.mcps.length, (m.rows.mcps || []).length);
});

test('manifest: a hook wired on two events is two entries and one file', () =>
{
    const m = loadManifest(ROOT);
    const stop = m.hooks.filter((h) => h.startsWith('guard-stop-contract.js::'));
    assert.ok(stop.length >= 2, stop.join(' | '));
    assert.ok(stop.some((h) => h.includes('::@Stop::')), stop.join(' | '));
    assert.ok(stop.some((h) => /::AskUserQuestion::/.test(h)), stop.join(' | '));
});

test('manifest: every MCP entry keeps its install-time placeholders intact', () =>
{
    // JSON has no `$` expansion, so an install-time shell variable became an @PLACEHOLDER@ token the
    // argv resolver already understands. A row that lost one would register a literal.
    const m = loadManifest(ROOT);
    const serena = m.mcps.find((e) => e.startsWith('serena|'));
    assert.match(serena, /@SERENA_CONTEXT@/);
    const memory = m.mcps.find((e) => e.startsWith('memory|'));
    assert.match(memory, /@MEMORY_DB_PATH@/);
});

test('manifest: a manifest with no retired block, or a partial one, prunes nothing it does not name', () =>
{
    const fs = require('node:fs');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-retired-'));
    try
    {
        fs.mkdirSync(path.join(dir, 'meta'));
        const file = path.join(dir, 'meta', 'stack-manifest.json');
        fs.writeFileSync(file, JSON.stringify({ skills: [], agents: [], rules: [], hooks: [], plugins: [], mcps: [] }));
        assert.deepStrictEqual(loadManifest(dir).retired, { skills: [], agents: [], rules: [], hooks: [], mcps: [], plugins: [] });
        fs.writeFileSync(file, JSON.stringify({ skills: [], agents: [], rules: [], hooks: [], plugins: [], mcps: [], retired: { plugins: ['ponytail'] } }));
        const r = loadManifest(dir).retired;
        assert.deepStrictEqual(r.plugins, ['ponytail']);
        assert.deepStrictEqual(r.agents, []);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
