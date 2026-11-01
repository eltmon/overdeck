/** PAN-4650 WI-12: the machine banner shows exactly its state's actions; non-live composers are read-only. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../VaultContinueDialog', () => ({ VaultContinueDialog: () => null }));
vi.mock('../../Settings/anywhere/machinesApi', () => ({ reconnectMachine: vi.fn(async () => ({ ok: true })) }));

import type { Conversation } from '../../CommandDeck/ConversationList';
import { ConversationMachineBanner, ConversationMachineChip, MachineReadOnlyNotice } from '../ConversationMachineBanner';

function conv(overrides: Partial<Conversation>): Conversation {
  return {
    id: -3, name: '@env-desk/conv-x', tmuxSession: 'conv-x', status: 'active', cwd: '/w', issueId: null, createdAt: '2026-11-01T10:00:00.000Z',
    endedAt: null, lastAttachedAt: null, sessionAlive: true, claudeSessionId: 's-x', origin: 'linked', environmentId: 'env-desk',
    machineLabel: 'desk', machineState: 'offline', machineLastSeenAt: null, savedCopyName: null, releasedTo: null, ...overrides,
  } as Conversation;
}

function wrap(children: ReactNode, rows: Conversation[] = []) {
  const client = new QueryClient();
  client.setQueryData(['conversations'], rows);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const buttons = () => screen.queryAllByRole('button').map((button) => button.textContent);

describe('ConversationMachineBanner (PAN-4650 WI-12)', () => {
  it('ac2: offline with a saved copy offers Read saved copy and Continue here', () => {
    render(wrap(<ConversationMachineBanner conversation={conv({ savedCopyName: 'vault-1' })} />));
    expect(screen.getByTestId('machine-banner').textContent).toContain('desk is offline (last seen never)');
    expect(buttons()).toEqual(['Read saved copy', 'Continue here']);
  });

  it('ac2: offline without a saved copy offers only Reconnect', () => {
    render(wrap(<ConversationMachineBanner conversation={conv({})} />));
    expect(buttons()).toEqual(['Reconnect']);
  });

  it('ac2: a released copy offers only Open there, enabled when the continuation is listed', () => {
    const released = conv({ id: 7, name: 'conv-x', origin: 'local', environmentId: null, releasedTo: 'env-laptop', machineLabel: null });
    const continuation = conv({ name: '@env-laptop/conv-y', environmentId: 'env-laptop', machineLabel: 'laptop', machineState: 'online', pulledFrom: { environmentId: 'env-desk', nativeSessionId: 's-x' } });
    render(wrap(<ConversationMachineBanner conversation={released} />, [released, continuation]));
    expect(screen.getByTestId('machine-banner').textContent).toContain('Continued on laptop · this copy is read-only');
    expect(buttons()).toEqual(['Open there']);
    expect(screen.getByRole('button', { name: 'Open there' })).toBeEnabled();
  });

  it('renders nothing for the live states', () => {
    const { container } = render(wrap(<>
      <ConversationMachineBanner conversation={conv({ machineState: 'online' })} />
      <ConversationMachineBanner conversation={conv({ origin: 'local', environmentId: null })} />
    </>));
    expect(container.textContent).toBe('');
  });

  it('shows the "on <machine>" chip for linked rows only', () => {
    render(wrap(<>
      <ConversationMachineChip conversation={conv({ machineState: 'online' })} />
      <ConversationMachineChip conversation={conv({ origin: 'local' })} />
    </>));
    expect(screen.getAllByTestId('machine-chip').map((chip) => chip.textContent)).toEqual(['on desk']);
  });

  it('ac4: the composer of a non-live state is a read-only notice', () => {
    render(wrap(<>
      <MachineReadOnlyNotice conversation={conv({ savedCopyName: 'vault-1' })} />
      <MachineReadOnlyNotice conversation={conv({ origin: 'local', releasedTo: 'env-laptop' })} />
    </>));
    const notices = screen.getAllByTestId('machine-read-only-notice').map((notice) => notice.textContent);
    expect(notices[0]).toBe("desk is offline, so messages can't reach it. Continue here to run the conversation on this machine.");
    expect(notices[1]).toContain('Read-only. This conversation now runs on');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
