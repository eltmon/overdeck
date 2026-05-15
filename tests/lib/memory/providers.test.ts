import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getExtractionProvider,
  registerExtractionProvider,
  resolveExtractionProvider,
  resolveExtractionProviderSelection,
  type ExtractionProvider,
  type ExtractionProviderOptions,
  type ExtractionProviderResult,
} from '../../../src/lib/memory/providers/index.js';
import { CliproxyExtractionProvider } from '../../../src/lib/memory/providers/cliproxy.js';

interface ExtractedPayload {
  summary: string;
}

class StubExtractionProvider implements ExtractionProvider {
  readonly name = 'stub';
  readonly defaultModel = 'stub-model';

  async extract<T>(
    _prompt: string,
    _jsonSchema: unknown,
    options: ExtractionProviderOptions = {},
  ): Promise<ExtractionProviderResult<T>> {
    return {
      data: { summary: 'ok' } as T,
      usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
      cost: { usd: 0 },
      model: options.model ?? this.defaultModel,
      provider: this.name,
      requestId: 'stub-request',
    };
  }
}

describe('memory extraction providers', () => {
  afterEach(() => {
    delete process.env.PANOPTICON_MEMORY_PROVIDER;
    delete process.env.PANOPTICON_MEMORY_MODEL;
  });

  it('round-trips a stub provider through the registry', async () => {
    registerExtractionProvider(new StubExtractionProvider());

    const provider = getExtractionProvider('stub');
    const result = await provider.extract<ExtractedPayload>('summarize', { type: 'object' });

    expect(result).toMatchObject({
      data: { summary: 'ok' },
      model: 'stub-model',
      provider: 'stub',
      requestId: 'stub-request',
    });
  });

  it('lets memory provider env vars override settings', async () => {
    registerExtractionProvider(new StubExtractionProvider());
    process.env.PANOPTICON_MEMORY_PROVIDER = 'stub';
    process.env.PANOPTICON_MEMORY_MODEL = 'stub-env-model';

    const selection = await resolveExtractionProviderSelection({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    const resolved = await resolveExtractionProvider({ provider: 'anthropic' });

    expect(selection).toEqual({
      provider: 'stub',
      model: 'stub-env-model',
      fallbackChain: [],
      source: 'env',
    });
    expect(resolved.provider.name).toBe('stub');
    expect(resolved.model).toBe('stub-env-model');
  });

  it('routes cliproxy extraction through the local Anthropic-compatible messages endpoint', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg-1',
      content: [{ type: 'text', text: '{"summary":"cliproxy ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }), { status: 200 }));
    const provider = new CliproxyExtractionProvider('http://127.0.0.1:8317', fetchFn as typeof fetch);

    const result = await provider.extract<ExtractedPayload>('summarize', { type: 'object' });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:8317/v1/messages');
    expect(result).toMatchObject({
      data: { summary: 'cliproxy ok' },
      model: 'gpt-4.1-nano',
      provider: 'cliproxy',
      usage: { input: 10, output: 4 },
    });
    expect(result.cost.usd).toBeGreaterThan(0);
  });
});
