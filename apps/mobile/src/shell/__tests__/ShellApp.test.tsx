import { buildPhonePairLink } from '@overdeck/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDENTITY = vi.hoisted(() => ({ clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'ee'.repeat(32) }));
const harness = vi.hoisted(() => ({
  dialKind: 'removed' as 'removed' | 'no-path',
  launchUrl: undefined as string | undefined,
  urlListeners: [] as Array<(event: { url: string }) => void>,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: vi.fn(async () => (harness.launchUrl ? { url: harness.launchUrl } : undefined)),
    addListener: vi.fn(async (_event: string, listener: (event: { url: string }) => void) => {
      harness.urlListeners.push(listener);
      return { remove: vi.fn() };
    }),
  },
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
        throw harness.dialKind === 'removed'
          ? new actual.ConnectionError('removed', actual.connectionText.removed('desk'))
          : new actual.ConnectionError('no-path', actual.connectionText.noPath('desk'));
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
import { CURRENT_MACHINE_KEY, readMachines, removeAccount, useShellStore, writeAccount, writeMachines } from '../store';
import type { PairedMachine } from '../types';

const PAIR_LINK = buildPhonePairLink({
  environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b',
  machineKeyHex: 'ab'.repeat(32),
  code: 'odp_' + 'cd34'.repeat(16),
});

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
  harness.dialKind = 'removed';
  harness.launchUrl = undefined;
  harness.urlListeners.length = 0;
  sessionStorage.clear();
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

  it('shows any other dial failure as a banner over the machine view', async () => {
    harness.dialKind = 'no-path';
    render(<ShellApp navigate={() => undefined} />);
    expect((await screen.findByRole('alert')).textContent).toBe('No direct path to desk. Install Tailscale on it or use the relay plan.');
    expect(screen.getByText('machine view')).toBeTruthy();
  });

  it('opens the pair screen when a pair link arrives during the machine view', async () => {
    harness.dialKind = 'no-path';
    render(<ShellApp navigate={() => undefined} />);
    await screen.findByText('machine view');
    await act(async () => {
      for (const listener of harness.urlListeners) listener({ url: PAIR_LINK });
    });
    expect(((await screen.findByPlaceholderText('ai.overdeck.app:/pair#…')) as HTMLInputElement).value).toBe(PAIR_LINK);
    expect(screen.queryByText('machine view')).toBeNull();
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBeNull();
  });

  it('handles a launch URL once per app process, not again after a reload', async () => {
    localStorage.removeItem(CURRENT_MACHINE_KEY);
    history.replaceState(null, '', '/');
    harness.launchUrl = PAIR_LINK;
    const first = render(<ShellApp navigate={() => undefined} />);
    expect(await screen.findByPlaceholderText('ai.overdeck.app:/pair#…')).toBeTruthy();
    first.unmount();
    render(<ShellApp navigate={() => undefined} />);
    expect(await screen.findByText('Machines')).toBeTruthy();
    expect(screen.queryByPlaceholderText('ai.overdeck.app:/pair#…')).toBeNull();
  });
});

describe('ShellApp notification taps', () => {
  const OTHER = 'e91ffda1-431a-483d-a6e4-a72079516ea4';
  const openLink = (environmentId: string, t: string) =>
    `ai.overdeck.app:/open#v=1&e=${environmentId}&p=%2Fm%3Fsubject%3Dpan-4840-conv&t=${t}`;
  const tap = async (url: string) =>
    act(async () => {
      for (const listener of harness.urlListeners) listener({ url });
    });

  beforeEach(() => {
    localStorage.removeItem(CURRENT_MACHINE_KEY);
    history.replaceState(null, '', '/');
  });

  it('opens the paired machine at the notification path, once per link', async () => {
    const navigate = vi.fn();
    render(<ShellApp navigate={navigate} />);
    await screen.findByText('Machines');
    await tap(openLink(MACHINE.environmentId, '1'));
    expect(navigate).toHaveBeenCalledWith('/m?subject=pan-4840-conv');
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBe(MACHINE.environmentId);
    await tap(openLink(MACHINE.environmentId, '1'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('shows the machine list for a machine this phone is not paired with', async () => {
    const navigate = vi.fn();
    render(<ShellApp navigate={navigate} />);
    await screen.findByText('Machines');
    await tap(openLink(OTHER, '2'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Machines')).toBeTruthy();
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBeNull();
  });

  it('opens the paired machine from a cold launch', async () => {
    const navigate = vi.fn();
    harness.launchUrl = openLink(MACHINE.environmentId, '3');
    render(<ShellApp navigate={navigate} />);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/m?subject=pan-4840-conv'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does nothing while signed out', async () => {
    await removeAccount();
    const navigate = vi.fn();
    render(<ShellApp navigate={navigate} />);
    await screen.findByText('Sign in');
    await tap(openLink(MACHINE.environmentId, '4'));
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBeNull();
  });
});
