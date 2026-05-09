import { describe, expect, it } from 'vitest';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { bucketFeature, type PipelineStage } from '../ProjectOverview';
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
  it('buckets stuck issues by the stuck flag', () => {
    expectStage('stuck', {}, { stuck: true });
  });

  it('buckets failed pipeline statuses as stuck', () => {
    expectStage('stuck', {}, { reviewStatus: 'failed' });
    expectStage('stuck', {}, { testStatus: 'failed' });
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
});
