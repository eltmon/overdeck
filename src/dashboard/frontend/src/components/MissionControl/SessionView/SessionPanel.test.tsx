import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import { SessionPanel } from './SessionPanel';

vi.mock('../styles/mission-control.module.css', () => ({
  default: {
    sessionPanel: 'sessionPanel',
    sessionPanelHeader: 'sessionPanelHeader',
    sessionPanelInfo: 'sessionPanelInfo',
    sessionPanelType: 'sessionPanelType',
    sessionPanelPresence: 'sessionPanelPresence',
    sessionPanelModel: 'sessionPanelModel',
    sessionPanelDuration: 'sessionPanelDuration',
    sessionPanelToggle: 'sessionPanelToggle',
    sessionPanelToggleBtn: 'sessionPanelToggleBtn',
    sessionPanelToggleBtnActive: 'sessionPanelToggleBtnActive',
    sessionPanelContent: 'sessionPanelContent',
    sessionPanelTranscript: 'sessionPanelTranscript',
    sessionPanelEmpty: 'sessionPanelEmpty',
  },
}));

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: { name: string } }) => (
    <div data-testid="conversation-panel">{conversation.name}</div>
  ),
}));

vi.mock('../../chat/ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => (
    <div data-testid="chat-markdown">{text}</div>
  ),
}));

vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="x-terminal">{sessionName}</div>
  ),
}));

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-821',
    tmuxSession: 'agent-pan-821',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

describe('SessionPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders session info sub-header', () => {
    render(<SessionPanel session={makeSession()} />);
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('renders role in type badge when present', () => {
    render(<SessionPanel session={makeSession({ type: 'reviewer', role: 'correctness' })} />);
    expect(screen.getByText('reviewer:correctness')).toBeInTheDocument();
  });

  it('defaults to conversation view', () => {
    render(<SessionPanel session={makeSession({ hasJsonl: true })} />);
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('falls back to ChatMarkdown when no hasJsonl but transcript exists', () => {
    render(<SessionPanel session={makeSession({ transcript: 'Hello world' })} />);
    expect(screen.getByTestId('chat-markdown')).toHaveTextContent('Hello world');
  });

  it('shows empty state when no hasJsonl and no transcript', () => {
    render(<SessionPanel session={makeSession()} />);
    expect(screen.getByText('No conversation data available for this session.')).toBeInTheDocument();
  });

  it('switches to terminal view on toggle click', () => {
    render(<SessionPanel session={makeSession()} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.getByTestId('x-terminal')).toBeInTheDocument();
  });

  it('switches back to conversation view on toggle click', () => {
    render(<SessionPanel session={makeSession({ transcript: 'hello' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    fireEvent.click(screen.getByText('Conversation'));
    expect(screen.getByTestId('chat-markdown')).toBeInTheDocument();
  });

  it('persists view toggle to localStorage per session', () => {
    const { unmount } = render(<SessionPanel session={makeSession({ sessionId: 'sess-a' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(localStorage.getItem('mc-session-panel-view:sess-a')).toBe('terminal');
    unmount();

    render(<SessionPanel session={makeSession({ sessionId: 'sess-a' })} />);
    expect(screen.getByTestId('x-terminal')).toBeInTheDocument();
  });

  it('does not share toggle state across different sessions', () => {
    const { unmount } = render(<SessionPanel session={makeSession({ sessionId: 'sess-a' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    unmount();

    render(<SessionPanel session={makeSession({ sessionId: 'sess-b', transcript: 'hi' })} />);
    expect(screen.getByTestId('chat-markdown')).toBeInTheDocument();
  });

  it('shows session ended empty state for ended session terminal view', () => {
    render(<SessionPanel session={makeSession({ presence: 'ended' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.getByText('Session ended')).toBeInTheDocument();
  });

  it('still shows conversation for ended session with transcript', () => {
    render(
      <SessionPanel session={makeSession({ presence: 'ended', transcript: 'ended transcript' })} />,
    );
    expect(screen.getByTestId('chat-markdown')).toHaveTextContent('ended transcript');
  });

  it('shows no terminal available when tmuxSession is missing', () => {
    render(<SessionPanel session={makeSession({ tmuxSession: undefined })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.getByText('No terminal session available.')).toBeInTheDocument();
  });
});
