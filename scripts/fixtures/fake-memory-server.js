#!/usr/bin/env node
'use strict';
// Minimal fake MCP stdio server for scripts/memory-import.test.js. Understands initialize,
// notifications/initialized, tools/list and tools/call (memory_store only - the import script's
// chosen idempotence route relies on the server's OWN duplicate-content report inside memory_store,
// so no separate lookup tool needs answering).
//
// FAKE_MEMORY_DB (required): a JSON array file acting as the persisted 'database', read and
// rewritten on every store so a second process launch against the same file sees the first launch's
// rows - matching the real server's on-disk sqlite dedup surviving a fresh process per run.
// FAKE_MEMORY_CALLS_LOG (optional): one JSON line appended per memory_store call ({content, tags,
// memory_type}), for tests to assert exactly what the import script sent.
// FAKE_MEMORY_FAIL_CONTENT (optional): a memory_store call whose content equals this string gets a
// genuine (non-duplicate) 'Error storing memory' response, to exercise the import script's hard
// failure path - mirrors the real server wrapping BOTH a benign duplicate and a real failure in an
// isError:false 'Error storing memory: ...' text (verified against mcp-memory-service 11.13.0).
const fs = require('node:fs');
const readline = require('node:readline');

const dbPath = process.env.FAKE_MEMORY_DB;
const callsLogPath = process.env.FAKE_MEMORY_CALLS_LOG || null;
const failContent = process.env.FAKE_MEMORY_FAIL_CONTENT || null;

function loadDb()
{
    if (!dbPath) return [];
    try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
    catch (e) { return []; }
}

function saveDb(db)
{
    if (!dbPath) return;
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function logCall(entry)
{
    if (!callsLogPath) return;
    fs.appendFileSync(callsLogPath, `${JSON.stringify(entry)}\n`);
}

function send(obj)
{
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function textResult(text)
{
    return { content: [{ type: 'text', text }], isError: false };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) =>
{
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    const { id, method, params } = msg;

    if (method === 'initialize')
    {
        send({ jsonrpc: '2.0', id, result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'fake-memory', version: '0.0.1' },
        } });
        return;
    }
    if (method === 'notifications/initialized') return; // notification - no response
    if (method === 'tools/list')
    {
        send({ jsonrpc: '2.0', id, result: { tools: [
            { name: 'memory_store', description: 'fake store' },
            { name: 'memory_search', description: 'fake search' },
            { name: 'memory_list', description: 'fake list' },
        ] } });
        return;
    }
    if (method === 'tools/call')
    {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        if (toolName === 'memory_store')
        {
            const content = toolArgs.content;
            const metadata = toolArgs.metadata || {};
            logCall({ content, tags: metadata.tags, memory_type: metadata.type });
            if (failContent && content === failContent)
            {
                send({ jsonrpc: '2.0', id, result: textResult('Error storing memory: simulated failure for test') });
                return;
            }
            const db = loadDb();
            const dup = db.find((row) => row.content === content);
            if (dup)
            {
                send({ jsonrpc: '2.0', id, result: textResult(
                    `Error storing memory: Duplicate content detected (semantically similar to fake${dup.id})`,
                ) });
                return;
            }
            const row = { id: db.length + 1, content, tags: metadata.tags, memory_type: metadata.type };
            db.push(row);
            saveDb(db);
            send({ jsonrpc: '2.0', id, result: textResult(`Memory stored successfully (hash: fake${row.id})`) });
            return;
        }
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${toolName}` } });
        return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
});

process.stdin.on('end', () => process.exit(0));
