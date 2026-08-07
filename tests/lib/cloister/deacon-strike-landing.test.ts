import { describe, expect, it, vi } from 'vitest';

import { patrolStrikeLandings, salvageStrandedStrikeBranches, StrikeLandingSupervisor, type StrikeLandingDeps } from '../../../src/lib/cloister/deacon-strike-landing.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const head = 'a'.repeat(40);
function ready(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return { issueId: 'PAN-2702', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: 't', strikeReadyHead: head, strikeLandingState: 'ready', ...overrides };
}

function deps(result: { success: boolean; mergeStatus?: string; error?: string; transport?: boolean } = { success: true, mergeStatus: 'merged' }): StrikeLandingDeps & { readonly state: ReviewStatus; setState: (state: ReviewStatus) => void; flush: () => Promise<void> } {
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
    deliverRecovery: vi.fn().mockResolvedValue({ delivered: true, queuedToMail: true }),
    writeFeedback: vi.fn().mockResolvedValue(true),
    needsYou: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-07-16T00:00:00.000Z',
    schedule: (key, work) => { scheduledKeys.add(key); scheduled.push(work().finally(() => scheduledKeys.delete(key))); },
    isScheduled: key => scheduledKeys.has(key),
    isPersistentlyOwned: vi.fn().mockReturnValue(false),
    listProjects: vi.fn().mockResolvedValue([]),
    git: vi.fn(),
    isStrikeAgentAlive: vi.fn().mockResolvedValue(false),
    flush: () => Promise.all(scheduled).then(() => undefined),
  };
}

