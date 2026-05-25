import { act, render, screen, within } from '@testing-library/react';
import type { MemoryObservation } from '@panctl/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { HomePage } from '../HomePage';

function setHomeState(bootstrapComplete: boolean, observationsByIssueId: Record<string, MemoryObservation[]> = {}): void {
  act(() => {
    useDashboardStore.setState({ bootstrapComplete, observationsByIssueId });
  });
}

function observation(overrides: Partial<MemoryObservation>): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-24T12:00:00.000Z',
    projectId: overrides.projectId ?? 'panopticon-cli',
    workspaceId: overrides.workspaceId ?? 'workspace-a',
    issueId: overrides.issueId ?? 'PAN-1052',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? 'session-1',
    agentRole: overrides.agentRole ?? 'work',
    agentHarness: overrides.agentHarness ?? 'claude-code',
    gitBranch: overrides.gitBranch ?? 'feature/pan-1052',
    sourceTranscriptOffset: overrides.sourceTranscriptOffset ?? 1,
    actionStatus: overrides.actionStatus === undefined ? 'Implemented feed' : overrides.actionStatus,
    narrative: overrides.narrative ?? 'Narrative detail',
    summary: overrides.summary ?? 'Summary detail',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: overrides.tokens ?? { prompt: 1, completion: 1, total: 2 },
    model: overrides.model ?? 'test-model',
  };
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));
    setHomeState(false);
  });

  afterEach(() => {
    setHomeState(false);
    vi.useRealTimers();
  });

  it('renders the loading state before the dashboard snapshot arrives', () => {
    render(<HomePage />);

    expect(screen.getByTestId('home-loading')).toHaveTextContent('Loading Home snapshot…');
  });

  it('renders empty shell sections after bootstrap without PAN-1052 data', () => {
    setHomeState(true);

    render(<HomePage />);

    expect(screen.getByTestId('home-page')).toHaveTextContent('Panopticon briefing');
    expect(screen.getByText('System summary')).toBeInTheDocument();
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Knowledge registry')).toBeInTheDocument();
    expect(screen.getByText('Observations will appear after PAN-1052 memory extraction creates them.')).toBeInTheDocument();
  });

  it('groups actionable observations into PRD buckets newest-first', () => {
    setHomeState(true, {
      'PAN-1052': [
        observation({ id: 'older-ignored', timestamp: '2026-05-24T11:59:00.000Z', actionStatus: null }),
        observation({ id: 'just-now-old', timestamp: '2026-05-24T11:10:00.000Z', actionStatus: 'Older just now', summary: 'Old summary' }),
        observation({ id: 'just-now-new', timestamp: '2026-05-24T11:55:00.000Z', actionStatus: 'Newer just now', summary: 'New summary' }),
      ],
      'PAN-1204': [
        observation({ id: 'today', issueId: 'PAN-1204', workspaceId: 'workspace-b', timestamp: '2026-05-24T09:00:00.000Z', actionStatus: 'Earlier today', summary: 'Today summary' }),
        observation({ id: 'yesterday', issueId: 'PAN-1204', workspaceId: 'workspace-b', timestamp: '2026-05-23T09:00:00.000Z', actionStatus: 'Yesterday work', summary: 'Yesterday summary' }),
        observation({ id: 'week', issueId: 'PAN-1204', workspaceId: 'workspace-b', timestamp: '2026-05-20T09:00:00.000Z', actionStatus: 'This week work', summary: 'Week summary' }),
        observation({ id: 'month', issueId: 'PAN-1204', workspaceId: 'workspace-b', timestamp: '2026-05-10T09:00:00.000Z', actionStatus: 'This month work', summary: 'Month summary' }),
        observation({ id: 'older', issueId: 'PAN-1204', workspaceId: 'workspace-b', timestamp: '2026-04-10T09:00:00.000Z', actionStatus: 'Older work', summary: 'Older summary' }),
      ],
    });

    render(<HomePage />);

    expect(screen.getByTestId('home-activity-bucket-justNow')).toHaveTextContent('Just Now');
    expect(screen.getByTestId('home-activity-bucket-earlierToday')).toHaveTextContent('Earlier Today');
    expect(screen.getByTestId('home-activity-bucket-yesterday')).toHaveTextContent('Yesterday');
    expect(screen.getByTestId('home-activity-bucket-thisWeek')).toHaveTextContent('This Week');
    expect(screen.getByTestId('home-activity-bucket-thisMonth')).toHaveTextContent('This Month');
    expect(screen.getByTestId('home-activity-bucket-older')).toHaveTextContent('Older');
    expect(screen.queryByText('older-ignored')).not.toBeInTheDocument();

    const justNow = screen.getByTestId('home-activity-bucket-justNow');
    const entries = within(justNow).getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('Newer just now');
    expect(entries[1]).toHaveTextContent('Older just now');
  });

  it('renders observation identity, summary, narrative, files, and tags', () => {
    setHomeState(true, {
      'PAN-1204': [
        observation({
          id: 'rich-observation',
          issueId: 'PAN-1204',
          workspaceId: 'workspace-cn10',
          actionStatus: 'Rendered Home feed',
          summary: 'Displayed actionable observation',
          narrative: 'Used observationsByIssueId without reading JSONL transcripts.',
          files: ['src/dashboard/frontend/src/components/HomePage.tsx'],
          tags: ['home', 'memory'],
        }),
      ],
    });

    render(<HomePage />);

    const feed = screen.getByTestId('home-activity-feed');
    expect(feed).toHaveTextContent('workspace-cn10 · PAN-1204');
    expect(feed).toHaveTextContent('Rendered Home feed');
    expect(feed).toHaveTextContent('Displayed actionable observation');
    expect(feed).toHaveTextContent('Used observationsByIssueId without reading JSONL transcripts.');
    expect(feed).toHaveTextContent('src/dashboard/frontend/src/components/HomePage.tsx');
    expect(feed).toHaveTextContent('home');
    expect(feed).toHaveTextContent('memory');
  });
});
