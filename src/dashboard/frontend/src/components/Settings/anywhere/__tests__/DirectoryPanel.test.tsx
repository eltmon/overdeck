import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DirectoryResponse } from '@overdeck/contracts';

import { DialogProvider } from '../../../DialogProvider';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  loadDirectory: vi.fn(),
  approveApproval: vi.fn(),
  openApproval: vi.fn(),
  rejectApproval: vi.fn(),
  acceptJoin: vi.fn(),
  rejectJoin: vi.fn(),
  joinDirectory: vi.fn(),
  forgetDirectoryMachine: vi.fn(),
}));

vi.mock('../directoryApi', () => ({ DIRECTORY_QUERY_KEY: ['anywhere-directory'], ...api }));
vi.mock('../machinesApi', () => ({
  MACHINES_QUERY_KEY: ['anywhere-machines'],
  loadMachines: async () => ({ self: { environmentId: 'env-self', label: 'desk', fingerprint: 'aaaa-aaaa-aaaa-aaaa-aaaa' }, links: [], inbound: [] }),
}));

const { DirectoryPanel } = await import('../DirectoryPanel');

const REQUEST_ID = '0'.repeat(32);

function directory(over: Partial<DirectoryResponse> = {}): DirectoryResponse {
  return {
    signedIn: true,
    state: 'online',
    url: 'https://connect.overdeck.ai',
    plan: 'tester',
    refusal: null,
    machines: [],
    approvals: [],
    joins: [],
    relay: null,
    ...over,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <DirectoryPanel />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('DirectoryPanel (PAN-2356 WI-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks a signed-out machine to sign in with pan account login', async () => {
    api.loadDirectory.mockResolvedValue(directory({ signedIn: false, state: 'off' }));
    renderPanel();
    expect(await screen.findByTestId('directory-signed-out')).toHaveTextContent(
      'Sign in with pan account login to find your machines through overdeck.ai.',
    );
  });

  it('shows the refusal for a fourth machine on a free account', async () => {
    api.loadDirectory.mockResolvedValue(directory({ state: 'refused', plan: 'free', refusal: 'The free account includes 3 machines' }));
    renderPanel();
    expect(await screen.findByTestId('directory-refusal')).toHaveTextContent('The free account includes 3 machines');
  });

  it('reviews an incoming approval with its code and approves that request', async () => {
    api.loadDirectory.mockResolvedValue(directory({
      approvals: [{ requestId: REQUEST_ID, from: 'env-vps', label: 'vps', fingerprint: 'bbbb-bbbb-bbbb-bbbb-bbbb', expiresAt: Date.now() + 600_000, sas: '123 456', state: 'open', error: null }],
    }));
    api.approveApproval.mockResolvedValue({ status: 202, body: { approving: true } });
    const user = userEvent.setup();
    renderPanel();

    const row = await screen.findByTestId(`directory-approval-${REQUEST_ID}`);
    await user.click(within(row).getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('approval-sas')).toHaveTextContent('123 456');
    expect(within(dialog).getByText('Approve only if the other machine shows the same code.')).toBeInTheDocument();
    expect(within(dialog).getByText('bbbb-bbbb-bbbb-bbbb-bbbb')).toBeInTheDocument();
    expect(api.openApproval).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(api.approveApproval).toHaveBeenCalledWith(REQUEST_ID);
  });

  it('opens the approval channel first when the code is not known yet', async () => {
    api.loadDirectory.mockResolvedValue(directory({
      approvals: [{ requestId: REQUEST_ID, from: 'env-vps', label: 'vps', fingerprint: 'from-directory', expiresAt: Date.now() + 600_000, sas: null, state: 'pending', error: null }],
    }));
    api.openApproval.mockResolvedValue({ status: 200, body: { sas: '654 321', fingerprint: 'cccc-cccc-cccc-cccc-cccc' } });
    const user = userEvent.setup();
    renderPanel();
    await user.click(within(await screen.findByTestId(`directory-approval-${REQUEST_ID}`)).getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('654 321')).toBeInTheDocument();
    expect(screen.getByText('cccc-cccc-cccc-cccc-cccc')).toBeInTheDocument();
    expect(api.openApproval).toHaveBeenCalledWith(REQUEST_ID);
  });

  it('lists machines with Link, Linked and last-seen, and nothing to remove on this machine', async () => {
    const base = { publicKeyHex: 'a'.repeat(64), serverVersion: '0.72.0', endpoints: [] };
    api.loadDirectory.mockResolvedValue(directory({
      machines: [
        { ...base, environmentId: 'env-self', label: 'desk', fingerprint: 'aaaa-aaaa-aaaa-aaaa-aaaa', online: true, lastSeenAt: new Date().toISOString(), linked: false },
        { ...base, environmentId: 'env-vps', label: 'vps', fingerprint: 'bbbb-bbbb-bbbb-bbbb-bbbb', online: false, lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(), linked: true },
        { ...base, environmentId: 'env-lap', label: 'laptop', fingerprint: 'cccc-cccc-cccc-cccc-cccc', online: true, lastSeenAt: new Date().toISOString(), linked: false },
      ],
    }));
    api.joinDirectory.mockResolvedValue({ status: 200, body: { requestId: REQUEST_ID } });
    const user = userEvent.setup();
    renderPanel();

    const self = await screen.findByTestId('directory-machine-env-self');
    await within(self).findByText('this machine');
    expect(within(self).queryByRole('button', { name: 'Remove from directory' })).toBeNull();
    const vps = screen.getByTestId('directory-machine-env-vps');
    expect(within(vps).getByText('Linked')).toBeInTheDocument();
    expect(within(vps).getByText(/last seen/)).toBeInTheDocument();
    await user.click(within(screen.getByTestId('directory-machine-env-lap')).getByRole('button', { name: 'Link' }));
    expect(api.joinDirectory).toHaveBeenCalledWith('env-lap');
  });
});
