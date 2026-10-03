import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(() => null),
  getConversationByName: vi.fn(() => null),
}));

vi.mock('../../../lib/overdeck/conversations.js', () => conversationMocks);

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const CONV = { id: 123, name: 'conv-a', tmuxSession: 'conv-conv-a', cwd: '/workspace' };

describe('handoffStartCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    conversationMocks.getConversationByName.mockReturnValue(CONV);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('posts to the kickoff door and reports delivery', async () => {
    fetchMock = vi.fn(async (url: string) =>
      url.includes('/kickoff') ? jsonResponse(200, { success: true, conversation: { ...CONV, forkStatus: null } }) : jsonResponse(200, { ...CONV, forkStatus: null }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { handoffStartCommand } = await import('../handoff-start.js');

    const promise = handoffStartCommand('conv-a');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Started conversation conv-a — kickoff delivered');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/conversations/conv-a/kickoff');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('exits 1 when the server answers 409', async () => {
    fetchMock = vi.fn(async () => jsonResponse(409, { error: 'No held kickoff: the conversation was already started or was never held' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { handoffStartCommand } = await import('../handoff-start.js');

    await expect(handoffStartCommand('conv-a')).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('No held kickoff');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when delivery fails', async () => {
    fetchMock = vi.fn(async (url: string) =>
      url.includes('/kickoff') ? jsonResponse(200, { success: true, conversation: { ...CONV, forkStatus: 'handoff' } }) : jsonResponse(200, { ...CONV, forkStatus: 'failed', forkError: 'session boom' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { handoffStartCommand } = await import('../handoff-start.js');

    const promise = handoffStartCommand('conv-a');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Kickoff failed: session boom');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
