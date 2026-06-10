import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { getConversationSearchConfigSync, loadConfigSync, mergeConfigs } from '../config-yaml.js';

describe('conversationSearch configuration', () => {
  it('defaults to disabled with openai provider and text-embedding-3-small', () => {
    const { config } = mergeConfigs({});

    expect(config.conversationSearch).toEqual({
      enabled: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(homedir(), '.panopticon', 'conversations', 'embeddings.db'),
    });
  });

  it('merges enabled flag from YAML', () => {
    const { config } = mergeConfigs({ conversationSearch: { enabled: true } });
    expect(config.conversationSearch.enabled).toBe(true);
  });

  it('merges provider, model, apiKeyRef, and dbPath overrides', () => {
    const { config } = mergeConfigs({
      conversationSearch: {
        enabled: true,
        provider: 'openai',
        model: 'text-embedding-3-large',
        apiKeyRef: 'MY_OPENAI_KEY',
        dbPath: '/custom/path/embeddings.db',
      },
    });

    expect(config.conversationSearch).toEqual({
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-large',
      apiKeyRef: 'MY_OPENAI_KEY',
      dbPath: '/custom/path/embeddings.db',
    });
  });

  it('getConversationSearchConfigSync returns the normalized conversationSearch block', () => {
    const result = getConversationSearchConfigSync();
    const expected = loadConfigSync().config.conversationSearch;

    expect(result).toEqual(expected);
    expect(typeof result.enabled).toBe('boolean');
    expect(result.provider).toBe('openai');
    expect(typeof result.model).toBe('string');
    expect(typeof result.dbPath).toBe('string');
  });
});
