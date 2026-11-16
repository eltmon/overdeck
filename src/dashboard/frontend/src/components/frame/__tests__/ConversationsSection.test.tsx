/**
 * PAN-5293 WI-11: the left column's Conversations section.
 */
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_SCOPE_STORAGE_KEY, ConversationsSection } from '../ConversationsSection';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { TestDeckNavigationProvider, type DeckNavigationCall } from '../deck/deckNavigation';
import { resetDeckLayoutStore, useDeckLayoutStore } from '../../../lib/deckLayoutStore';
import { presetLayout } from '../../../lib/paneLayout';
import { usePanesStore } from '../../../lib/panesStore';

vi.mock('../../Settings/anywhere/machinesApi', () => ({
  MACHINES_QUERY_KEY: ['anywhere-machines'],
  loadMachines: async () => ({ links: [] }),
  setMachineHidden: async () => ({ status: 200, body: {} }),
}));
vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));

const openConversation = vi.fn();
vi.mock('../deck/useOpenConversation', () => ({ useOpenConversation: () => openConversation }));

const conv = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tmuxSession: `conv-${name}`,
  status: 'ended' as const,
  cwd: '/p/alpha',
  issueId: null,
  createdAt: '2026-11-01T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
  title: name,
  ...extra,
});

const rows = [
  conv(1, 'inbox-a'),
  conv(2, 'needs-you', { pendingInputCount: 1 }),
  conv(3, 'settled-1', { settledAt: '2026-11-02T00:00:00.000Z' }),
  conv(4, 'snoozed-1', { snoozedUntil: '2099-01-01T00:00:00.000Z' }),
  conv(5, 'elsewhere', { cwd: '/p/beta' }),
];

let calls: DeckNavigationCall[] = [];

function renderSection(selectedProject = 'alpha', commandDeckProjects: Array<{ name: string }> = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['conversations'], rows);
  client.setQueryData(['registered-projects'], [
    { key: 'alpha', name: 'alpha', path: '/p/alpha' },
    { key: 'beta', name: 'beta', path: '/p/beta' },
  ]);
  client.setQueryData(['command-deck-projects'], commandDeckProjects);
  return render(
    <QueryClientProvider client={client}>
      <TestDeckNavigationProvider calls={calls}>
        <ConversationsSection selectedProject={selectedProject} />
      </TestDeckNavigationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  openConversation.mockClear();
  calls = [];
  resetDeckLayoutStore();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  useCommandDeckSelection.setState({ selectedConversation: null, selectedFeature: null });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConversationsSection (PAN-5293 F-D13)', () => {
  it('Active hides Snoozed and Settled; All shows them', () => {
    renderSection();
    expect(screen.getByTestId('conversation-scope-active')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('needs-you')).toBeInTheDocument();
    expect(screen.getByTitle('inbox-a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settled · 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Snoozed · 1/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversation-scope-all'));
    expect(screen.getByRole('button', { name: /Settled · 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Snoozed · 1/ })).toBeInTheDocument();
  });

  it('remembers All across remounts', () => {
    const first = renderSection();
    fireEvent.click(screen.getByTestId('conversation-scope-all'));
    expect(localStorage.getItem(CONVERSATION_SCOPE_STORAGE_KEY)).toBe('all');
    first.unmount();

    renderSection();
    expect(screen.getByTestId('conversation-scope-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('counts only the project conversations and opens a clicked row', () => {
    renderSection();
    expect(screen.getByTestId('conversation-scope-all')).toHaveTextContent('All 4');
    expect(screen.queryByTitle('elsewhere')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('inbox-a'));
    expect(openConversation).toHaveBeenCalledWith('inbox-a');
  });
});

describe('ConversationsSection deck switch (PAN-5343 H-D2)', () => {
  it('All projects selects the All projects deck', () => {
    renderSection();
    expect(screen.getByTestId('conversation-deck-scope-project')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('conversation-deck-scope-all'));
    expect(calls).toEqual([{ method: 'selectProject', projectName: '__all-projects__', opts: undefined }]);
  });

  it('This project restores the last project', () => {
    localStorage.setItem('overdeck.ui.lastProjectKey', 'dfai');
    renderSection('__all-projects__');
    expect(screen.getByTestId('conversation-deck-scope-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('conversation-deck-scope-project'));
    expect(calls).toEqual([{ method: 'selectProject', projectName: 'dfai', opts: undefined }]);
  });

  it('This project falls back to the first listed project, then No project', () => {
    const first = renderSection('__all-projects__', [{ name: 'beta' }, { name: 'alpha' }]);
    fireEvent.click(screen.getByTestId('conversation-deck-scope-project'));
    expect(calls.at(-1)).toEqual({ method: 'selectProject', projectName: 'beta', opts: undefined });
    first.unmount();

    renderSection('__all-projects__');
    fireEvent.click(screen.getByTestId('conversation-deck-scope-project'));
    expect(calls.at(-1)).toEqual({ method: 'selectProject', projectName: '__no-project__', opts: undefined });
  });

  it('lists every project in the All projects deck, with the full count', () => {
    renderSection('__all-projects__');
    expect(screen.getByTitle('elsewhere')).toBeInTheDocument();
    expect(screen.getByTitle('inbox-a')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-scope-all')).toHaveTextContent('All 5');
  });
});

describe('ConversationsSection pane badges (PAN-5343 H-D18)', () => {
  const agentPane = (paneId: string, conversationId: string) => ({ paneId, paneType: 'agent' as const, label: conversationId, createdAt: 1, conversationId });

  function seedDeck(layout: ReturnType<typeof presetLayout> | null) {
    usePanesStore.setState({
      panesByWorkspace: { alpha: [agentPane('p1', 'needs-you'), agentPane('p2', 'inbox-a')] },
      activePaneByWorkspace: { alpha: 'p1' },
    });
    useDeckLayoutStore.setState({ layoutByDeck: { alpha: layout }, focusHistoryByDeck: {} });
  }

  const badgeIn = (title: string) => screen.getByTitle(title).querySelector('[data-testid="conversation-pane-slot"]');

  it('numbers the rows shown in a 2-leaf layout and leaves other rows unbadged', () => {
    seedDeck(presetLayout(['p1', 'p2'], 2));
    renderSection();
    expect(badgeIn('inbox-a')).toHaveTextContent('2');
    expect(badgeIn('needs-you')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('conversation-scope-all'));
    expect(screen.getAllByTestId('conversation-pane-slot')).toHaveLength(2);
  });

  it('shows no badge with a null layout', () => {
    seedDeck(null);
    renderSection();
    expect(screen.queryByTestId('conversation-pane-slot')).not.toBeInTheDocument();
  });

  it('drops the badge when the layout goes back to null', () => {
    seedDeck(presetLayout(['p1', 'p2'], 2));
    renderSection();
    expect(badgeIn('inbox-a')).toHaveTextContent('2');
    act(() => { useDeckLayoutStore.getState().setLayout('alpha', null); });
    expect(screen.queryByTestId('conversation-pane-slot')).not.toBeInTheDocument();
  });
});
