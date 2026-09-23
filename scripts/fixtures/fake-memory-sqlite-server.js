#!/usr/bin/env node
'use strict';
// A fake memory MCP stdio server that works on the REAL sqlite file MCP_MEMORY_SQLITE_PATH names
// (memory-schema.sql plus memory-vec-shadow.sql), the way mcp-memory-service 11.13.0 does, for the
// `memory.js reembed` tests. Read against that version's source (storage/mixins/store.py, delete.py,
// metadata.py; server/handlers/memory.py):
//   memory_store  - an exact duplicate is a LIVE row with the same content hash; a soft-deleted row
//                   with that hash is purged first; the row gets created_at = now, the metadata minus
//                   tags/type plus conversation_id, and a UNIT vector in a chunk of its own.
//   memory_delete - soft delete by content_hash: deleted_at set, the vector's rowid entry dropped.
//   memory_update - merges updates.metadata; with preserve_timestamps false a supplied created_at /
//                   created_at_iso / updated_at / updated_at_iso wins.
//   conflicts     - a store whose content is FAKE_SQLITE_CONFLICT tags it and the oldest other live row
//                   `conflict:unresolved`, as _record_conflicts does; the reply says nothing about it.
// Failures, each keyed on the content it hits: FAKE_SQLITE_FAIL_STORE answers 'Error storing memory'
// and writes nothing (FAKE_SQLITE_FAIL_STORE_ONCE=1: on the first launch only, a marker file beside the
// db); FAKE_SQLITE_FAIL_DELETE answers an error and deletes nothing; FAKE_SQLITE_CRASH_ON_DELETE deletes,
// then exits without closing the database or answering, once. FAKE_SQLITE_FAIL_UPDATE_ONCE=1 fails the
// first memory_update of the first launch. FAKE_SQLITE_BAD_VECTOR=1 stores a vector far from unit length
// (a server running without the sentence model). FAKE_SQLITE_CALLS_LOG: one JSON line per tools/call.
const crypto = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');

process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.MCP_MEMORY_SQLITE_PATH;
const failStore = process.env.FAKE_SQLITE_FAIL_STORE || null;
const failOnceMarker = process.env.FAKE_SQLITE_FAIL_STORE_ONCE === '1' ? `${dbPath}.failed-once` : null;
const callsLog = process.env.FAKE_SQLITE_CALLS_LOG || null;
const failDelete = process.env.FAKE_SQLITE_FAIL_DELETE || null;
const crashOnDelete = process.env.FAKE_SQLITE_CRASH_ON_DELETE || null;
const failUpdateMarker = process.env.FAKE_SQLITE_FAIL_UPDATE_ONCE === '1' ? `${dbPath}.update-failed-once` : null;
const badVector = process.env.FAKE_SQLITE_BAD_VECTOR === '1';
const conflictOn = process.env.FAKE_SQLITE_CONFLICT || null;
const CONFLICT_TAG = 'conflict:unresolved';
const DIM = 384;

const hashOf = (content) => crypto.createHash('sha256').update(String(content).trim().toLowerCase()).digest('hex');
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const text = (t) => ({ content: [{ type: 'text', text: t }], isError: false });

function withDb(fn)
{
    const db = new DatabaseSync(dbPath);
    try { return fn(db); } finally { db.close(); }
}

function store(args)
{
    const content = args.content;
    const meta = { ...(args.metadata || {}) };
    const tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const type = meta.type || 'note';
    delete meta.tags;
    delete meta.type;
    if (args.conversation_id) meta.conversation_id = args.conversation_id;
    if (failStore && content === failStore && !(failOnceMarker && fs.existsSync(failOnceMarker)))
    {
        if (failOnceMarker) fs.writeFileSync(failOnceMarker, '1');
        return 'Error storing memory: simulated failure for test';
    }
    const hash = hashOf(content);
    return withDb((db) =>
    {
        if (db.prepare('SELECT 1 FROM memories WHERE content_hash = ? AND deleted_at IS NULL').get(hash)) return 'Error storing memory: Duplicate content detected (exact match)';
        for (const { id } of db.prepare('SELECT id FROM memories WHERE content_hash = ? AND deleted_at IS NOT NULL').all(hash)) db.prepare('DELETE FROM memory_embeddings_rowids WHERE rowid = ?').run(id);
        db.prepare('DELETE FROM memories WHERE content_hash = ? AND deleted_at IS NOT NULL').run(hash);
        const now = Date.now() / 1000;
        const iso = new Date(now * 1000).toISOString();
        const { lastInsertRowid } = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, metadata, created_at, updated_at, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(hash, content, tags.join(','), type, JSON.stringify(meta), now, now, iso, iso);
        const v = Float32Array.from({ length: DIM }, (_, i) => (badVector ? ((i % 7) - 3) / 2 : 1 / Math.sqrt(DIM)));
        const { lastInsertRowid: chunk } = db.prepare('INSERT INTO memory_embeddings_vector_chunks00 (rowid, vectors) VALUES ((SELECT COALESCE(MAX(rowid), 0) + 1 FROM memory_embeddings_vector_chunks00), ?)').run(Buffer.from(v.buffer));
        db.prepare('INSERT INTO memory_embeddings_rowids (rowid, id, chunk_id, chunk_offset) VALUES (?, NULL, ?, 0)').run(lastInsertRowid, chunk);
        if (conflictOn && content === conflictOn)
        {
            const other = db.prepare('SELECT id FROM memories WHERE deleted_at IS NULL AND id != ? ORDER BY id LIMIT 1').get(lastInsertRowid);
            for (const id of [lastInsertRowid, other && other.id].filter((x) => x != null))
            {
                db.prepare(`UPDATE memories SET tags = CASE WHEN tags = '' THEN ? ELSE tags || ',' || ? END WHERE id = ?`).run(CONFLICT_TAG, CONFLICT_TAG, id);
            }
        }
        return `Memory stored successfully (hash: ${hash.slice(0, 8)})`;
    });
}

