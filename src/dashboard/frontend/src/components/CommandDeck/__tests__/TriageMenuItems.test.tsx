/**
 * PAN-4639 WI-7: Settle/Unsettle — the shared menu item, the row's settle
 * checkbox, and that both the row menu and the tab menu offer it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { TriageMenuItems } from '../TriageMenuItems';
import { ConversationRow } from '../ConversationRow';
import { ConversationActionMenu } from '../ConversationActionMenu';
import type { Conversation } from '../ConversationList';
import type { ConversationMutations } from '../useConversationMutations';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

const conversation: Conversation = {
  id: 1,
  name: 'test-conversation',
  tmuxSession: 'conv-test-conversation',
  status: 'ended',
  cwd: '/tmp',
  issueId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
  title: 'Test conversation',
};

function baseMutations(overrides: Partial<ConversationMutations> = {}): ConversationMutations {
  return {
    archive: vi.fn(),
    isArchivePending: vi.fn(() => false),
    stop: vi.fn(),
    rename: vi.fn(),
    retitle: vi.fn(),
    isRetitlePending: vi.fn(() => false),
    toggleFavorite: vi.fn(),
    move: vi.fn(),
    linkPullRequest: vi.fn(),
    unlinkPullRequest: vi.fn(),
    triage: vi.fn(),
    undoLastTriage: vi.fn(() => false),
    openForkModal: vi.fn(),
    submitFork: vi.fn(),
    forkTarget: null,
    forkTargetMode: undefined,
    forkTargetFocus: undefined,
    closeForkModal: vi.fn(),
    isForkPending: false,
    ...overrides,
  };
}

describe('TriageMenuItems', () => {
  it('renders Settle for an unsettled conversation and calls triage on click', () => {
    const triage = vi.fn();
    render(<TriageMenuItems conversation={conversation} mutations={{ triage }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settle' }));
    expect(triage).toHaveBeenCalledWith({
      updates: [{ name: 'test-conversation', settled: true }],
      label: 'Settled "Test conversation"',
    });
  });

  it('renders Unsettle for a settled conversation, calls triage with settled: false, and closes', () => {
    const triage = vi.fn();
    const onClose = vi.fn();
    render(
      <TriageMenuItems
        conversation={{ ...conversation, settledAt: '2026-09-01T00:00:00.000Z' }}
        mutations={{ triage }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unsettle' }));
    expect(triage).toHaveBeenCalledWith({
      updates: [{ name: 'test-conversation', settled: false }],
      label: 'Moved "Test conversation" to Inbox',
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConversationRow settle checkbox (settle-controls.ac1, ac3)', () => {
  function renderRow(convOverrides: Partial<Conversation>, variant: 'flat' | 'nested' = 'flat', mutations = baseMutations()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationRow
          conv={{ ...conversation, ...convOverrides }}
          isSelected={false}
          onSelect={onSelect}
          mutations={mutations}
          variant={variant}
        />
      </QueryClientProvider>,
    );
    return { onSelect, mutations };
  }

  it('an unsettled top-level row has an unchecked checkbox; clicking it settles and never selects the row', () => {
    const triage = vi.fn();
    const { onSelect } = renderRow({}, 'flat', baseMutations({ triage }));
    const checkbox = screen.getByRole('checkbox', { name: 'Settle Test conversation' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);

    expect(triage).toHaveBeenCalledWith({
      updates: [{ name: 'test-conversation', settled: true }],
      label: 'Settled "Test conversation"',
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a settled row has a checked checkbox labeled Unsettle', () => {
    renderRow({ settledAt: '2026-09-01T00:00:00.000Z' });
    expect(screen.getByRole('checkbox', { name: 'Unsettle Test conversation' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a nested row renders no settle checkbox (settle-controls.ac3)', () => {
    renderRow({}, 'nested');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('row and tab menus both offer Settle/Unsettle (settle-controls.ac2, ac3)', () => {
  it('the row overflow menu shows Settle for an unsettled conversation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationRow conv={conversation} isSelected={false} onSelect={vi.fn()} mutations={baseMutations()} />
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByTitle('test-conversation'));
    expect(await screen.findByRole('menuitem', { name: 'Settle' })).toBeInTheDocument();
  });

  it('a nested row renders no Settle menu item', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationRow conv={conversation} isSelected={false} onSelect={vi.fn()} mutations={baseMutations()} variant="nested" />
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByTitle('test-conversation'));
    expect(screen.queryByRole('menuitem', { name: 'Settle' })).not.toBeInTheDocument();
  });

  it('the tab ConversationActionMenu shows Unsettle for a settled conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationActionMenu
          conversation={{ ...conversation, settledAt: '2026-09-01T00:00:00.000Z' }}
          mutations={baseMutations()}
          position={{ top: 0, left: 0 }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('menuitem', { name: 'Unsettle' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
