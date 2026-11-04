/**
 * PAN-4942 (W-LINK1 WI-7): opened from a machine-link card, Link a machine
 * tells the agent that asked which machine was linked, then closes. Without a
 * request id it never does; a stopped agent or a failed resolve only shows a
 * toast; a failed link resolves nothing and keeps the dialog open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { toastSuccess, toastInfo, toastError, linkMachineMock, markLinkedMock } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  linkMachineMock: vi.fn(),
  markLinkedMock: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, info: toastInfo, error: toastError } }));
vi.mock('../machinesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../machinesApi')>()),
  linkMachine: linkMachineMock,
  markAgentRequestLinked: markLinkedMock,
}));

import { LinkMachineDialog } from '../LinkMachineDialog';

const LINK = { id: 'link-1', environmentId: 'env-1', label: 'desk' };

function renderDialog(agentRequestId: string | null, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LinkMachineDialog open onClose={onClose} agentRequestId={agentRequestId} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function link() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Pairing link from the other machine'), 'https://desk/#pair=odp_x');
  await user.click(screen.getByRole('button', { name: 'Link' }));
}

beforeEach(() => {
  linkMachineMock.mockResolvedValue({ status: 200, body: LINK });
  markLinkedMock.mockResolvedValue({ status: 200, body: { requestId: 'r1', status: 'linked', machine: { environmentId: 'env-1', label: 'desk' } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LinkMachineDialog with an agent request (PAN-4942)', () => {
  it('tells the agent once with the new link environment id, then closes', async () => {
    const onClose = renderDialog('r1');
    await link();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(markLinkedMock).toHaveBeenCalledTimes(1);
    expect(markLinkedMock).toHaveBeenCalledWith('r1', 'env-1');
    expect(toastSuccess).toHaveBeenCalledWith('Linked desk');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('never tells an agent when it was opened without a request id', async () => {
    const onClose = renderDialog(null);
    await link();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(markLinkedMock).not.toHaveBeenCalled();
  });

  it('shows an info toast when the agent that asked has stopped, and still closes', async () => {
    markLinkedMock.mockResolvedValue({ status: 409, body: { error: 'the agent stopped; its request expired', code: 'agent-stopped' } });
    const onClose = renderDialog('r1');
    await link();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastInfo).toHaveBeenCalledWith('Linked desk, but the agent that asked has stopped.');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when the resolve fails or throws, and still closes', async () => {
    markLinkedMock.mockResolvedValue({ status: 409, body: { error: 'request is expired', code: 'not-pending' } });
    const onClose = renderDialog('r1');
    await link();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith('Linked desk, but could not tell the agent: request is expired');

    cleanup();
    markLinkedMock.mockRejectedValue(new Error('Failed to fetch'));
    const second = renderDialog('r1');
    await link();
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith('Linked desk, but could not tell the agent: Failed to fetch');
  });

  it('tells no agent and stays open when the link fails', async () => {
    linkMachineMock.mockResolvedValue({ status: 401, body: { error: 'pairing-refused', message: 'desk refused the pairing code; it expired or was already used.' } });
    const onClose = renderDialog('r1');
    await link();
    expect(await screen.findByRole('alert')).toHaveTextContent('desk refused the pairing code');
    expect(markLinkedMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
