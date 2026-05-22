import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnthropicMessagesUrl, invalidateProbeCacheSync, probeProvider } from '../../src/lib/provider-health.js';
import { PROVIDERS } from '../../src/lib/providers.js';

describe('provider health endpoint construction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateProbeCacheSync();
  });

  it('appends /v1/messages for provider roots that are not versioned', () => {
    expect(buildAnthropicMessagesUrl('https://api.z.ai/api/anthropic')).toBe(
      'https://api.z.ai/api/anthropic/v1/messages'
    );
  });

  it('appends /messages when the provider base URL already ends in /v1', () => {
    expect(buildAnthropicMessagesUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/messages'
    );
  });

  it('normalizes trailing slashes before appending the messages path', () => {
    expect(buildAnthropicMessagesUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1/messages'
    );
  });

  it('probes MiniMax with the same bearer auth and endpoint used by runtime routing', async () => {
    const fetchMock = vi.fn(async () => new Response('{"content":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await (await Effect.runPromise(expect(probeProvider(PROVIDERS.minimax, 'sk-minimax-test', 'minimax-m2.7'))))x-test', 'minimax-m2.7')))).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.io/anthropic/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-minimax-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });
});
