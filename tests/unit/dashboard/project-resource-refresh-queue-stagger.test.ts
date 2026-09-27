/**
 * PAN-4264 Work Item 19: boot-warm and periodic-convergence refreshes enqueue
 * projects one at a time instead of one burst of GitHub calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectResourceRefreshQueue,
  PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS,
  PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS,
  startProjectResourceConvergence,
} from '../../../src/dashboard/server/services/project-resource-refresh-queue.js';

const project = (name: string) => ({ name, path: `/${name}`, issue_prefix: name.toUpperCase() });
const projects = (count: number) => Array.from({ length: count }, (_, i) => project(`p${i}`));

describe('staggered project resource refresh (PAN-4264)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes 10 projects over 60 s as 10 separate batches spaced 6 s apart', async () => {
    const batchTimes: number[] = [];
    const refreshProjects = vi.fn(async (batch: unknown[]) => {
      expect(batch).toHaveLength(1);
      batchTimes.push(Date.now());
    });
    const queue = createProjectResourceRefreshQueue({ refreshProjects });
    const start = Date.now();

    const stagger = queue.enqueueProjectsStaggered(projects(10), 'boot-warm', 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await stagger.done;
    await queue.whenIdle();

    expect(refreshProjects).toHaveBeenCalledTimes(10);
    expect(batchTimes.map((t) => t - start)).toEqual(
      Array.from({ length: 10 }, (_, i) => i * 6_000 + PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS),
    );
    queue.stop();
  });

  it('never spaces projects closer than the debounce plus 1 s', async () => {
    const refreshProjects = vi.fn(async () => undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });

    queue.enqueueProjectsStaggered(projects(100), 'boot-warm', 60_000);
    await vi.advanceTimersByTimeAsync(10 * (PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS + 1_000));
    expect(refreshProjects.mock.calls.length).toBeLessThanOrEqual(11);
    expect(refreshProjects.mock.calls.every(([batch]) => (batch as unknown[]).length === 1)).toBe(true);
    queue.stop();
  });

  it('cancel() stops the rest', async () => {
    const refreshProjects = vi.fn(async () => undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });

    const stagger = queue.enqueueProjectsStaggered(projects(10), 'boot-warm', 60_000);
    await vi.advanceTimersByTimeAsync(13_000);
    stagger.cancel();
    await stagger.done;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(refreshProjects).toHaveBeenCalledTimes(3);
    queue.stop();
  });

  it('a second convergence tick cancels the first tick\'s pending enqueues', async () => {
    const refreshProjects = vi.fn(async () => undefined);
    const queue = createProjectResourceRefreshQueue({ refreshProjects });
    // 200 projects at the 2 s spacing floor take 398 s, longer than the 5-minute interval.
    const stop = startProjectResourceConvergence(queue, () => projects(200));
    const refreshedPaths = () => refreshProjects.mock.calls.flatMap(([batch]) => (batch as Array<{ path: string }>).map((p) => p.path));

    // Tick 1 at 300 s; tick 2 at 600 s cancels p150..p199 of tick 1 and restarts
    // from p0. Stop at 900 s, before tick 2 reaches p150 (600 s + 300 s).
    await vi.advanceTimersByTimeAsync(3 * PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS - 1_500);
    stop();
    await vi.advanceTimersByTimeAsync(PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS * 2);

    const paths = refreshedPaths();
    expect(paths).not.toContain('/p199');
    expect(paths.filter((path) => path === '/p0')).toHaveLength(2);
    queue.stop();
  });
});
