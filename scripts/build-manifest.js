'use strict';
// THE STACK MANIFEST, generated once out of the shell twin and read by everything after.
//
// The six lists the installers work from were declared inline in BOTH twins - about 273 lines each,
// kept identical by hand and policed by four lint checks whose whole job was to notice when the
// hand slipped. This script performs the move: it reads the blocks out of `claude-stack.sh`,
// verifies the `.ps1` says exactly the same thing, and writes `meta/stack-manifest.json`.
//
//   node scripts/build-manifest.js            # report what it would write, write nothing
//   node scripts/build-manifest.js --write    # write meta/stack-manifest.json
//
// It is a ONE-TIME extraction, kept in the tree because a reviewer has to be able to re-run it and
// get the same bytes. After Phase 7 the JSON is edited directly and this script only ever proves
// that the frozen twins still agree with it.
//
// Two spellings survive the move deliberately:
//   - a row's trailing `# comment` becomes `note`. It is how a maintainer decides whether to switch
//     a row off, so dropping it would make the JSON smaller and the decision harder.
//   - a COMMENTED row becomes `active: false` rather than disappearing. 'Shipped but not seeded' is
//     a real state - an MCP server no stack seeds, a plugin parked for a release - and flattening it
//     to absent would quietly shrink the catalog the guided walk offers.
//
// And one is rewritten: an install-time shell variable (`${SERENA_PIN}`, `${PW_PIN}`) becomes the
// `@SERENA_PIN@` placeholder the argv resolver already understands, because JSON has no `$`
// expansion and inventing one would be a second mechanism for a job that has one. A LITERAL
// `\${CLAUDE_PROJECT_DIR}` - escaped in the shell precisely so it reaches `.mcp.json` unexpanded -
// loses only its backslash and stays literal.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
const OUT = path.join(ROOT, 'meta', 'stack-manifest.json');

const BLOCKS = [
    { key: 'skills', sh: 'SKILLS=(', ps1: '$Skills = @(', fields: ['repo', 'name'] },
    { key: 'agents', sh: 'AGENTS=(', ps1: '$Agents = @(', fields: ['file'] },
    { key: 'rules', sh: 'CLAUDE_RULES=(', ps1: '$ClaudeRules = @(', fields: ['file'] },
    { key: 'hooks', sh: 'HOOKS=(', ps1: '$Hooks = @(', fields: ['file', 'matcher', 'event'], sep: '::' },
    { key: 'plugins', sh: 'PLUGINS=(', ps1: '$Plugins = @(', fields: ['id'] },
    { key: 'mcps', sh: 'MCPS=(', ps1: '$Mcps = @(', fields: ['name', 'args'] },
];

// The install-time variables. Anything NOT on this list that arrives as `${...}` is a literal bound
// for .mcp.json, and an unknown one is an error rather than a guess - a silently mis-classified
// variable is a server that launches with a broken argument.
const INSTALL_TIME = new Set(['SERENA_PIN', 'PW_PIN', 'CTX7_PIN', 'MEMORY_PIN', 'MEMORY_BACKEND']);

// Two MCP rows are not literals in either twin: the sh writes `$MEMORY_ENTRY` / `$CONTEXT7_ENTRY`
// and the ps1 writes every row as a variable. They are not data that can be flattened either -
// memory's spec carries the level's db path, and context7 has two transports. So they keep the
// @PLACEHOLDER@ shape the argv resolver already understands, and context7 carries both transports
// as `variants` with the run picking one. That is one substitution mechanism, not a second.
const SH_ENTRY_VAR = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

function resolveShEntry(name, src)
{
    const m = src.match(new RegExp(`^${name}="([^"]*)"`, 'm'));
    if (!m) throw new Error(`mcps: '$${name}' has no assignment in the sh twin to resolve it from`);
    return m[1];
}

function context7Variants(src)
{
    const local = src.match(/^\s*CONTEXT7_SPEC="(-- npx[^"]*)"/m);
    if (!local) throw new Error('mcps: the context7 local transport could not be read from the sh twin');
    return { remote: '@HTTP@', local: normalize(local[1], 'context7 local transport') };
}

