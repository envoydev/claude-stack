#!/usr/bin/env node
'use strict';
// One-time import: Claude Code's own per-project auto-memory notes (~/.claude/projects/<slug>/memory/
// *.md, one file per note plus an index MEMORY.md) into the shared `memory` MCP, so a project can
// switch Claude's own memory off without losing what it already learned. Read-only against the
// source notes folder - it is never written to.
//
// Usage: node scripts/memory-import.js --project-root <root> [--config-dir <dir>] [--memory-dir <dir>]
//
// The server is spawned EXACTLY as the `memory` entry registers it: read command/args/env from
// <root>/.mcp.json, else the account's <configDir>/.claude.json `mcpServers.memory`. No registration
// found -> exit 1. `--memory-dir` overrides the source notes folder (for tests); its default is
// <configDir>/projects/<slug>/memory/, where configDir is --config-dir, else CLAUDE_CONFIG_DIR, else
// ~/.claude, and slug is the git top-level directory's absolute path with every path separator
// replaced by '-' (worktrees resolve to the MAIN repo's directory via `git rev-parse
// --path-format=absolute --git-common-dir`, since Claude Code's own auto-memory is shared by every
// worktree of one repo - confirmed against this machine's real ~/.claude/projects/ folder names).
//
// Idempotence: relies on the memory MCP's OWN duplicate-content detection. Storing the same content
// twice against the same database returns a "Duplicate content detected" message wrapped in a
// successful (isError:false) tool result rather than adding a second row - verified against the real
// mcp-memory-service 11.13.0 server on an empty temp db. That message is read as "already present",
// never as a failure; any OTHER "Error storing memory" text is a hard failure (exit 1).
//
// Kind mapping (note frontmatter type -> memory_type, read from metadata.type or a top-level type
// key - real notes on this machine carry it nested under metadata.type):
//   user -> preference, feedback -> correction, project -> project-fact, reference -> project-fact,
//   anything else (including missing) -> project-fact.
// Tags: `project:<name>` (name = basename of the git top-level dir, commas stripped) plus the note's
// own `name` (frontmatter `name`, else the filename without its extension). Content: the frontmatter
// `description` as the first line, then the body. MEMORY.md is the index, never imported.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

const CALL_TIMEOUT_MS = 30000;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

const KIND_MAP = {
    user: 'preference',
    feedback: 'correction',
    project: 'project-fact',
    reference: 'project-fact',
};

function mapKind(rawType)
{
    return KIND_MAP[rawType] || 'project-fact';
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
// auto-memory folder, so the slug always names the MAIN checkout, never the worktree path.
function gitTopLevel(projectRoot)
{
    try
    {
        const commonDir = execFileSync(
            'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;
    }
    catch (e)
    {
        return projectRoot; // not a git repo (or git missing) - fall back to the project root itself
    }
}

function slugify(absPath)
{
    return absPath.replace(/[\\/]/g, '-');
}

function defaultMemoryDir(projectRoot, configDir)
{
    const slug = slugify(gitTopLevel(projectRoot));
    return path.join(configDir, 'projects', slug, 'memory');
}

function readJsonSafe(file)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return null; }
}

