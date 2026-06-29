/**
 * Tests for ConversationPanel inline title rename UI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationPanel } from '../ConversationPanel';
import { DialogProvider } from '../../DialogProvider';

// Mock DialogProvider hooks so ConversationPanel can mount without the full provider tree
vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));

// Mock heavy child components that are not under test
vi.mock('../../XTerminal', () => ({ XTerminal: () => <div data-testid="xterminal" /> }));
vi.mock('../MessagesTimeline', () => ({ MessagesTimeline: () => null }));
vi.mock('../../DiffWorkerPoolProvider', () => ({
  DiffWorkerPoolProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../DiffPanel', () => ({
  DiffPanel: () => <div data-testid="diff-panel" />,
}));
// PAN-1523 moved the context-usage meter into the composer footer. Capture the
// usage snapshot ConversationPanel computes and passes down so we can assert it
// without rendering the real ContextWindowMeter.
vi.mock('../ComposerFooter', () => ({
  ComposerFooter: ({ contextWindowUsage }: { contextWindowUsage: unknown }) => (
    <div data-testid="composer-footer" data-usage={JSON.stringify(contextWindowUsage)} />
  ),
}));
vi.mock('../ModelPicker', () => ({
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: vi.fn(),
  saveStoredModel: vi.fn(),
  ModelPicker: ({ value, onChange }: { value: string; onChange: (m: string) => void }) => (
    <select
      data-testid="model-picker"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

// Mock updateConversationTitle — we only want to assert calls, not hit the network
vi.mock('../../CommandDeck/ConversationList', () => ({
  updateConversationTitle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    conversationTerminal: 'conversationTerminal',
    conversationTerminalHeader: 'conversationTerminalHeader',
    conversationHeaderContainer: 'conversationHeaderContainer',
    conversationTerminalTitle: 'conversationTerminalTitle',
    conversationTerminalStatus: 'conversationTerminalStatus',
    conversationTerminalBody: 'conversationTerminalBody',
    spinnerIcon: 'spinnerIcon',
    conversationTitleInput: 'conversationTitleInput',
    conversationTitleEditBtn: 'conversationTitleEditBtn',
    copyLinkButton: 'copyLinkButton',
    conversationAboutToggle: 'conversationAboutToggle',
    conversationAboutToggleActive: 'conversationAboutToggleActive',
    conversationAboutDrawer: 'conversationAboutDrawer',
    conversationAboutText: 'conversationAboutText',
    conversationAboutMeta: 'conversationAboutMeta',
    conversationAboutMuted: 'conversationAboutMuted',
    viewToggle: 'viewToggle',
    viewToggleBtn: 'viewToggleBtn',
    viewToggleBtnActive: 'viewToggleBtnActive',
  },
}));

// Import the mock so we can assert on it
import { updateConversationTitle } from '../../CommandDeck/ConversationList';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockConversation: React.ComponentProps<typeof ConversationPanel>['conversation'] = {
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
  title: 'My Panel Title',
  model: 'claude-opus-4-6',
};

function makeClient(messagesData = {
  messages: [],
  workLog: [],
  streaming: false,
}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Pre-seed messages so the useQuery doesn't attempt a real fetch
  client.setQueryData(['conversation-messages', 'test-conv'], messagesData);
  return client;
}

function renderPanel(
  conversation = mockConversation,
  props: Partial<React.ComponentProps<typeof ConversationPanel>> = {},
  messagesData?: Parameters<typeof makeClient>[0],
) {
  const client = makeClient(messagesData);
  const view = render(
    <DialogProvider>
      <QueryClientProvider client={client}>
        <ConversationPanel
          conversation={conversation}
          viewMode="conversation"
          onArchived={() => {}}
          {...props}
        />
      </QueryClientProvider>
    </DialogProvider>,
  );
  return { client, ...view };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationPanel rename flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the conversation title in the header', () => {
    renderPanel();
    expect(screen.getByText('My Panel Title')).toBeInTheDocument();
  });

  it('shows About as a visible pressed-state toggle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: 'This conversation is about tightening dashboard behavior.',
        messageCount: 2,
        generatedAt: '2026-06-11T00:00:00.000Z',
      }),
    }));

    renderPanel();
    const toggle = screen.getByRole('button', { name: 'Show about this conversation' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide about this conversation' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('This conversation is about tightening dashboard behavior.')).toBeInTheDocument();
  });

  it('shows Hide tool calls as a visible pressed-state toggle', () => {
    renderPanel();
    const toggle = screen.getByRole('button', { name: 'Hide tool calls' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show tool calls' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a pi Stop button during a running turn and posts abort', async () => {
    let resolveAbort: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/abort')) {
        return new Promise<Response>((resolve) => {
          resolveAbort = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel(
      {
        ...mockConversation,
        harness: 'pi',
        sessionAlive: true,
        status: 'active',
      },
      {},
      {
        messages: [{
          id: 'u1',
          role: 'user',
          text: 'please keep working',
          createdAt: new Date().toISOString(),
        }],
        workLog: [],
        streaming: true,
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop current turn' }));

    await waitFor(() => expect(screen.getByText('Stopping…')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/test-conv/abort', expect.objectContaining({ method: 'POST' }));

    resolveAbort?.(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.getByText('Stop')).toBeInTheDocument());
  });

  it('closes the About drawer when switching conversations', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ summary: null, messageCount: 0, generatedAt: null }),
    }));

    const { rerender, client } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show about this conversation' }));
    expect(screen.getByRole('button', { name: 'Hide about this conversation' })).toHaveAttribute('aria-pressed', 'true');

    const nextConversation = {
      ...mockConversation,
      id: 2,
      name: 'next-conv',
      title: 'Next Conversation',
    };
    client.setQueryData(['conversation-messages', 'next-conv'], { messages: [], workLog: [], streaming: false });
    rerender(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationPanel
            conversation={nextConversation}
            viewMode="conversation"
            onArchived={() => {}}
          />
        </QueryClientProvider>
      </DialogProvider>,
    );

    expect(screen.getByRole('button', { name: 'Show about this conversation' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not mount the terminal when a diff deep-link opens a live terminal-mode conversation', () => {
    window.history.replaceState(null, '', '/conv/1?diff=1&diffTurnId=turn-1&diffFilePath=src%2Ffile.ts');
    const activeConversation = {
      ...mockConversation,
      sessionAlive: true,
      endedAt: null,
    };
    const client = makeClient();
    client.setQueryData(['conversation-diffs', 'test-conv'], {
      summaries: [{ turnId: 'turn-1', completedAt: '2024-01-01T00:00:00Z', status: 'completed', files: [] }],
    });
    render(
      <DialogProvider>
        <QueryClientProvider client={client}>
          <ConversationPanel
            conversation={activeConversation}
            viewMode="terminal"
            onArchived={() => {}}
          />
        </QueryClientProvider>
      </DialogProvider>,
    );

    expect(screen.getByTestId('diff-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('xterminal')).not.toBeInTheDocument();
  });

  it('passes conversation context usage to the composer footer', () => {
    renderPanel({
      ...mockConversation,
      contextUsage: {
        activeBytes: 6_000,
        estimatedTokens: 1_500,
        contextWindow: 200_000,
        percentUsed: 0.75,
      },
    });
    expect(screen.getByTestId('composer-footer')).toHaveAttribute(
      'data-usage',
      expect.stringContaining('"usedTokens":1500'),
    );
  });

  it('prefers the latest messages response context usage', () => {
    renderPanel(
      {
        ...mockConversation,
        contextUsage: {
          activeBytes: 6_000,
          estimatedTokens: 1_500,
          contextWindow: 200_000,
          percentUsed: 0.75,
        },
      },
      {},
      {
        messages: [],
        workLog: [],
        streaming: false,
        contextUsage: {
          activeBytes: 132_164,
          estimatedTokens: 33_041,
          contextWindow: 200_000,
          percentUsed: 16.52,
        },
      },
    );
    expect(screen.getByTestId('composer-footer')).toHaveAttribute(
      'data-usage',
      expect.stringContaining('"usedTokens":33041'),
    );
  });

  it('shows title input with current value when pencil button is clicked', () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('My Panel Title');
  });

  it('falls back to conversation name when title is null', () => {
    renderPanel({ ...mockConversation, title: null });
    expect(screen.getByRole('button', { name: 'Rename test-conv' })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    expect(input).toHaveValue('test-conv');
  });

  it('commits rename via Enter key', async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Renamed Panel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(updateConversationTitle).toHaveBeenCalledWith('test-conv', 'Renamed Panel');
    });
  });

  it('closes the input after pressing Enter', async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    });
  });

  it('cancels rename via Escape key', () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it('commits rename on blur', async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Blur Commit' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateConversationTitle).toHaveBeenCalledWith('test-conv', 'Blur Commit');
    });
  });

  it('does not call API when title is empty', () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it('does not call API when title is whitespace only', () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it('does not call API when title is unchanged', () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    // title is already 'My Panel Title', don't change it
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateConversationTitle).not.toHaveBeenCalled();
  });

  it('prevents double-commit when Enter is followed immediately by blur', async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('Rename conversation'));
    const input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Once Only' } });

    // Simulate the race: Enter commits, blur fires before React can unmount the input
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });

    await waitFor(() => {
      expect(updateConversationTitle).toHaveBeenCalledTimes(1);
    });
    expect(updateConversationTitle).toHaveBeenCalledWith('test-conv', 'Once Only');
  });

  it('resets the committed guard when a new edit session starts', async () => {
    renderPanel();

    // First rename
    fireEvent.click(screen.getByTitle('Rename conversation'));
    let input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'First' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    // Second rename — guard must have been reset
    fireEvent.click(screen.getByTitle('Rename conversation'));
    input = screen.getByRole('textbox', { name: 'Rename test-conv' });
    fireEvent.change(input, { target: { value: 'Second' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateConversationTitle).toHaveBeenCalledTimes(2);
    });
    expect(updateConversationTitle).toHaveBeenNthCalledWith(1, 'test-conv', 'First');
    expect(updateConversationTitle).toHaveBeenNthCalledWith(2, 'test-conv', 'Second');
  });

  it('renders terminal mode from props and reports toggle changes upward', () => {
    const onViewModeChange = vi.fn();
    renderPanel({ ...mockConversation, sessionAlive: true }, {
      viewMode: 'terminal',
      onViewModeChange,
    });

    expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));

    expect(onViewModeChange).toHaveBeenCalledWith('conversation');
  });

  // Detach affordance — a header button next to Copy link that opens the
  // conversation in a new browser window. Same target as the ⋮ pop-out item
  // and the drag-off-to-detach in the PaneBar. All three detach entry points
  // land on /popout/conversation/<id>, a bare conversation view (no sidebar
  // or awareness rail) so the detached window focuses on the one chat.
  it('exposes a Detach button that opens /popout/conversation/<id> in a new window', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel();

    const detach = screen.getByRole('button', { name: 'Detach conversation' });
    expect(detach).toBeInTheDocument();
    fireEvent.click(detach);

    expect(openSpy).toHaveBeenCalledWith('/popout/conversation/1', '_blank', expect.stringContaining('popup=yes'));
    openSpy.mockRestore();
  });

  it('passes ?view=terminal to the popout when in terminal mode', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPanel({ ...mockConversation, sessionAlive: true }, { viewMode: 'terminal' });

    fireEvent.click(screen.getByRole('button', { name: 'Detach conversation' }));

    expect(openSpy).toHaveBeenCalledWith(
      '/popout/conversation/1?view=terminal',
      '_blank',
      expect.stringContaining('popup=yes'),
    );
    openSpy.mockRestore();
  });

  it('hides the Detach button when the panel is embedded', () => {
    renderPanel(mockConversation, { embedded: true });
    expect(screen.queryByRole('button', { name: 'Detach conversation' })).toBeNull();
  });
});
