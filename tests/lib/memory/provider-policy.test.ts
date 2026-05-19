import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, resetDatabase } from '../../../src/lib/database/index.js';
import { insertCostEvent } from '../../../src/lib/database/cost-events-db.js';
import {
  extractWithProviderPolicy,
  getTodayMemoryExtractionSpendUsd,
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

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-provider-policy-'));
  process.env.PANOPTICON_HOME = tempDir;
  resetDatabase();
});

afterEach(async () => {
  closeDatabase();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

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
  it('reads today\'s memory-extraction spend from persisted cost events', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    insertCostEvent({
      ts: today.toISOString(),
      type: 'cost',
      agentId: identity.sessionId,
      issueId: identity.issueId,
      sessionType: 'memory-extraction',
      source: 'memory-extraction',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 1.25,
      requestId: 'memory-extraction-today',
      sessionId: identity.sessionId,
    });
    insertCostEvent({
      ts: yesterday.toISOString(),
      type: 'cost',
      agentId: identity.sessionId,
      issueId: identity.issueId,
      sessionType: 'memory-extraction',
      source: 'memory-extraction',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 9,
      requestId: 'memory-extraction-yesterday',
      sessionId: identity.sessionId,
    });
    insertCostEvent({
      ts: today.toISOString(),
      type: 'cost',
      agentId: identity.sessionId,
      issueId: identity.issueId,
      sessionType: 'agent',
      source: 'agent',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 5,
      requestId: 'agent-today',
      sessionId: identity.sessionId,
    });

    expect(getTodayMemoryExtractionSpendUsd(identity)).toBe(1.25);
  });

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
