import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectResourceRefreshQueue,
  membershipRefreshForProject,
  PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS,
  shouldRefreshMembershipForResourceRefresh,
} from '../../../src/dashboard/server/services/project-resource-refresh-queue.js';

const project = (name: string) => ({ name, path: `/${name}`, issue_prefix: name.toUpperCase() });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('project resource refresh queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces repeated projects and preserves first-seen FIFO order', async () => {
    const refreshProjects = vi.fn().mockResolvedValue(undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });
    const alpha = project('alpha');
    const beta = project('beta');

    queue.enqueueProject(alpha, 'agent.created');
    queue.enqueueProject(alpha, 'agent.started');
    queue.enqueueProject(beta, 'agent.created');

    await vi.advanceTimersByTimeAsync(PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS);
    await queue.whenIdle();

    expect(refreshProjects).toHaveBeenCalledOnce();
    expect(refreshProjects.mock.calls[0]?.[0]).toEqual([alpha, beta]);
    expect(refreshProjects.mock.calls[0]?.[1].reasonsByProjectPath).toEqual(new Map([
      [alpha.path, new Set(['agent.created', 'agent.started'])],
      [beta.path, new Set(['agent.created'])],
    ]));
    queue.stop();
  });

  it('re-gathers membership for close-out status changes but not agent-only refreshes', () => {
    const closeOutContext = {
      reasonsByProjectPath: new Map([['/alpha', new Set(['issue.statusChanged:closed-out'])]]),
    };
    const nonTerminalContext = {
      reasonsByProjectPath: new Map([['/alpha', new Set(['issue.statusChanged', 'agent.stopped'])]]),
    };

    expect(shouldRefreshMembershipForResourceRefresh(closeOutContext)).toBe(true);
    expect(shouldRefreshMembershipForResourceRefresh(nonTerminalContext)).toBe(false);
  });

  it.each(['opened', 'closed', 'reopened'])('re-gathers membership for pull_request:%s', (action) => {
    const context = {
      reasonsByProjectPath: new Map([['/alpha', new Set([`pull_request:${action}`])]]),
    };

    expect(shouldRefreshMembershipForResourceRefresh(context)).toBe(true);
  });

  describe('membershipRefreshForProject (PAN-5224)', () => {
    const alpha = project('alpha');

    it('healthy webhooks + GitHub tracker: periodic-convergence waits for the fallback interval (ac1)', () => {
      const deps = {
        ageMs: () => 10 * 60_000,
        fallbackMs: (trackerIsGithub: boolean) => (trackerIsGithub ? 30 * 60_000 : 5 * 60_000),
        trackerType: () => 'github' as const,
      };
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence']), deps)).toBe(false);
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence']), { ...deps, ageMs: () => 31 * 60_000 })).toBe(true);
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence']), { ...deps, ageMs: () => null })).toBe(true);
    });

    it('a Linear-tracker project, or webhooks not healthy, refreshes at the short fallback (ac2)', () => {
      const linearDeps = {
        ageMs: () => 6 * 60_000,
        fallbackMs: (trackerIsGithub: boolean) => (trackerIsGithub ? 30 * 60_000 : 5 * 60_000),
        trackerType: () => 'linear' as const,
      };
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence']), linearDeps)).toBe(true);

      const unhealthyDeps = {
        ageMs: () => 6 * 60_000,
        fallbackMs: () => 5 * 60_000,
        trackerType: () => 'github' as const,
      };
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence']), unhealthyDeps)).toBe(true);
    });

    it('any non-periodic membership reason refreshes at once; agent.started alone does not (ac3)', () => {
      const deps = {
        ageMs: () => 0,
        fallbackMs: () => Number.POSITIVE_INFINITY,
        trackerType: () => 'github' as const,
      };
      expect(membershipRefreshForProject(alpha, new Set(['periodic-convergence', 'pull_request:opened']), deps)).toBe(true);
      expect(membershipRefreshForProject(alpha, new Set(['agent.started']), deps)).toBe(false);
    });
  });

  it('runs at most one follow-up when the active project changes again', async () => {
    const first = deferred();
    const refreshProjects = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });
    const alpha = project('alpha');

    queue.enqueueProject(alpha, 'agent.created');
    await vi.advanceTimersByTimeAsync(PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS);
    expect(refreshProjects).toHaveBeenCalledOnce();

    queue.enqueueProject(alpha, 'agent.started');
    queue.enqueueProject(alpha, 'agent.stopped');
    first.resolve();
    await queue.whenIdle();

    expect(refreshProjects).toHaveBeenCalledTimes(2);
    expect(refreshProjects.mock.calls[1]?.[0]).toEqual([alpha]);
    expect(refreshProjects.mock.calls[1]?.[1].reasonsByProjectPath.get(alpha.path)).toEqual(
      new Set(['agent.started', 'agent.stopped']),
    );
    queue.stop();
  });

  it('continues with queued work after a failed batch', async () => {
    const first = deferred();
    const refreshProjects = vi.fn()
      .mockImplementationOnce(async () => {
        await first.promise;
        throw new Error('tracker unavailable');
      })
      .mockResolvedValueOnce(undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });
    const alpha = project('alpha');
    const beta = project('beta');

    queue.enqueueProject(alpha, 'agent.created');
    await vi.advanceTimersByTimeAsync(PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS);
    queue.enqueueProject(beta, 'agent.created');
    first.resolve();
    await queue.whenIdle();

    expect(refreshProjects).toHaveBeenCalledTimes(2);
    expect(queue.getState()).toMatchObject({ running: false, pendingProjectPaths: [], lastError: null });
    queue.stop();
  });
});
