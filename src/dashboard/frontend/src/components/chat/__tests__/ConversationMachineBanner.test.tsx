/** PAN-4650 WI-12: the machine banner shows exactly its state's actions; non-live composers are read-only. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../VaultContinueDialog', () => ({ VaultContinueDialog: () => null }));
vi.mock('../../Settings/anywhere/machinesApi', () => ({ reconnectMachine: vi.fn(async () => ({ ok: true })) }));

import type { Conversation } from '../../CommandDeck/ConversationList';
import { ConversationMachineBanner, ConversationMachineChip, MachineReadOnlyNotice, RemoteHeaderActions } from '../ConversationMachineBanner';

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

/**
 * PAN-4732: the five title-bar states of the PAN-4650 browser spec, in happy-dom. Rows copied
 * from tests/e2e/fixtures/linked-conversations.ts and outcomes from the EXPECTED table in
 * tests/e2e/linked-conversation-title-bar.spec.ts. Header colours stay in the browser spec.
 */
const STATES = ['local', 'remote', 'offline-saved', 'offline-none', 'released'] as const;
type TitleBarState = (typeof STATES)[number];

const BASE = {
  tmuxSession: 'conv-x', status: 'active', cwd: '/home/desk/overdeck/workspaces/feature-pan-4650', issueId: 'PAN-4650',
  createdAt: '2026-11-01T10:00:00.000Z', endedAt: null, lastAttachedAt: null, sessionAlive: true, title: 'Fix the deploy pipeline',
  model: 'claude-opus-5-5', pullable: true, isWorking: false,
};

const LINKED = {
  ...BASE, id: -4, name: '@env-desk/conv-x', origin: 'linked', environmentId: 'env-desk', remoteName: 'conv-x', machineLabel: 'desk',
  machineLastSeenAt: '2026-11-01T11:48:00.000Z', releasedTo: null,
};

function rowFor(state: TitleBarState): Conversation {
  switch (state) {
    case 'local': return { ...BASE, id: 12, name: 'conv-x', origin: 'local' } as Conversation;
    case 'remote': return { ...LINKED, machineState: 'online', savedCopyName: null } as Conversation;
    case 'offline-saved': return { ...LINKED, machineState: 'offline', savedCopyName: 'vault-1', savedCopyAt: '2026-11-01T14:02:00.000Z' } as Conversation;
    case 'offline-none': return { ...LINKED, machineState: 'offline', savedCopyName: null } as Conversation;
    case 'released': return { ...BASE, id: 12, name: 'conv-x', origin: 'local', releasedTo: 'env-laptop', claudeSessionId: 's-x', sessionAlive: false } as Conversation;
  }
}

/** The linked row the released copy became, so Open there is enabled. */
const CONTINUATION = {
  ...LINKED, name: '@env-laptop/conv-y', environmentId: 'env-laptop', machineLabel: 'laptop', machineState: 'online',
  pulledFrom: { environmentId: 'env-desk', nativeSessionId: 's-x' },
} as unknown as Conversation;

/** What each state shows (mockup states 1-5). */
const EXPECTED: Record<TitleBarState, { chip: string | null; banner: string | null; buttons: string[]; readOnly: boolean }> = {
  local: { chip: null, banner: null, buttons: [], readOnly: false },
  remote: { chip: 'on desk', banner: null, buttons: ['Preview', 'Pull here'], readOnly: false },
  'offline-saved': { chip: 'on desk', banner: 'desk is offline (last seen', buttons: ['Read saved copy', 'Continue here'], readOnly: true },
  'offline-none': { chip: 'on desk', banner: 'desk is offline (last seen', buttons: ['Reconnect'], readOnly: true },
  released: { chip: null, banner: 'Continued on laptop · this copy is read-only', buttons: ['Open there'], readOnly: true },
};

describe('the five title-bar states (PAN-4732)', () => {
  it.each(STATES)('%s', (state) => {
    const conversation = rowFor(state);
    const live = state === 'local' || state === 'remote';
    render(wrap(<>
      <RemoteHeaderActions conversation={conversation} />
      <ConversationMachineChip conversation={conversation} />
      <ConversationMachineBanner conversation={conversation} />
      {live ? <div>composer</div> : <MachineReadOnlyNotice conversation={conversation} />}
    </>, [conversation, CONTINUATION]));
    const expected = EXPECTED[state];
    expect(screen.queryAllByTestId('machine-chip').map((chip) => chip.textContent)).toEqual(expected.chip ? [expected.chip] : []);
    const banner = screen.queryAllByTestId('machine-banner').map((node) => node.textContent ?? '');
    if (expected.banner) expect(banner[0] ?? '').toContain(expected.banner);
    else expect(banner).toEqual([]);
    expect(screen.queryAllByRole('button').map((button) => button.textContent?.trim()).filter(Boolean)).toEqual(expected.buttons);
    expect(screen.queryAllByTestId('machine-read-only-notice')).toHaveLength(expected.readOnly ? 1 : 0);
  });
});
