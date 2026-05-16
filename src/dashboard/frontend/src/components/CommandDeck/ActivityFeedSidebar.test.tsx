import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { MemoryObservation } from '@panctl/contracts';
import { useDashboardStore } from '../../lib/store';
import { ActivityFeedSidebar, createActionStatusObservationSelector } from './ActivityFeedSidebar';

function observation(id: string, timestamp: string, actionStatus: string | null, issueId = 'PAN-1052'): MemoryObservation {
  return {
    id,
    timestamp,
    projectId: 'panopticon-cli',
    workspaceId: `feature-${issueId.toLowerCase()}`,
    issueId,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: `feature/${issueId.toLowerCase()}`,
    sourceTranscriptOffset: 1,
    actionStatus,
    narrative: 'Narrative',
    summary: 'Summary',
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

function seedObservations(observationsByIssueId: Record<string, MemoryObservation[]>) {
  useDashboardStore.setState({ observationsByIssueId });
}

describe('ActivityFeedSidebar', () => {
  beforeEach(() => {
    seedObservations({});
  });

  it('renders only observations with non-null actionStatus', () => {
    seedObservations({
      'PAN-1052': [
        observation('visible', '2026-05-16T11:55:00.000Z', 'Implemented the activity sidebar'),
        observation('hidden', '2026-05-16T11:54:00.000Z', null),
      ],
    });

    render(<ActivityFeedSidebar issueId="PAN-1052" now={new Date('2026-05-16T12:00:00.000Z')} />);

    expect(screen.getByText('Implemented the activity sidebar')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('renders headers only for non-empty time buckets', () => {
    seedObservations({
      'PAN-1052': [observation('recent', '2026-05-16T11:55:00.000Z', 'Recent status')],
    });

    render(<ActivityFeedSidebar issueId="PAN-1052" now={new Date('2026-05-16T12:00:00.000Z')} />);

    expect(screen.getByTestId('activity-feed-bucket-justNow')).toHaveTextContent('Just Now');
    expect(screen.queryByTestId('activity-feed-bucket-earlierToday')).toBeNull();
    expect(screen.queryByTestId('activity-feed-bucket-yesterday')).toBeNull();
    expect(screen.queryByTestId('activity-feed-bucket-thisWeek')).toBeNull();
    expect(screen.queryByTestId('activity-feed-bucket-thisMonth')).toBeNull();
    expect(screen.queryByTestId('activity-feed-bucket-older')).toBeNull();
  });

  it('shows actionStatus, workspace and issue label, and relative time for each item', () => {
    seedObservations({
      'PAN-1052': [observation('recent', '2026-05-16T11:30:00.000Z', 'Wired sidebar bucket rendering')],
    });

    render(<ActivityFeedSidebar issueId="PAN-1052" now={new Date('2026-05-16T12:00:00.000Z')} />);

    const bucket = screen.getByTestId('activity-feed-bucket-justNow');
    expect(within(bucket).getByText('Wired sidebar bucket rendering')).toBeInTheDocument();
    expect(within(bucket).getByText('feature-pan-1052 · PAN-1052')).toBeInTheDocument();
    expect(within(bucket).getByText('30m ago')).toBeInTheDocument();
  });

  it('keeps selector results stable when unrelated store state changes', () => {
    const source = [observation('recent', '2026-05-16T11:30:00.000Z', 'Stable selector result')];
    const selector = createActionStatusObservationSelector('PAN-1052');
    const first = selector({ observationsByIssueId: { 'PAN-1052': source } });
    const second = selector({ observationsByIssueId: { 'PAN-1052': source }, recentActivity: [{ id: 'unrelated' }] } as any);

    expect(second).toBe(first);
  });

  it('renders an empty state when no action statuses exist', () => {
    seedObservations({
      'PAN-1052': [observation('narrative-only', '2026-05-16T11:55:00.000Z', null)],
    });

    render(<ActivityFeedSidebar issueId="PAN-1052" now={new Date('2026-05-16T12:00:00.000Z')} />);

    expect(screen.getByTestId('activity-feed-empty')).toHaveTextContent('No action status updates yet.');
  });
});
