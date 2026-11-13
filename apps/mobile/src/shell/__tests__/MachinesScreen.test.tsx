import type { DirectoryWebClient, DirectoryWebState } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine } from '@overdeck/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverdeckKeysWeb } from '../../native/keys-web';
import { MachinesScreen, UNAUTHORIZED_REFUSAL } from '../MachinesScreen';
import { CURRENT_MACHINE_KEY, readAccount, setKeysPlugin, writeAccount } from '../store';
import type { PairedMachine } from '../types';

function machine(id: string, label: string, overrides: Partial<DirectoryMachine> = {}): DirectoryMachine {
  return {
    environmentId: id,
    label,
    publicKeyHex: 'ab'.repeat(32),
    fingerprint: 'abab-abab-abab-abab-abab',
    online: true,
    lastSeenAt: '2026-11-03T00:00:00.000Z',
    serverVersion: '0.74.0',
    endpoints: [],
    ...overrides,
  };
}

function paired(id: string, label: string): PairedMachine {
  return {
    environmentId: id,
    label,
    machineKeyHex: 'ab'.repeat(32),
    linkPublicKeyHex: 'cd'.repeat(32),
    linkSecretKeyHex: 'ef'.repeat(32),
    token: 't',
    tokenId: 'i',
    pairedAt: '2026-11-03T00:00:00.000Z',
  };
}

function fakeClient(state: DirectoryWebState, machines: DirectoryMachine[], refusal: string | null = null): DirectoryWebClient {
  return { state, machines, refusal, onStateChange: () => () => undefined } as unknown as DirectoryWebClient;
}

const noop = () => undefined;

beforeEach(() => {
  localStorage.clear();
  setKeysPlugin(new OverdeckKeysWeb());
});

afterEach(cleanup);

describe('MachinesScreen', () => {
  it('PAN-5208: shows the empty state for an online directory with no machines', () => {
    render(<MachinesScreen client={fakeClient('online', [])} paired={[]} onPair={noop} onSettings={noop} onSignedOut={noop} />);
    expect(screen.getByText('No machines yet.')).toBeTruthy();
    expect(screen.getByText('Pair a machine to see it here.')).toBeTruthy();
  });

  it('PAN-5208: renders the watermark outside the list and keeps the header button names', () => {
    const onPair = vi.fn();
    const onSettings = vi.fn();
    const { container } = render(
      <MachinesScreen client={fakeClient('online', [machine('e-1', 'desk')])} paired={[]} onPair={onPair} onSettings={onSettings} onSignedOut={noop} />,
    );
    const watermark = container.querySelector('[data-component="logo-watermark"]');
    expect(watermark).not.toBeNull();
    expect(container.querySelector('ul')?.contains(watermark)).toBe(false);
    expect(screen.queryByText('No machines yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pair a machine' }));
    expect(onPair).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('lists paired machines first, then by label', () => {
    const client = fakeClient('online', [machine('e-zed', 'zed'), machine('e-alpha', 'alpha'), machine('e-mid', 'mid')]);
    render(<MachinesScreen client={client} paired={[paired('e-zed', 'zed')]} onPair={noop} onSettings={noop} onSignedOut={noop} />);
    const ids = screen.getAllByRole('button').map((b) => b.getAttribute('data-environment-id')).filter(Boolean);
    expect(ids).toEqual(['e-zed', 'e-alpha', 'e-mid']);
    expect(screen.getByText('Paired')).toBeTruthy();
  });

  it('shows the update text for an unpaired machine older than MIN_PAN_VERSION and still lets it pair', () => {
    const onPair = vi.fn();
    const old = machine('e-old', 'old', { serverVersion: '0.73.1' });
    render(<MachinesScreen client={fakeClient('online', [old])} paired={[]} onPair={onPair} onSettings={noop} onSignedOut={noop} />);
    expect(screen.getByText('Update Overdeck on old to use the app (pan 0.74.0 or later).')).toBeTruthy();
    fireEvent.click(screen.getByText('old'));
    expect(onPair).toHaveBeenCalledWith(old);
  });

  it('opens a paired machine whose reported version is older, without the update text', () => {
    const navigate = vi.fn();
    const client = fakeClient('online', [machine('e-dev', 'dev', { serverVersion: '0.73.1' })]);
    render(<MachinesScreen client={client} paired={[paired('e-dev', 'dev')]} onPair={noop} onSettings={noop} onSignedOut={noop} navigate={navigate} />);
    expect(screen.queryByText(/Update Overdeck/)).toBeNull();
    fireEvent.click(screen.getByText('dev'));
    expect(navigate).toHaveBeenCalledWith('/m');
  });

  it('shows the connecting line and the refusal text', () => {
    const { unmount } = render(
      <MachinesScreen client={fakeClient('connecting', [])} paired={[]} onPair={noop} onSettings={noop} onSignedOut={noop} />,
    );
    expect(screen.getByText('Connecting to overdeck.ai…')).toBeTruthy();
    unmount();
    render(
      <MachinesScreen
        client={fakeClient('refused', [], 'Another copy of this app connected to the directory')}
        paired={[]}
        onPair={noop}
        onSettings={noop}
        onSignedOut={noop}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Another copy of this app connected to the directory');
    expect(screen.queryByText('Sign in again')).toBeNull();
  });

  it('"Sign in again" removes the account secret after an unauthorized refusal', async () => {
    await writeAccount({ token: 'odd_x', deviceId: 'd', label: 'Pixel' });
    const onSignedOut = vi.fn();
    render(
      <MachinesScreen
        client={fakeClient('refused', [], UNAUTHORIZED_REFUSAL)}
        paired={[]}
        onPair={noop}
        onSettings={noop}
        onSignedOut={onSignedOut}
      />,
    );
    fireEvent.click(screen.getByText('Sign in again'));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(await readAccount()).toBeNull();
  });

  it('opens a paired online machine by storing it as current and navigating to /m', () => {
    const navigate = vi.fn();
    const client = fakeClient('online', [machine('e-1', 'desk')]);
    render(<MachinesScreen client={client} paired={[paired('e-1', 'desk')]} onPair={noop} onSettings={noop} onSignedOut={noop} navigate={navigate} />);
    fireEvent.click(screen.getByText('desk'));
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBe('e-1');
    expect(navigate).toHaveBeenCalledWith('/m');
  });

  it('opens the pair screen for an unpaired machine', () => {
    const onPair = vi.fn();
    const target = machine('e-2', 'laptop');
    render(<MachinesScreen client={fakeClient('online', [target])} paired={[]} onPair={onPair} onSettings={noop} onSignedOut={noop} />);
    fireEvent.click(screen.getByText('laptop'));
    expect(onPair).toHaveBeenCalledWith(target);
    expect(localStorage.getItem(CURRENT_MACHINE_KEY)).toBeNull();
  });
});
