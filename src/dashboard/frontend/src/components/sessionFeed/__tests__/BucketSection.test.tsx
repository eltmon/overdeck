import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  conversationId: 42,
  conversationName: 'conv-a',
  agent: 'claude_code',
  lastMessageDate: '2026-05-23T01:00:00.000Z',
  lastMessageSnippet: 'Conversation card snippet',
  recencyAt: '2026-05-23T01:00:00.000Z',
  timestampLabel: 'started',
  sessionAlive: false,
  agentState: 'idle',
  projectKey: null,
};

const gauntletRun: SessionFeedEntry = {
  kind: 'gauntlet_run',
  id: 'gauntlet-run:lexerra:india',
  timestamp: '2026-05-23T01:03:00.000Z',
  workspaceId: null,
  issueId: null,
  run: 'india',
  projectKey: 'lexerra',
  orchestratorName: 'conv-2884',
  orchestratorTitle: null,
  countsLine: '6 builders · 6 working',
  state: 'working',
  latest: { text: 'alpha builder launched', at: '2026-05-23T01:03:00.000Z' },
  lanes: [],
  laneConversationIds: [],
  anyAlive: true,
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

    // Activity cards also render a copy control; this asserts the card rows themselves.
    const buttons = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('data-testid') !== 'activity-feed-copy');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Git card messagePAN-13893m ago',
      'Activity card headlineworkspace-a · PAN-1389·4m agoEvent',
      'Claude Codestarted 5m agoConversation card snippet',
    ]);

    fireEvent.click(buttons[1]);

    expect(onSelect).toHaveBeenCalledWith(activity);
  });

  it('renders a gauntlet_run entry as a run card and selects it from the main area — PAN-4301', () => {
    const onSelect = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BucketSection label="Just Now" items={[gauntletRun]} onSelect={onSelect} now={now} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('INDIA · lexerra'));

    expect(screen.getByText('6 builders · 6 working')).toBeTruthy();
    expect(onSelect).toHaveBeenCalledWith(gauntletRun);
    client.clear();
  });
});
