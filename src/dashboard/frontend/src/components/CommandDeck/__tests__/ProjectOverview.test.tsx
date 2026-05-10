import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { bucketFeature, ProjectOverview, type PipelineStage } from '../ProjectOverview';
import { useDashboardStore } from '../../../lib/store';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';

function makeFeature(overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId: 'PAN-1044',
    title: 'Project overview panel',
    projectName: 'panopticon-cli',
    branch: 'feature/pan-1044',
    status: 'open',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    sessions: [],
    ...overrides,
  };
}

function reviewStatus(overrides: Partial<ReviewStatusSnapshot>): ReviewStatusSnapshot {
  return {
    issueId: 'PAN-1044',
    ...overrides,
  } as ReviewStatusSnapshot;
}

function expectStage(
  expected: PipelineStage,
  featureOverrides: Partial<ProjectFeature>,
  status?: Partial<ReviewStatusSnapshot>,
) {
  expect(
    bucketFeature(
      makeFeature(featureOverrides),
      status ? reviewStatus(status) : undefined,
    ),
  ).toBe(expected);
}

describe('bucketFeature', () => {
  beforeEach(() => {
    useDashboardStore.setState({ reviewStatusByIssueId: {} });
  });

  it('buckets stuck issues by the stuck flag', () => {
    expectStage('stuck', {}, { stuck: true });
  });

  it('buckets non-progress pipeline failures and blockers as stuck', () => {
    expectStage('stuck', {}, { reviewStatus: 'failed' });
    expectStage('stuck', {}, { reviewStatus: 'blocked' });
    expectStage('stuck', {}, { testStatus: 'failed' });
    expectStage('stuck', {}, { testStatus: 'dispatch_failed' });
    expectStage('stuck', {}, { mergeStatus: 'failed' });
    expectStage('stuck', {}, { verificationStatus: 'failed' });
  });

  it('buckets blocker reasons as stuck', () => {
    expectStage('stuck', {}, {
      blockerReasons: [
        {
          type: 'merge_conflict',
          summary: 'Merge conflict',
          detectedAt: '2026-05-09T00:00:00Z',
        },
      ],
    });
  });

  it('buckets active merge statuses as merging', () => {
    expectStage('merging', {}, { mergeStatus: 'queued' });
    expectStage('merging', {}, { mergeStatus: 'merging' });
    expectStage('merging', {}, { mergeStatus: 'verifying' });
  });

  it('buckets ready-for-merge issues as awaitingMerge', () => {
    expectStage('awaitingMerge', {}, { readyForMerge: true });
  });

  it('buckets testing issues as tests', () => {
    expectStage('tests', {}, { testStatus: 'testing' });
  });

  it('buckets active reviews as review', () => {
    expectStage('review', {}, { reviewStatus: 'reviewing' });
  });

  it('buckets running verification as buildGate', () => {
    expectStage('buildGate', {}, { verificationStatus: 'running' });
  });

  it('buckets active work-agent issues without review status as working', () => {
    expectStage('working', { agentStatus: 'running' }, undefined);
    expectStage('working', { agentStatus: 'active' }, undefined);
    expectStage('working', {
      agentStatus: 'stopped',
      sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
    }, undefined);
  });

  it('does not bucket stopped or suspended agents as working', () => {
    expectStage('idle', { agentStatus: 'stopped' }, undefined);
    expectStage('idle', { agentStatus: 'suspended' }, undefined);
  });

  it('buckets planned issues without work sessions as planning using SessionNode.type', () => {
    expectStage('planning', {
      hasPlanning: true,
      sessions: [
        { type: 'planning' },
        { type: 'reviewer', role: 'work' },
      ] as ProjectFeature['sessions'],
    });
  });

  it('does not bucket planned issues with a work session as planning', () => {
    expectStage('idle', {
      hasPlanning: true,
      sessions: [{ type: 'work' }] as ProjectFeature['sessions'],
    });
  });

  it('buckets issues with no active signals as idle', () => {
    expectStage('idle', {}, undefined);
  });

  it('shows stuck reasons for blocked review and test dispatch failures', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1': reviewStatus({ issueId: 'PAN-1', reviewStatus: 'blocked' }),
        'PAN-2': reviewStatus({ issueId: 'PAN-2', testStatus: 'dispatch_failed' }),
      },
    });

    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', title: 'Blocked review' }),
          makeFeature({ issueId: 'PAN-2', title: 'Dispatch failed' }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('Review blocked')).toBeInTheDocument();
    expect(screen.getByText('Test dispatch failed')).toBeInTheDocument();
  });

  it('counts only active work agents in the hero summary', () => {
    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[
          makeFeature({ issueId: 'PAN-1', agentStatus: 'running' }),
          makeFeature({ issueId: 'PAN-2', agentStatus: 'active' }),
          makeFeature({ issueId: 'PAN-3', agentStatus: 'stopped' }),
          makeFeature({ issueId: 'PAN-4', agentStatus: 'suspended' }),
          makeFeature({
            issueId: 'PAN-5',
            agentStatus: null,
            sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
          }),
        ]}
        issueCosts={{}}
        onSelectFeature={() => {}}
      />,
    );

    expect(screen.getByText('Active agents').parentElement).toHaveTextContent('3');
  });

  it('renders partial cost breakdown details without crashing', () => {
    render(
      <ProjectOverview
        projectName="panopticon-cli"
        features={[makeFeature({ issueId: 'PAN-1' })]}
        issueCosts={{ 'PAN-1': 1.23 }}
        issueCostDetails={{
          'PAN-1': {
            byModel: undefined as unknown as Record<string, { cost: number; tokens: number }>,
            byStage: undefined as unknown as Record<string, { cost: number; tokens: number }>,
          },
        }}
        onSelectFeature={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getByText('$1.23'));

    expect(screen.getAllByText('No cost data')).toHaveLength(2);
  });
});
