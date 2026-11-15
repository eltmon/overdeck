import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import type { DerivedIssueState } from '../../../types';
import {
  formatAge,
  groupPipelineEntries,
  homeStageTag,
  homeWhoFor,
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

    // PAN-5294: the pipeline has no Needs-you group; the entry stays in its phase lane.
    const groups = groupPipelineEntries([makeBucket({ ...base, pipelineBucket: 'zombie_pr' })]);
    expect(groups.find(group => group.key === 'building')?.entries).toHaveLength(1);
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

// PAN-4605: a PR the pipeline never picked up is a Needs-you reason, and the
// subline carries the exact fix.
describe('pr-outside-pipeline classification (PAN-4605)', () => {
  it('is a needs-you feature and its subline carries the fix', () => {
    const feature = makeFeature();
    const fix = 'PR #7 (feature/pan-1) is checked out in /home/me/hoff. Run `pan review request PAN-1`.';
    const derived = derivedState('in-review', {
      attention: 'pr-outside-pipeline',
      prOutsidePipeline: { prNumber: 7, fix, worktreePath: '/home/me/hoff' },
    });

    expect(isNeedsYouFeature(feature, derived)).toBe(true);
    expect(sublineFor(makeBucket(feature, derived))).toBe(`review never started — ${fix}`);
    // PAN-5294: a needs-you issue stays in its phase lane (the Needs you panel lists it).
    const groups = groupPipelineEntries([makeBucket(feature, derived)]);
    expect(groups[0]?.key).toBe('building');
    expect(groups[0]?.entries).toHaveLength(1);
  });
});

// PAN-4399: a not-started work-start is its own Needs-you reason; a retrying
// one stays out of Needs-you but still explains the "work" phase subline.
describe('work-not-started classification (PAN-4399)', () => {
  it('is a needs-you feature and its subline names the error', () => {
    const feature = makeFeature();
    const derived = derivedState('working', {
      attention: 'work-not-started',
      workStart: { status: 'not-started', at: '2026-09-29T10:00:00.000Z', error: 'spawn guardrails still refused the work agent' },
    });

    expect(isNeedsYouFeature(feature, derived)).toBe(true);
    expect(sublineFor(makeBucket(feature, derived))).toBe(
      'work agent not started — spawn guardrails still refused the work agent',
    );
  });

  it('falls back to "run pan start" when the journal carries no error text', () => {
    const feature = makeFeature();
    const derived = derivedState('working', {
      attention: 'work-not-started',
      workStart: { status: 'not-started', at: '2026-09-29T10:00:00.000Z' },
    });

    expect(sublineFor(makeBucket(feature, derived))).toBe('work agent not started — run pan start');
  });

  it('a retrying workStart is not needs-you but names itself in the work-phase subline', () => {
    const feature = makeFeature();
    const derived = derivedState('working', {
      workStart: { status: 'retrying', at: '2026-09-29T10:00:00.000Z', nextRetryAt: '2026-09-29T10:10:00.000Z' },
    });

    expect(isNeedsYouFeature(feature, derived)).toBe(false);
    expect(sublineFor(makeBucket(feature, derived))).toBe('work agent start retrying');
  });

  // PAN-4210, review non-blocking #3: a Deacon-frozen retry is held, not
  // actively retrying — the subline must say so.
  it('a held workStart names the frozen Deacon instead of claiming an active retry', () => {
    const feature = makeFeature();
    const derived = derivedState('working', {
      workStart: { status: 'retrying', at: '2026-09-29T10:00:00.000Z', held: true },
    });

    expect(sublineFor(makeBucket(feature, derived))).toBe('work agent start held while the Deacon is frozen');
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

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready', 'stalled']);
    const stalled = groups.find(g => g.key === 'stalled')!;
    expect(stalled.entries[0].phase).toBe('stalled');
    expect(pipelineChipFor(stalled.entries[0]).label).toBe('stalled — has work, no live agent');
  });

  it('keeps a recently-active artifact-bearing feature out of stalled', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-07-12T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready']);
    expect(groups[0].entries).toHaveLength(1);
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

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready']);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups.some(g => g.key === 'stalled')).toBe(false);
  });

  // PAN-5294 G-D5: Stalled claims first, so a stalled entry appears in no other lane.
  it('lets stalled claim an entry before its ready lane', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature, derivedState('ready'))]);

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready', 'stalled']);
    expect(groups.find(g => g.key === 'ready')?.entries).toHaveLength(0);
    expect(groups.find(g => g.key === 'stalled')?.entries).toHaveLength(1);
  });

  it('does not duplicate a stalled feature into its original phase group', () => {
    const feature = makeFeature({
      taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
    });
    const groups = groupPipelineEntries([makeBucket(feature)]);

    expect(groups.filter(g => g.key === 'stalled')).toHaveLength(1);
    expect(groups.find(g => g.key === 'building')?.entries).toHaveLength(0);
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
        pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'approved', checks: 'red', mergeable: true },
      }),
      phase: 'review',
    });

    expect(chip.key).toBe('blocked');
    expect(chip.label).toBe('blocked');
  });
});

