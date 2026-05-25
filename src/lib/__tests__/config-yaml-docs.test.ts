import { describe, expect, it } from 'vitest';

import { getDefaultDocsConfig, mergeConfigs, mergeDocsConfigs } from '../config-yaml.js';

describe('docs RAG configuration', () => {
  it('seeds normalized defaults for enablement, trigger, corpus, budget, embedding, and classifier', () => {
    const { config } = mergeConfigs({});

    expect(config.docs).toEqual({
      enabled: true,
      promptInjectionEnabled: true,
      cliEnabled: true,
      trigger: {
        regexes: [
          'pan',
          'panopticon',
          'cloister',
          'deacon',
          'workspace',
          'specialist',
          'harness',
          'bd',
          'beads',
          'vbrief',
          'workhorse',
        ],
        caseSensitive: false,
      },
      corpus: {
        docs: true,
        skills: true,
        rules: true,
        claudeMd: true,
        prds: false,
        prdStatuses: ['active', 'planned'],
        maxChunkTokens: 500,
      },
      budget: {
        injectionRate: 1,
        turnWindow: 10,
        maxTokensPerInjection: 3000,
        maxChunksPerInjection: 5,
        bypassClassifierThreshold: 0.85,
      },
      embedding: {
        provider: 'local',
        model: 'gte-small',
        dimensions: 384,
      },
      classifier: {
        enabled: false,
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        threshold: 0.85,
        timeoutMs: 1500,
      },
    });
  });

  it('merges YAML docs overrides over defaults', () => {
    const { config } = mergeConfigs({
      docs: {
        enabled: false,
        prompt_injection: false,
        cli: true,
        trigger: {
          regexes: ['pan docs', 'workspace container'],
          case_sensitive: true,
        },
        corpus: {
          skills: false,
          prds: true,
          prd_statuses: ['planned', 'completed'],
          max_chunk_tokens: 650,
        },
        budget: {
          injection_rate: 2,
          turn_window: 8,
          max_tokens_per_injection: 1500,
          max_chunks_per_injection: 3,
          bypass_classifier_threshold: 0.9,
        },
        embedding: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimensions: 1536,
        },
        classifier: {
          enabled: true,
          provider: 'cliproxy',
          model: 'claude-haiku-4-5',
          threshold: 0.7,
          timeout_ms: 750,
        },
      },
    });

    expect(config.docs.enabled).toBe(false);
    expect(config.docs.promptInjectionEnabled).toBe(false);
    expect(config.docs.cliEnabled).toBe(true);
    expect(config.docs.trigger).toEqual({
      regexes: ['pan docs', 'workspace container'],
      caseSensitive: true,
    });
    expect(config.docs.corpus).toEqual({
      docs: true,
      skills: false,
      rules: true,
      claudeMd: true,
      prds: true,
      prdStatuses: ['planned', 'completed'],
      maxChunkTokens: 650,
    });
    expect(config.docs.budget).toEqual({
      injectionRate: 2,
      turnWindow: 8,
      maxTokensPerInjection: 1500,
      maxChunksPerInjection: 3,
      bypassClassifierThreshold: 0.9,
    });
    expect(config.docs.embedding).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    expect(config.docs.classifier).toEqual({
      enabled: true,
      provider: 'cliproxy',
      model: 'claude-haiku-4-5',
      threshold: 0.7,
      timeoutMs: 750,
    });
  });

  it('keeps classifier disabled unless explicitly enabled', () => {
    const docs = mergeDocsConfigs({
      docs: {
        enabled: true,
        classifier: {
          provider: 'cliproxy',
          model: 'claude-haiku-4-5',
          threshold: 0.75,
          timeout_ms: 500,
        },
      },
    });

    expect(docs.classifier).toEqual({
      enabled: false,
      provider: 'cliproxy',
      model: 'claude-haiku-4-5',
      threshold: 0.75,
      timeoutMs: 500,
    });
  });

  it('returns a fresh docs default object for callers to mutate', () => {
    const first = getDefaultDocsConfig();
    first.trigger.regexes.push('mutated');
    first.corpus.prdStatuses.push('completed');

    const second = getDefaultDocsConfig();

    expect(second.trigger.regexes).not.toContain('mutated');
    expect(second.corpus.prdStatuses).toEqual(['active', 'planned']);
  });
});
