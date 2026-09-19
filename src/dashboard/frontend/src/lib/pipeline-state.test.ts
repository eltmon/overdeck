import { describe, it, expect } from 'vitest';

import { PHASE_BY_DERIVED_STATE, getPipelineIssuePhase, isIssueStuck, isPipelineReady, issueNeedsYou } from './pipeline-state';
import type { DerivedIssueState, DerivedIssueStateName } from '../types';

const issue = (over: { labels?: string[]; stateType?: string } = {}) => ({
  labels: over.labels ?? [],
  stateType: over.stateType,
});

const derived = (state: DerivedIssueStateName, over: Partial<DerivedIssueState> = {}): DerivedIssueState => ({
  issueId: 'PAN-1',
  state,
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

  it('a derived-backlog issue with the `ready` label lands in the ready lane', () => {
    expect(getPipelineIssuePhase(derived('backlog'), issue({ labels: ['ready'] }))).toBe('ready');
  });

  it('a derived-backlog issue with no ready signal is hidden in todo', () => {
    expect(getPipelineIssuePhase(derived('backlog'), issue())).toBe('todo');
  });

  it('falls back to the Definition of Ready when nothing is derived yet', () => {
    expect(getPipelineIssuePhase(undefined, issue({ labels: ['ready'] }))).toBe('ready');
    expect(getPipelineIssuePhase(undefined, issue())).toBe('todo');
  });
});

describe('derived state → lane (PAN-3917 FR-6)', () => {
  it('maps every one of the nine derived states to a lane', () => {
    const states: DerivedIssueStateName[] = [
      'backlog', 'parked', 'planned', 'working', 'in-review', 'changes-requested', 'ready', 'merged', 'closed',
    ];
    for (const state of states) {
      expect(PHASE_BY_DERIVED_STATE[state]).toBeDefined();
      expect(getPipelineIssuePhase(derived(state))).toBe(PHASE_BY_DERIVED_STATE[state]);
    }
  });

  it('puts work, review and ship states in their lanes', () => {
    expect(getPipelineIssuePhase(derived('planned'))).toBe('plan');
    expect(getPipelineIssuePhase(derived('working'))).toBe('work');
    expect(getPipelineIssuePhase(derived('in-review'))).toBe('review');
    expect(getPipelineIssuePhase(derived('changes-requested'))).toBe('review');
    expect(getPipelineIssuePhase(derived('ready'))).toBe('ship');
    expect(getPipelineIssuePhase(derived('merged'))).toBe('ship');
  });
});

describe('attention signals', () => {
  it('reads stuck and api-error as stuck, needs-you separately', () => {
    expect(isIssueStuck(derived('working', { attention: 'stuck' }))).toBe(true);
    expect(isIssueStuck(derived('working', { attention: 'api-error' }))).toBe(true);
    expect(isIssueStuck(derived('working', { attention: 'needs-you' }))).toBe(false);
    expect(isIssueStuck(derived('working'))).toBe(false);
    expect(issueNeedsYou(derived('working', { attention: 'needs-you' }))).toBe(true);
    expect(issueNeedsYou(derived('working', { attention: 'stuck' }))).toBe(false);
  });
});