// Read command/args/env for the `memory` server exactly as it is registered: the project's
// .mcp.json first, else the account file. Neither is ever written.
function findMemoryRegistration(projectRoot, configDir)
{
    const projMcp = path.join(projectRoot, '.mcp.json');
    if (fs.existsSync(projMcp))
    {
        const data = readJsonSafe(projMcp);
        const entry = data && data.mcpServers && data.mcpServers.memory;
        if (entry && entry.command) return entry;
    }
    const acctFile = path.join(configDir, '.claude.json');
    if (fs.existsSync(acctFile))
    {
        const data = readJsonSafe(acctFile);
        const entry = data && data.mcpServers && data.mcpServers.memory;
        if (entry && entry.command) return entry;
    }
    return null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseNote(raw, filename)
{
    let meta = null;
    let body = raw;
    const m = FRONTMATTER_RE.exec(raw);
    if (m)
    {
        try { meta = yaml.load(m[1]); } catch (e) { meta = null; }
        if (!meta || typeof meta !== 'object') meta = {};
        body = raw.slice(m[0].length);
    }
    else
    {
        meta = {};
    }
    const name = meta.name || path.basename(filename, path.extname(filename));
    const description = typeof meta.description === 'string' ? meta.description.trim() : '';
    const rawType = (meta.metadata && meta.metadata.type) || meta.type || '';
    body = body.replace(/^\s+/, '').replace(/\s+$/, '');
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

async function runImport(projectRoot, configDir, memoryDir)
{
    let filenames;
    try { filenames = fs.readdirSync(memoryDir); }
    catch (e)
    {
        if (e.code === 'ENOENT') return { ok: true, message: `nothing to import, from ${memoryDir}` };
        throw new Error(`could not read ${memoryDir}: ${e.message}`);
    }

    const noteFiles = filenames.filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').sort();
    if (noteFiles.length === 0) return { ok: true, message: `nothing to import, from ${memoryDir}` };

    const entry = findMemoryRegistration(projectRoot, configDir);
    if (!entry)
    {
        throw new Error(
            "no 'memory' MCP server registered (checked .mcp.json and the account config) - nothing to import into",
        );
    }

    const projectName = path.basename(gitTopLevel(projectRoot)).replace(/,/g, '');
    const notes = noteFiles.map((f) =>
    {
        const full = path.join(memoryDir, f);
        let raw;
        try { raw = fs.readFileSync(full, 'utf8'); }
        catch (e) { throw new Error(`could not read ${full}: ${e.message}`); }
        return parseNote(raw, f);
    });

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
        }, Math.min(CALL_TIMEOUT_MS, timeLeft()));
        rpc.notify('notifications/initialized');

        let imported = 0;
        let present = 0;
        for (const note of notes)
        {
            if (Date.now() > deadline) throw new Error('import timed out after 5 minutes');
            const kind = mapKind(note.rawType);
            const content = buildContent(note.description, note.body);
            const tags = [`project:${projectName}`, note.name];
            const resp = await rpc.call('tools/call', {
                name: 'memory_store',
                arguments: { content, metadata: { tags, type: kind } },
            }, Math.min(CALL_TIMEOUT_MS, timeLeft()));

            if (resp.error) throw new Error(`memory_store failed for '${note.name}': ${resp.error.message || JSON.stringify(resp.error)}`);
            const text = extractResultText(resp.result);
            if (resp.result && resp.result.isError) throw new Error(`memory_store failed for '${note.name}': ${text}`);
            // Read the text: the server wraps BOTH a genuine failure and a benign duplicate-content
            // report as isError:false text starting 'Error storing memory:' - only the duplicate
            // case counts as 'already present'; anything else with that prefix is a hard failure.
            if (/duplicate content detected/i.test(text)) present++;
            else if (/error storing memory/i.test(text)) throw new Error(`memory_store failed for '${note.name}': ${text}`);
            else imported++;
        }
        return { ok: true, message: `${imported} imported, ${present} already present, from ${memoryDir}` };
    }
    finally
    {
        killChild();
    }
}

async function main()
{
    const args = parseArgs(process.argv.slice(2));
    if (!args.projectRoot) throw new Error('--project-root is required');
    const projectRoot = path.resolve(args.projectRoot);
    const configDir = args.configDir ? path.resolve(args.configDir) : defaultConfigDir();
    const memoryDir = args.memoryDir ? path.resolve(args.memoryDir) : defaultMemoryDir(projectRoot, configDir);
    return runImport(projectRoot, configDir, memoryDir);
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

module.exports = { mapKind, parseNote, buildContent, slugify, gitTopLevel, defaultMemoryDir };
