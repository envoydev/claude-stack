-- Captured 2026-09-23 from a live mcp-memory-service 11.13.0 sqlite_vec database: the three plain
-- SHADOW tables behind the `memory_embeddings` vec0 virtual table (`content_embedding FLOAT[384]`).
-- node:sqlite reads them without loading the sqlite_vec extension. A vector lives in
-- memory_embeddings_vector_chunks00.vectors (float32, little-endian) at chunk_offset * dim * 4 of the
-- chunk that memory_embeddings_rowids names for the memory's id. Used with memory-schema.sql.
CREATE TABLE "memory_embeddings_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,sequence_id integer,partition00,validity BLOB NOT NULL, rowids BLOB NOT NULL);
CREATE TABLE "memory_embeddings_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id,chunk_id INTEGER,chunk_offset INTEGER);
CREATE TABLE "memory_embeddings_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);
