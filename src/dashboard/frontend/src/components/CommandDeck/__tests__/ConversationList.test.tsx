/**
 * Tests for ConversationList rename UI and updateConversationTitle API helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationList, updateConversationTitle } from '../ConversationList';

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

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(['conversations'], [mockConversation]);
  return client;
}

function renderList(props?: { selectedConversation?: string | null }) {
  const client = makeClient();
  render(
    <QueryClientProvider client={client}>
      <ConversationList
        selectedConversation={props?.selectedConversation ?? null}
        onSelectConversation={() => {}}
      />
    </QueryClientProvider>,
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

  it('renders a spinner for actively working conversations', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, sessionAlive: true, isWorking: true }]);
    render(
      <QueryClientProvider client={client}>
        <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('conversation-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-dot')).not.toBeInTheDocument();
  });

  it('renders a dot for alive but idle conversations', () => {
    const client = makeClient();
    client.setQueryData(['conversations'], [{ ...mockConversation, sessionAlive: true, isWorking: false }]);
    render(
      <QueryClientProvider client={client}>
        <ConversationList selectedConversation={null} onSelectConversation={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('conversation-dot')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-spinner')).not.toBeInTheDocument();
  });

  it('shows an edit input with the current title when the pencil button is clicked', () => {
    renderList();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('My Test Conversation');
  });

  it('commits rename via Enter key', async () => {
    renderList();
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    });
  });

  it('cancels rename via Escape key', () => {
    renderList();
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input1 = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input1, { target: { value: 'First Rename' } });
    fireEvent.keyDown(input1, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    // Second rename — the guard must have been reset when startEditing was called
    fireEvent.click(screen.getByTitle('Rename conversation'));
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
});
