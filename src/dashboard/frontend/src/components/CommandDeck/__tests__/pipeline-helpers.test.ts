import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import type { DerivedIssueState } from '../../../types';
import {
  groupPipelineEntries,
  isNeedsYouFeature,
  isStalledFeature,
  lastActivityAt,
  pipelineChipFor,
  sublineFor,
} from '../pipeline-helpers';

const DAYS = 24 * 60 * 60 * 1000;

function makeFeature(overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId: 'PAN-1',
    title: 'Test issue',
    projectName: 'overdeck',
    branch: 'feature/pan-1',
    status: 'idle',
    stateLabel: 'open',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: true,
    isShadow: false,
    sessions: [],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 0,
      remoteBranchCount: 0,
      tmuxSessionCount: 0,
      prs: [],
      hasXbrief: false,
      hasTasks: true,
      dockerContainerCount: 0,
      conversations: [],
    },
    ...overrides,
  };
}

function makeBucket(feature: ProjectFeature, derived?: DerivedIssueState) {
  return { feature, derived, phase: 'work' as const };
}

function derivedState(state: DerivedIssueState['state'], extra: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return { issueId: 'PAN-1', state, ...extra };
}

describe('needs-you classification', () => {
  it('requires the canonical planned-backlog bucket for plan approval', () => {
    const base = makeFeature({ hasPrd: true, hasState: false });

    expect(isNeedsYouFeature({ ...base, pipelineBucket: 'planned_backlog' }, undefined)).toBe(true);
    expect(isNeedsYouFeature({ ...base, pipelineBucket: 'in_flight' }, undefined)).toBe(false);
    expect(isNeedsYouFeature({ ...base, pipelineBucket: 'zombie_pr' }, undefined)).toBe(false);
    expect(isNeedsYouFeature({ ...base, pipelineBucket: 'clean_terminal' }, undefined)).toBe(false);

    const groups = groupPipelineEntries([makeBucket({ ...base, pipelineBucket: 'zombie_pr' })]);
    expect(groups.some(group => group.key === 'needs-you')).toBe(false);
  });

  it('labels a canonical plan approval instead of claiming checks passed', () => {
    const feature = makeFeature({
      hasPrd: true,
      hasState: false,
      pipelineBucket: 'planned_backlog',
    });

    expect(sublineFor(makeBucket(feature))).toBe('plan approval pending');
  });

  it('labels an awaiting planning session as waiting for an answer', () => {
    const feature = makeFeature({
      sessions: [{
        id: 'planning-pan-1',
        type: 'planning',
        presence: 'active',
        awaitingInput: true,
        model: 'claude-sonnet-5',
        startedAt: '2026-07-12T00:00:00Z',
      } as any],
    });

    expect(sublineFor(makeBucket(feature))).toBe('waiting on your answer');
  });
});

describe('isStalledFeature', () => {
  it('returns true when the issue has an artifact signal but no live agent', () => {
    const feature = makeFeature({
      resourceDetails: { ...makeFeature().resourceDetails!, branchAheadOfMain: true },
    });
    expect(isStalledFeature(feature, undefined)).toBe(true);
  });

  it('returns true when there is partial task progress and no live agent', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: new Date(Date.now() - 30 * DAYS).toISOString() },
    });
    expect(isStalledFeature(feature, undefined)).toBe(true);
  });

  it('returns true when there is an in-progress task and no live agent', () => {
    const feature = makeFeature({
      taskTotals: { total: 3, closed: 0, inProgress: 1, lastUpdated: new Date(Date.now() - 30 * DAYS).toISOString() },
    });
    expect(isStalledFeature(feature, undefined)).toBe(true);
  });

  it('returns true when there is a linked conversation and no live agent', () => {
    const feature = makeFeature({
      resourceDetails: {
        ...makeFeature().resourceDetails!,
        conversations: [{ id: 1, name: 'conv-1', title: 'Investigate', status: 'active' }],
      },
    });
    expect(isStalledFeature(feature, undefined)).toBe(true);
  });

  it('returns false when there is no artifact signal', () => {
    const feature = makeFeature({
      resourceDetails: { ...makeFeature().resourceDetails!, branchAheadOfMain: false, hasTasks: false },
      taskTotals: null,
    });
    expect(isStalledFeature(feature, undefined)).toBe(false);
  });

  it('returns false when a work session is active', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: new Date(Date.now() - 30 * DAYS).toISOString() },
      agentStatus: 'active',
    });
    expect(isStalledFeature(feature, undefined)).toBe(false);
  });

  it('returns false when a live agent session is present', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: new Date(Date.now() - 30 * DAYS).toISOString() },
      sessions: [
        {
          id: 'agent-pan-1',
          type: 'work',
          presence: 'active',
          model: 'claude-sonnet-5',
          startedAt: new Date(Date.now() - 1 * DAYS).toISOString(),
        } as any,
      ],
    });
    expect(isStalledFeature(feature, undefined)).toBe(false);
  });
});

