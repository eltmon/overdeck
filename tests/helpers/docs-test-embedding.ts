/**
 * Deterministic docs embedding for tests (moved out of src/lib/docs/index-builder.ts,
 * where no production code called it; PAN-3958 CH-8).
 *
 * Hashes the model, doc path, anchor and content into a unit vector, so docs-index
 * tests get stable, content-dependent embeddings without loading a model.
 */
import { createHash } from 'node:crypto';

import { normalizeFloat32Embedding, type DocsEmbeddingInput } from '../../src/lib/docs/index-builder.js';

export function deterministicDocsTestEmbedding(input: DocsEmbeddingInput): Float32Array {
  const values = new Float32Array(input.dimensions);
  let seed = `${input.model}\n${input.chunk.docPath}\n${input.chunk.sectionAnchor ?? ''}\n${input.chunk.content}`;

  for (let offset = 0; offset < input.dimensions; offset += 8) {
    const digest = createHash('sha256').update(seed).digest();
    for (let i = 0; i < 8 && offset + i < input.dimensions; i++) {
      values[offset + i] = (digest.readUInt32LE(i * 4) / 0xffffffff) * 2 - 1;
    }
    seed = digest.toString('hex');
  }

  return normalizeFloat32Embedding(values, input.dimensions);
}
