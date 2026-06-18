import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../config-yaml.js';
import { buildDocsIndex, type DocsEmbeddingInput } from '../index-builder.js';
import {
  formatDocsQueryJson,
  formatDocsQueryMarkdown,
  queryDocsIndex,
  sanitizeDocsFtsQuery,
} from '../query.js';

let rootDir: string;
let syncSourcesRoot: string;
let outputPath: string;

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
      dimensions: 2,
      model: 'test-query-embedding',
      ...overrides.embedding,
    },
  };
}

function embeddingFor(input: DocsEmbeddingInput): Float32Array {
  if (input.chunk.docPath.includes('semantic-neighbor')) return new Float32Array([1, 0]);
  if (input.chunk.docPath.includes('skill')) return new Float32Array([1, 0]);
  if (input.chunk.content.includes('alpha')) return new Float32Array([1, 0]);
  return new Float32Array([0, 1]);
}

describe('docs query library', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-query-'));
    syncSourcesRoot = join(rootDir, 'sync-sources');
    outputPath = join(rootDir, 'dist', 'docs-index.sqlite');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('sanitizes malformed, empty, and punctuation-only FTS prompts without throwing', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nAlpha docs.\n');
    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig(), embeddingFn: embeddingFor });

    expect(sanitizeDocsFtsQuery('')).toBeNull();
    expect(sanitizeDocsFtsQuery('?!?:*')).toBeNull();
    expect(() => queryDocsIndex({ indexPath: outputPath, query: '"unterminated NEAR() * :', top: 5 })).not.toThrow();
    expect(queryDocsIndex({ indexPath: outputPath, query: '"unterminated NEAR() * :', top: 5 }).results).toEqual([]);
  });

  it('combines BM25 matches and stored-vector similarity with reciprocal rank fusion and doc kind priority', async () => {
    await writeFixture('docs/alpha.md', '# Alpha\n\nAlpha exact match.\n');
    await writeFixture('docs/semantic-neighbor.md', '# Neighbor\n\nRelated workspace guidance.\n');
    await writeFixture('docs/other.md', '# Other\n\nUnrelated beta material.\n');
    await writeFixture('sync-sources/skills/pan-alpha/SKILL.md', '# Alpha Skill\n\nAlpha exact match.\n');

    await buildDocsIndex({
      outputPath,
      rootDir,
      syncSourcesRoot,
      config: docsConfig({ corpus: { skills: true } }),
      embeddingFn: embeddingFor,
    });

    const result = queryDocsIndex({ indexPath: outputPath, query: 'alpha', top: 4, maxTokens: 100 });

    expect(result.results.map((item) => item.docPath)).toContain('docs/semantic-neighbor.md');
    expect(result.results[0].docKind).toBe('docs');
    expect(result.results.every((item) => item.scores.rrf > 0)).toBe(true);
    expect(result.results.some((item) => item.scores.bm25 !== undefined)).toBe(true);
    expect(result.results.some((item) => item.scores.vector !== undefined)).toBe(true);
  });

  it('formats bounded markdown snippets with path, heading, and anchor provenance', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nAlpha one two three four five six.\n');
    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig(), embeddingFn: embeddingFor });

    const result = queryDocsIndex({ indexPath: outputPath, query: 'alpha', top: 1, maxTokens: 4 });
    const markdown = formatDocsQueryMarkdown(result);

    expect(markdown).toContain('<overdeck-docs>');
    expect(markdown).toContain('## docs/guide.md → Guide (#guide)');
    expect(markdown).toContain('# Guide Alpha one');
    expect(markdown).toContain('</overdeck-docs>');
    expect(result.results[0].tokenCount).toBeLessThanOrEqual(4);
  });

  it('formats JSON responses and never calls embedding providers or network APIs during query', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nAlpha docs.\n');
    await buildDocsIndex({ outputPath, rootDir, syncSourcesRoot, config: docsConfig(), embeddingFn: embeddingFor });
    const fetchMock = vi.fn(() => { throw new Error('network should not be called'); });
    vi.stubGlobal('fetch', fetchMock);

    const result = queryDocsIndex({ indexPath: outputPath, query: 'alpha', top: 1 });
    const json = JSON.parse(formatDocsQueryJson(result)) as { results: Array<{ docPath: string }> };

    expect(fetchMock).not.toHaveBeenCalled();
    expect(json.results[0].docPath).toBe('docs/guide.md');
  });
});