describe('patrolStrikeLandings', () => {
  it('pushes a clean dead strike and persists the ready marker before landing', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    d.setState(ready({ strikeReadyHead: undefined, strikeLandingState: undefined }));
    vi.mocked(d.listProjects).mockResolvedValue([{ key: 'overdeck', config: { path: '/repo' } }] as never);
    vi.mocked(d.git).mockImplementation(async (args) => {
      const command = args.join(' ');
      if (command === 'worktree list --porcelain') {
        return `worktree /repo/workspaces/feature-pan-2702-strike\nHEAD ${head}\nbranch refs/heads/strike/pan-2702\n`;
      }
      if (command === 'status --porcelain') return '';
      if (command === 'rev-list --count origin/main..HEAD') return '1';
      if (command === 'rev-parse HEAD') return head;
      if (command === 'push origin strike/pan-2702') return '';
      throw new Error(`Unexpected git invocation: ${command}`);
    });

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([
      `[strike-salvage] pushed PAN-2702 at ${head}`,
    ]);

    expect(d.git).toHaveBeenCalledWith(['push', 'origin', 'strike/pan-2702'], '/repo/workspaces/feature-pan-2702-strike');
    expect(d.state).toMatchObject({
      strikeReadyHead: head,
      strikeLandingState: 'ready',
      mergeNotes: 'Automatically salvaged completed strike branch strike/pan-2702 after its harness exited before push.',
    });
  });

  it.each([
    ['a live harness', true, ''],
    ['a dirty worktree', false, ' M src/file.ts'],
  ])('does not salvage %s', async (_label, alive, dirty) => {
    const d = deps();
    d.setState(ready({ strikeReadyHead: undefined, strikeLandingState: undefined }));
    vi.mocked(d.listProjects).mockResolvedValue([{ key: 'overdeck', config: { path: '/repo' } }] as never);
    vi.mocked(d.isStrikeAgentAlive).mockResolvedValue(alive);
    vi.mocked(d.git).mockImplementation(async (args) => {
      const command = args.join(' ');
      if (command === 'worktree list --porcelain') {
        return `worktree /repo/workspaces/feature-pan-2702-strike\nHEAD ${head}\nbranch refs/heads/strike/pan-2702\n`;
      }
      if (command === 'status --porcelain') return dirty;
      if (command === 'rev-list --count origin/main..HEAD') return '1';
      if (command === 'rev-parse HEAD') return head;
      throw new Error(`Unexpected git invocation: ${command}`);
    });

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([]);
    expect(d.git).not.toHaveBeenCalledWith(['push', 'origin', 'strike/pan-2702'], expect.any(String));
  });

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

  it('surfaces transport-flavored supervised rejection without demanding a fresh head', async () => {
    const d = deps();
    vi.mocked(d.mergeIssue).mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'needs_you', strikeRecoveryCount: 1 });
    expect(d.deliverRecovery).not.toHaveBeenCalled();
    expect(d.writeFeedback).toHaveBeenCalledTimes(1);
    expect(d.needsYou).toHaveBeenCalledTimes(1);
  });

  it('marks a terminal merge landed and clears readiness', async () => {
    const d = deps();
    d.setState(ready({
      strikeTransportRetryCount: 2,
      strikeNextAttemptAt: '2026-07-16T00:00:00.000Z',
    }));
    const actions = await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({
      strikeLandingState: 'landed',
      strikeReadyHead: undefined,
      strikeReadyAt: undefined,
      strikeTransportRetryCount: undefined,
      strikeNextAttemptAt: undefined,
    });
    expect(actions).toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
  });

  it('retries a transport failure at the same head after exponential backoff', async () => {
    const d = deps({ success: false, transport: true, error: 'Strike merge request failed: fetch failed' });
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.state).toMatchObject({
      strikeLandingState: 'ready',
      strikeReadyHead: head,
      strikeTransportRetryCount: 1,
      strikeNextAttemptAt: '2026-07-16T00:01:00.000Z',
    });
    expect(d.state.strikeLandingAttempts).toEqual([{
      timestamp: '2026-07-16T00:00:00.000Z',
      strikeHead: head,
      mainHead: 'main-head',
      outcome: 'transport-failed',
      detail: 'Strike merge request failed: fetch failed',
    }]);
    expect(d.deliverRecovery).not.toHaveBeenCalled();
  });

  it('preserves a landed state when a successful merge response is lost', async () => {
    const d = deps();
    vi.mocked(d.mergeIssue).mockImplementation(async () => {
      d.setState({
        ...d.state,
        mergeStatus: 'merged',
        strikeLandingState: 'landed',
        strikeReadyHead: undefined,
        strikeReadyAt: undefined,
      });
      return { success: false, transport: true, error: 'Strike merge request failed: socket hang up' };
    });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.state).toMatchObject({
      mergeStatus: 'merged',
      strikeLandingState: 'landed',
      strikeReadyHead: undefined,
      strikeTransportRetryCount: undefined,
      strikeNextAttemptAt: undefined,
    });
    expect(d.deliverRecovery).not.toHaveBeenCalled();
    expect(d.writeFeedback).not.toHaveBeenCalled();
  });

  it('skips transport retries until their due time, then reclaims the same head', async () => {
    const d = deps({ success: true, mergeStatus: 'queued' });
    d.setState(ready({
      strikeTransportRetryCount: 1,
      strikeNextAttemptAt: '2026-07-16T00:01:00.000Z',
    }));

    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.mergeIssue).not.toHaveBeenCalled();

    d.now = () => '2026-07-16T00:01:00.000Z';
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.mergeIssue).toHaveBeenCalledWith('PAN-2702', expect.objectContaining({ markerHead: head }));
  });

  it('escalates the tenth transport failure with complete attempt history', async () => {
    const d = deps({ success: false, transport: true, error: 'connection refused' });
    d.setState(ready({
      strikeTransportRetryCount: 9,
      strikeLandingAttempts: [{
        timestamp: 'old',
        strikeHead: 'old-head',
        mainHead: 'old-main',
        outcome: 'transport-failed',
        detail: 'old transport failure',
      }],
    }));

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.state).toMatchObject({
      strikeLandingState: 'needs_you',
      strikeTransportRetryCount: 10,
      strikeNextAttemptAt: undefined,
    });
    expect(d.writeFeedback).toHaveBeenCalledWith(
      'PAN-2702',
      '/repo/workspaces/feature-pan-2702-strike',
      expect.stringContaining('old-head'),
    );
    expect(d.needsYou).toHaveBeenCalledWith(
      'PAN-2702',
      expect.stringContaining('old-head'),
      expect.objectContaining({ attempts: expect.any(Array) }),
    );
    expect(d.deliverRecovery).not.toHaveBeenCalled();
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
    expect(d.deliverRecovery).toHaveBeenCalledWith(
      'strike-pan-2702',
      expect.stringContaining('push only strike/pan-2702'),
      `strike-landing:PAN-2702:${head}:1`,
    );
    const recoveryMessage = vi.mocked(d.deliverRecovery).mock.calls[0]?.[1] ?? '';
    expect(recoveryMessage).toContain('pan sync-main PAN-2702');
    expect(recoveryMessage).not.toContain('rebase strike/pan-2702');
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
    ['fetch failure safety net', 'fetch failed', 0],
    ['connection refusal safety net', 'ECONNREFUSED', 0],
  ])('surfaces needs-you once for %s with ordered history', async (_label, error, priorCount) => {
    const d = deps({ success: false, error });
    d.setState(ready({ strikeRecoveryCount: priorCount, strikeLandingAttempts: [{ timestamp: 'old', strikeHead: 'old-head', mainHead: 'old-main', outcome: 'failed', detail: 'old failure' }] }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([`[strike-landing] claimed PAN-2702 at ${head}`]);
    await d.flush();
    expect(d.state.strikeLandingState).toBe('needs_you');
    expect(d.deliverRecovery).not.toHaveBeenCalled();
    expect(d.writeFeedback).toHaveBeenCalledTimes(1);
    expect(d.needsYou).toHaveBeenCalledWith('PAN-2702', expect.stringContaining('old-head'), expect.objectContaining({ attempts: expect.any(Array) }));
    await expect(patrolStrikeLandings(d)).resolves.toEqual([]);
    expect(d.needsYou).toHaveBeenCalledTimes(1);
  });

  it('escalates recovery queued to mail without a live recipient', async () => {
    const d = deps({ success: false, error: 'gate failed' });
    vi.mocked(d.deliverRecovery).mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      reason: 'resume failed: session not found',
    });
    await patrolStrikeLandings(d);
    await d.flush();
    expect(d.state).toMatchObject({ strikeLandingState: 'needs_you', strikeRecoveryCount: 1 });
    expect(d.state.strikeLandingAttempts?.[0].detail).toContain('recovery not delivered: resume failed: session not found');
    expect(d.writeFeedback).toHaveBeenCalledTimes(1);
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
