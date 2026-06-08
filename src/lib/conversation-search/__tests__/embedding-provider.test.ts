import { describe, expect, it, vi } from 'vitest';

import {
  ConversationEmbeddingUnavailableError,
  createConversationEmbeddingProvider,
  estimateConversationEmbeddingCost,
  estimateTokenCount,
} from '../embedding-provider.js';
import type { NormalizedConversationSearchConfig } from '../../config-yaml.js';

function config(overrides: Partial<NormalizedConversationSearchConfig> = {}): NormalizedConversationSearchConfig {
  return {
    enabled: true,
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKeyRef: undefined,
    dbPath: '/tmp/embeddings.db',
    ...overrides,
  };
}

describe('conversation embedding provider', () => {
  it('embeds texts in one batch using the configured OpenAI model', async () => {
    const embeddingModel = { id: 'embedding-model' };
    const createOpenAI = vi.fn(() => ({ embedding: vi.fn(() => embeddingModel) }));
    const embedMany = vi.fn(async () => ({
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
      usage: { tokens: 12 },
    }));

    const provider = createConversationEmbeddingProvider({
      config: config({ model: 'text-embedding-3-large', apiKeyRef: 'PAN_OPENAI_KEY' }),
      env: { PAN_OPENAI_KEY: 'sk-test' },
      createOpenAI,
      embedMany,
    });

    const result = await provider.embed(['alpha', 'beta']);

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(embedMany).toHaveBeenCalledWith({ model: embeddingModel, values: ['alpha', 'beta'] });
    expect(result.model).toBe('text-embedding-3-large');
    expect(result.tokenCount).toBe(12);
    expect(result.embeddings).toEqual([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])]);
  });

  it('returns unavailable when disabled or missing an API key', async () => {
    const disabled = createConversationEmbeddingProvider({ config: config({ enabled: false }), env: { OPENAI_API_KEY: 'sk-test' } });
    await expect(disabled.embed(['hello'])).rejects.toThrow(ConversationEmbeddingUnavailableError);

    const missingKey = createConversationEmbeddingProvider({ config: config({ apiKeyRef: 'MISSING_KEY' }), env: {} });
    expect(missingKey.enabled).toBe(false);
    expect(missingKey.unavailableReason).toBe('MISSING_KEY is not set');
    await expect(missingKey.embed(['hello'])).rejects.toThrow(/MISSING_KEY is not set/);
  });

  it('returns an empty embedding batch without calling the provider', async () => {
    const embedMany = vi.fn();
    const provider = createConversationEmbeddingProvider({
      config: config(),
      env: { OPENAI_API_KEY: 'sk-test' },
      createOpenAI: vi.fn(() => ({ embedding: vi.fn() })),
      embedMany,
    });

    await expect(provider.embed([])).resolves.toEqual({ embeddings: [], model: 'text-embedding-3-small', tokenCount: 0 });
    expect(embedMany).not.toHaveBeenCalled();
  });

  it('estimates token count and USD cost from configured model price', () => {
    expect(estimateTokenCount(['abcd', 'abcde'])).toBe(3);

    const estimate = estimateConversationEmbeddingCost(['a'.repeat(4000)], { model: 'text-embedding-3-large' });

    expect(estimate).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-large',
      tokenCount: 1000,
      pricePerMillionTokens: 0.13,
    });
    expect(estimate.estimatedUsd).toBeCloseTo(0.00013);
  });
});