// PAN-5294 G-D5: the Home lanes, their order and which phases they list.
describe('groupPipelineEntries Home lanes (PAN-5294)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function bucket(issueId: string, phase: BucketPhase, derived?: DerivedIssueState) {
    return { feature: makeFeature({ issueId }), derived, phase };
  }

  it('returns building, review and ready in order and omits backlog, queued and merged entries', () => {
    const groups = groupPipelineEntries([
      bucket('PAN-1', 'plan'),
      bucket('PAN-2', 'work'),
      bucket('PAN-3', 'review'),
      bucket('PAN-4', 'todo'),
      bucket('PAN-5', 'ship', derivedState('ready')),
      bucket('PAN-6', 'ready'),
      bucket('PAN-7', 'ship', derivedState('merged')),
    ]);

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready']);
    expect(groups.map(g => g.title)).toEqual(['Building', 'In review', 'Ready to merge']);
    expect(groups[0].entries.map(e => e.feature.issueId).sort()).toEqual(['PAN-1', 'PAN-2']);
    expect(groups[1].entries.map(e => e.feature.issueId)).toEqual(['PAN-3']);
    expect(groups[2].entries.map(e => e.feature.issueId)).toEqual(['PAN-5']);
    const listed = groups.flatMap(g => g.entries.map(e => e.feature.issueId));
    expect(listed).not.toContain('PAN-4');
    expect(listed).not.toContain('PAN-6');
    expect(listed).not.toContain('PAN-7');
  });

  it('always renders the three main lanes, even with nothing in them', () => {
    const groups = groupPipelineEntries([]);
    expect(groups.map(g => [g.key, g.entries.length])).toEqual([['building', 0], ['review', 0], ['ready', 0]]);
  });

  it('adds stalled as the fourth lane and lists a stalled entry in no other lane', () => {
    const stalled = {
      feature: makeFeature({
        issueId: 'PAN-9',
        taskTotals: { total: 4, closed: 2, inProgress: 0, lastUpdated: '2026-05-13T00:00:00Z' },
      }),
      derived: derivedState('in-review'),
      phase: 'review' as const,
    };
    const groups = groupPipelineEntries([bucket('PAN-1', 'work'), stalled]);

    expect(groups.map(g => g.key)).toEqual(['building', 'review', 'ready', 'stalled']);
    const lanesWithPan9 = groups.filter(g => g.entries.some(e => e.feature.issueId === 'PAN-9')).map(g => g.key);
    expect(lanesWithPan9).toEqual(['stalled']);
  });
});

type BucketPhase = 'plan' | 'work' | 'review' | 'todo' | 'ship' | 'ready';

