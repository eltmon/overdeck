import { describe, it, expect } from 'vitest';
import type { IssueState, SessionNode } from '@overdeck/contracts';
import { resolveFeatureStateBadge, type FeatureStateBadgeInput } from './featureStateBadge';

function planningSession(presence: SessionNode['presence']): SessionNode {
  return {
    type: 'planning',
    sessionId: 'session-1',
    model: 'claude-sonnet-5',
    startedAt: '2026-09-25T00:00:00Z',
    duration: null,
    status: 'running',
    presence,
  } as SessionNode;
}

const EXPECTED_BY_STATE: Record<IssueState, { label: string; tone: string }> = {
  backlog: { label: 'Backlog', tone: 'rest' },
  parked: { label: 'Parked', tone: 'rest' },
  planned: { label: 'Planned', tone: 'rest' },
  working: { label: 'Working', tone: 'machine' },
  'in-review': { label: 'In review', tone: 'human' },
  'changes-requested': { label: 'Changes requested', tone: 'human' },
  ready: { label: 'Ready', tone: 'human' },
  merged: { label: 'Merged', tone: 'outcome' },
  closed: { label: 'Closed', tone: 'rest' },
};

describe('resolveFeatureStateBadge', () => {
  it.each(Object.entries(EXPECTED_BY_STATE) as [IssueState, { label: string; tone: string }][])(
    'returns the §5.1 label and tone for restState %s',
    (restState, expected) => {
      const badge = resolveFeatureStateBadge({ restState });
      expect(badge?.label).toBe(expected.label);
      expect(badge?.tone).toBe(expected.tone);
    },
  );

  it('storeState wins over restState', () => {
    const badge = resolveFeatureStateBadge({ storeState: 'ready', restState: 'working' });
    expect(badge?.label).toBe('Ready');
  });

  it('shows Planning for a planned state with an active planning session', () => {
    const badge = resolveFeatureStateBadge({ restState: 'planned', sessions: [planningSession('active')] });
    expect(badge).toEqual({
      key: 'planning',
      label: 'Planning',
      tone: 'specialist',
      title: 'A planning agent is writing the plan for this issue.',
    });
  });

  it('shows Planned (not Planning) once the planning session has ended', () => {
    const badge = resolveFeatureStateBadge({ restState: 'planned', sessions: [planningSession('ended')] });
    expect(badge?.label).toBe('Planned');
  });

  it('falls back to Merged for a null state with pipelineBucket post_merge_limbo', () => {
    const badge = resolveFeatureStateBadge({ pipelineBucket: 'post_merge_limbo' });
    expect(badge).toEqual({
      key: 'merged-closeout',
      label: 'Merged',
      tone: 'outcome',
      title: 'Merged; close-out has not run yet.',
    });
  });

  it('falls back to Closed for a null state with a closed rawTrackerState', () => {
    const badge = resolveFeatureStateBadge({ rawTrackerState: 'Done' });
    expect(badge).toEqual({
      key: 'closed-tracker',
      label: 'Closed',
      tone: 'rest',
      title: 'The tracker issue is closed.',
    });
  });

  it('returns null with no state, bucket, tracker state or sessions', () => {
    expect(resolveFeatureStateBadge({})).toBeNull();
  });

  it('never returns the label Allocated', () => {
    const inputs: FeatureStateBadgeInput[] = [
      ...(Object.keys(EXPECTED_BY_STATE) as IssueState[]).map((restState) => ({ restState })),
      { storeState: 'ready', restState: 'working' },
      { restState: 'planned', sessions: [planningSession('active')] },
      { restState: 'planned', sessions: [planningSession('ended')] },
      { pipelineBucket: 'post_merge_limbo' },
      { rawTrackerState: 'Done' },
      {},
    ];
    for (const input of inputs) {
      expect(resolveFeatureStateBadge(input)?.label).not.toBe('Allocated');
    }
  });
});
