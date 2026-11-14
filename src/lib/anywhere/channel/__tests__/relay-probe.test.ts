import { describe, expect, it, vi } from 'vitest';

import { probeRelayCandidate, type RelayProbePeer } from '../relay-probe.js';

type Candidate = { toJSON(): { candidate?: string } };

function fakePeer(opts: { onSetLocalDescription?: (emit: (candidate: Candidate) => void) => Promise<void> } = {}) {
  let handler: ((candidate: Candidate | undefined) => void) | undefined;
  const close = vi.fn(async () => undefined);
  const peer: RelayProbePeer = {
    onIceCandidate: {
      subscribe: (h) => {
        handler = h;
        return { unSubscribe: () => undefined };
      },
    },
    createDataChannel: vi.fn(),
    createOffer: vi.fn(async () => ({})),
    setLocalDescription: vi.fn(async () => {
      if (opts.onSetLocalDescription) await opts.onSetLocalDescription((candidate) => handler?.(candidate));
    }),
    close,
  };
  return { peer, close };
}

describe('probeRelayCandidate (PAN-5242 WI-7)', () => {
  it('returns failed without creating a peer when the relay list has no TURN server', async () => {
    const createPeer = vi.fn();
    const result = await probeRelayCandidate([], { createPeer });
    expect(result).toEqual({ state: 'failed', relayCandidates: 0, turnUrl: null, elapsedMs: 0, detail: 'the relay list has no TURN server' });
    expect(createPeer).not.toHaveBeenCalled();
  });

  it('counts a relay candidate gathered during setLocalDescription', async () => {
    const { peer, close } = fakePeer({
      onSetLocalDescription: async (emit) => {
        emit({ toJSON: () => ({ candidate: 'candidate:1 1 udp 1 203.0.113.9 5000 typ relay raddr 0.0.0.0 rport 0' }) });
      },
    });
    const createPeer = vi.fn(() => peer);
    const result = await probeRelayCandidate([{ urls: ['turns:turn.example:443'], username: 'u', credential: 'p' }], { createPeer });
    expect(result).toEqual({ state: 'ok', relayCandidates: 1, turnUrl: 'turns:turn.example:443', elapsedMs: expect.any(Number) });
    expect(close).toHaveBeenCalled();
  });

  it('fails after 12 s when setLocalDescription never resolves', async () => {
    vi.useFakeTimers();
    try {
      const { peer, close } = fakePeer({ onSetLocalDescription: () => new Promise<void>(() => undefined) });
      const createPeer = vi.fn(() => peer);
      const promise = probeRelayCandidate([{ urls: ['turns:turn.example:443'] }], { createPeer });
      await vi.advanceTimersByTimeAsync(12_000);
      const result = await promise;
      expect(result.state).toBe('failed');
      expect(result.state === 'failed' ? result.detail : '').toContain('12 s');
      expect(close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with zero relay candidates against a closed TURN port (real werift)', async () => {
    const result = await probeRelayCandidate([{ urls: ['turn:127.0.0.1:1?transport=tcp'], username: 'u', credential: 'p' }]);
    expect(result.state).toBe('failed');
    expect(result.relayCandidates).toBe(0);
    expect(result.turnUrl).toBe('turn:127.0.0.1:1?transport=tcp');
  }, 5_000);
});
