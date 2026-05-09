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
vi.mock('../../XTerminal', () => ({ XTerminal: () => null }));
vi.mock('../MessagesTimeline', () => ({ MessagesTimeline: () => null }));
vi.mock('../ComposerFooter', () => ({ ComposerFooter: () => null }));
vi.mock('../ModelPicker', () => ({
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
    conversationTerminalTitle: 'conversationTerminalTitle',
    conversationTerminalStatus: 'conversationTerminalStatus',
    conversationTerminalBody: 'conversationTerminalBody',
    spinnerIcon: 'spinnerIcon',
    conversationTitleInput: 'conversationTitleInput',
    conversationTitleEditBtn: 'conversationTitleEditBtn',
    copyLinkButton: 'copyLinkButton',
    viewToggle: 'viewToggle',
    viewToggleBtn: 'viewToggleBtn',
    viewToggleBtnActive: 'viewToggleBtnActive',
  },
}));

// Import the mock so we can assert on it
import { updateConversationTitle } from '../../CommandDeck/ConversationList';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  title: 'My Panel Title',
  model: 'claude-opus-4-6',
};

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Pre-seed messages so the useQuery doesn't attempt a real fetch
  client.setQueryData(['conversation-messages', 'test-conv'], {
    messages: [],
    workLog: [],
    streaming: false,
  });
  return client;
}

function renderPanel(
  conversation = mockConversation,
  props: Partial<React.ComponentProps<typeof ConversationPanel>> = {},
) {
  const client = makeClient();
  render(
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
  return client;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationPanel rename flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the conversation title in the header', () => {
    renderPanel();
    expect(screen.getByText('My Panel Title')).toBeInTheDocument();
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
});
