/**
 * PAN-5396: a dashboard restart during the post-merge lifecycle left the merged
 * work agent alive. At boot, the recovery re-runs the lifecycle for issues whose
 * PR merged after a still-live work or planning agent started.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  recoverInterruptedPostMergeLifecycles,
  type MergedAgentRecoveryDeps,
} from '../../../../src/lib/cloister/merged-agent-recovery.js';

const MERGED_AT = '2026-11-15T19:04:28Z';

function deps(overrides: Partial<MergedAgentRecoveryDeps> = {}): MergedAgentRecoveryDeps & { runLifecycle: ReturnType<typeof vi.fn> } {
  return {
    listAgents: async () => [
      { id: 'agent-pan-5349', issueId: 'PAN-5349', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z' },
    ],
    isAlive: async () => ({ alive: true, paneAlive: true }),
    // PAN-5349's last transcript record was 18:47:55, before its 19:04 merge.
    lastWorkActivityMs: async () => Date.parse('2026-11-15T18:47:55Z'),
    readMergedAt: async () => MERGED_AT,
    resolveProjectPath: async () => '/repo/overdeck',
    runLifecycle: vi.fn(async () => undefined),
    ...overrides,
  } as MergedAgentRecoveryDeps & { runLifecycle: ReturnType<typeof vi.fn> };
}

describe('recoverInterruptedPostMergeLifecycles', () => {
  it('re-runs the lifecycle for a live agent whose PR merged after it started', async () => {
    const d = deps();
    const actions = await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).toHaveBeenCalledWith('PAN-5349', '/repo/overdeck');
    expect(actions[0]).toContain('re-running the post-merge lifecycle');
  });

  it('leaves an issue alone when its PR has not merged', async () => {
    const d = deps({ readMergedAt: async () => undefined });
    await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).not.toHaveBeenCalled();
  });

  it('leaves an agent that started or resumed after the merge running', async () => {
    const started = deps({
      listAgents: async () => [
        { id: 'agent-pan-5349', issueId: 'PAN-5349', role: 'work', status: 'running', startedAt: '2026-11-15T20:00:00Z' },
      ],
    });
    await recoverInterruptedPostMergeLifecycles(started);
    expect(started.runLifecycle).not.toHaveBeenCalled();

    const resumed = deps({
      listAgents: async () => [
        { id: 'agent-pan-5349', issueId: 'PAN-5349', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z', lastResumeAt: '2026-11-15T20:00:00Z' },
      ],
    });
    await recoverInterruptedPostMergeLifecycles(resumed);
    expect(resumed.runLifecycle).not.toHaveBeenCalled();
  });

  it('leaves an agent relaunched after the merge running (restart stamps lastActivity)', async () => {
    const d = deps({
      listAgents: async () => [
        { id: 'agent-pan-5349', issueId: 'PAN-5349', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z', lastActivity: '2026-11-15T20:00:00Z' },
      ],
    });
    await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).not.toHaveBeenCalled();
  });

  it('leaves an agent that did work after the merge running', async () => {
    const d = deps({ lastWorkActivityMs: async () => Date.parse('2026-11-15T19:30:00Z') });
    const actions = await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).not.toHaveBeenCalled();
    expect(actions[0]).toContain('launched or worked after it');
  });

  it('reports an agent whose liveness is indeterminate instead of skipping it silently', async () => {
    const d = deps({ isAlive: async () => ({ alive: false, reason: 'runtime-indeterminate' }) });
    const actions = await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).not.toHaveBeenCalled();
    expect(actions).toEqual(['agent-pan-5349: liveness indeterminate — skipped']);
  });

  it('ignores agents that are not live, stopped, or not work/planning agents', async () => {
    const d = deps({
      listAgents: async () => [
        { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z' },
        { id: 'agent-pan-2', issueId: 'PAN-2', role: 'work', status: 'stopped', startedAt: '2026-11-15T15:00:00Z' },
        { id: 'agent-pan-3-review', issueId: 'PAN-3', role: 'review', status: 'running', startedAt: '2026-11-15T15:00:00Z' },
      ],
      isAlive: async (agentId) => (agentId === 'agent-pan-1'
        ? { alive: false, reason: 'runtime-indeterminate' }
        : { alive: true, paneAlive: true }),
    });
    await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).not.toHaveBeenCalled();
  });

  it('runs the lifecycle once per issue and keeps going after one issue fails', async () => {
    const d = deps({
      listAgents: async () => [
        { id: 'agent-pan-5357', issueId: 'PAN-5357', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z' },
        { id: 'planning-pan-5357', issueId: 'PAN-5357', role: 'plan', status: 'running', startedAt: '2026-11-15T14:00:00Z' },
        { id: 'agent-pan-5349', issueId: 'PAN-5349', role: 'work', status: 'running', startedAt: '2026-11-15T15:00:00Z' },
      ],
    });
    d.runLifecycle.mockRejectedValueOnce(new Error('tracker down'));
    const actions = await recoverInterruptedPostMergeLifecycles(d);
    expect(d.runLifecycle).toHaveBeenCalledTimes(2);
    expect(d.runLifecycle).toHaveBeenNthCalledWith(1, 'PAN-5357', '/repo/overdeck');
    expect(d.runLifecycle).toHaveBeenNthCalledWith(2, 'PAN-5349', '/repo/overdeck');
    expect(actions).toContainEqual(expect.stringContaining('PAN-5357: post-merge recovery failed: tracker down'));
  });
});
