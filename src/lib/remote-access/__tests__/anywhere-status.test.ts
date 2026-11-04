import { afterEach, describe, expect, it } from 'vitest';

import { readDirectoryStatus, readRelayStatus, setDirectoryStatusSource, setRelayStatusSource } from '../anywhere-status.js';

afterEach(() => {
  setDirectoryStatusSource(null);
  setRelayStatusSource(null);
});

describe('Anywhere status directory and relay sources (PAN-2356 WI-18)', () => {
  it('reports null until the dashboard registers a source', () => {
    expect(readDirectoryStatus()).toBeNull();
    expect(readRelayStatus()).toBeNull();
  });

  it('reads the registered sources on every call', () => {
    let bytesUsed = 1;
    setDirectoryStatusSource(() => ({ state: 'online', plan: 'tester', url: 'https://connect.overdeck.ai', refusal: null }));
    setRelayStatusSource(() => ({ using: true, bytesUsed, capBytes: 50_000_000_000, stopped: false }));
    expect(readDirectoryStatus()).toEqual({ state: 'online', plan: 'tester', url: 'https://connect.overdeck.ai', refusal: null });
    expect(readRelayStatus()?.bytesUsed).toBe(1);
    bytesUsed = 2;
    expect(readRelayStatus()?.bytesUsed).toBe(2);
    setRelayStatusSource(null);
    expect(readRelayStatus()).toBeNull();
  });
});
