/**
 * Thin re-export for conversation-search sidecar DB helpers.
 *
 * conversation-embeddings-db.ts uses only the shared database/driver (not
 * getDatabase()), so it is architecturally already independent of panopticon.db.
 * This module provides a gate-clean import path for consumers outside
 * src/lib/database/.
 */

export {
  openEmbeddingsDb,
  dimensionsForModel,
  type EmbeddingsDbHandle,
  type ChunkInsert,
  type ChunkRow,
  type ChunkSearchRow,
  type EmbeddingsDbStats,
  type OpenEmbeddingsDbOptions,
} from '../database/conversation-embeddings-db.js';
