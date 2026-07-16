import { describe, expect, it, vi } from 'vitest';

import { patrolStrikeLandings, type StrikeLandingDeps } from '../../../src/lib/cloister/deacon-strike-landing.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const head = 'a'.repeat(40);
function ready(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return { issueId: 'PAN-2702', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: 't', strikeReadyHead: head, strikeLandingState: 'ready', ...overrides };
}

function deps(result: { success: boolean; mergeStatus?: string; error?: string } = { success: true, mergeStatus: 'merged' }): StrikeLandingDeps & { readonly state: ReviewStatus; setState: (state: ReviewStatus) => void } {
  const container = { state: ready() };
  return {
    get state() { return container.state; },
    setState: (state) => { container.state = state; },
    loadStatuses: () => ({ 'PAN-2702': container.state }),
    getStatus: () => container.state,
    setStatus: vi.fn((_id, update) => (container.state = { ...container.state, ...update })),
    resolveProject: vi.fn().mockReturnValue({ projectPath: '/repo', projectKey: 'overdeck' }),
    mergeIssue: vi.fn().mockResolvedValue(result),
  };
}

describe('patrolStrikeLandings', () => {
  it('claims a ready marker and invokes the strike merge door', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    const actions = await patrolStrikeLandings(d);
    expect(d.mergeIssue).toHaveBeenCalledWith('PAN-2702', {
      kind: 'strike', markerHead: head, workspacePath: '/repo/workspaces/feature-pan-2702-strike',
      branchName: 'strike/pan-2702', recoveryTarget: 'strike-pan-2702',
    });
    expect(d.state.strikeLandingState).toBe('landing');
    expect(actions[0]).toContain('queued');
  });

  it('allows only one observer to claim the same HEAD', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    await Promise.all([patrolStrikeLandings(d), patrolStrikeLandings(d)]);
    expect(d.mergeIssue).toHaveBeenCalledTimes(1);
  });

  it('marks a terminal merge landed and clears readiness', async () => {
    const d = deps();
    const actions = await patrolStrikeLandings(d);
    expect(d.state).toMatchObject({ strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined });
    expect(actions).toEqual([`[strike-landing] landed PAN-2702 at ${head}`]);
  });

  it.each([
    ['ignored', { deaconIgnored: true }], ['stuck', { stuck: true }],
    ['merged', { mergeStatus: 'merged' as const }], ['non-ready', { strikeLandingState: 'recovering' as const }],
  ])('skips %s markers', async (_label, override) => {
    const d = deps();
    d.setState(ready(override));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.mergeIssue).not.toHaveBeenCalled();
  });
});
