/**
 * PAN-4639 WI-7: Settle/Unsettle — the shared menu item, the row's settle
 * checkbox, and that both the row menu and the tab menu offer it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    isStopPending: vi.fn(() => false),
    rename: vi.fn(),
    retitle: vi.fn(),
    isRetitlePending: vi.fn(() => false),
    toggleFavorite: vi.fn(),
    move: vi.fn(),
    linkPullRequest: vi.fn(),
    unlinkPullRequest: vi.fn(),
    triage: vi.fn(),
    undoLastTriage: vi.fn(() => false),
    setAutoSettleOverride: vi.fn(),
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

describe('Snooze submenu (snooze-menu.ac1-ac3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders four presets plus Custom… at 10:00 local', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    render(<TriageMenuItems conversation={conversation} mutations={{ triage: vi.fn() }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));

    expect(screen.getByRole('menuitem', { name: '1 hour' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'This evening' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Tomorrow morning' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom snooze time')).toBeInTheDocument();
  });

  it('omits This evening at 17:30 local, keeping the other three presets plus Custom…', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 17, 30));
    render(<TriageMenuItems conversation={conversation} mutations={{ triage: vi.fn() }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));

    expect(screen.queryByRole('menuitem', { name: 'This evening' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '1 hour' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Tomorrow morning' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom snooze time')).toBeInTheDocument();
  });

  it('choosing Tomorrow morning calls triage with tomorrow 09:00 local as an ISO string (ac2)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    const triage = vi.fn();
    const onClose = vi.fn();
    render(<TriageMenuItems conversation={conversation} mutations={{ triage }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tomorrow morning' }));

    const expected = new Date(2026, 10, 3, 9, 0, 0, 0).toISOString();
    expect(triage).toHaveBeenCalledWith(
      expect.objectContaining({ updates: [{ name: 'test-conversation', snoozedUntil: expected }] }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('a Custom value earlier than now keeps the Snooze button disabled (ac3)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    render(<TriageMenuItems conversation={conversation} mutations={{ triage: vi.fn() }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));

    const input = screen.getByLabelText('Custom snooze time');
    fireEvent.change(input, { target: { value: '2026-11-01T09:00' } });
    expect(screen.getByRole('button', { name: 'Snooze' })).toBeDisabled();
  });

  it('a Custom value in the future enables the Snooze button and calls triage on click', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    const triage = vi.fn();
    render(<TriageMenuItems conversation={conversation} mutations={{ triage }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }));

    const input = screen.getByLabelText('Custom snooze time');
    fireEvent.change(input, { target: { value: '2026-11-05T14:00' } });
    const button = screen.getByRole('button', { name: 'Snooze' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    const expected = new Date(2026, 10, 5, 14, 0).toISOString();
    expect(triage).toHaveBeenCalledWith(
      expect.objectContaining({ updates: [{ name: 'test-conversation', snoozedUntil: expected }] }),
    );
  });

  it('shows Unsnooze for a conversation snoozed in the future, and not for an unsnoozed one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    const futureSnooze = { ...conversation, snoozedUntil: new Date(2026, 10, 3, 9, 0).toISOString() };
    render(<TriageMenuItems conversation={futureSnooze} mutations={{ triage: vi.fn() }} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: 'Unsnooze' })).toBeInTheDocument();
  });

  it('clicking Unsnooze sends snoozedUntil: null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    const triage = vi.fn();
    const futureSnooze = { ...conversation, snoozedUntil: new Date(2026, 10, 3, 9, 0).toISOString() };
    render(<TriageMenuItems conversation={futureSnooze} mutations={{ triage }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unsnooze' }));
    expect(triage).toHaveBeenCalledWith(
      expect.objectContaining({ updates: [{ name: 'test-conversation', snoozedUntil: null }] }),
    );
  });

  it('a row snoozed until tomorrow 09:00 renders the wake label "back tomorrow 09:00" (ac3)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    const until = new Date(2026, 10, 3, 9, 0, 0, 0).toISOString();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationRow
          conv={{ ...conversation, snoozedUntil: until }}
          isSelected={false}
          onSelect={vi.fn()}
          mutations={baseMutations()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('back tomorrow 09:00')).toBeInTheDocument();
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

describe('Auto-settle on merge submenu (PAN-4653 WI-7)', () => {
  function openSubmenu(conv: Conversation, setAutoSettleOverride = vi.fn(), onClose = vi.fn()) {
    render(<TriageMenuItems conversation={conv} mutations={{ triage: vi.fn(), setAutoSettleOverride }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Auto-settle on merge' }));
    return { setAutoSettleOverride, onClose };
  }

  it('lists three choices and marks Use global setting when no override is set', () => {
    openSubmenu(conversation);
    const menu = screen.getByRole('menu', { name: 'Auto-settle on merge' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Use global setting', 'Always', 'Never']);
    expect(within(menu).getByRole('menuitem', { name: 'Use global setting' })).toHaveAttribute('aria-current', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Never' })).not.toHaveAttribute('aria-current');
  });

  it('choosing Never sets the override to off and closes the menu', () => {
    const { setAutoSettleOverride, onClose } = openSubmenu(conversation);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Never' }));
    expect(setAutoSettleOverride).toHaveBeenCalledWith({ name: 'test-conversation', override: 'off' });
    expect(onClose).toHaveBeenCalled();
  });

  it('marks Always for a conversation whose override is on', () => {
    openSubmenu({ ...conversation, autoSettleOverride: 'on' });
    expect(screen.getByRole('menuitem', { name: 'Always' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('menuitem', { name: 'Use global setting' })).not.toHaveAttribute('aria-current');
  });
});
