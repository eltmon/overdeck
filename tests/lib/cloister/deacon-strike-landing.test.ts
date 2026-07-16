import { describe, expect, it, vi } from 'vitest';

import { patrolStrikeLandings, StrikeLandingSupervisor, type StrikeLandingDeps } from '../../../src/lib/cloister/deacon-strike-landing.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const head = 'a'.repeat(40);
function ready(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return { issueId: 'PAN-2702', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: 't', strikeReadyHead: head, strikeLandingState: 'ready', ...overrides };
}

function deps(result: { success: boolean; mergeStatus?: string; error?: string } = { success: true, mergeStatus: 'merged' }): StrikeLandingDeps & { readonly state: ReviewStatus; setState: (state: ReviewStatus) => void; flush: () => Promise<void> } {
  const container = { state: ready() };
  const scheduled: Promise<void>[] = [];
  const scheduledKeys = new Set<string>();
  return {
    get state() { return container.state; },
    setState: (state) => { container.state = state; },
    loadStatuses: () => ({ 'PAN-2702': container.state }),
    getStatus: () => container.state,
    setStatus: vi.fn((_id, update) => (container.state = { ...container.state, ...update })),
    resolveProject: vi.fn().mockReturnValue({ projectPath: '/repo', projectKey: 'overdeck' }),
    mergeIssue: vi.fn().mockResolvedValue(result),
    getMainHead: vi.fn().mockResolvedValue('main-head'),
    deliverRecovery: vi.fn().mockResolvedValue(undefined),
    writeFeedback: vi.fn().mockResolvedValue(true),
    needsYou: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-07-16T00:00:00.000Z',
    schedule: (key, work) => { scheduledKeys.add(key); scheduled.push(work().finally(() => scheduledKeys.delete(key))); },
    isScheduled: key => scheduledKeys.has(key),
    isPersistentlyOwned: vi.fn().mockReturnValue(false),
    flush: () => Promise.all(scheduled).then(() => undefined),
  };
}

describe('patrolStrikeLandings', () => {
  it('claims a ready marker and invokes the strike merge door', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    const actions = await patrolStrikeLandings(d);
    await d.flush();
    expect(d.mergeIssue).toHaveBeenCalledWith('PAN-2702', {
      kind: 'strike', markerHead: head, workspacePath: '/repo/workspaces/feature-pan-2702-strike',
      branchName: 'strike/pan-2702', recoveryTarget: 'strike-pan-2702',
    });
    expect(d.state.strikeLandingState).toBe('landing');
    expect(actions).toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
  });

  it('allows only one observer to claim the same HEAD', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    await Promise.all([patrolStrikeLandings(d), patrolStrikeLandings(d)]);
    await d.flush();
    expect(d.mergeIssue).toHaveBeenCalledTimes(1);
  });

  it('reclaims a persisted landing after process-local supervision is lost', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    d.setState(ready({ strikeLandingState: 'landing' }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] reclaimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.mergeIssue).toHaveBeenCalledTimes(1);
  });

  it('does not reclaim queued or active durable merge ownership', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    d.setState(ready({ strikeLandingState: 'landing' }));
    const persistent = vi.mocked(d.isPersistentlyOwned);
    persistent.mockReturnValue(true);
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.mergeIssue).not.toHaveBeenCalled();
  });

  it('does not duplicate a queued-to-dequeued merge while its promise is pending', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    await patrolStrikeLandings(d); await d.flush();
    d.setState(ready({ strikeLandingState: 'landing' }));
    vi.mocked(d.isPersistentlyOwned).mockReturnValue(true);
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    vi.mocked(d.isPersistentlyOwned).mockReturnValue(false);
    let release!: () => void;
    vi.mocked(d.mergeIssue).mockReturnValue(new Promise(resolve => { release = () => resolve({ success: true, mergeStatus: 'merged' }); }));
    await expect(patrolStrikeLandings(d)).resolves.toHaveLength(1);
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.mergeIssue).toHaveBeenCalledTimes(2);
    release(); await d.flush();
  });

  it('routes unexpected supervised rejection through durable recovery', async () => {
    const d = deps();
    vi.mocked(d.mergeIssue).mockRejectedValue(new Error('worker crashed'));
    await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'recovering', strikeRecoveryCount: 1 });
    expect(d.state.mergeNotes).toContain('Unexpected supervised strike landing failure: worker crashed');
  });

  it('marks a terminal merge landed and clears readiness', async () => {
    const d = deps();
    const actions = await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined });
    expect(actions).toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
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

  it('re-drives an actionable failure with complete recovery instructions', async () => {
    const d = deps({ success: false, error: 'Rebase conflicts in src/a.ts' });
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'recovering', strikeRecoveryCount: 1 });
    expect(d.state.strikeLandingAttempts).toEqual([{ timestamp: '2026-07-16T00:00:00.000Z', strikeHead: head, mainHead: 'main-head', outcome: 'failed', detail: 'Rebase conflicts in src/a.ts' }]);
    expect(d.deliverRecovery).toHaveBeenCalledWith('strike-pan-2702', expect.stringContaining('push only strike/pan-2702'));
    expect(d.needsYou).not.toHaveBeenCalled();
  });

  it('does not retry a recovering marker without a fresh signal', async () => {
    const d = deps({ success: false, error: 'gate failed' });
    d.setState(ready({ strikeLandingState: 'recovering', strikeRecoveryCount: 1 }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.mergeIssue).not.toHaveBeenCalled();
    expect(d.deliverRecovery).not.toHaveBeenCalled();
  });

  it.each([
    ['third actionable cycle', 'gate failed', 2],
    ['non-actionable failure', 'Integration permission denied', 0],
  ])('surfaces needs-you once for %s with ordered history', async (_label, error, priorCount) => {
    const d = deps({ success: false, error });
    d.setState(ready({ strikeRecoveryCount: priorCount, strikeLandingAttempts: [{ timestamp: 'old', strikeHead: 'old-head', mainHead: 'old-main', outcome: 'failed', detail: 'old failure' }] }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.state.strikeLandingState).toBe('needs_you');
    expect(d.writeFeedback).toHaveBeenCalledTimes(1);
    expect(d.needsYou).toHaveBeenCalledWith('PAN-2702', expect.stringContaining('old-head'), expect.objectContaining({ attempts: expect.any(Array) }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.needsYou).toHaveBeenCalledTimes(1);
  });

  it('escalates a failed recovery delivery', async () => {
    const d = deps({ success: false, error: 'gate failed' });
    vi.mocked(d.deliverRecovery).mockRejectedValue(new Error('operator paused'));
    await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'needs_you', strikeRecoveryCount: 1 });
    expect(d.state.strikeLandingAttempts?.[0].detail).toContain('recovery delivery failed: operator paused');
  });

  it('bounds independently supervised landing work', async () => {
    const supervisor = new StrikeLandingSupervisor(2);
    const releases: Array<() => void> = [];
    const started: number[] = [];
    for (let index = 0; index < 3; index += 1) supervisor.enqueue(String(index), async () => {
      started.push(index);
      await new Promise<void>(resolve => releases.push(resolve));
    });
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    releases.shift()!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    releases.forEach(release => release());
  });
});
