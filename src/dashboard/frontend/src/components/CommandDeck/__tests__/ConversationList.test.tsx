/**
 * Tests for ConversationList rename UI and updateConversationTitle API helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationList, updateConversationTitle } from '../ConversationList';
import { DialogProvider } from '../../DialogProvider';

vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Circle: (props: Record<string, unknown>) => <svg data-testid="conversation-dot" {...props} />,
    Loader2: (props: Record<string, unknown>) => <svg data-testid="conversation-spinner" {...props} />,
    Archive: () => <svg />,
    Copy: () => <svg />,
    Check: () => <svg />,
    X: () => <svg />,
    Pencil: () => <svg />,
    Star: () => <svg />,
  };
});

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    conversationList: 'conversationList',
    conversationItem: 'conversationItem',
    conversationItemSelected: 'conversationItemSelected',
    conversationName: 'conversationName',
    conversationNameInput: 'conversationNameInput',
    conversationEditBtn: 'conversationEditBtn',
    conversationArchiveBtn: 'conversationArchiveBtn',
    conversationCopyBtn: 'conversationCopyBtn',
    conversationStopBtn: 'conversationStopBtn',
    conversationDot: 'conversationDot',
    conversationWorkingSpinner: 'conversationWorkingSpinner',
    conversationEmpty: 'conversationEmpty',
    skeletonList: 'skeletonList',
    skeletonItem: 'skeletonItem',
    featureCost: 'featureCost',
  },
}));

const mockConversation = {
  id: 1,
  name: 'test-conv',
  tmuxSession: 'test-session',
  status: 'ended' as const,
  cwd: '/home/user',
  issueId: null,
  createdAt: '2024-01-01T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
  isWorking: false,
  title: 'My Test Conversation',
};

const secondMockConversation = {
  ...mockConversation,
  id: 2,
  name: 'second-conv',
  tmuxSession: 'test-session-2',
  title: 'Second Test Conversation',
};

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(['conversations'], [mockConversation]);
  // PAN-1577: pre-seed so ConversationList's registered-projects query (for
  // each row's Move submenu) doesn't fire an extra real fetch in these tests.
  client.setQueryData(['registered-projects'], []);
  return client;
}

function renderList(props?: { selectedConversation?: string | null }) {
  const client = makeClient();
  render(
    <DialogProvider>
      <QueryClientProvider client={client}>
        <ConversationList
          selectedConversation={props?.selectedConversation ?? null}
          onSelectConversation={() => {}}
        />
      </QueryClientProvider>
    </DialogProvider>,
  );
  return client;
}

// ─── updateConversationTitle unit tests ───────────────────────────────────────

describe('updateConversationTitle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls PATCH endpoint with the correct URL and body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await updateConversationTitle('my-conv', 'New Title');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/conversations/my-conv',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      }),
    );
  });

  it('URL-encodes the conversation name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await updateConversationTitle('my conv/special', 'Title');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/conversations/my%20conv%2Fspecial',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('throws when the server returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(updateConversationTitle('my-conv', 'New Title')).rejects.toThrow(
      'Failed to update conversation title',
    );
  });
});

// ─── ConversationList rename flow ─────────────────────────────────────────────

describe('ConversationList rename flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the conversation title', () => {
    renderList();
    expect(screen.getByText('My Test Conversation')).toBeInTheDocument();
  });

  it('renders the harness next to the model', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{
      ...mockConversation,
      harness: 'codex',
      model: 'gpt-5.5-codex',
    }]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );

    expect(screen.getByTitle('Harness: Codex')).toHaveTextContent('Codex');
    expect(screen.getByTitle('Model: gpt-5.5-codex')).toHaveTextContent('gpt-5.5-codex');
  });

  it('renders a spinner for actively working conversations', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, sessionAlive: true, isWorking: true }]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );
    expect(screen.getByTestId('conversation-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-dot')).not.toBeInTheDocument();
  });

  it('renders a dot for alive but idle conversations', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, sessionAlive: true, isWorking: false }]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );
    expect(screen.getByTestId('conversation-dot')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-spinner')).not.toBeInTheDocument();
  });

  it('shows an edit input with the current title when the pencil button is clicked', () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('My Test Conversation');
  });

  it('commits rename via Enter key', async () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Renamed Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/conversations/test-conv',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Renamed Title' }),
        }),
      );
    });
  });

  it('closes the input after pressing Enter', async () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    });
  });

  it('cancels rename via Escape key', () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('test-conv'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('commits rename on blur', async () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Blurred Title' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/conversations/test-conv',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Blurred Title' }),
        }),
      );
    });
  });

  it('does not call API when title is empty', () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('test-conv'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('does not call API when title is whitespace only', () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('test-conv'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('does not call API when title is unchanged', () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    // title is already 'My Test Conversation', don't change it
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('test-conv'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('prevents double-commit when Enter is followed by blur', async () => {
    renderList();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Once Only' } });

    // Enter commits; blur fires before React can re-render (simulates real browser race)
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });

    await waitFor(() => {
      const patchCalls = vi.mocked(fetch).mock.calls.filter(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('test-conv') &&
          (opts as RequestInit)?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(1);
    });
  });

  it('resets the committed guard when a new edit session starts', async () => {
    renderList();

    // First rename
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input1 = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input1, { target: { value: 'First Rename' } });
    fireEvent.keyDown(input1, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    // Second rename — the guard must have been reset when startEditing was called
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input2 = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input2, { target: { value: 'Second Rename' } });
    fireEvent.keyDown(input2, { key: 'Enter' });

    await waitFor(() => {
      const patchCalls = vi.mocked(fetch).mock.calls.filter(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('test-conv') &&
          (opts as RequestInit)?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(2);
    });
  });

  it('allows favoriting another conversation while one favorite request is pending', async () => {
    const pendingResponses: Array<() => void> = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((resolve) => {
      pendingResponses.push(() => resolve({ ok: true }));
    })));

    const client = makeClient();
    client.setQueryData(['conversations'], [mockConversation, secondMockConversation]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );

    fireEvent.click(screen.getByLabelText('Favorite My Test Conversation'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Favorite Second Test Conversation'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));

    pendingResponses.forEach((resolve) => resolve());
  });

  it('ignores repeated favorite clicks for the same pending conversation', async () => {
    let resolveResponse: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveResponse = () => resolve({ ok: true });
    })));

    renderList();

    fireEvent.click(screen.getByLabelText('Favorite My Test Conversation'));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Unfavorite My Test Conversation'));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    resolveResponse?.();
  });
});

// ─── Move menu (PAN-1577) ──────────────────────────────────────────────────

describe('ConversationList move flow (PAN-1577)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/move')) {
        return Promise.resolve({ ok: true, json: async () => ({ projectKey: 'myn' }) });
      }
      // Background refetches (e.g. onSettled's invalidateQueries) hit /api/conversations —
      // must resolve to an array or ConversationList's memo chain throws.
      return Promise.resolve({ ok: true, json: async () => [mockConversation] });
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithProjects() {
    const client = makeClient();
    client.setQueryData(['registered-projects'], [
      { key: 'krux', name: 'Krux', path: '/home/user/Projects/krux' },
      { key: 'myn', name: 'MYN', path: '/home/user/Projects/myn' },
    ]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );
    return client;
  }

  it('exposes a Move item with a project picker from the 3-dot menu (ac1)', () => {
    renderWithProjects();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));

    expect(screen.getByRole('menuitem', { name: 'Krux' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'MYN' })).toBeInTheDocument();
  });

  it('exposes a Move item with a project picker from right-click (ac1)', () => {
    renderWithProjects();
    fireEvent.contextMenu(screen.getByTitle('test-conv'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));

    expect(screen.getByRole('menuitem', { name: 'Krux' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'MYN' })).toBeInTheDocument();
  });

  it('disables the conversation\'s current project in the picker (ac2)', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, projectKey: 'krux' }]);
    client.setQueryData(['registered-projects'], [
      { key: 'krux', name: 'Krux', path: '/home/user/Projects/krux' },
      { key: 'myn', name: 'MYN', path: '/home/user/Projects/myn' },
    ]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));

    expect(screen.getByRole('menuitem', { name: 'Krux' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'MYN' })).not.toBeDisabled();
  });

  it('disables the cwd-derived project in the picker when there is no explicit override (review fix: effective resolution)', () => {
    const client = makeClient();
    // No projectKey override -- this conversation is only ever grouped into
    // Krux via cwd inference, which the picker's disabled-state check must
    // also honor (previously it only compared the raw, nullable projectKey).
    client.setQueryData(['conversations'], [{ ...mockConversation, cwd: '/home/user/Projects/krux/sub', projectKey: null }]);
    client.setQueryData(['registered-projects'], [
      { key: 'krux', name: 'Krux', path: '/home/user/Projects/krux' },
      { key: 'myn', name: 'MYN', path: '/home/user/Projects/myn' },
    ]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));

    expect(screen.getByRole('menuitem', { name: 'Krux' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'MYN' })).not.toBeDisabled();
  });

  it('moves the conversation via the shared mutation when another project is selected (ac2)', async () => {
    renderWithProjects();
    fireEvent.click(screen.getByTitle('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'MYN' }));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/conversations/test-conv/move',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ projectKey: 'myn' }),
        }),
      );
    });
  });
});

// ─── Drag-drop move (PAN-1577) ─────────────────────────────────────────────

function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    get types() { return Array.from(store.keys()); },
    setData: (type: string, value: string) => { store.set(type, value); },
    getData: (type: string) => store.get(type) ?? '',
  };
}

describe('ConversationRow drag source (PAN-1577)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is draggable and carries {name, projectKey, cwd} as the drag payload (ac2)', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, projectKey: 'krux' }]);
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
        </QueryClientProvider>
      </DialogProvider>,
    );

    const row = screen.getByTitle('test-conv');
    expect(row).toHaveAttribute('draggable', 'true');

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });

    // cwd travels too (review fix): the drop target needs it to resolve the
    // conversation's *effective* current project (override-first, cwd
    // fallback) for the already-in-target no-op check.
    expect(dataTransfer.getData('application/json')).toBe(
      JSON.stringify({ name: 'test-conv', projectKey: 'krux', cwd: mockConversation.cwd }),
    );
  });
});
