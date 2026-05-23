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
