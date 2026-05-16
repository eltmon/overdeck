import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWhiteboardSession } from '../../src/autopreso/session.js';
import * as agent from '../../src/autopreso/agent.js';

describe('createWhiteboardSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exposes direct state and initializes agent history after warmup', async () => {
    vi.spyOn(agent, 'runWhiteboardWarmupOnce').mockResolvedValueOnce(undefined);
    const session = createWhiteboardSession();

    const snapshot = session.start([{ id: 'one', text: 'Draw launch plan' }]);
    expect(snapshot.mode).toBe('live');
    expect(session.mode).toBe('live');
    expect(session.elements[0]).toMatchObject({ id: 'one', text: 'Draw launch plan' });
    expect(session.canvasDirtyForAgent).toBe(true);

    await vi.waitFor(() => expect(session.warmupStatus).toBe('ready'));
    expect(session.agentHistory).toEqual([
      { role: 'user', content: expect.stringContaining('Draw launch plan') },
      { role: 'assistant', content: 'UNDERSTOOD' },
    ]);
    expect(session.canvasDirtyForAgent).toBe(false);
  });

  it('retries warmup up to 8 times with capped exponential backoff', async () => {
    vi.useFakeTimers();
    const warmup = vi.spyOn(agent, 'runWhiteboardWarmupOnce');
    warmup.mockRejectedValue(new Error('not ready'));
    try {
      const session = createWhiteboardSession();
      session.start([{ id: 'one', text: 'Retry me' }]);

      await vi.advanceTimersByTimeAsync(0);
      expect(warmup).toHaveBeenCalledTimes(1);

      let expectedCalls = 1;
      for (const delay of [2000, 4000, 8000, 16000, 30000, 30000, 30000]) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(warmup).toHaveBeenCalledTimes(expectedCalls);
        await vi.advanceTimersByTimeAsync(1);
        expectedCalls += 1;
        expect(warmup).toHaveBeenCalledTimes(expectedCalls);
      }

      expect(warmup).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.warmupStatus).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending transcript turns once the busy-agent queue is full', () => {
    vi.spyOn(agent, 'runWhiteboardAgent').mockImplementation(() => new Promise(() => {}));
    const session = createWhiteboardSession();
    session.mode = 'live';

    expect(session.processTranscript('active turn', { autopreso: { provider: 'openai', model: 'gpt-4.1-mini' } }).accepted).toBe(true);
    for (let index = 0; index < 8; index += 1) {
      expect(session.processTranscript(`queued turn ${index}`, { autopreso: { provider: 'openai', model: 'gpt-4.1-mini' } })).toMatchObject({ accepted: true, coalesced: true });
    }
    expect(session.processTranscript('overflow turn', { autopreso: { provider: 'openai', model: 'gpt-4.1-mini' } })).toMatchObject({ accepted: false, coalesced: true });
  });

  it('resets to staging state', () => {
    const session = createWhiteboardSession();
    session.start([{ id: 'one' }]);

    const snapshot = session.reset();
    expect(snapshot.mode).toBe('staging');
    expect(session.mode).toBe('staging');
    expect(session.elements).toEqual([]);
    expect(session.agentHistory).toEqual([]);
    expect(session.canvasDirtyForAgent).toBe(false);
  });
});
