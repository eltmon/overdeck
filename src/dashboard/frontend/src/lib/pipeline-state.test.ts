import { describe, it, expect } from 'vitest';

import {
  PHASE_BY_DERIVED_STATE,
  comparePipelineIssues,
  derivedForIssue,
  firstAgentByIssueId,
  getPipelineIssuePhase,
  groupPipelineIssues,
  isIssueStuck,
  isPipelineReady,
  issueNeedsYou,
} from './pipeline-state';
import type { Agent, DerivedIssueState, DerivedIssueStateName, Issue } from '../types';

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

function fullIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: over.identifier ?? 'PAN-0',
    identifier: over.identifier ?? 'PAN-0',
    title: over.title ?? 'Issue title',
    status: over.status ?? 'Todo',
    priority: over.priority ?? 4,
    labels: over.labels ?? [],
    url: `https://example.com/${over.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...over,
  };
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: over.id ?? 'agent-1',
    runtime: 'claude-code',
    model: 'opus',
    status: 'running',
    startedAt: '2026-05-18T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...over,
  };
}

describe('pipeline board grouping', () => {
  it('drops an issue outside the pipeline membership, a closed issue and a todo-phase issue', () => {
    const groups = groupPipelineIssues(
      [
        fullIssue({ identifier: 'PAN-10', pipelineMembership: { available: true, inPipeline: false } }),
        fullIssue({ identifier: 'PAN-11', stateType: 'completed' }),
        fullIssue({ identifier: 'PAN-12', labels: [] }),
      ],
      {},
    );
    for (const phase of ['ship', 'review', 'work', 'plan', 'ready'] as const) {
      expect(groups[phase].map((issue) => issue.identifier)).not.toContain('PAN-10');
      expect(groups[phase].map((issue) => issue.identifier)).not.toContain('PAN-11');
      expect(groups[phase].map((issue) => issue.identifier)).not.toContain('PAN-12');
    }
  });

  it('places working, in-review, ready and planned issues, and a ready-labelled issue without derived state', () => {
    const groups = groupPipelineIssues(
      [
        fullIssue({ identifier: 'PAN-20' }),
        fullIssue({ identifier: 'PAN-21' }),
        fullIssue({ identifier: 'PAN-22' }),
        fullIssue({ identifier: 'PAN-23' }),
        fullIssue({ identifier: 'PAN-24', labels: ['ready'] }),
      ],
      {
        'PAN-20': derived('working', { issueId: 'PAN-20' }),
        'PAN-21': derived('in-review', { issueId: 'PAN-21' }),
        'PAN-22': derived('ready', { issueId: 'PAN-22' }),
        'PAN-23': derived('planned', { issueId: 'PAN-23' }),
      },
    );
    expect(groups.work.map((issue) => issue.identifier)).toEqual(['PAN-20']);
    expect(groups.review.map((issue) => issue.identifier)).toEqual(['PAN-21']);
    expect(groups.ship.map((issue) => issue.identifier)).toEqual(['PAN-22']);
    expect(groups.plan.map((issue) => issue.identifier)).toEqual(['PAN-23']);
    expect(groups.ready.map((issue) => issue.identifier)).toEqual(['PAN-24']);
  });

  it('sorts within a phase by priority then newest updatedAt first', () => {
    const groups = groupPipelineIssues(
      [
        fullIssue({ identifier: 'PAN-30', priority: 3, updatedAt: '2026-05-18T00:00:00.000Z' }),
        fullIssue({ identifier: 'PAN-31', priority: 1, updatedAt: '2026-05-18T00:00:00.000Z' }),
        fullIssue({ identifier: 'PAN-32', priority: 1, updatedAt: '2026-05-18T02:00:00.000Z' }),
      ],
      {
        'PAN-30': derived('working', { issueId: 'PAN-30' }),
        'PAN-31': derived('working', { issueId: 'PAN-31' }),
        'PAN-32': derived('working', { issueId: 'PAN-32' }),
      },
    );
    expect(groups.work.map((issue) => issue.identifier)).toEqual(['PAN-32', 'PAN-31', 'PAN-30']);
  });

  it('comparePipelineIssues sorts priority 1 before priority 3', () => {
    const higher = fullIssue({ identifier: 'PAN-40', priority: 1 });
    const lower = fullIssue({ identifier: 'PAN-41', priority: 3 });
    expect(comparePipelineIssues(higher, lower)).toBeLessThan(0);
  });

  it('derivedForIssue finds an entry keyed by the upper-case identifier when the issue identifier is lower case', () => {
    const derivedByIssueId = { 'PAN-50': derived('working', { issueId: 'PAN-50' }) };
    expect(derivedForIssue(derivedByIssueId, { identifier: 'pan-50' })).toBe(derivedByIssueId['PAN-50']);
  });

  it('firstAgentByIssueId keys by lowercase issueId and keeps the first agent for an issue', () => {
    const first = agent({ id: 'agent-1', issueId: 'PAN-60' });
    const second = agent({ id: 'agent-2', issueId: 'pan-60' });
    const map = firstAgentByIssueId([first, second]);
    expect(map.get('pan-60')).toBe(first);
    expect(map.size).toBe(1);
  });
});
