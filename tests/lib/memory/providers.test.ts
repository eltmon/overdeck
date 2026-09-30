import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  getExtractionProvider,
  registerExtractionProvider,
  resolveExtractionProvider,
  resolveExtractionProviderSelection,
  isExtractionProviderAuthError,
  type ExtractionProvider,
  type ExtractionProviderOptions,
  type ExtractionProviderResult,
} from '../../../src/lib/memory/providers/index.js';
import { CliproxyExtractionProvider } from '../../../src/lib/memory/providers/cliproxy.js';
import { AnthropicExtractionProvider } from '../../../src/lib/memory/providers/anthropic.js';

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
    delete process.env.OVERDECK_MEMORY_PROVIDER;
    delete process.env.OVERDECK_MEMORY_MODEL;
    vi.restoreAllMocks();
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
    process.env.OVERDECK_MEMORY_PROVIDER = 'stub';
    process.env.OVERDECK_MEMORY_MODEL = 'stub-env-model';

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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    expect(warn).not.toHaveBeenCalled();
  });

  // PAN-4327: Sonnet 5+, Opus 4.7+ and Fable 400 on non-default temperature.
  it('omits temperature for a sampling-restricted model via cliproxy', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg-1',
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }), { status: 200 }));
    const provider = new CliproxyExtractionProvider('http://127.0.0.1:8317', fetchFn as typeof fetch);

    await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { model: 'claude-sonnet-5-5' });

    const body = JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty('temperature');
  });

  it('keeps sending temperature for a model that accepts it via cliproxy', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg-1',
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }), { status: 200 }));
    const provider = new CliproxyExtractionProvider('http://127.0.0.1:8317', fetchFn as typeof fetch);

    await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { model: 'gpt-4.1-nano' });

    const body = JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
    expect(body.temperature).toBe(0);
  });

  it('omits temperature for a sampling-restricted model via the Anthropic SDK', async () => {
    const create = vi.fn(async () => ({
      id: 'msg-2',
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }));
    const provider = new AnthropicExtractionProvider({ messages: { create } } as never);

    await provider.extract<ExtractedPayload>('summarize', { type: 'object' }, { model: 'claude-sonnet-5-5' });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('keeps sending temperature for the default Anthropic model', async () => {
    const create = vi.fn(async () => ({
      id: 'msg-3',
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }));
    const provider = new AnthropicExtractionProvider({ messages: { create } } as never);

    await provider.extract<ExtractedPayload>('summarize', { type: 'object' });

    expect(create.mock.calls[0][0]).toMatchObject({ temperature: 0 });
  });

  // PAN-4370 WI-3: the anthropic provider must not throw the SDK's generic
  // "Could not resolve authentication method" when no client is injected and
  // the environment has no credentials — it should raise a typed, actionable
  // error before even constructing the SDK client.
  it('rejects with ExtractionProviderAuthError (mentioning ANTHROPIC_API_KEY) when no client is injected and credentials are missing, without constructing an SDK client', async () => {
    const provider = new AnthropicExtractionProvider(undefined, () => false);

    await expect(provider.extract<ExtractedPayload>('summarize', { type: 'object' })).rejects.toSatisfy((error: unknown) => {
      return isExtractionProviderAuthError(error) && error.message.includes('ANTHROPIC_API_KEY');
    });
  });

  it('rejects with ExtractionProviderAuthError when an injected client throws an Anthropic AuthenticationError, and an injected client with no env key still succeeds', async () => {
    const create = vi.fn(async () => {
      throw new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers());
    });
    const provider = new AnthropicExtractionProvider({ messages: { create } } as never);

    await expect(provider.extract<ExtractedPayload>('summarize', { type: 'object' })).rejects.toSatisfy((error: unknown) => isExtractionProviderAuthError(error));

    const okCreate = vi.fn(async () => ({
      id: 'msg-4',
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }));
    const okProvider = new AnthropicExtractionProvider({ messages: { create: okCreate } } as never);

    const result = await okProvider.extract<ExtractedPayload>('summarize', { type: 'object' });
    expect(result.data).toEqual({ summary: 'ok' });
  });

  it('rejects with ExtractionProviderAuthError on cliproxy HTTP 401, and a plain Error (not the auth class) on HTTP 400', async () => {
    const unauthorizedFetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }));
    const unauthorizedProvider = new CliproxyExtractionProvider('http://127.0.0.1:8317', unauthorizedFetch as typeof fetch);

    await expect(unauthorizedProvider.extract<ExtractedPayload>('summarize', { type: 'object' })).rejects.toSatisfy((error: unknown) => isExtractionProviderAuthError(error));

    const badRequestFetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'unknown provider for model X' } }), { status: 400 }));
    const badRequestProvider = new CliproxyExtractionProvider('http://127.0.0.1:8317', badRequestFetch as typeof fetch);

    await expect(badRequestProvider.extract<ExtractedPayload>('summarize', { type: 'object' })).rejects.toSatisfy((error: unknown) => error instanceof Error && !isExtractionProviderAuthError(error));
  });
});
