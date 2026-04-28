import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import { SessionPanel } from './SessionPanel';

vi.mock('../styles/command-deck.module.css', () => ({
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

vi.mock('../RoundCard', () => ({
  RoundCard: ({ round }: { round: { round: number; verdict: string } }) => (
    <div data-testid="round-card" data-round={round.round} data-verdict={round.verdict} />
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

  it('renders toggle bar with Conversation and Terminal tabs', () => {
    render(<SessionPanel session={makeSession()} />);
    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
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

  it('falls back to sessionId for terminal when tmuxSession is missing but active', () => {
    render(<SessionPanel session={makeSession({ tmuxSession: undefined, presence: 'active' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.getByTestId('x-terminal')).toBeInTheDocument();
  });

  it('shows no terminal available when tmuxSession is missing and session is idle', () => {
    render(<SessionPanel session={makeSession({ tmuxSession: undefined, presence: 'idle' })} />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(screen.getByText('No terminal session available.')).toBeInTheDocument();
  });

  it('hides Findings tab when session has no roundMetadata', () => {
    render(<SessionPanel session={makeSession({ type: 'work' })} />);
    expect(screen.queryByText('Findings')).not.toBeInTheDocument();
  });

  it('shows Findings tab for reviewer sessions with roundMetadata', () => {
    render(
      <SessionPanel
        session={makeSession({
          type: 'reviewer',
          role: 'correctness',
          roundMetadata: {
            roundCount: 1,
            latestRound: 1,
            history: [{ round: 1, status: 'passed', findings: 0, durationSec: 30, cost: 0.12 }],
          },
        })}
      />,
    );
    expect(screen.getByText('Findings')).toBeInTheDocument();
  });

  it('switches to Findings view and renders round cards', () => {
    render(
      <SessionPanel
        session={makeSession({
          type: 'reviewer',
          role: 'correctness',
          roundMetadata: {
            roundCount: 2,
            latestRound: 2,
            history: [
              { round: 1, status: 'failed', findings: 3, durationSec: 45, cost: 0.25 },
              { round: 2, status: 'passed', findings: 0, durationSec: 30, cost: 0.12 },
            ],
          },
        })}
      />,
    );
    fireEvent.click(screen.getByText('Findings'));
    expect(screen.getByText('Review rounds')).toBeInTheDocument();
    const cards = screen.getAllByTestId('round-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-round', '1');
    expect(cards[0]).toHaveAttribute('data-verdict', 'failed');
    expect(cards[1]).toHaveAttribute('data-round', '2');
    expect(cards[1]).toHaveAttribute('data-verdict', 'passed');
  });

  it('persists findings view to localStorage', () => {
    const { unmount } = render(
      <SessionPanel
        session={makeSession({
          sessionId: 'sess-findings',
          roundMetadata: {
            roundCount: 1,
            latestRound: 1,
            history: [{ round: 1, status: 'passed' }],
          },
        })}
      />,
    );
    fireEvent.click(screen.getByText('Findings'));
    expect(localStorage.getItem('mc-session-panel-view:sess-findings')).toBe('findings');
    unmount();

    render(
      <SessionPanel
        session={makeSession({
          sessionId: 'sess-findings',
          roundMetadata: {
            roundCount: 1,
            latestRound: 1,
            history: [{ round: 1, status: 'passed' }],
          },
        })}
      />,
    );
    expect(screen.getByText('Review rounds')).toBeInTheDocument();
  });
});