function remove(args)
{
    return withDb((db) =>
    {
        const row = db.prepare('SELECT id FROM memories WHERE content_hash = ? AND deleted_at IS NULL').get(String(args.content_hash || ''));
        if (!row) return 'No memories matched\n\nDeleted 0 memories';
        if (failDelete && hashOf(failDelete) === args.content_hash) return 'Error deleting memory: simulated failure for test';
        db.prepare('DELETE FROM memory_embeddings_rowids WHERE rowid = ?').run(row.id);
        db.prepare('UPDATE memories SET deleted_at = ? WHERE id = ?').run(Date.now() / 1000, row.id);
        const crashMarker = `${dbPath}.crashed-once`;
        if (crashOnDelete && hashOf(crashOnDelete) === args.content_hash && !fs.existsSync(crashMarker))
        {
            // A kill between two tool calls: the delete is committed, the handle is never closed, no reply.
            fs.writeFileSync(crashMarker, '1');
            process.exit(1);
        }
        return 'Deleted by content hash\n\nDeleted 1 memories';
    });
}

function update(args)
{
    const updates = args.updates || {};
    const keep = args.preserve_timestamps !== false;
    if (failUpdateMarker && !fs.existsSync(failUpdateMarker))
    {
        fs.writeFileSync(failUpdateMarker, '1');
        return 'Failed to update memory metadata: simulated failure for test';
    }
    return withDb((db) =>
    {
        const row = db.prepare('SELECT * FROM memories WHERE content_hash = ? AND deleted_at IS NULL').get(String(args.content_hash || ''));
        if (!row) return `Failed to update memory metadata: Memory with hash ${args.content_hash} not found`;
        const meta = { ...JSON.parse(row.metadata || '{}'), ...(updates.metadata || {}) };
        const pick = (key) => (!keep && updates[key] !== undefined ? updates[key] : row[key]);
        db.prepare('UPDATE memories SET metadata = ?, created_at = ?, created_at_iso = ?, updated_at = ?, updated_at_iso = ? WHERE id = ?')
            .run(JSON.stringify(meta), pick('created_at'), pick('created_at_iso'), keep ? row.updated_at : (updates.updated_at ?? Date.now() / 1000), keep ? row.updated_at_iso : (updates.updated_at_iso ?? null), row.id);
        return 'Successfully updated memory metadata. Updated fields: custom_metadata';
    });
}

const TOOLS = { memory_store: store, memory_delete: remove, memory_update: update };

readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) =>
{
    let msg;
    try { msg = JSON.parse(line.trim()); } catch { return; }
    const { id, method, params } = msg;
    if (method === 'initialize') { send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-memory-sqlite', version: '0.0.1' } } }); return; }
    if (method === 'notifications/initialized') return;
    if (method === 'tools/call')
    {
        const tool = TOOLS[params && params.name];
        if (callsLog) fs.appendFileSync(callsLog, `${JSON.stringify({ name: params && params.name, arguments: params && params.arguments })}\n`);
        if (!tool) { send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${params && params.name}` } }); return; }
        let reply;
        try { reply = tool((params && params.arguments) || {}); } catch (err) { reply = `Error: ${err.message}`; }
        send({ jsonrpc: '2.0', id, result: text(reply) });
        return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
});
process.stdin.on('end', () => process.exit(0));