describe('lastActivityAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes taskTotals.lastUpdated when no sessions or review updates exist', () => {
    const entry = makeBucket(
      makeFeature({
        taskTotals: { total: 2, closed: 1, inProgress: 0, lastUpdated: '2026-06-13T00:00:00Z' },
      }),
    );
    expect(lastActivityAt(entry)).toBe(new Date('2026-06-13T00:00:00Z').getTime());
  });
});

describe('groupPipelineEntries stalled bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('places an artifact-bearing, agent-less, stale feature in the stalled group', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.map(g => g.key)).toEqual(['stalled']);
    expect(groups[0].phase).toBe('stalled');
    expect(groups[0].entries[0].phase).toBe('stalled');
    expect(pipelineChipFor(groups[0].entries[0]).label).toBe('stalled — has work, no live agent');
  });

  it('keeps a recently-active artifact-bearing feature out of stalled', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-07-12T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.map(g => g.key)).toEqual(['work']);
    expect(groups.some(g => g.key === 'stalled')).toBe(false);
  });

  it('keeps a live-agent feature out of stalled even when artifact signals exist', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
      sessions: [
        {
          id: 'agent-pan-1',
          type: 'work',
          presence: 'active',
          model: 'claude-sonnet-5',
          startedAt: '2026-07-12T00:00:00Z',
        } as any,
      ],
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.map(g => g.key)).toEqual(['work']);
    expect(groups.some(g => g.key === 'stalled')).toBe(false);
  });

  it('prefers needs-you over stalled when both apply', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature, derivedState('ready'))]);

    expect(groups.map(g => g.key)).toEqual(['needs-you']);
    expect(groups.some(g => g.key === 'stalled')).toBe(false);
  });

  it('does not duplicate a stalled feature into its original phase group', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.filter(g => g.key === 'stalled')).toHaveLength(1);
    expect(groups.filter(g => g.key === 'work')).toHaveLength(0);
  });
});

describe('pipelineChipFor reads the derived state', () => {
  it('labels an issue whose reviewer asked for changes', () => {
    const chip = pipelineChipFor({
      feature: makeFeature(),
      derived: derivedState('changes-requested'),
      phase: 'review',
    });

    expect(chip.key).toBe('review');
    expect(chip.label).toBe('changes requested');
    expect(chip.animate).toBe(false);
  });

  it('animates a live review', () => {
    const chip = pipelineChipFor({
      feature: makeFeature(),
      derived: derivedState('in-review'),
      phase: 'review',
    });

    expect(chip.key).toBe('review');
    expect(chip.label).toBe('in review');
    expect(chip.animate).toBe(true);
  });

  it('flags a pull request the forge cannot merge as blocked', () => {
    const chip = pipelineChipFor({
      feature: makeFeature(),
      derived: derivedState('in-review', {
        pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'APPROVED', checks: 'red', mergeable: true },
      }),
      phase: 'review',
    });

    expect(chip.key).toBe('blocked');
    expect(chip.label).toBe('blocked');
  });
});
