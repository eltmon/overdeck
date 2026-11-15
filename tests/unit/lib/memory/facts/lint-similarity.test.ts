import { describe, expect, it } from 'vitest';
import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';
import {
  cosine,
  EMBEDDING_CANDIDATE_THRESHOLD,
  type Embedder,
  factText,
  LEXICAL_CANDIDATE_THRESHOLD,
  LEXICAL_DUPLICATE_THRESHOLD,
  lexicalVectors,
  scoreFactPairs,
} from '../../../../../src/lib/memory/facts/lint-similarity.js';

function fact(id: string, description: string, body = ''): MemoryFact {
  return {
    id,
    scope: 'project',
    type: 'project',
    title: id,
    description,
    tags: [],
    created: null,
    updated: null,
    source: null,
    status: 'active',
    supersedes: [],
    supersededBy: null,
    review: [],
    extra: {},
    body,
    file: `/repo/.overdeck/memory/${id}.md`,
  };
}

const FACTS = [
  fact('timestream-sieges', 'Disable timestream during sieges and caravans arrivals', 'Turn timestream off for sieges and caravans.'),
  fact('timestream-arrivals', 'Disable timestream during sieges and caravans arrivals now', 'Turn timestream off for sieges and caravans.'),
  fact('noble-rooms', 'Every noble gets four furnished rooms', 'Rooms need a bed, cabinet and coffer.'),
];

describe('lint similarity', () => {
  it('factText joins title, description and body', () => {
    expect(factText(fact('x', 'Desc', 'Body'))).toBe('x\nDesc\nBody');
  });

  it('lexical cosine of identical texts is 1 and of disjoint texts is 0', () => {
    const [a, b, c] = lexicalVectors(['caravan siege timestream', 'caravan siege timestream', 'noble bedroom furniture']);
    expect(cosine(a, b)).toBeCloseTo(1, 10);
    expect(cosine(a, c)).toBe(0);
  });

  it('flags a seeded near-duplicate pair lexically and not an unrelated pair', async () => {
    const result = await scoreFactPairs(FACTS, null);
    expect(result.method).toBe('lexical');
    expect(result.fallbackReason).toBeUndefined();
    const duplicate = result.pairs.find((pair) => pair.a === 'timestream-arrivals' && pair.b === 'timestream-sieges');
    expect(duplicate?.score).toBeGreaterThanOrEqual(LEXICAL_DUPLICATE_THRESHOLD);
    expect(result.pairs.some((pair) => pair.a === 'noble-rooms' || pair.b === 'noble-rooms')).toBe(false);
    for (const pair of result.pairs) expect(pair.score).toBeGreaterThanOrEqual(LEXICAL_CANDIDATE_THRESHOLD);
  });

  it("uses the injected embedder's vectors and model when provided", async () => {
    const vectors: Record<string, number[]> = {
      'timestream-sieges': [1, 0, 0],
      'timestream-arrivals': [0.8, 0.6, 0],
      'noble-rooms': [0, 0, 1],
    };
    const embedder: Embedder = async (texts) => ({
      model: 'fake-embed-1',
      embeddings: texts.map((text) => new Float32Array(vectors[text.split('\n')[0]])),
    });

    const result = await scoreFactPairs(FACTS, embedder);
    expect(result.method).toBe('embedding');
    expect(result.model).toBe('fake-embed-1');
    expect(result.pairs).toEqual([{ a: 'timestream-arrivals', b: 'timestream-sieges', score: expect.closeTo(0.8, 6) }]);
    expect(result.pairs[0].score).toBeGreaterThanOrEqual(EMBEDDING_CANDIDATE_THRESHOLD);
  });

  it('falls back to lexical with the reason when the embedder throws', async () => {
    const embedder: Embedder = async () => {
      throw new Error(`rate limited ${'x'.repeat(300)}`);
    };
    const result = await scoreFactPairs(FACTS, embedder);
    expect(result.method).toBe('lexical');
    expect(result.fallbackReason).toContain('rate limited');
    expect(result.fallbackReason?.length).toBe(200);
    expect(result.pairs[0]).toMatchObject({ a: 'timestream-arrivals', b: 'timestream-sieges' });
  });

  it('sorts pairs by score descending, then by ids', async () => {
    const result = await scoreFactPairs([
      fact('b-two', 'caravan siege timestream'),
      fact('a-one', 'caravan siege timestream'),
      fact('c-three', 'caravan siege timestream'),
    ], null);
    expect(result.pairs.map((pair) => `${pair.a}/${pair.b}`)).toEqual(['a-one/b-two', 'a-one/c-three', 'b-two/c-three']);
  });
});
