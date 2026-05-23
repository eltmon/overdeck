import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BucketSection } from '../BucketSection';
import type { SessionFeedEntry } from '../types';

const now = new Date('2026-05-23T01:05:00.000Z');

const conversation: SessionFeedEntry = {
  kind: 'conversation',
  id: 'conversation:conv-a',
  timestamp: '2026-05-23T01:00:00.000Z',
  workspaceId: '/workspace/a',
  issueId: 'PAN-1389',
  conversationName: 'conv-a',
  agent: 'claude_code',
  lastMessageDate: '2026-05-23T01:00:00.000Z',
  lastMessageSnippet: 'Conversation card snippet',
};

const activity: SessionFeedEntry = {
  kind: 'activity',
  id: 'obs-1',
  timestamp: '2026-05-23T01:01:00.000Z',
  workspaceId: 'workspace-a',
  issueId: 'PAN-1389',
  headline: 'Activity card headline',
  summary: 'Activity summary',
};

const git: SessionFeedEntry = {
  kind: 'git',
  id: 'git-1',
  timestamp: '2026-05-23T01:02:00.000Z',
  workspaceId: null,
  issueId: 'PAN-1389',
  source: 'git-commit',
  level: 'info',
  message: 'Git card message',
};

describe('BucketSection', () => {
  it('renders the label exactly once', () => {
    render(<BucketSection label="Just Now" items={[activity]} onSelect={vi.fn()} now={now} />);

    expect(screen.getAllByText('Just Now')).toHaveLength(1);
  });

  it('dispatches conversation, activity, and git entries to their cards', () => {
    render(<BucketSection label="Just Now" items={[conversation, activity, git]} onSelect={vi.fn()} now={now} />);

    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('Activity card headline')).toBeTruthy();
    expect(screen.getByText('Git card message')).toBeTruthy();
  });

  it('renders items in the provided order and calls onSelect with the clicked entry', () => {
    const onSelect = vi.fn();
    render(<BucketSection label="Just Now" items={[git, activity, conversation]} onSelect={onSelect} now={now} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Git card messagePAN-13893m ago',
      'Activity card headlineworkspace-a · PAN-1389·4m ago',
      'Claude Code5m agoConversation card snippet',
    ]);

    fireEvent.click(buttons[1]);

    expect(onSelect).toHaveBeenCalledWith(activity);
  });
});
