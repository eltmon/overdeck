import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileConversations } from '../MobileConversations';

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: { title: string; name: string; id: number; origin?: string } }) => (
    <div data-testid="conversation-panel" data-name={conversation.name} data-id={String(conversation.id)} data-origin={conversation.origin ?? ''}>
      {conversation.title}
    </div>
  ),
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function row(id: number, title: string, lastActivityAt: string, extra: Record<string, unknown> = {}) {
  return { id, name: `conv-${id}`, title, issueId: null, createdAt: '2026-10-01T00:00:00.000Z', lastAttachedAt: null, lastActivityAt, ...extra };
}

/** Stub `fetch` to answer `/api/conversations` and `/api/registered-projects` by URL. */
function stubFetch(conversations: unknown[], registeredProjects: unknown[] | 'error' = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/registered-projects')) {
      if (registeredProjects === 'error') return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
      return new Response(JSON.stringify(registeredProjects), { status: 200 });
    }
    return new Response(JSON.stringify(conversations), { status: 200 });
  }));
}

/** The group header toggle, never the sibling "New conversation in <label>" + button. */
async function findGroupHeader(label: string) {
  return screen.findByRole('button', { name: (accessibleName) => accessibleName.trim().startsWith(label) });
}

async function expandGroup(label: string) {
  fireEvent.click(await findGroupHeader(label));
  return screen.findByRole('list', { name: label });
}

