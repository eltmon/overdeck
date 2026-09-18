/**
 * PAN-3894 (W3a): perProjectSpecialistPatrol extracted from deacon.ts into its
 * own module with injectable deps, so the housekeeping scheduler can run it off
 * the 60 s tick and so its four behaviors are testable without tmux or git.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  perProjectSpecialistPatrol,
  SPECIALIST_STUCK_MS,
  SPECIALIST_IDLE_LINGER_MS,
  type SpecialistPatrolDeps,
} from '../../../../src/lib/cloister/specialist-patrol.js';

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

function specialist(overrides: Record<string, unknown> = {}) {
  return {
    projectKey: 'overdeck',
    specialistType: 'review-agent',
    registryKey: 'overdeck:review-agent',
    metadata: {},
    isRunning: true,
    tmuxSession: 'specialist-overdeck-review-agent',
    ...overrides,
  } as any;
}

function makeDeps(overrides: Partial<SpecialistPatrolDeps> = {}): SpecialistPatrolDeps {
  return {
    getAllProjectSpecialistStatuses: vi.fn(async () => []),
    getAgentRuntimeStateSync: vi.fn(() => undefined),
    saveAgentRuntimeState: vi.fn(),
    getReviewStatusSync: vi.fn(() => null),
    setReviewStatusSync: vi.fn(),
    killSession: vi.fn(async () => undefined),
    execAsync: vi.fn(async () => ({ stdout: '' })),
    resolveProjectFromIssueSync: vi.fn(() => null),
    postMergeLifecycle: vi.fn(async () => undefined),
    now: () => NOW,
    ...overrides,
  } as unknown as SpecialistPatrolDeps;
}

describe('perProjectSpecialistPatrol (PAN-3894 W3a)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('resets a dead session whose runtime mirror still says active', async () => {
    const saveAgentRuntimeState = vi.fn();
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [specialist({ isRunning: false })]),
      getAgentRuntimeStateSync: vi.fn(() => ({ state: 'active', lastActivity: new Date(NOW).toISOString() })),
      saveAgentRuntimeState,
    });

    const actions = await perProjectSpecialistPatrol(deps);

    expect(saveAgentRuntimeState).toHaveBeenCalledWith(
      'specialist-overdeck-review-agent',
      expect.objectContaining({ state: 'idle' }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('Dead-session reset');
  });

  it('auto-completes a merge whose specialist died after the merge landed (PAN-375)', async () => {
    const setReviewStatusSync = vi.fn();
    const postMergeLifecycle = vi.fn(async () => undefined);
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [
        specialist({ isRunning: false, specialistType: 'merge-agent' }),
      ]),
      getAgentRuntimeStateSync: vi.fn(() => ({
        state: 'active',
        lastActivity: new Date(NOW).toISOString(),
        currentIssue: 'PAN-1234',
      })),
      getReviewStatusSync: vi.fn(() => ({ mergeStatus: 'merging' })),
      resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/repo', key: 'overdeck' })),
      execAsync: vi.fn(async () => ({ stdout: "abc123 Merge branch 'feature/pan-1234'\n" })),
      setReviewStatusSync,
      postMergeLifecycle,
    });

    const actions = await perProjectSpecialistPatrol(deps);

    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-1234', { mergeStatus: 'merged', readyForMerge: false });
    expect(postMergeLifecycle).toHaveBeenCalledWith('PAN-1234', '/repo');
    expect(actions).toContain('Auto-completed stale merge for PAN-1234');
  });

  it('resets mergeStatus to pending when the dead merge specialist never landed the merge', async () => {
    const setReviewStatusSync = vi.fn();
    const postMergeLifecycle = vi.fn(async () => undefined);
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [
        specialist({ isRunning: false, specialistType: 'merge-agent' }),
      ]),
      getAgentRuntimeStateSync: vi.fn(() => ({
        state: 'active',
        lastActivity: new Date(NOW).toISOString(),
        currentIssue: 'PAN-1234',
      })),
      getReviewStatusSync: vi.fn(() => ({ mergeStatus: 'merging' })),
      resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/repo', key: 'overdeck' })),
      execAsync: vi.fn(async () => ({ stdout: '' })),
      setReviewStatusSync,
      postMergeLifecycle,
    });

    await perProjectSpecialistPatrol(deps);

    expect(setReviewStatusSync).toHaveBeenCalledWith('PAN-1234', { mergeStatus: 'pending' });
    expect(postMergeLifecycle).not.toHaveBeenCalled();
  });

  it('force-kills a running specialist active past the stuck threshold and returns a [warn] action', async () => {
    const killSession = vi.fn(async () => undefined);
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [specialist()]),
      getAgentRuntimeStateSync: vi.fn(() => ({
        state: 'active',
        lastActivity: new Date(NOW - SPECIALIST_STUCK_MS - 1000).toISOString(),
      })),
      killSession,
    });

    const actions = await perProjectSpecialistPatrol(deps);

    expect(killSession).toHaveBeenCalledWith('specialist-overdeck-review-agent');
    expect(actions[0]).toBe('[warn] Per-project review-agent (overdeck) stuck, force-killing');
    expect(actions).toContain('Force-killed stuck per-project review-agent (overdeck)');
  });

  it('kills a specialist that lingers idle past the linger threshold (PAN-919)', async () => {
    const killSession = vi.fn(async () => undefined);
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [specialist()]),
      getAgentRuntimeStateSync: vi.fn(() => ({
        state: 'idle',
        lastActivity: new Date(NOW - SPECIALIST_IDLE_LINGER_MS - 60_000).toISOString(),
      })),
      killSession,
    });

    const actions = await perProjectSpecialistPatrol(deps);

    expect(killSession).toHaveBeenCalledWith('specialist-overdeck-review-agent');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('Killed lingering idle specialist review-agent (overdeck)');
  });

  it('leaves a freshly-idle running specialist alone', async () => {
    const killSession = vi.fn(async () => undefined);
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => [specialist()]),
      getAgentRuntimeStateSync: vi.fn(() => ({
        state: 'idle',
        lastActivity: new Date(NOW - 60_000).toISOString(),
      })),
      killSession,
    });

    const actions = await perProjectSpecialistPatrol(deps);

    expect(killSession).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('swallows a registry failure and returns no actions', async () => {
    const deps = makeDeps({
      getAllProjectSpecialistStatuses: vi.fn(async () => {
        throw new Error('registry unreadable');
      }),
    });

    await expect(perProjectSpecialistPatrol(deps)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
