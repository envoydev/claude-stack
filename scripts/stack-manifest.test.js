'use strict';
// THE MANIFEST IS ONE FILE, not two hand-kept copies in two languages.
//
// Until Phase 7 the six lists the installers work from - skills, agents, rules, hooks, plugins and
// MCPs - were declared inline in BOTH twins, about 273 lines each. Four lint checks existed only to
// catch the moment the two copies drifted, which is the wrong shape for data: a list that must be
// identical in two places should live in one. (`HOOKS_CATALOG` and `MCPS_CATALOG` are not a seventh
// and eighth list: each twin copies HOOKS / MCPS into them before the selection filter narrows the
// originals, so they are derived and stay derived.)
//
// `meta/stack-manifest.json` is that place. This file is the gate on the move: it reads the two
// twins the way the lint reads them and asserts the JSON says exactly the same thing. It fails
// while the JSON is missing, which is the point - it is written before the JSON is.
//
// The twins are FROZEN from this commit, not deleted (Phase 7's R1: no Windows machine here, and
// `pwsh` on macOS proves PowerShell syntax, never Windows path semantics). They read the JSON, so
// there is nothing left for a parity check to police even while both files exist.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const MANIFEST = path.join(ROOT, 'meta', 'stack-manifest.json');

// The twins' own block spellings. sh uses NAME=( ... ) with single quotes; ps1 uses $Name = @( ... )
// with the same quoting, and both close on a line that is just the terminator.
// Each row names itself differently per list, so `id` says which JSON field IS the name and the
// twin side takes the first '|'-separated field, which is the same thing in every block.
const BLOCKS = [
    { key: 'skills', sh: 'SKILLS=(', ps1: '$Skills = @(', id: (r) => `${r.repo}|${r.name}`, twin: (v) => v },
    { key: 'agents', sh: 'AGENTS=(', ps1: '$Agents = @(', id: (r) => r.file, twin: (v) => v },
    { key: 'rules', sh: 'CLAUDE_RULES=(', ps1: '$ClaudeRules = @(', id: (r) => r.file, twin: (v) => v },
    { key: 'plugins', sh: 'PLUGINS=(', ps1: '$Plugins = @(', id: (r) => r.id, twin: (v) => v },
    // The sh writes its two computed rows QUOTED ("$MEMORY_ENTRY"), the ps1 writes every row
    // unquoted, so the mapper resolves a leading '$' either way before taking the name.
    { key: 'mcps', sh: 'MCPS=(', ps1: '$Mcps = @(', id: (r) => r.name,
        twin: (v) => (v.startsWith('$') ? (ENTRY_VARS[v.slice(1)] ?? v) : v.split('|')[0]) },
];

// The MCP rows are written as variables in one twin or both, so the twin side resolves a bare
// `$Name` back to the server it stands for - the same map the generator uses, for the same reason.
const ENTRY_VARS = {
    MEMORY_ENTRY: 'memory', CONTEXT7_ENTRY: 'context7',
    AngularCliEntry: 'angular-cli', SerenaEntry: 'serena', PlaywrightEntry: 'playwright',
    ChromeDevtoolsEntry: 'chrome-devtools', AppiumMcpEntry: 'appium-mcp', SentryEntry: 'sentry',
    MemoryEntry: 'memory', Context7Entry: 'context7',
};

