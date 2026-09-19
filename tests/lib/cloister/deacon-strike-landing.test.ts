import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  patrolStrikeLandings,
  resetStrikeLandingAttemptsForTests,
  salvageStrandedStrikeBranches,
  StrikeLandingSupervisor,
  type StrikeLandingDeps,
} from '../../../src/lib/cloister/deacon-strike-landing.js';

const HEAD = 'a'.repeat(40);

/**
 * PAN-3917: a strike candidate is discovered from git (a `strike/<issue>`
 * worktree that is clean, ahead of main, and has no live agent), and whether it
 * already landed is the forge's answer. No status row is involved.
 */
function deps(
  overrides: Partial<StrikeLandingDeps> = {},
): StrikeLandingDeps & { flush: () => Promise<void> } {
  const scheduled: Promise<void>[] = [];
  const scheduledKeys = new Set<string>();
  const git = vi.fn(async (args: string[]) => {
    if (args[0] === 'worktree') {
      return [
        'worktree /repo/workspaces/feature-pan-2702-strike',
        'branch refs/heads/strike/pan-2702',
        '',
      ].join('\n');
    }
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-list') return '3';
    if (args[0] === 'rev-parse') return HEAD;
    return '';
  });
  return {
    resolveProject: vi.fn().mockReturnValue({ projectPath: '/repo', projectKey: 'overdeck' }) as never,
    getFacts: vi.fn(async () => ({ merged: false })),
    mergeIssue: vi.fn().mockResolvedValue({ success: true, outcome: 'merged' }),
    getMainHead: vi.fn().mockResolvedValue('main-head'),
    deliverRecovery: vi.fn().mockResolvedValue({ delivered: true, queuedToMail: true }),
    writeFeedback: vi.fn().mockResolvedValue(true),
    needsYou: vi.fn().mockResolvedValue(undefined),
    now: () => '2026-07-16T00:00:00.000Z',
    schedule: (key, work) => {
      scheduledKeys.add(key);
      scheduled.push(work().finally(() => scheduledKeys.delete(key)));
    },
    isScheduled: (key) => scheduledKeys.has(key),
    isPersistentlyOwned: vi.fn().mockReturnValue(false),
    listProjects: vi.fn().mockResolvedValue([{ key: 'overdeck', config: { path: '/repo' } }]) as never,
    git: git as never,
    isStrikeAgentAlive: vi.fn().mockResolvedValue(false),
    flush: () => Promise.all(scheduled).then(() => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  resetStrikeLandingAttemptsForTests();
});

describe('salvageStrandedStrikeBranches', () => {
  it('pushes a clean dead strike branch exactly once', async () => {
    const d = deps();

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([
      `[strike-salvage] pushed PAN-2702 at ${HEAD}`,
    ]);
    expect(d.git).toHaveBeenCalledWith(['push', 'origin', 'strike/pan-2702'], '/repo/workspaces/feature-pan-2702-strike');

    // A second pass at the same head is a no-op.
    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([]);
  });

  it('never re-arms a strike whose PR the forge already merged', async () => {
    const d = deps({ getFacts: vi.fn(async () => ({ merged: true })) });

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([]);
    expect(d.git).not.toHaveBeenCalledWith(expect.arrayContaining(['push']), expect.anything());
  });

  it('skips a branch whose agent is still alive', async () => {
    const d = deps({ isStrikeAgentAlive: vi.fn().mockResolvedValue(true) });

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([]);
  });

  it('returns nothing when the project listing is unavailable', async () => {
    const d = deps({ listProjects: vi.fn().mockRejectedValue(new Error('no config')) as never });

    await expect(salvageStrandedStrikeBranches(d)).resolves.toEqual([]);
  });
});

describe('patrolStrikeLandings', () => {
  it('schedules the landing and invokes the strike merge door', async () => {
    const d = deps();

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.mergeIssue).toHaveBeenCalledWith('PAN-2702', expect.objectContaining({
      kind: 'strike',
      markerHead: HEAD,
      branchName: 'strike/pan-2702',
    }));
  });

  it('does not land a strike whose PR already merged', async () => {
    const d = deps({ getFacts: vi.fn(async () => ({ merged: true })) });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.mergeIssue).not.toHaveBeenCalled();
  });

  it('does not double-schedule a landing that is already in flight', async () => {
    const d = deps({ isScheduled: vi.fn().mockReturnValue(true) });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.mergeIssue).not.toHaveBeenCalled();
  });

  it('yields to a persistently owned issue', async () => {
    const d = deps({ isPersistentlyOwned: vi.fn().mockReturnValue(true) });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.mergeIssue).not.toHaveBeenCalled();
  });

  it('routes an actionable merge failure back to the strike agent', async () => {
    const d = deps({
      mergeIssue: vi.fn().mockResolvedValue({ success: false, error: 'verification failed on strike branch' }),
    });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.deliverRecovery).toHaveBeenCalledWith(
      'strike-pan-2702',
      expect.stringContaining('Strike landing failed for PAN-2702'),
      `strike-landing:PAN-2702:${HEAD}:1`,
    );
    // Delivered recovery is the whole response; needs-you is the escalation.
    expect(d.needsYou).not.toHaveBeenCalled();
  });

  it('escalates to needs-you when the recovery message cannot be delivered', async () => {
    const d = deps({
      mergeIssue: vi.fn().mockResolvedValue({ success: false, error: 'verification failed on strike branch' }),
      deliverRecovery: vi.fn().mockResolvedValue({ delivered: false, queuedToMail: true, reason: 'no session' }),
    });

    await patrolStrikeLandings(d);
    await d.flush();

    expect(d.writeFeedback).toHaveBeenCalled();
    expect(d.needsYou).toHaveBeenCalledWith('PAN-2702', expect.stringContaining('needs operator attention'), expect.anything());
  });
});

describe('StrikeLandingSupervisor', () => {
  it('admits one worker per key and releases it when the work settles', async () => {
    const supervisor = new StrikeLandingSupervisor(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const second = vi.fn(async () => {});

    supervisor.enqueue('PAN-1:head', () => gate);
    expect(supervisor.has('PAN-1:head')).toBe(true);

    supervisor.enqueue('PAN-1:head', second);
    expect(second).not.toHaveBeenCalled();

    release();
    await gate;
    await new Promise((resolve) => setImmediate(resolve));
    expect(supervisor.has('PAN-1:head')).toBe(false);
  });
});
