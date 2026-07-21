import { describe, it, expect } from 'vitest';

import { isPipelineReady, getPipelineIssuePhase } from './pipeline-state';

const backlogIssue = (over: Partial<Parameters<typeof getPipelineIssuePhase>[0]> = {}) => ({
  state: undefined,
  status: undefined,
  stateType: undefined,
  hasPlan: false,
  planningComplete: false,
  mergeStatus: undefined,
  labels: [] as string[],
  ...over,
});

describe('Definition of Ready (PAN-1966)', () => {
  it('isPipelineReady: a `ready` label marks an issue ready (GitHub/GitLab)', () => {
    expect(isPipelineReady({ labels: ['ready'], stateType: undefined })).toBe(true);
  });

  it('isPipelineReady: Linear Todo (stateType "unstarted") marks an issue ready', () => {
    expect(isPipelineReady({ labels: [], stateType: 'unstarted' })).toBe(true);
  });

  it('isPipelineReady: a raw open/backlog issue is NOT ready', () => {
    expect(isPipelineReady({ labels: ['enhancement'], stateType: 'backlog' })).toBe(false);
    expect(isPipelineReady({ labels: [], stateType: undefined })).toBe(false);
  });

  it('getPipelineIssuePhase: open issue with the `ready` label → the ready lane', () => {
    expect(getPipelineIssuePhase(backlogIssue({ labels: ['ready'] }))).toBe('ready');
  });

  it('getPipelineIssuePhase: open backlog issue with no ready signal → todo (hidden from pipeline)', () => {
    expect(getPipelineIssuePhase(backlogIssue())).toBe('todo');
  });

  it('does not use server membership as a lane-assignment signal', () => {
    const withoutMembership = backlogIssue();
    const withMembership = backlogIssue({
      pipelineMembership: { inPipeline: true, bucket: 'post_merge_limbo', labelDrift: null },
    });
    expect(getPipelineIssuePhase(withMembership)).toBe(getPipelineIssuePhase(withoutMembership));
    expect(getPipelineIssuePhase(withMembership)).toBe('todo');

    const readyWithoutMembership = backlogIssue({ labels: ['ready'] });
    const readyWithMembership = backlogIssue({
      labels: ['ready'],
      pipelineMembership: { inPipeline: false, bucket: 'clean_terminal', labelDrift: 'stale_present' },
    });
    expect(getPipelineIssuePhase(readyWithMembership)).toBe(getPipelineIssuePhase(readyWithoutMembership));
    expect(getPipelineIssuePhase(readyWithMembership)).toBe('ready');
  });

  it('preserves in-flight lane assignment when membership is attached', () => {
    const membership = { inPipeline: true, bucket: 'in_flight' as const, labelDrift: null };
    expect(getPipelineIssuePhase(backlogIssue({ state: 'in_progress', pipelineMembership: membership }))).toBe('work');
    expect(getPipelineIssuePhase(backlogIssue({ state: 'in_review', pipelineMembership: membership }))).toBe('review');
    expect(getPipelineIssuePhase(backlogIssue({ mergeStatus: 'queued', pipelineMembership: membership }))).toBe('ship');
  });
});
