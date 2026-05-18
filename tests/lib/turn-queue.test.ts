import { describe, expect, it, vi } from 'vitest';
import type { ITurnEmitter } from '../../src/voice/transcription.js';
import { createTurnQueue, isTrivialTranscript } from '../../src/voice/turn-queue.js';

function createEmitter(): ITurnEmitter & { commit(text: string): void } {
  const committedCallbacks = new Set<(text: string) => void>();
  return {
    onPartial: vi.fn(),
    onCommitted: (cb) => {
      committedCallbacks.add(cb);
    },
    onError: vi.fn(),
    sendAudio: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    commit(text: string) {
      for (const cb of committedCallbacks) cb(text);
    },
  };
}

describe('isTrivialTranscript', () => {
  it('returns true for single filler words', () => {
    expect(isTrivialTranscript('um')).toBe(true);
    expect(isTrivialTranscript('Okay.')).toBe(true);
    expect(isTrivialTranscript('draw a box')).toBe(false);
  });
});

describe('createTurnQueue', () => {
  it('flushes pending committed chunks when closed before debounce fires', () => {
    vi.useFakeTimers();
    try {
      const emitter = createEmitter();
      const onTurn = vi.fn();
      const queue = createTurnQueue(emitter, onTurn);

      emitter.commit('final phrase');
      queue.close();

      expect(onTurn).toHaveBeenCalledWith('final phrase');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces committed events within 150ms into one turn', async () => {
    vi.useFakeTimers();
    try {
      const emitter = createEmitter();
      const onTurn = vi.fn();
      createTurnQueue(emitter, onTurn);

      emitter.commit('draw a');
      await vi.advanceTimersByTimeAsync(100);
      emitter.commit('circle');
      await vi.advanceTimersByTimeAsync(149);
      expect(onTurn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onTurn).toHaveBeenCalledWith('draw a circle');
    } finally {
      vi.useRealTimers();
    }
  });
});
