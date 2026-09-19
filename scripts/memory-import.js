#!/usr/bin/env node
'use strict';
// One-time import: Claude Code's own per-project auto-memory notes (~/.claude/projects/<slug>/memory/
// *.md, one file per note plus an index MEMORY.md) into the shared `memory` MCP, so a project can
// switch Claude's own memory off without losing what it already learned. Read-only against every
// source notes folder - it is never written to.
//
// Usage: node scripts/memory-import.js --project-root <root> [--config-dir <dir>] [--memory-dir <dir>]
//
// The server is spawned EXACTLY as the `memory` entry registers it: read command/args/env from
// <root>/.mcp.json, else the account's registration file (final review A, I1: the DEFAULT
// account's file is `$HOME/.claude.json` - a sibling of the `.claude` dir, never inside it; only an
// explicit `--config-dir` or a live `CLAUDE_CONFIG_DIR` moves it to `<dir>/.claude.json`).
//
// `--memory-dir` pins a single explicit notes folder (tests, or a caller that already knows the
// answer) and skips everything below. Left out, the importer AUTODETECTS every notes folder that
// could hold this project's notes and imports all of them in one pass, tagging every note the same
// way regardless of which one it came from (final review A, I7):
//   - the settings-chain `autoMemoryDirectory` override, read from <project>/.claude/settings.local.json,
//     then <project>/.claude/settings.json, then the primary account's settings.json (most specific
//     wins) - an absolute or `~/`-relative path that replaces the computed folder outright;
//   - the primary account's own computed folder: `<configDir>/projects/<name>/memory`, where <name> is
//     `CLAUDE_CODE_PROJECT_DIR_NAME` ONLY when the live `CLAUDE_CONFIG_DIR` env var is also set (Claude
//     Code itself ignores that variable otherwise - FACT-AUTOMEM), else the slugified git top level;
//   - every OTHER account dir on the machine found the same way: `$HOME/.claude`, every `$HOME/.claude-*`,
//     and a live `CLAUDE_CONFIG_DIR` if one is set - so a second Claude account, or a `--space` install,
//     is never skipped;
//   - re-review (final-review-A.md, 'I7's wrong-folder guard'): every account dir's `projects/*/`
//     folder NOT already covered above, whose own transcript's `cwd` (read line by line, stopping at
//     the first line that carries one, bounded per file) names this project's main checkout or one of
//     its worktrees - its `memory/` folder is added too, if it exists. This catches a note filed under
//     a name the slug rule missed. A folder with sessions but no notes is the NORMAL case (measured:
//     210 of 212 real project folders on one machine), never a failure.
// The git top level is the MAIN repo's directory, never a worktree's own directory (worktrees share one
// auto-memory folder) and never a submodule's `.git/modules/<name>` common dir (falls back to
// `--show-toplevel`, which for a submodule is that submodule's own root).
//
// No notes anywhere, direct or through a transcript, is always 'nothing to import', exit 0 - never a
// failure. `--memory-dir` skips all of the above - an explicit answer is never second-guessed.
//
// Idempotence: PRIMARILY a read-only node:sqlite precheck against the registration's own
// MCP_MEMORY_SQLITE_PATH, for a live row (`deleted_at IS NULL`) holding the exact same content - skips
// the store call outright on a hit. SECOND line, only for notes the precheck did not resolve
// (node:sqlite unavailable below Node 22.13, the db file not created yet, or the registration's env
// carries no MCP_MEMORY_SQLITE_PATH): the memory MCP's OWN duplicate-content detection, read from the
// store response text. final review A, M1: every store call also carries its own `conversation_id`
// (the documented bypass for the server's semantic-similarity dedup, FACT-TOOLS), so two genuinely
// distinct notes are never collapsed as 'too similar' to each other or to something imported earlier -
// idempotence for a genuine re-import stays on the db precheck (and, second line, the response text).
//
// Kind mapping (note frontmatter type -> memory_type, read from metadata.type or a top-level type key -
// real notes on this machine carry it nested under metadata.type). The mcp-memory-service server's own
// BUILT-IN ontology subtypes are used (fix round 1 ruling) rather than registering
// MCP_CUSTOM_MEMORY_TYPES, so the import works against any registration with no JSON to quote through
// two installer twins:
//   user -> preference_signal, feedback -> user_correction, project/reference/anything else
//   (including missing) -> reference.
// Tags: the note's own `name` (frontmatter `name`, else the filename without its extension; commas
// stripped) plus, for every kind EXCEPT `user`, `project:<name>` (name = basename of the git top-level
// dir, commas stripped). final review A, M2: a `user` note describes the PERSON, not the project - it
// is imported with no project tag at all, so it reads back as a global preference. Content: the
// frontmatter `description` as the first line, then the body (every `\r` stripped from the body).
// MEMORY.md is the index, never imported.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const CALL_TIMEOUT_MS = 30000;
// final review A, I6: FACT-EMBED measured a 41.3s cold first launch (wheels plus the 166MB ONNX
// model) - well past the old 30s. `initialize` alone gets the longer budget; the overall 5-minute cap
// (which bounds the whole run, initialize included) is unchanged.
const INIT_TIMEOUT_MS = 180000;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

