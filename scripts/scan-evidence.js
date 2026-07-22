#!/usr/bin/env node
// Deterministic evidence scan (Component A of the evidence layer): read the project's
// package manifests and catalog-named files, match them against the signal definitions in
// setup-plugin/references/evidence.json, and emit the `found` map the selection engine and
// the guided commands consume. Text over checked-in files only - no restore, no network.
// The conclusions are computed per run; the catalog ships only signal DEFINITIONS.
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.serena', '.claude']);
const MAX_DEPTH = 6;
const MAX_CONTENT_BYTES = 512 * 1024;
const LAYERS = ['skills', 'mcps', 'plugins'];

function walk(root)
{
    const files = [];
    (function rec(dir, depth)
    {
        if (depth > MAX_DEPTH) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries)
        {
            if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(path.join(dir, e.name), depth + 1); }
            else files.push(path.join(dir, e.name));
        }
    })(root, 0);
    return files.sort();
}

function readCapped(file)
{
    try
    {
        if (fs.statSync(file).size > MAX_CONTENT_BYTES) return null;
        return fs.readFileSync(file, 'utf8');
    }
    catch { return null; }
}

// A trailing '.' (NuGet namespace) or '/' (npm scope) marks a prefix; anything else is exact.
function matchesPackage(signal, pkg)
{
    return signal.endsWith('.') || signal.endsWith('/') ? pkg.startsWith(signal) : pkg === signal;
}

// Basename glob with '*' only (the catalog's file/content globs are basename patterns).
function basenameMatches(glob, file)
{
    const pattern = glob.replace(/^\*\*\//, '');
    const re = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(path.basename(file));
}

function isDotnetManifest(file)
{
    const base = path.basename(file);
    return base.endsWith('.csproj') || base === 'Directory.Build.props' || base === 'Directory.Packages.props';
}

// Ordered [{pkg, rel}] across every manifest - first catalog match wins, so order is stable.
function collectPackages(root, files)
{
    const out = [];
    for (const file of files)
    {
        const rel = path.relative(root, file);
        if (isDotnetManifest(file))
        {
            const text = readCapped(file);
            if (text === null) continue;
            for (const m of text.matchAll(/<(?:PackageReference|PackageVersion)\s[^>]*Include="([^"]+)"/g)) out.push({ pkg: m[1], rel });
        }
        else if (path.basename(file) === 'package.json')
        {
            const text = readCapped(file);
            if (text === null) continue;
            let json;
            try { json = JSON.parse(text); }
            catch { continue; }
            for (const section of ['dependencies', 'devDependencies'])
            {
                for (const pkg of Object.keys(json[section] || {})) out.push({ pkg, rel });
            }
        }
    }
    return out;
}

function scan(root, catalog)
{
    const files = walk(root);
    const packages = collectPackages(root, files);
    const dotnetManifests = files.filter(isDotnetManifest);

    const found = { skills: {}, mcps: {}, plugins: {} };
    for (const layer of LAYERS)
    {
        for (const [name, entry] of Object.entries(catalog[layer] || {}))
        {
            let hit = null;
            for (const signal of entry.packages || [])
            {
                const p = packages.find(x => matchesPackage(signal, x.pkg));
                if (p) { hit = `${p.pkg} in ${p.rel}`; break; }
            }
            if (!hit) for (const glob of entry.files || [])
            {
                const f = files.find(x => basenameMatches(glob, x));
                if (f) { hit = `${path.relative(root, f)} present`; break; }
            }
            if (!hit) for (const c of entry.csprojContent || [])
            {
                const re = new RegExp(c.regex);
                const f = dotnetManifests.find(x => { const t = readCapped(x); return t !== null && re.test(t); });
                if (f) { hit = `${c.label || c.regex} in ${path.relative(root, f)}`; break; }
            }
            if (!hit) for (const c of entry.content || [])
            {
                const re = new RegExp(c.regex);
                const f = files.find(x => basenameMatches(c.glob, x) && (t => t !== null && re.test(t))(readCapped(x)));
                if (f) { hit = `${c.label || c.regex} in ${path.relative(root, f)}`; break; }
            }
            if (hit) found[layer][name] = hit;
        }
    }
    return found;
}

function main(argv)
{
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
    const root = arg('--root');
    const catalogPath = arg('--catalog');
    if (!root || !catalogPath) { console.error('usage: scan-evidence.js --root <project> --catalog <evidence.json> [--out <file>]'); process.exit(2); }
    let catalog;
    try { catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); }
    catch (e) { console.error(`scan-evidence: cannot read catalog ${catalogPath}: ${e.code || e.message}`); process.exit(1); }
    if (!fs.existsSync(root)) { console.error(`scan-evidence: no such root ${root}`); process.exit(1); }

    const result = JSON.stringify({ found: scan(root, catalog) }, null, 2);
    const out = arg('--out');
    if (out) fs.writeFileSync(out, result);
    else process.stdout.write(result + '\n');
}

module.exports = { scan, matchesPackage, basenameMatches };

if (require.main === module) main(process.argv.slice(2));
