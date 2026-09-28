import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { UnscopedConversationChip } from '../UnscopedConversationChip';
import type { Conversation } from '../ConversationList';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    name: 'conv-a',
    tmuxSession: 'sess-1',
    status: 'active',
    cwd: '/home/user/somewhere',
    issueId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    ...overrides,
  } as Conversation;
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const REGISTERED_PROJECTS = [
  { key: 'overdeck', name: 'Overdeck', path: '/home/user/Projects/overdeck' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/registered-projects') return Response.json(REGISTERED_PROJECTS);
    if (url.endsWith('/move') && init?.method === 'PATCH') return Response.json({ projectKey: 'overdeck' });
    return Response.json({});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UnscopedConversationChip', () => {
  it('renders nothing for a scoped conversation', async () => {
    const { container } = renderWithProviders(<UnscopedConversationChip conversation={makeConversation({ projectKey: 'overdeck' })} />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders for an unscoped conversation', async () => {
    renderWithProviders(<UnscopedConversationChip conversation={makeConversation()} />);
    expect(await screen.findByText('Move to project…')).toBeInTheDocument();
  });

  it('choosing a project moves the conversation', async () => {
    renderWithProviders(<UnscopedConversationChip conversation={makeConversation()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Move to project…/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Overdeck' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/conversations/conv-a/move',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ projectKey: 'overdeck' }) }),
      );
    });
  });
});