const KIND_MAP = {
    user: 'preference_signal',
    feedback: 'user_correction',
    project: 'reference',
    reference: 'reference',
};

function mapKind(rawType)
{
    return KIND_MAP[rawType] || 'reference';
}

function parseArgs(argv)
{
    const out = { projectRoot: null, configDir: null, memoryDir: null };
    for (let i = 0; i < argv.length; i++)
    {
        const a = argv[i];
        if (a === '--project-root') out.projectRoot = argv[++i];
        else if (a === '--config-dir') out.configDir = argv[++i];
        else if (a === '--memory-dir') out.memoryDir = argv[++i];
        else throw new Error(`unrecognized argument '${a}'`);
    }
    return out;
}

function defaultConfigDir()
{
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// The main repo root for this working tree - a worktree's own directory shares its parent repo's
// auto-memory folder, so the slug always names the MAIN checkout, never the worktree path. Final
// review A, I7: a submodule's common dir is `<super>/.git/modules/<name>` - basename `<name>`, not
// `.git` - which is NOT a project root (it lives inside the superproject's own `.git`), so that shape
// falls back to `--show-toplevel` (the submodule's own working-tree root) instead.
function gitTopLevel(projectRoot)
{
    try
    {
        const commonDir = execFileSync(
            'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        if (commonDir && path.basename(commonDir) === '.git') return path.dirname(commonDir);
    }
    catch (e) { /* not a git repo, or git missing - fall through to --show-toplevel */ }
    try
    {
        const top = execFileSync(
            'git', ['rev-parse', '--show-toplevel'],
            { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        if (top) return top;
    }
    catch (e) { /* not a git repo, or git missing - fall through to projectRoot itself */ }
    return projectRoot;
}

// Claude Code's own docs (context7 /websites/code_claude, "Where transcripts are stored") state the
// rule plainly - every non-alphanumeric character is replaced by '-', not just path separators.
function slugify(absPath)
{
    return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function readJsonSafe(file)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return null; }
}

function expandTilde(p, home)
{
    if (typeof p !== 'string' || !p) return p;
    if (p === '~') return home;
    if (p.startsWith('~/') || p.startsWith(`~${path.sep}`)) return path.join(home, p.slice(2));
    return p;
}

// final review A, I7: `autoMemoryDirectory` can override the notes folder outright (absolute or
// `~/`-relative). Read from the same settings chain Claude Code itself reads, most specific first;
// `configDir` here is the PRIMARY account (the one `--config-dir` / `CLAUDE_CONFIG_DIR` names, else the
// default `$HOME/.claude`) - the override is a property of this launch's configuration, not of any one
// sibling account being scanned.
function readSettingsAutoMemoryDirectory(projectRoot, configDir, home)
{
    const candidates = [
        path.join(projectRoot, '.claude', 'settings.local.json'),
        path.join(projectRoot, '.claude', 'settings.json'),
        path.join(configDir, 'settings.json'),
    ];
    for (const file of candidates)
    {
        const data = readJsonSafe(file);
        const v = data && typeof data.autoMemoryDirectory === 'string' ? data.autoMemoryDirectory.trim() : '';
        if (v) return expandTilde(v, home);
    }
    return null;
}

// The computed default notes folder for ONE account dir: `CLAUDE_CODE_PROJECT_DIR_NAME` names it
// literally, but ONLY when the live `CLAUDE_CONFIG_DIR` env var equals this exact configDir - Claude
// Code ignores that variable when `CLAUDE_CONFIG_DIR` is unset (FACT-AUTOMEM), and a name meant for one
// account must never leak into another account's folder.
function slugMemoryDir(projectRoot, configDir, home)
{
    const resolvedConfigDir = path.resolve(configDir);
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : null;
    const dirName = (envConfigDir && envConfigDir === resolvedConfigDir && process.env.CLAUDE_CODE_PROJECT_DIR_NAME)
        ? process.env.CLAUDE_CODE_PROJECT_DIR_NAME
        : slugify(gitTopLevel(projectRoot));
    return path.join(configDir, 'projects', dirName, 'memory');
}

// The primary account's own computed notes folder - settings override first, else the slug rule. Kept
// as its own function (used directly by tests, and as the first entry the full scan builds from).
function defaultMemoryDir(projectRoot, configDir, home = os.homedir())
{
    const override = readSettingsAutoMemoryDirectory(projectRoot, configDir, home);
    if (override) return override;
    return slugMemoryDir(projectRoot, configDir, home);
}

// final review A, I7: every account dir on the machine that could hold this project's notes -
// the explicit --config-dir / CLAUDE_CONFIG_DIR (already the primary), $HOME/.claude, and every
// $HOME/.claude-<space> sibling. Order is stable but not meaningful - the caller dedupes.
function accountConfigDirs(home, explicitConfigDir)
{
    const set = new Set();
    const add = (d) => { if (d) set.add(path.resolve(d)); };
    add(explicitConfigDir);
    if (process.env.CLAUDE_CONFIG_DIR) add(process.env.CLAUDE_CONFIG_DIR);
    add(path.join(home, '.claude'));
    let entries = [];
    try { entries = fs.readdirSync(home, { withFileTypes: true }); }
    catch (e) { entries = []; }
    for (const e of entries)
    {
        if (e.isDirectory() && e.name.startsWith('.claude-')) add(path.join(home, e.name));
    }
    return Array.from(set);
}

// Re-review (final-review-A.md, 'I7's wrong-folder guard'): a real transcript's `cwd` is almost never
// on line 1 (measured: 0 of 298 real transcripts on one machine - line 1 is `ai-title` / `last-prompt`
// / `queue-operation` / `mode` / `custom-title`). Reads line by line instead, stopping at the first
// line that carries a `cwd` field, bounded to 512KB per file so one giant transcript never dominates
// the scan - cheap because it stops the moment it finds what it is looking for, and a plain substring
// check skips JSON.parse on every line that plainly has no `cwd`.
const TRANSCRIPT_SCAN_CAP_BYTES = 512 * 1024;

function findCwdInTranscript(file)
{
    let fd;
    try { fd = fs.openSync(file, 'r'); }
    catch (e) { return null; }
    try
    {
        let leftover = '';
        let readTotal = 0;
        const chunk = Buffer.alloc(65536);
        for (;;)
        {
            const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, readTotal);
            if (bytesRead === 0) break; // EOF
            readTotal += bytesRead;
            leftover += chunk.toString('utf8', 0, bytesRead);
            let nlIdx;
            while ((nlIdx = leftover.indexOf('\n')) !== -1)
            {
                const line = leftover.slice(0, nlIdx);
                leftover = leftover.slice(nlIdx + 1);
                if (line.indexOf('"cwd"') === -1) continue;
                try
                {
                    const obj = JSON.parse(line);
                    if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
                }
                catch (e) { /* not a clean JSON line - keep scanning */ }
            }
            if (readTotal >= TRANSCRIPT_SCAN_CAP_BYTES) return null;
        }
        if (leftover.indexOf('"cwd"') !== -1)
        {
            try
            {
                const obj = JSON.parse(leftover);
                if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
            }
            catch (e) { /* trailing partial line - ignore */ }
        }
        return null;
    }
    catch (e) { return null; }
    finally { try { fs.closeSync(fd); } catch (e) { /* already closed */ } }
}

// A transcript's own `cwd` matches THIS project when it names the same main checkout - gitTopLevel
// collapses any worktree of the same repo to that one root, so 'this project root or a worktree of
// it' is a single comparison.
function transcriptCwdMatchesProject(cwd, mainRootReal)
{
    const top = gitTopLevel(cwd);
    let topReal;
    try { topReal = fs.realpathSync(top); } catch (e) { topReal = path.resolve(top); }
    return topReal === mainRootReal;
}

// Re-review, I7 (binding ruling): 'sessions but no notes' is the NORMAL case (measured: 210 of 212
// real project folders with transcripts have no notes) - a wrong-folder guard that fails on it would
// refuse the import, and so the switch-off, for almost every project. Never fails. Instead, every
// account dir's `projects/*/` folder NOT already covered by the direct slug/override computation is
// checked for a transcript whose `cwd` names this project's main checkout (or one of its worktrees);
// the first match's own `memory/` folder is added as an EXTRA candidate, if it exists - this is how a
// note filed under a name the slug rule missed (a rename, an old naming quirk) is still found.
function extraDirsFromTranscripts(configDirs, projectRoot, alreadyCoveredDirs)
{
    const mainRoot = gitTopLevel(projectRoot);
    let mainRootReal;
    try { mainRootReal = fs.realpathSync(mainRoot); } catch (e) { mainRootReal = path.resolve(mainRoot); }

    const covered = new Set(Array.from(alreadyCoveredDirs, (d) => path.resolve(d)));
    const extra = [];
    for (const configDir of configDirs)
    {
        const projectsDir = path.join(configDir, 'projects');
        let entries;
        try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); }
        catch (e) { continue; }
        for (const entry of entries)
        {
            if (!entry.isDirectory()) continue;
            const folder = path.join(projectsDir, entry.name);
            const candidateMemoryDir = path.join(folder, 'memory');
            if (covered.has(path.resolve(candidateMemoryDir))) continue; // skip folders already covered
            let files;
            try { files = fs.readdirSync(folder); }
            catch (e) { continue; }
            let matched = false;
            for (const f of files)
            {
                if (!f.endsWith('.jsonl')) continue;
                const cwd = findCwdInTranscript(path.join(folder, f));
                if (cwd && transcriptCwdMatchesProject(cwd, mainRootReal)) { matched = true; break; } // stop early
            }
            if (matched && fs.existsSync(candidateMemoryDir)) extra.push(candidateMemoryDir);
        }
    }
    return extra;
}

