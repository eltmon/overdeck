/** PAN-4650 WI-13: linked rows show their machine, offline state and a short menu; hidden machines come back from the footer. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { ConversationRow } from '../ConversationRow';
import type { Conversation } from '../ConversationList';
import { HiddenMachinesFooter } from '../LinkedConversationRow';
import type { ConversationMutations } from '../useConversationMutations';

const setMachineHidden = vi.fn(async () => ({ status: 200, body: {} }));
const loadMachines = vi.fn(async () => ({
  self: {}, inbound: [], links: [{ id: 'link-desk', label: 'desk', hidden: true, state: 'online' }, { id: 'link-mini', label: 'mini', hidden: false, state: 'online' }],
}));

vi.mock('../../Settings/anywhere/machinesApi', () => ({
  MACHINES_QUERY_KEY: ['anywhere-machines'],
  loadMachines: () => loadMachines(),
  setMachineHidden: (id: string, hidden: boolean) => setMachineHidden(id, hidden),
}));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

const linked: Conversation = {
  id: -4,
  name: '@env-desk/conv-x',
  tmuxSession: 'conv-x',
  status: 'active',
  cwd: '/w',
  issueId: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Desk conversation',
  model: 'claude-opus-5-5',
  origin: 'linked',
  environmentId: 'env-desk',
  remoteName: 'conv-x',
  machineLabel: 'desk',
  machineState: 'online',
  machineLastSeenAt: null,
  savedCopyName: null,
  releasedTo: null,
};

const mutations = new Proxy({}, { get: (_target, key) => (String(key).startsWith('is') ? () => false : key === 'forkTarget' ? null : vi.fn()) }) as ConversationMutations;

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function renderRow(overrides: Partial<Conversation> = {}) {
  return renderWithClient(<ConversationRow conv={{ ...linked, ...overrides }} isSelected={false} onSelect={vi.fn()} mutations={mutations} />);
}

describe('linked conversation rows (PAN-4650 WI-13)', () => {
  it('ac1: an online row shows its machine chip and model', () => {
    renderRow();
    expect(screen.getByTestId('linked-machine-chip').textContent).toBe('desk');
    expect(screen.queryByTestId('linked-offline-meta')).toBeNull();
  });

  it('ac1: an offline row without a saved copy says so in place of the model', () => {
    renderRow({ machineState: 'offline' });
    expect(screen.getByTestId('linked-offline-meta').textContent).toBe('offline · no saved copy');
    expect(screen.queryByTitle('Model: claude-opus-5-5')).toBeNull();
  });

  it('an offline row with a saved copy names when it was saved', () => {
    renderRow({ machineState: 'offline', savedCopyName: 'vault-1', savedCopyAt: '2026-11-01T14:02:00.000Z' });
    expect(screen.getByTestId('linked-offline-meta').textContent).toMatch(/^offline · saved \d{2}:\d{2}$/);
  });

  it('ac2: the menu offers Hide this machine and no Archive, Rename or Move', async () => {
    renderRow();
    fireEvent.click(screen.getByLabelText('More actions for Desk conversation'));
    const menu = screen.getByRole('menu', { name: 'Actions for Desk conversation' });
    expect(menu.textContent).toContain('Hide this machine');
    expect(menu.textContent).not.toContain('Archive');
    expect(menu.textContent).not.toContain('Rename');
    fireEvent.click(screen.getByText('Hide this machine'));
    await waitFor(() => expect(setMachineHidden).toHaveBeenCalledWith('env-desk', true));
  });

  it('ac4: the footer lists each hidden machine with a Show action', async () => {
    renderWithClient(<HiddenMachinesFooter />);
    const footer = await screen.findByTestId('hidden-machines-footer');
    expect(footer.textContent).toBe('desk conversations hidden · Show');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(setMachineHidden).toHaveBeenCalledWith('link-desk', false));
  });
});
