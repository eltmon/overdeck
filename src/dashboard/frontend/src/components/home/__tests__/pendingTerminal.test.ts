import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PENDING_TERMINAL_EVENT,
  peekPendingTerminal,
  takePendingTerminal,
  writePendingTerminal,
} from '../pendingTerminal';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pendingTerminal', () => {
  it('round-trips a command for its deck', () => {
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    expect(peekPendingTerminal('proj-a')).toBe('npm test');
  });

  it('take deletes and a second take returns null', () => {
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    expect(takePendingTerminal('proj-a')).toBe('npm test');
    expect(takePendingTerminal('proj-a')).toBeNull();
  });

  it('peek does not delete', () => {
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    expect(peekPendingTerminal('proj-a')).toBe('npm test');
    expect(peekPendingTerminal('proj-a')).toBe('npm test');
    expect(takePendingTerminal('proj-a')).toBe('npm test');
  });

  it('ignores a record for another deck', () => {
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    expect(peekPendingTerminal('proj-b')).toBeNull();
    expect(takePendingTerminal('proj-b')).toBeNull();
    // untouched for the deck it belongs to
    expect(peekPendingTerminal('proj-a')).toBe('npm test');
  });

  it('ignores a record older than 30 s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    vi.setSystemTime(30_001);
    expect(peekPendingTerminal('proj-a')).toBeNull();
    expect(takePendingTerminal('proj-a')).toBeNull();
  });

  it('write dispatches the pending-terminal event', () => {
    const listener = vi.fn();
    window.addEventListener(PENDING_TERMINAL_EVENT, listener);
    try {
      writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0]?.[0] as CustomEvent<{ deckKey: string }>;
      expect(event.detail).toEqual({ deckKey: 'proj-a' });
    } finally {
      window.removeEventListener(PENDING_TERMINAL_EVENT, listener);
    }
  });
});