describe('MobileConversations', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists conversations newest first and hides archived rows', async () => {
    stubFetch([
      row(1, 'Oldest', '2026-10-30T00:00:00.000Z'),
      row(2, 'Newest', '2026-11-01T00:00:00.000Z', { issueId: 'PAN-2355' }),
      row(3, 'Archived', '2026-11-01T01:00:00.000Z', { archivedAt: '2026-11-01T02:00:00.000Z' }),
      row(4, 'Middle', '2026-10-31T00:00:00.000Z'),
    ]);
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    const list = await expandGroup('No project');
    const titles = Array.from(list.querySelectorAll('li')).map((li) => li.querySelector('span span')?.textContent);
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest']);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    expect(screen.getByText('PAN-2355')).toBeInTheDocument();
  });

  it('opens a row by id', async () => {
    stubFetch([row(7, 'Seven', '2026-11-01T00:00:00.000Z')]);
    const onOpen = vi.fn();
    renderWithQuery(<MobileConversations conversationId={null} onOpen={onOpen} onBack={() => {}} />);
    await expandGroup('No project');
    fireEvent.click(await screen.findByRole('button', { name: /Seven/ }));
    expect(onOpen).toHaveBeenCalledWith('7');
  });

  it('opens a linked row by its linked name', async () => {
    stubFetch([
      row(-1, 'Remote', '2026-11-01T00:00:00.000Z', {
        name: '@env-a/conv-9',
        origin: 'linked',
        remoteName: 'conv-9',
        machineLabel: 'laptop',
      }),
    ]);
    const onOpen = vi.fn();
    renderWithQuery(<MobileConversations conversationId={null} onOpen={onOpen} onBack={() => {}} />);
    await expandGroup('No project');
    fireEvent.click(await screen.findByRole('button', { name: /Remote/ }));
    expect(onOpen).toHaveBeenCalledWith('@env-a/conv-9');
  });

  it('renders every group collapsed on first load', async () => {
    stubFetch([row(1, 'Seven', '2026-11-01T00:00:00.000Z')], [{ key: 'alpha', name: 'Alpha', path: '/p/alpha' }]);
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    const header = await findGroupHeader('Alpha');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Seven/ })).not.toBeInTheDocument();
  });

  it('expands and collapses a group and remembers it in localStorage', async () => {
    stubFetch([row(1, 'Seven', '2026-11-01T00:00:00.000Z')]);
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    const header = await screen.findByRole('button', { name: /No project/ });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('pan-mobile-expanded-projects') ?? '[]')).toContain('__no-project__');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(JSON.parse(localStorage.getItem('pan-mobile-expanded-projects') ?? '[]')).not.toContain('__no-project__');
  });

  it('groups by project and puts unscoped rows in No project last', async () => {
    stubFetch(
      [row(1, 'InProject', '2026-11-01T00:00:00.000Z', { projectKey: 'alpha' }), row(2, 'Outside', '2026-11-01T00:00:00.000Z')],
      [{ key: 'alpha', name: 'Alpha', path: '/p/alpha' }],
    );
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    await expandGroup('Alpha');
    expect(screen.getByText('InProject')).toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    await expandGroup('No project');
    expect(screen.getByText('Outside')).toBeInTheDocument();
  });

  it('falls back to projectKey groups when the project list returns 403', async () => {
    stubFetch([row(1, 'Keyed', '2026-11-01T00:00:00.000Z', { projectKey: 'alpha' })], 'error');
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    const list = await expandGroup('alpha');
    expect(list).toHaveTextContent('Keyed');
  });

  it('+ posts { projectKey } and opens the created conversation', async () => {
    const created = { id: 9, name: 'conv-9', title: 'New', issueId: null, createdAt: '2026-11-01T00:00:00.000Z', lastAttachedAt: null, projectKey: 'alpha' };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/registered-projects')) return new Response(JSON.stringify([{ key: 'alpha', name: 'Alpha', path: '/p/alpha' }]), { status: 200 });
      if (url === '/api/conversations' && init?.method === 'POST') return new Response(JSON.stringify(created), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    renderWithQuery(<MobileConversations conversationId={null} onOpen={onOpen} onBack={() => {}} />);
    const plusButton = await screen.findByRole('button', { name: 'New conversation in Alpha' });
    const header = await findGroupHeader('Alpha');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(plusButton);
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/conversations' && (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(postCall).toBeDefined();
    expect((postCall![1] as RequestInit).body).toBe(JSON.stringify({ projectKey: 'alpha' }));
    expect(onOpen).toHaveBeenCalledWith('9');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the server error inline when the create fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/registered-projects')) return new Response(JSON.stringify([{ key: 'alpha', name: 'Alpha', path: '/p/alpha' }]), { status: 200 });
      if (url === '/api/conversations' && init?.method === 'POST') return new Response(JSON.stringify({ error: 'Unknown project' }), { status: 400 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    renderWithQuery(<MobileConversations conversationId={null} onOpen={onOpen} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New conversation in Alpha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows no + on No project or in fallback mode', async () => {
    stubFetch([row(1, 'Outside', '2026-11-01T00:00:00.000Z')]);
    const { unmount } = renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    await screen.findByRole('button', { name: /No project/ });
    expect(screen.queryByRole('button', { name: /^New conversation in/ })).not.toBeInTheDocument();
    unmount();

    stubFetch([row(2, 'Keyed', '2026-11-01T00:00:00.000Z', { projectKey: 'alpha' })], 'error');
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    await screen.findByRole('button', { name: /^alpha/ });
    expect(screen.queryByRole('button', { name: /^New conversation in/ })).not.toBeInTheDocument();
  });

  it('fetches the conversation and renders the panel with a Back control', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(row(7, 'Seven', '2026-11-01T00:00:00.000Z')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onBack = vi.fn();
    renderWithQuery(<MobileConversations conversationId="7" onOpen={() => {}} onBack={onBack} />);
    expect(await screen.findByTestId('conversation-panel')).toHaveTextContent('Seven');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/conversations/7');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  const linkedRows = [
    row(4, 'Local', '2026-11-01T00:00:00.000Z'),
    row(-1, 'Remote', '2026-11-01T00:00:00.000Z', {
      name: '@env-a/conv-9',
      origin: 'linked',
      remoteName: 'conv-9',
      machineLabel: 'laptop',
    }),
  ];

  it('loads a linked conversation from the merged list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(linkedRows), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<MobileConversations conversationId="@env-a/conv-9" onOpen={() => {}} onBack={() => {}} />);
    const panel = await screen.findByTestId('conversation-panel');
    expect(panel).toHaveAttribute('data-name', '@env-a/conv-9');
    expect(panel).toHaveAttribute('data-id', '-1');
    expect(panel).toHaveAttribute('data-origin', 'linked');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((url) => url === '/api/conversations')).toBe(true);
    expect(urls).not.toContain('/api/conversations/%40env-a%2Fconv-9');
  });

  it('resolves a linked key by machine label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(linkedRows), { status: 200 })));
    renderWithQuery(<MobileConversations conversationId="@laptop/conv-9" onOpen={() => {}} onBack={() => {}} />);
    const panel = await screen.findByTestId('conversation-panel');
    expect(panel).toHaveAttribute('data-name', '@env-a/conv-9');
  });

  it('shows the load error when no linked row matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row(4, 'Local', '2026-11-01T00:00:00.000Z')]), { status: 200 })));
    renderWithQuery(<MobileConversations conversationId="@env-b/conv-9" onOpen={() => {}} onBack={() => {}} />);
    expect(await screen.findByText(/Couldn.t load this conversation/)).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
  });
});
