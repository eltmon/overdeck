import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AnywhereDialogHost } from '../AnywhereDialogHost';
import { openAnywhereDialog, useAnywhereDialogStore } from '../anywhereDialogStore';

const toastInfo = vi.fn();
vi.mock('sonner', () => ({ toast: { info: (...args: unknown[]) => toastInfo(...args) } }));

function dialogStub(id: string) {
  return function Stub({ open, onClose, onPair, agentRequestId }: { open: boolean; onClose: () => void; onPair?: () => void; agentRequestId?: string | null }) {
    if (!open) return null;
    return (
      <div data-testid={`dialog-${id}`} data-agent-request-id={agentRequestId ?? ''}>
        <button type="button" onClick={onClose}>
          close
        </button>
        {onPair && (
          <button type="button" onClick={onPair}>
            pair
          </button>
        )}
      </div>
    );
  };
}

vi.mock('../LinkMachineDialog', () => ({ LinkMachineDialog: dialogStub('link-machine') }));
vi.mock('../AddFlyMachineDialog', () => ({ AddFlyMachineDialog: dialogStub('add-fly-machine') }));
vi.mock('../AddSshMachineDialog', () => ({ AddSshMachineDialog: dialogStub('add-ssh-machine') }));
vi.mock('../SetUpPhoneDialog', () => ({ SetUpPhoneDialog: dialogStub('set-up-phone') }));
vi.mock('../PairDeviceDialog', () => ({ PairDeviceDialog: dialogStub('pair-device') }));
vi.mock('../TailscaleSetupDialog', () => ({ TailscaleSetupDialog: dialogStub('tailscale-setup') }));

let fetchMock: ReturnType<typeof vi.fn>;
let viewerKind = 'root-session';

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnywhereDialogHost />
    </QueryClientProvider>,
  );
}

function allDialogTestIds(): string[] {
  return screen.queryAllByTestId(/^dialog-/).map((el) => el.getAttribute('data-testid')!);
}

beforeEach(() => {
  useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
  viewerKind = 'root-session';
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/anywhere/status') {
      return Promise.resolve(
        jsonResponse(200, {
          machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
          addresses: [],
          devices: { active: 0 },
          vault: { state: 'off', backend: null },
          problems: [],
          tailscale: { nextStep: 'ready', serveUrl: null, magicDnsName: null },
          viewer: { kind: viewerKind },
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
  toastInfo.mockClear();
  cleanup();
  vi.unstubAllGlobals();
});

describe('AnywhereDialogHost', () => {
  it('renders nothing when no dialog is requested', () => {
    renderHost();
    expect(allDialogTestIds()).toEqual([]);
  });

  it.each(['link-machine', 'add-fly-machine', 'add-ssh-machine', 'set-up-phone', 'pair-device'] as const)(
    'opens %s',
    (id) => {
      renderHost();
      act(() => openAnywhereDialog(id));
      expect(allDialogTestIds()).toEqual([`dialog-${id}`]);
    },
  );

  it('close clears the store', () => {
    renderHost();
    act(() => openAnywhereDialog('link-machine'));
    expect(screen.getByTestId('dialog-link-machine')).toBeTruthy();
    screen.getByRole('button', { name: 'close' }).click();
    expect(useAnywhereDialogStore.getState().dialog).toBeNull();
  });

  it('holds the agent request id from the open until close, and a later open without one leaves it null (PAN-4942)', () => {
    openAnywhereDialog('link-machine', { agentRequestId: 'r1' });
    expect(useAnywhereDialogStore.getState()).toMatchObject({ dialog: 'link-machine', agentRequestId: 'r1' });
    useAnywhereDialogStore.getState().close();
    expect(useAnywhereDialogStore.getState()).toMatchObject({ dialog: null, agentRequestId: null });
    openAnywhereDialog('link-machine');
    expect(useAnywhereDialogStore.getState()).toMatchObject({ dialog: 'link-machine', agentRequestId: null });
  });

  it('hands the agent request id to Link a machine (PAN-4942)', () => {
    renderHost();
    act(() => openAnywhereDialog('link-machine', { agentRequestId: 'r1' }));
    expect(screen.getByTestId('dialog-link-machine')).toHaveAttribute('data-agent-request-id', 'r1');
  });

  it('opens Tailscale setup for a root session', async () => {
    viewerKind = 'root-session';
    renderHost();
    act(() => openAnywhereDialog('tailscale-setup'));
    await waitFor(() => expect(screen.getByTestId('dialog-tailscale-setup')).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'pair' }));
    expect(allDialogTestIds()).toEqual(['dialog-pair-device']);
  });

  it('refuses Tailscale setup for a paired device', async () => {
    viewerKind = 'device';
    renderHost();
    act(() => openAnywhereDialog('tailscale-setup'));
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('Tailscale can be set up only from a browser on this machine.'));
    expect(screen.queryByTestId('dialog-tailscale-setup')).toBeNull();
    expect(useAnywhereDialogStore.getState().dialog).toBeNull();
  });

  it("opens connect-bot as the real ConnectBotDialog (not a stub)", () => {
    renderHost();
    act(() => openAnywhereDialog('connect-bot'));
    expect(document.querySelector('[data-component="connect-bot-dialog"]')).toBeTruthy();
  });
});