describe('homeStageTag (PAN-5294 G-D6)', () => {
  const blockedReview = {
    feature: makeFeature(),
    derived: derivedState('in-review', {
      pr: { url: 'https://example.com/pr/1', number: 1, reviewState: 'approved', checks: 'red', mergeable: true },
    }),
    phase: 'review' as const,
  };

  it('puts needs you ahead of blocked', () => {
    const tag = homeStageTag(blockedReview, true);
    expect(tag.key).toBe('needs-you');
    expect(tag.label).toBe('needs you');
    expect(tag.className).toContain('text-state-needs-you');
  });

  it('says blocked without the needs-you flag', () => {
    const tag = homeStageTag(blockedReview, false);
    expect(tag.label).toBe('blocked');
    expect(tag.className).toContain('text-destructive');
  });

  it('names the lane word otherwise', () => {
    expect(homeStageTag({ feature: makeFeature(), derived: undefined, phase: 'plan' }, false).label).toBe('planning');
    expect(homeStageTag({ feature: makeFeature(), derived: undefined, phase: 'work' }, false).label).toBe('building');
    expect(homeStageTag({ feature: makeFeature(), derived: derivedState('in-review'), phase: 'review' }, false).label).toBe('in review');
    expect(homeStageTag({ feature: makeFeature(), derived: derivedState('changes-requested'), phase: 'review' }, false).label)
      .toBe('changes requested');
    const ready = homeStageTag({ feature: makeFeature(), derived: derivedState('ready'), phase: 'ship' }, false);
    expect(ready.label).toBe('ready');
    expect(ready.className).toContain('text-state-done');
    expect(homeStageTag({ feature: makeFeature(), derived: undefined, phase: 'stalled' }, false).label).toBe('stalled');
  });
});

describe('homeWhoFor (PAN-5294 G-D7)', () => {
  it('names the pull request and its checks for an In review row', () => {
    const who = homeWhoFor({
      feature: makeFeature(),
      derived: derivedState('in-review', {
        pr: { url: 'https://example.com/pr/5127', number: 5127, reviewState: 'approved', checks: 'green', mergeable: true },
      }),
      phase: 'review',
    });
    expect(who).toBe('PR #5127 · checks green');
  });

  it('says running and failing for pending and red checks', () => {
    const pr = (checks: 'pending' | 'red') => derivedState('ready', {
      pr: { url: 'https://example.com/pr/7', number: 7, reviewState: 'approved', checks, mergeable: true },
    });
    expect(homeWhoFor({ feature: makeFeature(), derived: pr('pending'), phase: 'ship' })).toBe('PR #7 · checks running');
    expect(homeWhoFor({ feature: makeFeature(), derived: pr('red'), phase: 'ship' })).toBe('PR #7 · checks failing');
  });

  it('names the active session model and item progress for a work row', () => {
    const who = homeWhoFor({
      feature: makeFeature({
        taskTotals: { total: 7, closed: 4, inProgress: 1, lastUpdated: null },
        sessions: [
          { type: 'work', presence: 'ended', model: 'claude-haiku-4-5' } as any,
          { type: 'work', presence: 'active', model: 'claude-sonnet-4-6' } as any,
        ],
      }),
      derived: derivedState('working'),
      phase: 'work',
    });
    expect(who).toBe('sonnet-4-6 · 4 of 7 items');
  });

  it('says no agent when the issue has no sessions', () => {
    expect(homeWhoFor({ feature: makeFeature(), derived: undefined, phase: 'work' })).toBe('no agent');
  });
});

describe('formatAge (PAN-5294 G-D7)', () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  it('uses minutes under an hour, hours under 48 hours and days after', () => {
    expect(formatAge(59 * MINUTE)).toBe('59 m');
    expect(formatAge(47 * HOUR)).toBe('47 h');
    expect(formatAge(48 * HOUR)).toBe('2 d');
  });

  it('shows a dash for an unknown time', () => {
    expect(formatAge(undefined)).toBe('—');
    expect(formatAge(0)).toBe('—');
    expect(formatAge(Number.NaN)).toBe('—');
  });
});
