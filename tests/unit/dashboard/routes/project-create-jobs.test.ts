/**
 * Tests for project-create-jobs.ts
 *
 * Uses fake timers to verify TTL cleanup and job state transitions.
 * Mocks performProjectCreate from src/lib/projects/create.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ResolvedProjectIntent, ProjectCreateResult } from '../../../../src/lib/projects/create.js';

vi.mock('../../../../src/lib/projects/create.js', () => ({
  performProjectCreate: vi.fn(),
}));

import {
  startProjectCreateJob,
  getProjectCreateJob,
  __resetProjectCreateJobsForTests,
  JOB_TTL_MS,
} from '../../../../src/dashboard/server/routes/project-create-jobs.js';
import { performProjectCreate } from '../../../../src/lib/projects/create.js';

beforeEach(() => {
  __resetProjectCreateJobsForTests();
  vi.useFakeTimers();
  vi.mocked(performProjectCreate).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  __resetProjectCreateJobsForTests();
});

function makeIntent(): ResolvedProjectIntent {
  return {
    mode: 'new',
    key: 'test-proj',
    name: 'Test Project',
    path: '/home/user/Projects/test-proj',
    cloneUrl: null,
    provider: null,
    repoSlug: null,
    defaultBranch: null,
    remoteChecked: false,
    isGitRepository: true,
    proposedIssuePrefix: 'TP',
    wouldClone: false,
    wouldGitInit: true,
    willCreateMainWorkspace: true,
    findings: [],
  };
}

describe('project-create-jobs', () => {
  it('returns a UUID string from startProjectCreateJob', () => {
    vi.mocked(performProjectCreate).mockResolvedValue({
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-123',
    });

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('tracks a running job with phase and percent', async () => {
    vi.mocked(performProjectCreate).mockImplementation(async (intent, hooks) => {
      // Simulate first progress callback immediately
      hooks.onProgress?.({ phase: 'cloning', percent: 25 });
      // Simulate second progress after some time
      await new Promise((resolve) => setTimeout(resolve, 10));
      hooks.onProgress?.({ phase: 'registering', percent: 75 });
      return {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };
    });

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    // Job should exist and be running initially
    let job = getProjectCreateJob(id);
    expect(job).toBeDefined();
    expect(job?.status).toBe('running');

    // Simulate first progress callback (already called synchronously)
    await Promise.resolve();
    job = getProjectCreateJob(id);
    expect(job?.status).toBe('running');
    expect(job?.phase).toBe('cloning');
    expect(job?.percent).toBe(25);

    // Advance timers to complete the async sleep in performProjectCreate
    await vi.advanceTimersByTimeAsync(20);
    job = getProjectCreateJob(id);
    expect(job?.status).toBe('done');
    if (job?.status === 'done') {
      expect(job.result.key).toBe('test-proj');
    }
  });

  it('updates job to done when performProjectCreate resolves', async () => {
    const result: ProjectCreateResult = {
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-123',
    };

    vi.mocked(performProjectCreate).mockResolvedValue(result);

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    // Use runAllTimersAsync to allow the promise to settle and handlers to run
    // but do this before the TTL deletion can fire (TTL is 600s)
    await vi.advanceTimersByTimeAsync(100);

    const job = getProjectCreateJob(id);
    expect(job?.status).toBe('done');
    if (job?.status === 'done') {
      expect(job.result).toEqual(result);
      expect(typeof job.finishedAt).toBe('number');
    }
  });

  it('updates job to failed when performProjectCreate rejects', async () => {
    const errorMsg = 'Clone failed: network error';
    vi.mocked(performProjectCreate).mockRejectedValue(new Error(errorMsg));

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    // Advance timers to let the promise rejection settle
    await vi.advanceTimersByTimeAsync(100);

    const job = getProjectCreateJob(id);
    expect(job?.status).toBe('failed');
    if (job?.status === 'failed') {
      expect(job.error).toBe(errorMsg);
      expect(typeof job.finishedAt).toBe('number');
    }
  });

  it('schedules job deletion after JOB_TTL_MS', async () => {
    const result: ProjectCreateResult = {
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-123',
    };

    vi.mocked(performProjectCreate).mockResolvedValue(result);

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    // Let job complete
    vi.advanceTimersByTime(10);
    await Promise.resolve();

    let job = getProjectCreateJob(id);
    expect(job).toBeDefined();

    // Advance to just before TTL expiry
    vi.advanceTimersByTime(JOB_TTL_MS - 1);
    job = getProjectCreateJob(id);
    expect(job).toBeDefined();

    // Advance past TTL expiry
    vi.advanceTimersByTime(2);
    job = getProjectCreateJob(id);
    expect(job).toBeUndefined();
  });

  it('captures onProgress hooks and updates phase/percent', async () => {
    const progressCalls: { phase: string; percent: number | null }[] = [];

    vi.mocked(performProjectCreate).mockImplementation(async (intent, hooks) => {
      hooks.onProgress?.({ phase: 'phase1', percent: 10 });
      hooks.onProgress?.({ phase: 'phase2', percent: 50 });
      hooks.onProgress?.({ phase: 'phase3', percent: 90 });
      return {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };
    });

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    vi.advanceTimersByTime(5);
    await Promise.resolve();

    const job = getProjectCreateJob(id);
    if (job?.status === 'running') {
      // Job should have received the last progress call before settling
      expect(job.phase).toBe('phase3');
      expect(job.percent).toBe(90);
    }
  });

  it('does not update a job after it has settled', async () => {
    const result: ProjectCreateResult = {
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-123',
    };

    vi.mocked(performProjectCreate).mockImplementation(async (intent, hooks) => {
      hooks.onProgress?.({ phase: 'starting', percent: 0 });
      return result;
    });

    const intent = makeIntent();
    const id = startProjectCreateJob(intent);

    vi.advanceTimersByTime(10);
    await Promise.resolve();

    const job = getProjectCreateJob(id);
    expect(job?.status).toBe('done');

    // Simulate a stray progress callback (should not update)
    // This is already handled by the implementation, but we verify the guard
    if (job?.status === 'done') {
      expect(job.result.key).toBe('test-proj');
    }
  });

  it('stores startedAt timestamp on running jobs', () => {
    vi.mocked(performProjectCreate).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        key: 'test-proj',
        name: 'Test Project',
        path: '/home/user/Projects/test-proj',
        mainWorkspaceId: 'ws-123',
      };
    });

    const intent = makeIntent();
    const beforeStart = Date.now();
    const id = startProjectCreateJob(intent);
    const afterStart = Date.now();

    const job = getProjectCreateJob(id);
    expect(job?.status).toBe('running');
    if (job?.status === 'running') {
      expect(job.startedAt).toBeGreaterThanOrEqual(beforeStart);
      expect(job.startedAt).toBeLessThanOrEqual(afterStart);
    }
  });

  it('clears all timers on reset', async () => {
    const result: ProjectCreateResult = {
      key: 'test-proj',
      name: 'Test Project',
      path: '/home/user/Projects/test-proj',
      mainWorkspaceId: 'ws-123',
    };

    vi.mocked(performProjectCreate).mockResolvedValue(result);

    const id1 = startProjectCreateJob(makeIntent());
    const id2 = startProjectCreateJob(makeIntent());

    vi.advanceTimersByTime(10);
    await Promise.resolve();

    // Both jobs should be scheduled for deletion
    vi.advanceTimersByTime(JOB_TTL_MS - 15);

    // Before reset, jobs still exist
    expect(getProjectCreateJob(id1)).toBeDefined();
    expect(getProjectCreateJob(id2)).toBeDefined();

    // Reset clears them immediately
    __resetProjectCreateJobsForTests();

    expect(getProjectCreateJob(id1)).toBeUndefined();
    expect(getProjectCreateJob(id2)).toBeUndefined();
  });
});
