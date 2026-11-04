import { describe, expect, it, vi } from 'vitest';

import { ConnectionError } from '../connection';
import { currentMachine, lastDialError, onSessionChange, setSession } from '../session';
import type { PairedMachine } from '../types';

const MACHINE: PairedMachine = {
  environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b',
  label: 'desk',
  machineKeyHex: 'ab'.repeat(32),
  linkPublicKeyHex: 'cd'.repeat(32),
  linkSecretKeyHex: 'ef'.repeat(32),
  token: 'opt_phone_token',
  tokenId: 'tok-1',
  pairedAt: '2026-11-03T00:00:00.000Z',
};

describe('session', () => {
  it('has no current machine until one is selected', () => {
    setSession(null, null);
    expect(currentMachine()).toBeNull();
  });

  it('routes to the selected machine with its phone token and dials its link channel', async () => {
    const stream = { marker: 'stream' };
    const openLink = vi.fn(async () => stream as never);
    setSession(MACHINE, { openLink });
    const machine = currentMachine();
    expect(machine?.environmentId).toBe(MACHINE.environmentId);
    expect(machine?.bearerToken).toBe('opt_phone_token');
    await expect(machine?.dial()).resolves.toBe(stream);
    expect(openLink).toHaveBeenCalledWith(MACHINE);
    setSession(null, null);
  });

  it('publishes a dial ConnectionError and clears it on the next selection', async () => {
    const removed = new ConnectionError('removed', 'This phone was removed from desk. Pair again.');
    setSession(MACHINE, { openLink: async () => Promise.reject(removed) });
    const listener = vi.fn();
    const off = onSessionChange(listener);
    await expect(currentMachine()?.dial()).rejects.toBe(removed);
    expect(lastDialError()).toBe(removed);
    expect(listener).toHaveBeenCalledTimes(1);
    setSession(null, null);
    expect(lastDialError()).toBeNull();
    off();
  });
  it('clears the dial error when a later dial succeeds (PAN-5018)', async () => {
    const failed = new ConnectionError('other', 'Could not open a secure channel to desk.');
    let fail = true;
    const stream = { marker: 'stream' };
    setSession(MACHINE, { openLink: async () => (fail ? Promise.reject(failed) : (stream as never)) });
    const listener = vi.fn();
    const off = onSessionChange(listener);
    await expect(currentMachine()?.dial()).rejects.toBe(failed);
    expect(lastDialError()).toBe(failed);
    fail = false;
    await expect(currentMachine()?.dial()).resolves.toBe(stream);
    expect(lastDialError()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    setSession(null, null);
    off();
  });
});
