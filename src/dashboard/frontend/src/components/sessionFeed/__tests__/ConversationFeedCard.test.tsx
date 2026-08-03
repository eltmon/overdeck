import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationFeedCard } from '../ConversationFeedCard';
import type { ConversationSessionFeedEntry } from '../types';

function entry(overrides: Partial<ConversationSessionFeedEntry> = {}): ConversationSessionFeedEntry {
  return {
    kind: 'conversation',
    id: 'conversation:conv-a',
    timestamp: '2026-05-23T01:00:00.000Z',
    workspaceId: '/workspace/a',
    issueId: 'PAN-1389',
    conversationId: 42,
    conversationName: 'conv-a',
    agent: 'claude_code',
    lastMessageDate: '2026-05-23T01:00:00.000Z',
    lastMessageSnippet: 'A plain text snippet from the conversation',
    ...overrides,
  };
}

describe('ConversationFeedCard', () => {
  it('renders the agent icon, display name, snippet, message count, and thread label', () => {
    render(
      <ConversationFeedCard
        entry={entry({ messageCount: 4, threadLabel: 'Side thread', threadIsPrimary: false })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.getByTestId('conversation-feed-agent-icon')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('A plain text snippet from the conversation')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Side thread')).toBeTruthy();
  });

  it('renders the pi harness mark for pi conversation entries', () => {
    render(
      <ConversationFeedCard
        entry={entry({ agent: 'pi' })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.getByLabelText('oh-my-pi logo')).toBeInTheDocument();
    expect(screen.getByText('π')).toBeInTheDocument();
  });

  it('renders ACP conversations with Kimi labeling and transcript summary text', () => {
    render(
      <ConversationFeedCard
        entry={entry({
          agent: 'acp',
          lastMessageSnippet: 'Read package.json\nThe repository is ready.',
          messageCount: 2,
        })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.getByLabelText('ACP logo')).toBeInTheDocument();
    expect(screen.getByText('Kimi')).toBeInTheDocument();
    expect(screen.getByText(/Read package\.json/)).toBeInTheDocument();
    expect(screen.getByText(/The repository is ready\./)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders kimi_code conversations with the Kimi Code label and logo (2026-08-02 harness-labeled rows)', () => {
    render(
      <ConversationFeedCard
        entry={entry({ agent: 'kimi_code' })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.getByLabelText('Kimi Code logo')).toBeInTheDocument();
    expect(screen.getByText('Kimi Code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Code logo')).not.toBeInTheDocument();
  });

  it('renders codex conversations with the Codex label and logo', () => {
    render(
      <ConversationFeedCard
        entry={entry({ agent: 'codex' })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.getByLabelText('Codex logo')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
  });

  it('shows relative timestamp in a time element with dateTime set to the ISO timestamp', () => {
    render(
      <ConversationFeedCard
        entry={entry()}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    const time = screen.getByText('5m ago') as HTMLTimeElement;
    expect(time.tagName).toBe('TIME');
    expect(time.dateTime).toBe('2026-05-23T01:00:00.000Z');
  });

  it('hides messageCount when undefined and hides thread label when the thread is primary', () => {
    render(
      <ConversationFeedCard
        entry={entry({ threadLabel: 'Primary thread', threadIsPrimary: true })}
        onSelect={vi.fn()}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    expect(screen.queryByText('Primary thread')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('calls onSelect with the entry id when clicked', () => {
    const onSelect = vi.fn();
    render(
      <ConversationFeedCard
        entry={entry()}
        onSelect={onSelect}
        now={new Date('2026-05-23T01:05:00.000Z')}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('conversation:conv-a');
  });
});