// Read command/args/env for the `memory` server exactly as it is registered: the project's
// .mcp.json first, else the account file. Neither is ever written.
function accountRegistrationFile(explicitConfigDir, home)
{
    if (explicitConfigDir) return path.join(explicitConfigDir, '.claude.json');
    if (process.env.CLAUDE_CONFIG_DIR) return path.join(path.resolve(process.env.CLAUDE_CONFIG_DIR), '.claude.json');
    // final review A, I1: the DEFAULT account's own file is `$HOME/.claude.json` - a sibling of
    // the `.claude` dir, never inside it (context7 /websites/code_claude confirms this placement).
    return path.join(home, '.claude.json');
}

function findMemoryRegistration(projectRoot, explicitConfigDir, home)
{
    const projMcp = path.join(projectRoot, '.mcp.json');
    if (fs.existsSync(projMcp))
    {
        const data = readJsonSafe(projMcp);
        const entry = data && data.mcpServers && data.mcpServers.memory;
        if (entry && entry.command) return entry;
    }
    const acctFile = accountRegistrationFile(explicitConfigDir, home);
    if (fs.existsSync(acctFile))
    {
        const data = readJsonSafe(acctFile);
        const entry = data && data.mcpServers && data.mcpServers.memory;
        if (entry && entry.command) return entry;
    }
    return null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// final review A, C1: a flat frontmatter parser - no YAML library, so the importer runs from a
// release snapshot with no node_modules. Covers exactly what real notes use: top-level `key: value`
// pairs, one nested `metadata:` block (its own `key: value` pairs at deeper indent), single- or
// double-quoted values alongside unquoted ones, and CRLF line endings (the outer frontmatter fence is
// already `\r?\n`-tolerant; each inner line is stripped of a trailing `\r` here too).
function stripQuotes(v)
{
    const t = v.trim();
    if (t.length >= 2)
    {
        const first = t[0];
        const last = t[t.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) return t.slice(1, -1);
    }
    return t;
}

function parseFrontmatter(block)
{
    const meta = {};
    let inMetadata = false;
    for (const rawLine of block.split('\n'))
    {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) continue;
        if (/^\s/.test(line))
        {
            if (!inMetadata) continue;
            const m = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
            if (!m) continue;
            meta.metadata[m[1]] = stripQuotes(m[2]);
            continue;
        }
        inMetadata = false;
        const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1];
        const value = m[2];
        if (key === 'metadata' && value === '') { meta.metadata = {}; inMetadata = true; continue; }
        meta[key] = stripQuotes(value);
    }
    return meta;
}

