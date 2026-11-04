import { buildPhonePairLink } from '@overdeck/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDENTITY = vi.hoisted(() => ({ clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'ee'.repeat(32) }));
const urlListeners = vi.hoisted(() => [] as Array<(event: { url: string }) => void>);

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event: string, listener: (event: { url: string }) => void) => {
      urlListeners.push(listener);
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
vi.mock('../signIn', async (importOriginal) => {
  const { writeAccount } = await import('../store');
  return {
    ...(await importOriginal<typeof import('../signIn')>()),
    completeSignIn: vi.fn(async () => {
      const account = { token: 'odd_x', deviceId: 'd', label: 'Pixel' };
      await writeAccount(account);
      return account;
    }),
  };
});

import { PairScreen } from '../PairScreen';
import ShellApp from '../ShellApp';
import { useShellStore, writeAccount } from '../store';
import type { PairedMachine } from '../types';

const LINK = buildPhonePairLink({
  environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b',
  machineKeyHex: 'ab'.repeat(32),
  code: 'odp_' + 'cd34'.repeat(16),
});

const RECORD = { environmentId: '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b', label: 'desk' } as PairedMachine;

beforeEach(() => {
  localStorage.clear();
  urlListeners.length = 0;
  useShellStore.setState({ account: null, machines: [] });
});

afterEach(cleanup);

const openUrl = (url: string) =>
  act(async () => {
    for (const listener of urlListeners) listener({ url });
  });

describe('PairScreen', () => {
  it('pairs a pasted valid link and shows progress first', async () => {
    let finish: (machine: PairedMachine) => void = () => undefined;
    const pair = vi.fn(() => new Promise<PairedMachine>((resolve) => (finish = resolve)));
    const onPaired = vi.fn();
    render(<PairScreen initialLink={null} labelFor={() => 'desk'} pair={pair} onPaired={onPaired} onCancel={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('ai.overdeck.app:/pair#…'), { target: { value: `  ${LINK}  ` } });
    fireEvent.click(screen.getByText('Pair'));
    expect(pair).toHaveBeenCalledWith(`  ${LINK}  `);
    expect(await screen.findByText('Pairing with desk…')).toBeTruthy();
    await act(async () => finish(RECORD));
    expect(onPaired).toHaveBeenCalledWith(RECORD);
  });

  it('shows the not-a-code message for an invalid paste and does not pair', () => {
    const pair = vi.fn();
    render(<PairScreen initialLink={null} labelFor={() => 'desk'} pair={pair} onPaired={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('ai.overdeck.app:/pair#…'), { target: { value: 'odp_123' } });
    fireEvent.click(screen.getByText('Pair'));
    expect(screen.getByRole('alert').textContent).toBe('That is not an Overdeck pairing code.');
    expect(pair).not.toHaveBeenCalled();
  });

  it('shows the pairing error', async () => {
    const pair = vi.fn(async () => {
      throw new Error('desk is offline. Open Overdeck on it and try again.');
    });
    render(<PairScreen initialLink={LINK} labelFor={() => 'desk'} pair={pair} onPaired={() => undefined} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Pair'));
    expect((await screen.findByRole('alert')).textContent).toBe('desk is offline. Open Overdeck on it and try again.');
  });
});

describe('ShellApp pair links', () => {
  it('opens the pair screen prefilled for an appUrlOpen pair link', async () => {
    await writeAccount({ token: 'odd_x', deviceId: 'd', label: 'Pixel' });
    render(<ShellApp navigate={() => undefined} />);
    await screen.findByText('Machines');
    await openUrl(LINK);
    const input = (await screen.findByPlaceholderText('ai.overdeck.app:/pair#…')) as HTMLInputElement;
    expect(input.value).toBe(LINK);
  });

  it('keeps a pair link that arrives while signed out and opens it after sign-in', async () => {
    render(<ShellApp navigate={() => undefined} />);
    await screen.findByText('Sign in');
    await openUrl(LINK);
    expect(screen.getByText('Sign in')).toBeTruthy();
    await openUrl('ai.overdeck.app:/oauth/callback?code=odc_x&state=s');
    await waitFor(() => expect((screen.getByPlaceholderText('ai.overdeck.app:/pair#…') as HTMLInputElement).value).toBe(LINK));
  });
});
