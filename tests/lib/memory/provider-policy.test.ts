import { describe, expect, it, vi } from 'vitest';
import {
  extractWithProviderPolicy,
  registerExtractionProvider,
  type ExtractionProvider,
  type ExtractionProviderOptions,
  type ExtractionProviderResult,
} from '../../../src/lib/memory/providers/index.js';

interface ExtractedPayload {
  summary: string;
}

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

class TestProvider implements ExtractionProvider {
  readonly calls: string[] = [];

  constructor(
    readonly name: string,
    readonly defaultModel: string,
    private readonly behavior: 'success' | 'fail',
  ) {}

  async extract<T>(
    prompt: string,
    _jsonSchema: unknown,
    options: ExtractionProviderOptions = {},
  ): Promise<ExtractionProviderResult<T>> {
    this.calls.push(prompt);
    if (this.behavior === 'fail') throw new Error(`${this.name} failed`);
    return {
      data: { summary: `${this.name} ok` } as T,
      usage: { input: 1, output: 1 },
      cost: { usd: 0.001 },
      model: options.model ?? this.defaultModel,
      provider: this.name,
    };
  }
}

describe('memory extraction provider policy', () => {
  it('skips extraction when today\'s memory-extraction spend is at the cap', async () => {
    const provider = new TestProvider('cap-provider', 'cap-model', 'success');
    const recordHealth = vi.fn(async () => undefined);
    registerExtractionProvider(provider);

    const result = await extractWithProviderPolicy<ExtractedPayload>('summarize', { type: 'object' }, {
      identity,
      perDayCostCapUsd: 5,
    }, {
      selection: { provider: 'cap-provider', model: 'cap-model', fallbackChain: [], source: 'settings' },
      getDailySpendUsd: () => 5,
      recordHealth,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'cost-cap' });
    expect(provider.calls).toHaveLength(0);
    expect(recordHealth).toHaveBeenCalledWith(identity, {
      status: 'degraded',
      reason: 'cost-cap',
      success: false,
    });
  });

  it('tries one fallback provider after the primary provider fails', async () => {
    const primary = new TestProvider('primary-fail', 'primary-model', 'fail');
    const fallback = new TestProvider('fallback-ok', 'fallback-model', 'success');
    registerExtractionProvider(primary);
    registerExtractionProvider(fallback);

    const result = await extractWithProviderPolicy<ExtractedPayload>('summarize', { type: 'object' }, {
      identity,
    }, {
      selection: {
        provider: 'primary-fail',
        model: 'primary-model',
        fallbackChain: [{ provider: 'fallback-ok', model: 'fallback-model' }],
        source: 'settings',
      },
      getDailySpendUsd: () => 0,
      recordHealth: vi.fn(async () => undefined),
    });

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(result.status).toBe('extracted');
    if (result.status === 'extracted') {
      expect(result.provider).toBe('fallback-ok');
      expect(result.result.data).toEqual({ summary: 'fallback-ok ok' });
    }
  });

  it('drops extraction after primary and fallback both fail', async () => {
    registerExtractionProvider(new TestProvider('primary-double-fail', 'primary-model', 'fail'));
    registerExtractionProvider(new TestProvider('fallback-double-fail', 'fallback-model', 'fail'));
    const recordHealth = vi.fn(async () => undefined);

    const result = await extractWithProviderPolicy<ExtractedPayload>('summarize', { type: 'object' }, {
      identity,
    }, {
      selection: {
        provider: 'primary-double-fail',
        model: 'primary-model',
        fallbackChain: [{ provider: 'fallback-double-fail', model: 'fallback-model' }],
        source: 'settings',
      },
      getDailySpendUsd: () => 0,
      recordHealth,
    });

    expect(result.status).toBe('dropped');
    if (result.status === 'dropped') expect(result.reason).toBe('extraction-failed');
    expect(recordHealth).toHaveBeenCalledWith(identity, {
      status: 'failing',
      reason: 'extraction-failed',
      success: false,
    });
  });
});
