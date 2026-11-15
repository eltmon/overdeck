import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FACT_VECTOR_REFRESH_TIMEOUT_MS,
  factContentHash,
  factVectorCachePath,
  readFactVectors,
  refreshFactVectors,
  refreshStoreVectorsBestEffort,
  type DocsEmbeddingConfig,
} from '../../../../../src/lib/memory/facts/vectors.js';
import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';

function makeFact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    scope: 'project',
    type: 'feedback',
    title: '',
    description: '',
    tags: [],
    updated: null,
    source: null,
    review: [],
    body: '',
    always: false,
    file: `/facts/${overrides.id}.md`,
    ...overrides,
  };
}

const config: DocsEmbeddingConfig = { provider: 'local', model: 'gte-small', dimensions: 4 };

describe('memory fact vector cache', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-fact-vectors-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function vectorOf(n: number): Float32Array {
    return new Float32Array([n, 0, 0, 0]);
  }

  it('embeds only facts whose content hash is missing', async () => {
    const factA = makeFact({ id: 'fact-a', title: 'A', description: 'Alpha' });
    const factB = makeFact({ id: 'fact-b', title: 'B', description: 'Beta' });
    const embed = vi.fn(async () => vectorOf(1));

    const first = await refreshFactVectors({ facts: [factA], config, embed });
    expect(first).toEqual({ embedded: 1, reused: 0 });
    expect(embed).toHaveBeenCalledTimes(1);

    embed.mockClear();
    const second = await refreshFactVectors({ facts: [factA, factB], config, embed });
    expect(second).toEqual({ embedded: 1, reused: 1 });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('a second refresh over unchanged facts calls the embed function zero times', async () => {
    const fact = makeFact({ id: 'unchanged-fact', title: 'U', description: 'Unchanged' });
    const embed = vi.fn(async () => vectorOf(2));

    await refreshFactVectors({ facts: [fact], config, embed });
    embed.mockClear();
    const result = await refreshFactVectors({ facts: [fact], config, embed });

    expect(result).toEqual({ embedded: 0, reused: 1 });
    expect(embed).not.toHaveBeenCalled();
  });

  it('reuses a vector after the same fact text moves to another store', async () => {
    const sharedTitle = 'Shared';
    const sharedDescription = 'Identical text across two stores';
    const factInStoreOne = makeFact({ id: 'store-one-fact', title: sharedTitle, description: sharedDescription, file: '/store-one/fact.md' });
    const factInStoreTwo = makeFact({ id: 'store-two-fact', title: sharedTitle, description: sharedDescription, file: '/store-two/fact.md' });
    const embed = vi.fn(async () => vectorOf(3));

    const first = await refreshFactVectors({ facts: [factInStoreOne], config, embed });
    const second = await refreshFactVectors({ facts: [factInStoreTwo], config, embed });

    expect(first.embedded + second.embedded).toBe(1);
    expect(second.reused).toBe(1);
    expect(factContentHash(factInStoreOne)).toBe(factContentHash(factInStoreTwo));
  });

  it('discards a cache built with another model', async () => {
    const fact = makeFact({ id: 'model-switch-fact', title: 'M', description: 'Model switch' });
    await refreshFactVectors({ facts: [fact], config, embed: async () => vectorOf(4) });

    const otherModelConfig: DocsEmbeddingConfig = { ...config, model: 'other-model' };
    const embed = vi.fn(async () => vectorOf(5));
    const result = await refreshFactVectors({ facts: [fact], config: otherModelConfig, embed });

    expect(result).toEqual({ embedded: 1, reused: 0 });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map for a missing or corrupt cache', async () => {
    expect(await readFactVectors(config)).toEqual(new Map());

    mkdirSync(join(process.env.OVERDECK_HOME as string, 'cache'), { recursive: true });
    writeFileSync(factVectorCachePath(), 'not json', 'utf8');
    expect(await readFactVectors(config)).toEqual(new Map());

    writeFileSync(factVectorCachePath(), JSON.stringify({ version: 2, provider: 'local', model: 'gte-small', dimensions: 4, vectors: {} }), 'utf8');
    expect(await readFactVectors(config)).toEqual(new Map());
  });

  it('writes the cache atomically', async () => {
    const fact = makeFact({ id: 'atomic-fact', title: 'A', description: 'Atomic write' });
    await refreshFactVectors({ facts: [fact], config, embed: async () => vectorOf(6) });

    const raw = JSON.parse(readFileSync(factVectorCachePath(), 'utf8'));
    expect(raw).toMatchObject({ version: 1, provider: 'local', model: 'gte-small', dimensions: 4 });
    expect(Object.keys(raw.vectors)).toEqual([factContentHash(fact)]);

    const cacheDir = join(process.env.OVERDECK_HOME as string, 'cache');
    const leftoverTmp = readdirSync(cacheDir).filter((name) => name.endsWith('.tmp'));
    expect(leftoverTmp).toEqual([]);
  });

  it('best-effort refresh reports a timeout without throwing', async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = () => new Promise<{ embedded: number; reused: number }>(() => {});
      const resultPromise = refreshStoreVectorsBestEffort({
        stores: [],
        config,
        refresh: neverResolves as unknown as typeof refreshFactVectors,
      });

      await vi.advanceTimersByTimeAsync(FACT_VECTOR_REFRESH_TIMEOUT_MS);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.timedOut).toBe(true);
        expect(result.reason).toContain('timed out');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
