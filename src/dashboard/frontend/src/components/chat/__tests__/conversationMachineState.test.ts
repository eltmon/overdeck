/** PAN-4650 WI-12: the five title-bar machine states and the header status they imply. */
import { describe, expect, it } from 'vitest';

import { acceptsInput, conversationHeaderStatus, conversationMachineState, isLiveMachineState, lastSeenText, runsHere } from '../conversationMachineState';

const FLAGS = { forking: false, spawning: false, failed: false };

describe('conversationMachineState (PAN-4650 WI-12)', () => {
  it('ac1: returns each of the five states for its input', () => {
    expect(conversationMachineState({ origin: 'local' })).toBe('local');
    expect(conversationMachineState({})).toBe('local');
    expect(conversationMachineState({ origin: 'linked', machineState: 'online' })).toBe('remote');
    expect(conversationMachineState({ origin: 'linked', machineState: 'offline', savedCopyName: 'vault-1' })).toBe('offline-saved');
    expect(conversationMachineState({ origin: 'linked', machineState: 'connecting', savedCopyName: null })).toBe('offline-none');
    expect(conversationMachineState({ origin: 'local', releasedTo: 'env-laptop' })).toBe('released');
  });

  it('takes input only in the live states and never from a vault copy', () => {
    expect(isLiveMachineState('local')).toBe(true);
    expect(isLiveMachineState('remote')).toBe(true);
    expect(isLiveMachineState('offline-saved')).toBe(false);
    expect(acceptsInput({ origin: 'linked', machineState: 'online' })).toBe(true);
    expect(acceptsInput({ origin: 'vault' })).toBe(false);
    expect(acceptsInput({ releasedTo: 'env-laptop' })).toBe(false);
    expect(runsHere({ origin: 'local' })).toBe(true);
    expect(runsHere({ origin: 'linked', machineState: 'online' })).toBe(false);
    expect(runsHere({ releasedTo: 'env-laptop' })).toBe(false);
  });

  it('labels the non-live states with a hollow neutral dot and keeps the signal law otherwise', () => {
    expect(conversationHeaderStatus({ releasedTo: 'env-laptop', sessionAlive: false }, FLAGS)).toEqual({ color: 'var(--muted-foreground)', label: 'released', hollow: true });
    expect(conversationHeaderStatus({ origin: 'linked', machineState: 'offline', sessionAlive: true }, FLAGS)).toMatchObject({ label: 'offline', hollow: true });
    expect(conversationHeaderStatus({ origin: 'linked', machineState: 'online', sessionAlive: true }, FLAGS)).toEqual({ color: 'var(--info)', label: 'active', hollow: false });
    expect(conversationHeaderStatus({ sessionAlive: false }, { ...FLAGS, failed: true })).toMatchObject({ color: 'var(--destructive)', label: 'failed' });
    expect(conversationHeaderStatus({ sessionAlive: false }, FLAGS)).toMatchObject({ label: 'ended', hollow: false });
  });

  it('writes last seen relative to now', () => {
    const now = Date.parse('2026-11-01T12:00:00.000Z');
    expect(lastSeenText(null, now)).toBe('never');
    expect(lastSeenText('2026-11-01T11:59:40.000Z', now)).toBe('just now');
    expect(lastSeenText('2026-11-01T11:48:00.000Z', now)).toBe('12 min ago');
    expect(lastSeenText('2026-11-01T09:00:00.000Z', now)).toBe('3 h ago');
  });
});
