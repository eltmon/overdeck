import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDENTITY = vi.hoisted(() => ({ clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'ee'.repeat(32) }));

vi.mock('@capacitor/app', () => ({
  App: { getLaunchUrl: vi.fn(async () => undefined), addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));
vi.mock('../../native/keys', async () => {
  const { OverdeckKeysWeb } = await import('../../native/keys-web');
  return { OverdeckKeys: new OverdeckKeysWeb(), loadIdentity: async () => IDENTITY };
});
vi.mock('../directory', () => ({
  createDirectory: () => ({
    client: { state: 'online', machines: [], refusal: null, onStateChange: () => () => undefined, start: vi.fn(async () => undefined), stop: vi.fn(), send: vi.fn(() => true) },
    dialer: { close: vi.fn() },
    relayStopped: () => false,
  }),
  useDirectoryState: (client: { state: string }) => client.state,
  useDirectoryMachines: (client: { machines: unknown[] }) => client.machines,
}));
vi.mock('../connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../connection')>();
  return {
    ...actual,
    createConnection: () => ({
      openLink: async () => {
        throw new actual.ConnectionError('removed', actual.connectionText.removed('desk'));
      },
      openPairing: vi.fn(),
      dialRaw: vi.fn(),
      forgetRoutes: vi.fn(),
    }),
  };
});
// The machine view dials as the shims would when MobileApp opens its RPC socket.
vi.mock('../MachineView', async () => {
  const { useEffect } = await import('react');
  const { currentMachine } = await import('../session');
  return {
    MachineView: () => {
      useEffect(() => {
        void currentMachine()?.dial().catch(() => undefined);
      }, []);
      return <p>machine view</p>;
    },
  };
});

import ShellApp from '../ShellApp';
import { CURRENT_MACHINE_KEY, readMachines, useShellStore, writeAccount, writeMachines } from '../store';
import type { PairedMachine } from '../types';

const MACHINE: PairedMachine = {
  environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b',
  label: 'desk',
  machineKeyHex: 'ab'.repeat(32),
  linkPublicKeyHex: 'cd'.repeat(32),
  linkSecretKeyHex: 'ef'.repeat(32),
  token: 'opt_phone',
  tokenId: 'tok-1',
  pairedAt: '2026-11-03T00:00:00.000Z',
};

beforeEach(async () => {
  localStorage.clear();
  useShellStore.setState({ account: null, machines: [] });
  await writeAccount({ token: 'odd_x', deviceId: 'd', label: 'Pixel' });
  await writeMachines([MACHINE]);
  localStorage.setItem(CURRENT_MACHINE_KEY, MACHINE.environmentId);
  history.replaceState(null, '', '/m');
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('ShellApp machine view', () => {
  it('shows the removed screen when the link dial is refused as unknown-peer', async () => {
    render(<ShellApp navigate={() => undefined} />);
    expect(await screen.findByText('This phone was removed from desk. Pair again.')).toBeTruthy();
    expect(screen.getByText('Pair again')).toBeTruthy();
  });

  it('Forget deletes the machine record and returns to the list', async () => {
    render(<ShellApp navigate={() => undefined} />);
    const forget = await screen.findByText('Forget');
    await act(async () => forget.click());
    expect(await screen.findByText('Machines')).toBeTruthy();
    expect(await readMachines()).toEqual([]);
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBeNull();
  });
});