function parseNote(raw, filename)
{
    let meta = {};
    let body = raw;
    const m = FRONTMATTER_RE.exec(raw);
    if (m)
    {
        meta = parseFrontmatter(m[1]);
        body = raw.slice(m[0].length);
    }
    const name = meta.name || path.basename(filename, path.extname(filename));
    const description = typeof meta.description === 'string' ? meta.description.trim() : '';
    const rawType = (meta.metadata && meta.metadata.type) || meta.type || '';
    // Strip every '\r' (not just outer whitespace) so a CRLF-authored note (e.g. on Windows) never
    // stores a body with embedded '\r' characters.
    body = body.replace(/\r/g, '').replace(/^\s+/, '').replace(/\s+$/, '');
    return { name, description, rawType, body };
}

function buildContent(description, body)
{
    if (description && body) return `${description}\n\n${body}`;
    return description || body;
}

function extractResultText(result)
{
    if (!result) return '';
    if (Array.isArray(result.content))
    {
        return result.content
            .map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
            .join('\n');
    }
    return '';
}

function loadSqlite()
{
    // Test hook: forces the same fallback path a genuinely unavailable node:sqlite takes, so the
    // fallback is exercisable on any Node version, not only below 22.13.
    if (process.env.CLAUDE_STACK_MEMORY_IMPORT_FORCE_NO_SQLITE === '1') return null;
    try
    {
        // Silences the (harmless) ExperimentalWarning node:sqlite prints below Node 24 - same
        // pattern this plan uses elsewhere for the same module.
        process.removeAllListeners('warning');
        return require('node:sqlite');
    }
    catch (e)
    {
        return null; // Node < 22.13 without --experimental-sqlite - node:sqlite is unavailable
    }
}

