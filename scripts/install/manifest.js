'use strict';
// THE MANIFEST - the six lists, read from meta/stack-manifest.json.
//
// The JSON is generated FROM the sh twin and refuses to build when the ps1 disagrees (T0), so it is
// the same data all three carry. This loader renders it back into the exact entry SPELLINGS the
// shell uses - `repo|name`, `file.js::matcher::event`, `name|args`, `plugin@marketplace` - for one
// reason: every layer of this seed parses those spellings, and so does the twin it replaces, so a
// behaviour is read off one shape rather than two. `scripts/install-manifest.test.js` pins the
// rendering against what `build-manifest.js` parses out of the twin.
//
// A row carrying `active: false` is SHIPPED BUT NOT SEEDED - a real state, not an absence. It stays
// in the catalog (a stamp and an `--installed-only` derivation both need to know the release ships
// it) and out of the default selection.
//
// Two catalogs are kept UNFILTERED: hooks and mcps as SHIPPED. The selection narrows the live lists,
// and the retirement passes have to name every hook and server the stack ever wrote - including the
// ones this run did not pick.
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = path.join('meta', 'stack-manifest.json');

const renderHook = (row) => `${row.file}::${row.matcher || ''}::${row.event || ''}`;
const renderSkill = (row) => `${row.repo}|${row.name}`;
const renderMcp = (row) => `${row.name}|${row.args}`;

function loadManifest(sourceDir)
{
    const file = path.join(sourceDir, MANIFEST);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const active = (rows) => (rows || []).filter((r) => r.active !== false);

    return {
        skills: active(raw.skills).map(renderSkill),
        agents: active(raw.agents).map((r) => r.file),
        rules: active(raw.rules).map((r) => r.file),
        hooks: active(raw.hooks).map(renderHook),
        plugins: active(raw.plugins).map((r) => r.id),
        mcps: active(raw.mcps).map(renderMcp),
        // As SHIPPED - never narrowed by a selection.
        catalogs: {
            hooks: (raw.hooks || []).map(renderHook),
            mcps: (raw.mcps || []).map(renderMcp),
            plugins: (raw.plugins || []).map((r) => r.id),
            skills: (raw.skills || []).map(renderSkill),
        },
        rows: raw,
    };
}

module.exports = { loadManifest, renderHook, renderSkill, renderMcp, MANIFEST };
