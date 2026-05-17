import { describe, expect, it } from 'vitest';
import { buildEnrichSessionsJobPayload } from '../ws-rpc.js';
import type { RuntimeConversationsConfig } from '../../../lib/config-yaml.js';

describe('ws-rpc enrichSessions payload', () => {
  it('forwards fullTranscript to the dashboard DB worker payload', () => {
    const config: RuntimeConversationsConfig = {
      compactionModel: 'claude-haiku-4-5',
      manualCompactMode: 'claude-code',
      richCompaction: true,
      titleModel: 'claude-haiku-4-5',
      watchDirs: [],
      scanMaxParallel: null,
      embeddings: false,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingAutoOnDeep: true,
      enrichment: {
        quickModel: null,
        deepModel: null,
        maxParallel: 3,
        costConfirmThreshold: 1,
      },
      apiKeys: {},
      enabledProviders: new Set(['anthropic']),
    };

    const payload = buildEnrichSessionsJobPayload({
      level: 3,
      ids: [42],
      model: 'claude-sonnet-4-6',
      customPrompt: 'focus on decisions',
      confirmed: true,
      fullTranscript: true,
    }, config);

    expect(payload).toMatchObject({
      tier: 3,
      sessionIds: [42],
      maxParallel: 3,
      modelOverride: 'claude-sonnet-4-6',
      promptSuffix: 'focus on decisions',
      fullTranscript: true,
      skipAlreadyEnriched: true,
      force: true,
    });
  });
});