function openDbReadOnly(DatabaseSync, dbPath)
{
    try { return new DatabaseSync(dbPath, { readOnly: true }); }
    catch (e)
    {
        try { return new DatabaseSync(`file:${dbPath}?mode=ro&immutable=1`, { readOnly: true }); }
        catch (e2) { return null; } // e.g. the db file does not exist yet (first-ever import)
    }
}

function hasLiveDuplicate(db, content)
{
    try
    {
        const row = db.prepare('SELECT 1 FROM memories WHERE content = ? AND deleted_at IS NULL LIMIT 1').get(content);
        return !!row;
    }
    catch (e)
    {
        return false; // a query failure is 'no precheck available' for this note, never a false match
    }
}

function startServer(entry, cwd)
{
    const command = entry.command;
    const args = Array.isArray(entry.args) ? entry.args : [];
    const env = Object.assign({}, process.env, entry.env || {});
    return spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
}

// A minimal JSON-RPC-over-stdio client: one line per message, both directions - no MCP client
// library needed (matches the spike's driver.js approach).
function createRpcClient(child)
{
    let buf = '';
    let nextId = 1;
    const pending = new Map();
    let fatalError = null;
    let stderrTail = '';

    child.stdout.on('data', (chunk) =>
    {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1)
        {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            let msg;
            try { msg = JSON.parse(line); } catch (e) { continue; }
            if (msg && msg.id !== undefined && pending.has(msg.id))
            {
                const { resolve } = pending.get(msg.id);
                pending.delete(msg.id);
                resolve(msg);
            }
        }
    });
    child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000); });
    const failAll = (err) =>
    {
        if (!fatalError) fatalError = err;
        for (const { reject } of pending.values()) reject(err);
        pending.clear();
    };
    child.on('error', (err) => failAll(new Error(`could not start the memory MCP server: ${err.message}`)));
    child.on('exit', (code, signal) => failAll(new Error(
        `memory MCP server exited unexpectedly (code=${code} signal=${signal})${stderrTail ? ` - stderr: ${stderrTail.slice(-500)}` : ''}`,
    )));

    function call(method, params, timeoutMs)
    {
        return new Promise((resolve, reject) =>
        {
            if (fatalError) { reject(fatalError); return; }
            const id = nextId++;
            const timer = setTimeout(() =>
            {
                pending.delete(id);
                reject(new Error(`timed out waiting for '${method}' after ${timeoutMs}ms`));
            }, timeoutMs);
            pending.set(id, {
                resolve: (msg) => { clearTimeout(timer); resolve(msg); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
    }
    function notify(method, params)
    {
        if (fatalError) return;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    }
    return { call, notify };
}

async function runImport(projectRoot, configDir, explicitConfigDir, home, explicitMemoryDir)
{
    let memoryDirs;
    let scannedConfigDirs;
    if (explicitMemoryDir)
    {
        memoryDirs = [explicitMemoryDir];
        scannedConfigDirs = [configDir];
    }
    else
    {
        scannedConfigDirs = accountConfigDirs(home, explicitConfigDir);
        const set = new Set();
        const override = readSettingsAutoMemoryDirectory(projectRoot, configDir, home);
        if (override) set.add(override);
        for (const cd of scannedConfigDirs) set.add(slugMemoryDir(projectRoot, cd, home));
        // Re-review, I7: a folder the slug/override computation missed, found through its own
        // transcript's cwd - never a failure (see extraDirsFromTranscripts).
        for (const extraDir of extraDirsFromTranscripts(scannedConfigDirs, projectRoot, set)) set.add(extraDir);
        memoryDirs = Array.from(set);
    }

    const noteEntries = [];
    const existedDirs = [];
    for (const dir of memoryDirs)
    {
        let filenames;
        try { filenames = fs.readdirSync(dir); }
        catch (e)
        {
            if (e.code === 'ENOENT') continue;
            throw new Error(`could not read ${dir}: ${e.message}`);
        }
        existedDirs.push(dir);
        for (const f of filenames.filter((n) => n.endsWith('.md') && n !== 'MEMORY.md').sort())
        {
            noteEntries.push({ dir, file: f });
        }
    }
    const fromLabel = (existedDirs.length ? existedDirs : memoryDirs).join(', ');

    // Re-review, I7 (binding ruling): no notes anywhere - including nothing found through a
    // transcript match above - is always 'nothing to import', exit 0. Never a failure: a project
    // with sessions but no notes is the normal case, not a sign the folder computation is wrong.
    if (noteEntries.length === 0) return { ok: true, message: `nothing to import, from ${fromLabel}` };

    const entry = findMemoryRegistration(projectRoot, explicitConfigDir, home);
    if (!entry)
    {
        throw new Error(
            "no 'memory' MCP server registered (checked .mcp.json and the account config) - nothing to import into",
        );
    }

    const projectName = path.basename(gitTopLevel(projectRoot)).replace(/,/g, '');
    const notes = noteEntries.map(({ dir, file }) =>
    {
        const full = path.join(dir, file);
        let raw;
        try { raw = fs.readFileSync(full, 'utf8'); }
        catch (e) { throw new Error(`could not read ${full}: ${e.message}`); }
        return parseNote(raw, file);
    });

    // The db precheck is a pure local file read - resolved before spawning the server at all. The
    // registration's own env names the exact file the server itself will open.
    let db = null;
    let sqliteNote = '';
    const dbPath = entry.env && entry.env.MCP_MEMORY_SQLITE_PATH;
    if (dbPath)
    {
        const sqlite = loadSqlite();
        if (sqlite) db = openDbReadOnly(sqlite.DatabaseSync, dbPath);
        else sqliteNote = ' (node:sqlite unavailable - idempotence checked via the server response text only)';
    }

    const child = startServer(entry, projectRoot);
    let killed = false;
    const killChild = () =>
    {
        if (killed) return;
        killed = true;
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    };

    const rpc = createRpcClient(child);
    const deadline = Date.now() + OVERALL_TIMEOUT_MS;
    const timeLeft = () => Math.max(1, deadline - Date.now());

    try
    {
        await rpc.call('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'claude-stack-memory-import', version: '1.0.0' },
        }, Math.min(INIT_TIMEOUT_MS, timeLeft()));
        rpc.notify('notifications/initialized');

        let imported = 0;
        let present = 0;
        for (const note of notes)
        {
            if (Date.now() > deadline) throw new Error('import timed out after 5 minutes');
            const content = buildContent(note.description, note.body);
            if (db && hasLiveDuplicate(db, content)) { present++; continue; }

            const kind = mapKind(note.rawType);
            const noteName = note.name.replace(/,/g, '');
            // final review A, M2: a 'user' note describes the PERSON, not the project - no
            // project: tag, so it reads back as a global preference. Every other kind keeps one.
            const tags = note.rawType === 'user' ? [noteName] : [`project:${projectName}`, noteName];
            const resp = await rpc.call('tools/call', {
                name: 'memory_store',
                // final review A, M1: a fresh conversation_id per note bypasses the server's
                // semantic-similarity dedup ACROSS calls (FACT-TOOLS), so two genuinely distinct
                // notes are never silently collapsed into one. Idempotence for a genuine re-import
                // stays on the db precheck above, second line the response text below.
                arguments: { content, conversation_id: randomUUID(), metadata: { tags, type: kind } },
            }, Math.min(CALL_TIMEOUT_MS, timeLeft()));

            if (resp.error) throw new Error(`memory_store failed for '${note.name}': ${resp.error.message || JSON.stringify(resp.error)}`);
            const text = extractResultText(resp.result);
            if (resp.result && resp.result.isError) throw new Error(`memory_store failed for '${note.name}': ${text}`);
            // Read the text: the server wraps BOTH a genuine failure and a benign duplicate-content
            // report as isError:false text starting 'Error storing memory:' - only the duplicate
            // case counts as 'already present'; anything else with that prefix is a hard failure.
            // Second line only - the db precheck above is the primary idempotence check.
            if (/duplicate content detected/i.test(text)) present++;
            else if (/error storing memory/i.test(text)) throw new Error(`memory_store failed for '${note.name}': ${text}`);
            else imported++;
        }
        return { ok: true, message: `${imported} imported, ${present} already present, from ${fromLabel}${sqliteNote}` };
    }
    finally
    {
        killChild();
        if (db) { try { db.close(); } catch (e) { /* already closed */ } }
    }
}

async function main()
{
    const args = parseArgs(process.argv.slice(2));
    if (!args.projectRoot) throw new Error('--project-root is required');
    const projectRoot = path.resolve(args.projectRoot);
    const home = os.homedir();
    const explicitConfigDir = args.configDir ? path.resolve(args.configDir) : null;
    const configDir = explicitConfigDir || defaultConfigDir();
    const memoryDir = args.memoryDir ? path.resolve(args.memoryDir) : null;
    return runImport(projectRoot, configDir, explicitConfigDir, home, memoryDir);
}

if (require.main === module)
{
    main().then((res) =>
    {
        console.log(`memory import: ${res.message}`);
        process.exit(0);
    }).catch((err) =>
    {
        console.error(`memory import: ${err && err.message ? err.message : err}`);
        process.exit(1);
    });
}

module.exports = {
    mapKind, parseNote, buildContent, slugify, gitTopLevel, defaultMemoryDir,
    INIT_TIMEOUT_MS, OVERALL_TIMEOUT_MS,
};
