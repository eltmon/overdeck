/**
 * PAN-5293 WI-11: the left column's Conversations section.
 */
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_SCOPE_STORAGE_KEY, ConversationsSection } from '../ConversationsSection';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';

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

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['conversations'], rows);
  client.setQueryData(['registered-projects'], [
    { key: 'alpha', name: 'alpha', path: '/p/alpha' },
    { key: 'beta', name: 'beta', path: '/p/beta' },
  ]);
  client.setQueryData(['command-deck-projects'], []);
  return render(
    <QueryClientProvider client={client}>
      <ConversationsSection selectedProject="alpha" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  openConversation.mockClear();
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