function readBlock(file, opener, quote)
{
    const rows = [];
    const entry = new RegExp(`^\\s*(#?)\\s*${quote}([^${quote}]+)${quote}\\s*(?:#\\s*(.*))?$`);
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
        if (m) { rows.push({ value: m[2], active: m[1] !== '#', note: (m[3] || '').trim() }); continue; }
        // A row can also be a bare variable reference - the ps1 writes EVERY MCP row that way, and
        // the sh writes the two computed ones. Unquoted, so the quoted pattern above never sees it.
        const v = line.match(/^\s*(#?)\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:#\s*(.*))?$/);
        if (v) rows.push({ value: `$${v[2]}`, active: v[1] !== '#', note: (v[3] || '').trim() });
    }
    return rows;
}

// `\${FOO}` in the shell is a literal the run must NOT expand; `${FOO}` is one it must. The JSON
// carries no backslashes, so the two are told apart here, once, and never again.
function normalize(value, where)
{
    const braced = value.replace(/(\\?)\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g, (full, esc, name, dflt) =>
    {
        if (esc) return `\${${name}${dflt || ''}}`;          // escaped: stays a literal
        if (INSTALL_TIME.has(name)) return `@${name}@`;       // resolved by the argv resolver
        if (dflt) return `\${${name}${dflt}}`;                // a default means .mcp.json expansion
        throw new Error(`${where}: '\${${name}}' is neither an install-time pin nor an escaped literal - classify it in INSTALL_TIME or escape it`);
    });
    // The shell also writes an install-time variable UNBRACED where nothing follows it that could
    // extend the name (`=$MEMORY_BACKEND `). Same classification, same placeholder - a bare name
    // left alone here would ship a literal '$MEMORY_BACKEND' into a registration.
    return braced.replace(/(^|[^\\$])\$([A-Za-z_][A-Za-z0-9_]*)/g, (full, pre, name) =>
        (INSTALL_TIME.has(name) ? `${pre}@${name}@` : full));
}

function rowToObject(row, block, src)
{
    const v = row.value.match(SH_ENTRY_VAR);
    const raw = v ? resolveShEntry(v[1], src) : row.value;
    const value = normalize(raw, `${block.key} row '${raw.slice(0, 40)}'`);
    const parts = block.sep ? value.split(block.sep) : value.split('|');
    const out = {};
    // A field list shorter than the row means the LAST field keeps the remainder: an MCP's args
    // carry '|' inside them, and splitting those apart would be a different manifest.
    block.fields.forEach((field, i) =>
    {
        out[field] = i === block.fields.length - 1 && !block.sep
            ? parts.slice(i).join('|')
            : (parts[i] ?? '');
    });
    if (block.key === 'skills') out.name = parts.slice(1).join('|');
    // context7's spec IS the transport choice, so the row carries both and the run picks one.
    // Flattening it to the default would make `--context7 local` a code path with no data behind it.
    if (out.name === 'context7' && out.args === '$CONTEXT7_SPEC')
    {
        out.args = '@CONTEXT7_SPEC@';
        out.variants = context7Variants(src);
    }
    if (!row.active) out.active = false;
    if (row.note) out.note = row.note;
    return out;
}

// One RETIRED_* array in either twin: a one-line list, or a block with a comment per row.
function retiredList(file, opener, quote)
{
    const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(opener));
    if (!line) throw new Error(`retired: '${opener}' not found in ${path.basename(file)}`);
    const rest = line.slice(opener.length);
    if (!rest.includes(')')) return readBlock(file, opener, quote).filter((r) => r.active).map((r) => r.value);
    const body = rest.slice(0, rest.indexOf(')'));
    return quote === "'"
        ? [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
        : body.split(/\s+/).filter(Boolean).map((v) => v.replace(/^"|"$/g, ''));
}

const RETIRED = [['skills', 'SKILLS', 'Skills'], ['agents', 'AGENTS', 'Agents'], ['rules', 'RULES', 'Rules'],
    ['hooks', 'HOOKS', 'Hooks'], ['mcps', 'MCPS', 'Mcps'], ['plugins', 'PLUGINS', 'Plugins']];

function build()
{
    const SH_SRC = fs.readFileSync(SH, 'utf8');
    const manifest = {
        generatedBy: 'build-manifest',
        note: 'The six lists both installers work from. Edited HERE, never in the twins - they read this file. `node scripts/build-manifest.js --write` regenerates it from the shell twin while the twins still carry the blocks, and proves the two agree either way.',
    };
    const problems = [];
    for (const block of BLOCKS)
    {
        const sh = readBlock(SH, block.sh, '"');
        const ps1 = readBlock(PS1, block.ps1, "'");
        // Both twins write some rows as a variable reference, so compare by NAME - the one thing
        // every spelling agrees on, and the only field a drift between the two could hide.
        const nameOf = (value, src, varMap) =>
        {
            const v = value.match(SH_ENTRY_VAR);
            if (!v) return value.split(block.sep || '|')[0];
            return varMap[v[1]] ?? v[1];
        };
        const shVars = { MEMORY_ENTRY: 'memory', CONTEXT7_ENTRY: 'context7' };
        const ps1Vars = { AngularCliEntry: 'angular-cli', SerenaEntry: 'serena', PlaywrightEntry: 'playwright',
            ChromeDevtoolsEntry: 'chrome-devtools', AppiumMcpEntry: 'appium-mcp', SentryEntry: 'sentry',
            MemoryEntry: 'memory', Context7Entry: 'context7' };
        const shActive = sh.filter((r) => r.active).map((r) => nameOf(r.value, SH, shVars)).sort();
        const ps1Active = ps1.filter((r) => r.active).map((r) => nameOf(r.value, PS1, ps1Vars)).sort();
        if (JSON.stringify(shActive) !== JSON.stringify(ps1Active))
        {
            const onlySh = shActive.filter((v) => !ps1Active.includes(v));
            const onlyPs1 = ps1Active.filter((v) => !shActive.includes(v));
            problems.push(`${block.key}: the twins disagree before the move - only in sh: ${onlySh.join(', ') || 'none'}; only in ps1: ${onlyPs1.join(', ') || 'none'}`);
        }
        if (!sh.length) problems.push(`${block.key}: the sh block '${block.sh}' read zero rows`);
        manifest[block.key] = sh.map((r) => rowToObject(r, block, SH_SRC));
    }
    // A plugin from a marketplace that is neither the official one nor this repo installs only once
    // that marketplace is registered. The twins keep the sources in a block of their own; the manifest
    // carries each on the plugin rows it serves, which is what the seed reads. A marketplace is named
    // in its own marketplace.json - claude-hud's matches its repo name - so a source serving no row
    // is reported rather than silently dropped.
    const shSources = readBlock(SH, 'EXTRA_MARKETPLACES=(', '"').filter((r) => r.active).map((r) => r.value);
    const ps1Sources = readBlock(PS1, '$ExtraMarketplaces = @(', "'").filter((r) => r.active).map((r) => r.value);
    if (JSON.stringify([...shSources].sort()) !== JSON.stringify([...ps1Sources].sort()))
        problems.push(`marketplaces: the twins disagree - sh: ${shSources.join(', ') || 'none'}; ps1: ${ps1Sources.join(', ') || 'none'}`);
    for (const source of shSources)
    {
        const served = manifest.plugins.filter((r) => r.id.endsWith(`@${source.split('/').pop()}`));
        if (!served.length) problems.push(`marketplaces: ${source} serves no plugin row`);
        for (const row of served) row.marketplace = source;
    }
    // The names a release RETIRED, which a run prunes from a project that still carries them.
    manifest.retired = {};
    for (const [key, sh, ps1] of RETIRED)
    {
        const fromSh = retiredList(SH, `RETIRED_${sh}=(`, '"');
        const fromPs1 = retiredList(PS1, `$Retired${ps1} = @(`, "'");
        if (JSON.stringify([...fromSh].sort()) !== JSON.stringify([...fromPs1].sort()))
            problems.push(`retired ${key}: the twins disagree - sh: ${fromSh.join(', ') || 'none'}; ps1: ${fromPs1.join(', ') || 'none'}`);
        manifest.retired[key] = fromSh;
    }
    return { manifest, problems };
}

if (require.main === module)
{
    let result;
    try { result = build(); }
    catch (err) { process.stderr.write(`build-manifest: ${err.message}\n`); process.exit(1); }
    const { manifest, problems } = result;
    for (const p of problems) process.stderr.write(`build-manifest: ${p}\n`);
    for (const block of BLOCKS)
    {
        const rows = manifest[block.key];
        const off = rows.filter((r) => r.active === false).length;
        process.stdout.write(`  ${block.key.padEnd(8)} ${String(rows.length).padStart(3)} rows${off ? ` (${off} switched off)` : ''}\n`);
    }
    if (problems.length) process.exit(1);
    if (process.argv.includes('--write'))
    {
        fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
        process.stdout.write(`build-manifest: wrote ${path.relative(ROOT, OUT)}\n`);
    }
    else process.stdout.write('build-manifest: clean (pass --write to write the file)\n');
}

module.exports = { build, readBlock, normalize, BLOCKS };
