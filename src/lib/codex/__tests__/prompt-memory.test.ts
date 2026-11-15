import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCodexPromptMemory, CODEX_PROMPT_MEMORY_TIMEOUT_MS } from '../prompt-memory.js';

const BASE_URL = 'http://127.0.0.1:3011';

function deps(overrides: Parameters<typeof applyCodexPromptMemory>[1] = {}) {
  return {
    token: () => 'internal-secret',
    baseUrl: () => BASE_URL,
    env: {} as NodeJS.ProcessEnv,
    ...overrides,
  };
}

describe('applyCodexPromptMemory (PAN-5359)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the wrapped text and contextChars on a 202 ok response, and posts prompt/sessionId/agentId/conversation plus the token header', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, context: 'MEM' }), { status: 202 }));

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: '01a1-thread', conversation: 'conv-c1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(result).toEqual({ text: '<overdeck-turn-context>\nMEM\n</overdeck-turn-context>\n\nbuild it', contextChars: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/api/memory/inject`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-overdeck-internal-token']).toBe('internal-secret');
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: 'build it',
      sessionId: '01a1-thread',
      agentId: 'conv-c1',
      conversation: 'conv-c1',
    });
  });

  it('never calls fetch and returns the original prompt when OVERDECK_BARE_CONTEXT=1', async () => {
    const fetchImpl = vi.fn();

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch, env: { OVERDECK_BARE_CONTEXT: '1' } as NodeJS.ProcessEnv }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never calls fetch and returns the original prompt when there is no internal token', async () => {
    const fetchImpl = vi.fn();

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch, token: () => null }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the original prompt on a fetch rejection', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
  });

  it('falls back to the original prompt on an HTTP 500', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
  });

  it('falls back to the original prompt when the context is empty', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, context: '' }), { status: 202 }));

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
  });

  it('falls back to the original prompt when the context contains the close marker', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, context: 'has </overdeck-turn-context> inside' }),
      { status: 202 },
    ));

    const result = await applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(result).toEqual({ text: 'build it', contextChars: 0 });
  });

  it('times out at 1500ms using fake timers, with no real wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const resultPromise = applyCodexPromptMemory(
      { prompt: 'build it', agentId: 'conv-c1', sessionId: 's1' },
      deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    await vi.advanceTimersByTimeAsync(CODEX_PROMPT_MEMORY_TIMEOUT_MS);

    await expect(resultPromise).resolves.toEqual({ text: 'build it', contextChars: 0 });
  });
});
