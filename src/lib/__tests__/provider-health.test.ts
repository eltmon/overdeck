import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const proxyMocks = vi.hoisted(() => ({
  ensureOpenAICompatibleProxyRunning: vi.fn(),
}));

vi.mock('../openai-compatible-proxy.js', () => ({
  ensureOpenAICompatibleProxyRunning: proxyMocks.ensureOpenAICompatibleProxyRunning,
  getOpenAICompatibleProxyBaseUrl: vi.fn((provider: string) => `http://127.0.0.1:12436/${provider}`),
}));

const { invalidateProbeCacheSync, probeProvider } = await import('../provider-health.js');
const { PROVIDERS } = await import('../providers.js');

describe('provider health Nous probe path (PAN-1168)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invalidateProbeCacheSync();
    proxyMocks.ensureOpenAICompatibleProxyRunning.mockReturnValue(Effect.succeed(undefined));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateProbeCacheSync();
    vi.useRealTimers();
  });

  it('probes Nous with GET /v1/models instead of POST /v1/messages', async () => {
    const fetchMock = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(Effect.runPromise(probeProvider(
      { ...PROVIDERS.nous, baseUrl: 'http://proxy.test/nous' },
      'sk-nous-test',
      'qwen/qwen3.6-plus',
    ))).resolves.toEqual({ ok: true });

    expect(proxyMocks.ensureOpenAICompatibleProxyRunning).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxy.test/nous/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-nous-test',
          accept: 'application/json',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/messages'),
      expect.anything(),
    );
  });

  it('classifies Nous /v1/models 401 responses as auth failures', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"bad token"}}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(Effect.runPromise(probeProvider(
      { ...PROVIDERS.nous, baseUrl: 'http://proxy.test/nous' },
      'sk-nous-auth-fails',
      'qwen/qwen3.6-plus',
    ))).resolves.toEqual({
      ok: false,
      kind: 'auth',
      status: 401,
      message: 'bad token',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://proxy.test/nous/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps non-Nous providers on POST /v1/messages', async () => {
    const fetchMock = vi.fn(async () => new Response('{"content":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(Effect.runPromise(probeProvider(
      PROVIDERS.minimax,
      'sk-minimax-test',
      'minimax-m2.7',
    ))).resolves.toEqual({ ok: true });

    expect(proxyMocks.ensureOpenAICompatibleProxyRunning).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.io/anthropic/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-minimax-test',
          'anthropic-version': '2023-06-01',
        }),
        body: JSON.stringify({
          model: 'minimax-m2.7',
          max_tokens: 1,
          messages: [{ role: 'user', content: '.' }],
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/models'),
      expect.anything(),
    );
  });
});