// One reader for both languages: take the lines between the block opener and its terminator, keep
// the quoted payload, and remember whether the row was commented out - a commented row is a
// deliberate 'shipped but not seeded' marker, so it has to survive the move as one. The two twins
// quote differently (sh double, ps1 single), which is exactly the kind of accident that makes a
// hand-kept copy drift, so the reader takes the quote character as an argument.
function readBlock(file, opener, quote)
{
    const rows = [];
    const entry = new RegExp(`^\\s*(#?)\\s*${quote}([^${quote}]+)${quote}`);
    let inBlock = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n'))
    {
        if (!inBlock)
        {
            inBlock = line.trimEnd().endsWith(opener);
            continue;
        }
        if (line.trim() === ')') break;
        const m = line.match(entry);
        if (m) { rows.push({ value: m[2], active: m[1] !== '#' }); continue; }
        const v = line.match(/^\s*(#?)\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:#.*)?$/);
        if (v) rows.push({ value: ENTRY_VARS[v[2]] ?? `$${v[2]}`, active: v[1] !== '#' });
    }
    return rows;
}

const shBlock = (opener) => readBlock(SH, opener, '"');
const ps1Block = (opener) => readBlock(PS1, opener, "'");
const activeValues = (rows) => rows.filter((r) => r.active).map((r) => r.value).sort();

test('stack-manifest: the file exists - the two twins stop being its home', () =>
{
    assert.ok(fs.existsSync(MANIFEST),
        'meta/stack-manifest.json is missing: the eight lists still live inline in both twins');
    const parsed = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const key of ['skills', 'agents', 'rules', 'hooks', 'plugins', 'mcps'])
        assert.ok(Array.isArray(parsed[key]) || (parsed[key] && typeof parsed[key] === 'object'),
            `stack-manifest: the '${key}' list is missing`);
});

for (const block of BLOCKS)
{
    const fromJson = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))[block.key]
        .filter((r) => r.active !== false).map(block.id).sort();

    test(`stack-manifest: '${block.key}' says what the sh twin declares`, () =>
    {
        assert.deepStrictEqual(fromJson(), activeValues(shBlock(block.sh)).map(block.twin).sort(),
            `stack-manifest: '${block.key}' and the sh twin disagree`);
    });

    test(`stack-manifest: '${block.key}' says what the ps1 twin declares`, () =>
    {
        assert.deepStrictEqual(fromJson(), activeValues(ps1Block(block.ps1)).map(block.twin).sort(),
            `stack-manifest: '${block.key}' and the ps1 twin disagree`);
    });
}

test('stack-manifest: a commented row survives the move as a commented row', () =>
{
    // 'shipped but not seeded' is a real state - an MCP server in the catalog that no stack seeds,
    // a plugin parked for a release. Flattening it to 'absent' would silently drop the item from
    // the catalog the guided walk offers, which is a different install, not a smaller file.
    const parsed = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const shCommented = shBlock('PLUGINS=(').filter((r) => !r.active).map((r) => r.value).sort();
    const jsonInactive = (parsed.plugins || []).filter((r) => r.active === false).map((r) => r.id).sort();
    assert.deepStrictEqual(jsonInactive, shCommented,
        'stack-manifest: the commented catalog rows did not survive the move');
});

// The twins KEEP their inline copies, and that is deliberate.
//
// A downloaded `claude-stack.sh` is self-contained on purpose - the README tells a user to keep it
// in `.claude/` as 'the per-project manifest you trim and re-run', and the lists are read before the
// run has resolved any source snapshot to read a JSON file out of. Pointing the twins at
// `meta/stack-manifest.json` would make the standalone script depend on a file it does not have yet,
// which is a worse failure than the duplication it removes.
//
// So the JSON is ADDITIVE here: the Node seed reads it, the twins keep frozen copies, and the twins
// are deleted in Phase 7b with their copies. Drift cannot creep back in the meantime, because
// `build-manifest` regenerates the JSON from the sh twin and refuses when the ps1 disagrees - which
// is what this test runs.
test('stack-manifest: the JSON, the sh twin and the ps1 twin all still say the same thing', () =>
{
    const { build } = require('./build-manifest.js');
    const { manifest, problems } = build();
    assert.deepStrictEqual(problems, [], `build-manifest found a disagreement between the twins: ${problems.join(' | ')}`);
    const onDisk = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    assert.deepStrictEqual(manifest, onDisk,
        'meta/stack-manifest.json is STALE - regenerate it with `node scripts/build-manifest.js --write`');
});
