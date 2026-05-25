import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, sep } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../config-yaml.js';
import {
  buildDocsIndex,
  bufferToFloat32Array,
  DEFAULT_DOCS_INDEX_PATH,
  float32ArrayToBuffer,
  validateDocsIndex,
} from '../index-builder.js';

let rootDir: string;
let syncSourcesRoot: string;

async function writeFixture(path: string, content: string): Promise<void> {
  const absolutePath = join(rootDir, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function docsConfig(overrides: {
  corpus?: Partial<NormalizedDocsConfig['corpus']>;
  embedding?: Partial<NormalizedDocsConfig['embedding']>;
} = {}): Pick<NormalizedDocsConfig, 'corpus' | 'embedding'> {
  const defaults = getDefaultDocsConfig();
  return {
    corpus: {
      ...defaults.corpus,
      skills: false,
      rules: false,
      claudeMd: false,
      prds: false,
      ...overrides.corpus,
    },
    embedding: {
      ...defaults.embedding,
      dimensions: 4,
      model: 'test-docs-embedding',
      ...overrides.embedding,
    },
  };
}

function openIndex(path: string): Database.Database {
  return new Database(path, { readonly: true });
}

describe('docs index builder', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-index-'));
    syncSourcesRoot = join(rootDir, 'sync-sources');
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('creates chunk, FTS, embedding, and metadata rows with matching chunk ids', async () => {
    const outputPath = join(rootDir, 'dist', 'docs-index.sqlite');
    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n\n## Second\n\nBeta docs.\n');

    const result = await buildDocsIndex({
      outputPath,
      rootDir,
      syncSourcesRoot,
      builtAt: '2026-05-25T00:00:00.000Z',
      config: docsConfig(),
    });

    expect(result).toMatchObject({
      outputPath,
      sourceCount: 1,
      chunkCount: 2,
      embeddingCount: 2,
      builtAt: '2026-05-25T00:00:00.000Z',
      embeddingModel: 'test-docs-embedding',
      embeddingDimensions: 4,
    });

    const db = openIndex(outputPath);
    try {
      const metadata = validateDocsIndex(db);
      expect(metadata).toMatchObject({
        schemaVersion: 1,
        sourceCount: 1,
        chunkCount: 2,
        embeddingCount: 2,
        embeddingModel: 'test-docs-embedding',
        embeddingDimensions: 4,
      });
      expect(db.prepare('SELECT chunk_id, doc_path, doc_kind, section_heading FROM docs_chunks ORDER BY chunk_id').all()).toEqual([
        { chunk_id: 1, doc_path: 'docs/guide.md', doc_kind: 'docs', section_heading: 'First' },
        { chunk_id: 2, doc_path: 'docs/guide.md', doc_kind: 'docs', section_heading: 'Second' },
      ]);
      expect(db.prepare('SELECT chunk_id FROM docs_embeddings ORDER BY chunk_id').all()).toEqual([
        { chunk_id: 1 },
        { chunk_id: 2 },
      ]);
      expect(db.prepare("SELECT rowid, doc_path FROM docs_fts WHERE docs_fts MATCH 'Alpha'").all()).toEqual([
        { rowid: 1, doc_path: 'docs/guide.md' },
      ]);
    } finally {
      db.close();
    }
  });

  it('rebuilds idempotently at the same output path', async () => {
    const outputPath = join(rootDir, 'dist', 'docs-index.sqlite');
    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n');
    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig() });

    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n\n## Second\n\nBeta docs.\n');
    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig() });

    const db = openIndex(outputPath);
    try {
      expect(validateDocsIndex(db)).toMatchObject({ chunkCount: 2, embeddingCount: 2 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM docs_index_metadata').get()).toEqual({ count: 7 });
    } finally {
      db.close();
    }
  });

  it('stores normalized Float32 embeddings as round-trippable blobs', async () => {
    const outputPath = join(rootDir, 'dist', 'docs-index.sqlite');
    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n');

    await buildDocsIndex({
      outputPath,
      rootDir,
      syncSourcesRoot,
      config: docsConfig(),
      embeddingFn: () => new Float32Array([3, 4, 0, 0]),
    });

    const db = openIndex(outputPath);
    try {
      const row = db.prepare('SELECT embedding FROM docs_embeddings WHERE chunk_id = 1').get() as { embedding: Buffer };
      const embedding = bufferToFloat32Array(row.embedding, 4);
      expect(Array.from(embedding)).toEqual([0.6000000238418579, 0.800000011920929, 0, 0]);
      expect(bufferToFloat32Array(float32ArrayToBuffer(new Float32Array([1, 2, 3, 4])), 4)).toEqual(new Float32Array([1, 2, 3, 4]));
      expect(() => bufferToFloat32Array(Buffer.alloc(2), 4)).toThrow('embedding blob dimension mismatch');
    } finally {
      db.close();
    }
  });

  it('fails loudly when the generated index exceeds the configured size budget', async () => {
    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n');

    await expect(buildDocsIndex({
      outputPath: join(rootDir, 'dist', 'docs-index.sqlite'),
      rootDir,
      syncSourcesRoot,
      config: docsConfig(),
      maxIndexBytes: 1,
    })).rejects.toThrow('exceeding budget 1 bytes');
  });

  it('writes the package docs index artifact path', async () => {
    const outputPath = join(rootDir, 'dist', 'docs-index.sqlite');
    await writeFixture('docs/guide.md', '# First\n\nAlpha docs.\n');

    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig() });

    expect(DEFAULT_DOCS_INDEX_PATH.split(sep).slice(-2)).toEqual(['dist', 'docs-index.sqlite']);
    await expect(stat(outputPath)).resolves.toMatchObject({ size: expect.any(Number) });
  });
});
