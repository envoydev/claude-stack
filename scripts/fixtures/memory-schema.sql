-- Captured 2026-09-19 from a live mcp-memory-service 11.13.0 sqlite_vec database (uvx --with numpy
-- --from mcp-memory-service@11.13.0 memory server), via `sqlite3 memory.db .schema`. Plain tables
-- only - the reader needs content, tags and timestamps, and this table opens without loading the
-- sqlite_vec extension (the real database also has a `memory_embeddings` vec0 virtual table plus its
-- vec0 shadow tables, `memory_content_fts` FTS5 tables, `memory_graph`, `beliefs`, `metadata` and
-- `migration_registry`, none of which a fixture reader needs - see spike-facts.md FACT-SCHEMA).
CREATE TABLE memories (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        content_hash TEXT UNIQUE NOT NULL,
                        content TEXT NOT NULL,
                        tags TEXT,
                        memory_type TEXT,
                        metadata TEXT,
                        created_at REAL,
                        updated_at REAL,
                        created_at_iso TEXT,
                        updated_at_iso TEXT,
                        deleted_at REAL DEFAULT NULL
                    , store TEXT DEFAULT 'default', parent_id TEXT, version INTEGER DEFAULT 1, confidence REAL DEFAULT 1.0, last_accessed INTEGER, superseded_by TEXT);
CREATE INDEX idx_content_hash ON memories(content_hash);
CREATE INDEX idx_created_at ON memories(created_at);
CREATE INDEX idx_memory_type ON memories(memory_type);
CREATE INDEX idx_deleted_at ON memories(deleted_at);
