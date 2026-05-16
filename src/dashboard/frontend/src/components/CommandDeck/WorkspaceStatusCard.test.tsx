import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MemoryObservation, MemoryStatus } from '@panctl/contracts';
import { WorkspaceStatusCard } from './WorkspaceStatusCard';

const issue = {
  identifier: 'PAN-1052',
  title: 'Memory substrate dashboard',
  description: 'A long fallback summary that can be clamped when no memory status exists.',
};

const status: MemoryStatus = {
  name: 'Workspace status',
  headline: 'Streaming observations into the dashboard',
  summary: 'The workspace status card explains the current phase, recent actions, and git/PR activity for the selected workspace.',
  goal: null,
  phase: 'building',
  accomplished: [],
  decided: [],
  open: [],
  nextSteps: [],
  confidence: 0.82,
  workingSet: [],
  tags: [],
};

function observation(id: string, timestamp: string, actionStatus: string | null): MemoryObservation {
  return {
    id,
    timestamp,
    projectId: 'panopticon-cli',
    workspaceId: 'feature-pan-1052',
    issueId: 'PAN-1052',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: 'feature/pan-1052',
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

describe('WorkspaceStatusCard', () => {
  it('renders a phase icon colored by the memory status phase', () => {
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={{ ...status, phase: 'verifying' }}
        observations={[]}
        stats={{ additions: 4, deletions: 2, commits: 1, prs: 1 }}
        onOpenWorkspaceHome={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workspace-status-phase-icon')).toHaveAttribute('data-phase', 'verifying');
    expect(screen.getByTestId('workspace-status-phase-label')).toHaveTextContent('Verifying');
    expect(screen.getByTestId('workspace-status-phase-icon').getAttribute('style')).toContain('var(--warning');
  });

  it('line-clamps the summary to three lines', () => {
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={status}
        observations={[]}
        stats={{ additions: 0, deletions: 0, commits: 0, prs: 0 }}
        onOpenWorkspaceHome={vi.fn()}
      />,
    );

    const summary = screen.getByTestId('workspace-status-summary');
    expect(summary).toHaveTextContent(status.summary);
    expect(summary.getAttribute('style')).toContain('-webkit-line-clamp: 3');
    expect(summary.getAttribute('style')).toContain('overflow: hidden');
  });

  it('renders the latest three observations with non-null actionStatus', () => {
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={status}
        observations={[
          observation('old', '2026-05-16T10:00:00.000Z', 'Old status'),
          observation('ignored', '2026-05-16T10:10:00.000Z', null),
          observation('middle', '2026-05-16T10:20:00.000Z', 'Middle status'),
          observation('newer', '2026-05-16T10:30:00.000Z', 'Newer status'),
          observation('newest', '2026-05-16T10:40:00.000Z', 'Newest status'),
        ]}
        stats={{ additions: 0, deletions: 0, commits: 0, prs: 0 }}
        onOpenWorkspaceHome={vi.fn()}
      />,
    );

    const list = screen.getByTestId('workspace-status-observations');
    expect(within(list).getByText('Newest status')).toBeInTheDocument();
    expect(within(list).getByText('Newer status')).toBeInTheDocument();
    expect(within(list).getByText('Middle status')).toBeInTheDocument();
    expect(within(list).queryByText('Old status')).toBeNull();
    expect(within(list).queryByText('ignored')).toBeNull();
  });

  it('shows stats footer values for additions, deletions, commits, and PRs', () => {
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={status}
        observations={[]}
        stats={{ additions: 120, deletions: 14, commits: 3, prs: 2 }}
        onOpenWorkspaceHome={vi.fn()}
      />,
    );

    expect(screen.getByText('+120')).toBeInTheDocument();
    expect(screen.getByText('-14')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('clicks through to the workspace home tab', () => {
    const onOpenWorkspaceHome = vi.fn();
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={status}
        observations={[]}
        stats={{ additions: 0, deletions: 0, commits: 0, prs: 0 }}
        onOpenWorkspaceHome={onOpenWorkspaceHome}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open pan-1052 workspace overview/i }));
    expect(onOpenWorkspaceHome).toHaveBeenCalledOnce();
  });

  it('shows stale status when the latest actionStatus observation is older than one hour', () => {
    render(
      <WorkspaceStatusCard
        issue={issue}
        status={status}
        observations={[observation('stale', '2026-05-16T10:00:00.000Z', 'Stale status')]}
        stats={{ additions: 0, deletions: 0, commits: 0, prs: 0 }}
        onOpenWorkspaceHome={vi.fn()}
        now={new Date('2026-05-16T11:00:01.000Z')}
      />,
    );

    expect(screen.getByTestId('workspace-status-stale')).toBeInTheDocument();
  });
});
