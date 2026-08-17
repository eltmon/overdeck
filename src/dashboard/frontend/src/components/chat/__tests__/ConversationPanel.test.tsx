/**
 * Tests for ConversationPanel inline title rename UI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { ConversationPanel } from '../ConversationPanel';
import { DialogProvider } from '../../DialogProvider';

const streamTransportMock = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
  initialEvents: new Map<string, unknown>(),
}));

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({
    request: () => new Promise(() => {}),
    subscribe: (createStream: (client: unknown) => unknown, listener: (event: unknown) => void) => {
      let conversationName = '';
      const client = new Proxy({}, {
        get: () => (args: { conversationName: string }) => {
          conversationName = args.conversationName;
          return {};
        },
      });
      createStream(client);
      streamTransportMock.listeners.set(conversationName, listener);
      const initialEvent = streamTransportMock.initialEvents.get(conversationName)
        ?? (conversationName === 'next-conv'
          ? { kind: 'messages', snapshot: true, messages: [], workLog: [], streaming: false }
          : undefined);
      if (initialEvent) listener(initialEvent);
      return vi.fn();
    },
  }),
}));

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

let queryClients: QueryClient[] = [];
let fetchControl: ReturnType<typeof installStrictFetchMock>;

function defaultConversationResponse(method: string, url: string): Response | undefined {
  if (method === 'POST' && url === 'http://localhost:3000/api/dashboard/session') {
    return Response.json({ csrfToken: 'test-csrf-token' });
  }
  if (method === 'GET' && /^\/api\/conversations\/(test-conv|next-conv|agent-test-stream-[ab])\/diffs$/.test(url)) {
    return Response.json({ summaries: [] });
  }
  // PAN-3113 — the panel polls the shared pending-input feed for pane choice
  // menus; nothing is pending in these fixtures.
  if (method === 'GET' && url.endsWith('/api/conversations/pending-input')) {
    return Response.json([]);
  }
  return undefined;
}

function makeClient(messagesData = {
  messages: [],
  workLog: [],
  streaming: false,
}) {
  streamTransportMock.initialEvents.set('test-conv', {
    kind: 'messages',
    snapshot: true,
    ...messagesData,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Pre-seed messages so the useQuery doesn't attempt a real fetch
  client.setQueryData(['conversation-messages', 'test-conv'], messagesData);
  queryClients.push(client);
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
    queryClients = [];
    fetchControl = installStrictFetchMock(({ method, url }) => defaultConversationResponse(method, url));
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
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
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/conversations/test-conv/about') {
        return Response.json({
          summary: 'This conversation is about tightening dashboard behavior.',
          messageCount: 2,
          generatedAt: '2026-06-11T00:00:00.000Z',
        });
      }
      return defaultConversationResponse(method, url);
    });

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
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/conversations/test-conv/abort') {
        return new Promise<Response>((resolve) => {
          resolveAbort = resolve;
        });
      }
      return defaultConversationResponse(method, url);
    });

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
    expect(fetchControl.fetchMock).toHaveBeenCalledWith('/api/conversations/test-conv/abort', expect.objectContaining({ method: 'POST' }));

    resolveAbort?.(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.getByText('Stop')).toBeInTheDocument());
  });

  it('closes the About drawer when switching conversations', () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && [
        '/api/conversations/test-conv/about',
        '/api/conversations/next-conv/about',
      ].includes(url)) {
        return Response.json({ summary: null, messageCount: 0, generatedAt: null });
      }
      return defaultConversationResponse(method, url);
    });

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
      sessionAlive: true,
      status: 'active',
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
        sessionAlive: true,
        status: 'active',
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

    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));

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

describe('ConversationPanel resume message control', () => {
  beforeEach(() => {
    queryClients = [];
    fetchControl = installStrictFetchMock(({ method, url }) => {
      const defaultResponse = defaultConversationResponse(method, url);
      if (defaultResponse) return defaultResponse;
      if (method === 'POST' && url === '/api/conversations/test-conv/resume') {
        return Response.json({ ...mockConversation, status: 'active', sessionAlive: true });
      }
      return undefined;
    });
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('places a checked send-message checkbox beside the resume button', () => {
    renderPanel();

    expect(screen.getByRole('checkbox', { name: 'Send resume message' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Resume Session' })).toBeInTheDocument();
  });

  it('passes the checkbox choice to the resume endpoint', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Send resume message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Session' }));

    await waitFor(() => {
      const resumeCall = fetchControl.fetchMock.mock.calls.find(([url]) => String(url) === '/api/conversations/test-conv/resume');
      expect(resumeCall).toBeDefined();
      expect(JSON.parse(String((resumeCall?.[1] as RequestInit).body))).toMatchObject({ sendResumeContract: false });
    });
  });
});

describe('ConversationPanel empty-state gating (workLog-only agent sessions)', () => {
  const workOnlyData = {
    messages: [],
    workLog: [{
      id: 'call_1',
      createdAt: new Date().toISOString(),
      label: 'Bash',
      tone: 'tool',
      toolTitle: 'Bash',
      detail: 'git status',
    }],
    streaming: false,
  };

  beforeEach(() => {
    queryClients = [];
    fetchControl = installStrictFetchMock(({ method, url }) => defaultConversationResponse(method, url));
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
    localStorage.clear();
    vi.clearAllMocks();
  });

  // Regression: since the CLIProxy 7.2 upgrade (2026-08-03), GPT-harness work
  // agents emit no assistant text blocks — only thinking/tool_use — and every
  // user entry is a filtered hook injection, so messages.length stays 0 for a
  // live, hard-at-work agent. The panel must render the work timeline, not the
  // "How can I help you?" first-message state (2026-08-04, agent-pan-3511).
  it('does not show the first-message empty state for a live session with workLog activity', () => {
    renderPanel(
      { ...mockConversation, sessionAlive: true, status: 'active', endedAt: null },
      {},
      workOnlyData,
    );
    expect(screen.queryByText('How can I help you?')).toBeNull();
    expect(screen.queryByText('Type a message below to start the conversation.')).toBeNull();
  });

  it('does not claim "no saved history" for an ended session with workLog activity', () => {
    renderPanel(
      { ...mockConversation, sessionAlive: false, status: 'ended', endedAt: '2024-01-01T01:00:00Z' },
      {},
      workOnlyData,
    );
    expect(screen.queryByText(/no saved history/)).toBeNull();
  });

  it('still shows the first-message empty state for a live session with no activity at all', () => {
    renderPanel(
      { ...mockConversation, sessionAlive: true, status: 'active', endedAt: null },
      {},
      { messages: [], workLog: [], streaming: false },
    );
    expect(screen.getByText('How can I help you?')).toBeInTheDocument();
  });
});

describe('ConversationPanel first stream payload', () => {
  const streamConversation = {
    ...mockConversation,
    id: -1,
    name: 'agent-test-stream-a',
    tmuxSession: 'agent-test-stream-a',
    status: 'active' as const,
    sessionAlive: true,
    endedAt: null,
    harness: 'ohmypi' as const,
  };

  beforeEach(() => {
    queryClients = [];
    streamTransportMock.listeners.clear();
    fetchControl = installStrictFetchMock(({ method, url }) => defaultConversationResponse(method, url));
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the loading skeleton instead of the greeting before the first payload', () => {
    renderPanel(streamConversation);

    expect(screen.getByRole('status', { name: 'Loading conversation' })).toBeInTheDocument();
    expect(screen.queryByText('How can I help you?')).toBeNull();
  });

  it('shows the greeting after the first payload confirms an empty transcript', () => {
    renderPanel(streamConversation);

    act(() => {
      streamTransportMock.listeners.get(streamConversation.name)?.({
        kind: 'messages',
        snapshot: true,
        messages: [],
        workLog: [],
        streaming: false,
      });
    });

    expect(screen.getByText('How can I help you?')).toBeInTheDocument();
  });

  it('returns to the loading skeleton when switching conversations', () => {
    const view = renderPanel(streamConversation);

    act(() => {
      streamTransportMock.listeners.get(streamConversation.name)?.({
        kind: 'messages',
        snapshot: true,
        messages: [],
        workLog: [],
        streaming: false,
      });
    });
    expect(screen.getByText('How can I help you?')).toBeInTheDocument();

    view.rerender(
      <DialogProvider>
        <QueryClientProvider client={view.client}>
          <ConversationPanel
            conversation={{
              ...streamConversation,
              name: 'agent-test-stream-b',
              tmuxSession: 'agent-test-stream-b',
            }}
            viewMode="conversation"
            onArchived={() => {}}
          />
        </QueryClientProvider>
      </DialogProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading conversation' })).toBeInTheDocument();
    expect(screen.queryByText('How can I help you?')).toBeNull();
  });
});

describe('ConversationPanel spawn-placeholder window (post-reboot interrupted rows)', () => {
  beforeEach(() => {
    queryClients = [];
    fetchControl = installStrictFetchMock(({ method, url }) => defaultConversationResponse(method, url));
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
    localStorage.clear();
    vi.clearAllMocks();
  });

  // 2026-08-05 post-reboot: a dead tmux session + no endedAt rendered
  // "Starting…" for 5+ minutes over a day-old conversation whose transcript
  // was on disk. Interrupted rows must render their content, not the spawn
  // placeholder.
  it('does not show Starting… for an old interrupted conversation with transcript content', () => {
    renderPanel(
      { ...mockConversation, sessionAlive: false, status: 'active', endedAt: null, createdAt: '2026-08-04T13:48:50.505Z' },
      {},
      {
        messages: [{ id: 'u1', role: 'user', text: 'older conversation content', createdAt: '2026-08-04T14:00:00Z' }],
        workLog: [],
        streaming: false,
      },
    );
    expect(screen.queryByText('Starting…')).toBeNull();
    expect(screen.queryByText('Waiting for the session to start.')).toBeNull();
  });

  it('still shows Starting… for a genuinely fresh spawn', () => {
    renderPanel(
      { ...mockConversation, sessionAlive: false, status: 'active', endedAt: null, createdAt: new Date().toISOString() },
      {},
      { messages: [], workLog: [], streaming: false },
    );
    expect(screen.getByText('Starting…')).toBeInTheDocument();
  });
});
