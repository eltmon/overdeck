/** PAN-4455 WI-9: the dialog host, its default tab (D-2), tab switching and closing. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AnywhereStatus } from '../../../Settings/anywhere/anywhereApi';
import type { ContinueTarget } from '../continueOnDeviceStore';

const api = vi.hoisted(() => ({ loadAnywhereStatus: vi.fn() }));
vi.mock('../../../Settings/anywhere/anywhereApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../Settings/anywhere/anywhereApi')>()),
  loadAnywhereStatus: api.loadAnywhereStatus,
}));
vi.mock('../OpenOnScreenTab', () => ({ OpenOnScreenTab: () => <div data-testid="screen-tab" /> }));
vi.mock('../HandOffTab', () => ({ HandOffTab: () => <div data-testid="handoff-tab" /> }));

const { ContinueOnDeviceDialogHost } = await import('../ContinueOnDeviceDialog');
const { openContinueOnDevice, useContinueOnDeviceStore } = await import('../continueOnDeviceStore');

const LOCAL = { origin: 'http://127.0.0.1:3011', loopback: true };
const DESK = { origin: 'https://desk.example', loopback: false };

function status(overrides: Partial<AnywhereStatus> = {}): AnywhereStatus {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses: [LOCAL, DESK],
    devices: { active: 0 },
    vault: { state: 'ready', backend: 'dir:/x' },
    problems: [],
    viewer: { kind: 'root-session' },
    ...overrides,
  };
}

const TARGET: ContinueTarget = { name: 'conv-42', id: 42, title: 'Fix the parser', harness: 'claude-code', sessionAlive: true, viewMode: 'conversation' };

function renderHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContinueOnDeviceDialogHost />
    </QueryClientProvider>,
  );
}

describe('ContinueOnDeviceDialog (PAN-4455 WI-9)', () => {
  beforeEach(() => {
    useContinueOnDeviceStore.setState({ target: null });
    api.loadAnywhereStatus.mockReset();
  });

  it('renders nothing until a menu opens it, then shows the title and the conversation', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status());
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openContinueOnDevice(TARGET));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Continue on another device')).toBeInTheDocument();
    expect(screen.getByText('Fix the parser')).toBeInTheDocument();
    expect(await screen.findByTestId('screen-tab')).toBeInTheDocument();
  });

  it('D-2: a reachable address opens on the screen tab', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status());
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    await screen.findByTestId('screen-tab');
    expect(screen.getByRole('tab', { name: 'Open on another screen' })).toHaveAttribute('aria-selected', 'true');
  });

  it('D-2: no reachable address, vault ready and claude-code open on the hand-off tab', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status({ addresses: [LOCAL] }));
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    expect(await screen.findByTestId('handoff-tab')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hand off to another machine' })).toHaveAttribute('aria-selected', 'true');
  });

  it('D-2: no reachable address with the vault off stays on the screen tab', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status({ addresses: [LOCAL], vault: { state: 'off', backend: null } }));
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    expect(await screen.findByTestId('screen-tab')).toBeInTheDocument();
  });

  it('clicking the other tab switches', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status());
    const user = userEvent.setup();
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    await screen.findByTestId('screen-tab');
    await user.click(screen.getByRole('tab', { name: 'Hand off to another machine' }));
    expect(screen.getByTestId('handoff-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-tab')).toBeNull();
  });

  it('Escape and the close button close the dialog', async () => {
    api.loadAnywhereStatus.mockResolvedValue(status());
    const user = userEvent.setup();
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    await screen.findByTestId('screen-tab');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useContinueOnDeviceStore.getState().target).toBeNull();

    act(() => openContinueOnDevice(TARGET));
    await screen.findByTestId('screen-tab');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the status error', async () => {
    api.loadAnywhereStatus.mockRejectedValue(new Error('Request failed (500)'));
    renderHost();
    act(() => openContinueOnDevice(TARGET));
    expect(await screen.findByText('Request failed (500)')).toBeInTheDocument();
  });
});
