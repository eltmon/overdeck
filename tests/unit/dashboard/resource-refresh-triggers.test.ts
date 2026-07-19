import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createResourceRefreshTriggers, type ResourceRefreshTriggerDeps } from '../../../src/dashboard/server/services/resource-refresh-triggers.js';
import type { ProjectConfig } from '../../../src/lib/projects.js';

type EventHandler = (event: { type: string; payload?: { issueId?: string } }) => void;

const panProject = { name: 'overdeck', path: '/overdeck' } as ProjectConfig;
const minProject = { name: 'myn', path: '/myn' } as ProjectConfig;

function makeDeps() {
  let handler: EventHandler = () => {};
  const deps = {
    subscribe: vi.fn().mockImplementation((fn: EventHandler) => {
      handler = fn;
      return vi.fn();
    }),
    projectForIssue: vi.fn().mockImplementation((issueId: string) =>
      issueId.startsWith('PAN-') ? panProject : issueId.startsWith('MIN-') ? minProject : null),
    allProjects: vi.fn().mockReturnValue([panProject, minProject]),
    refreshMemberships: vi.fn().mockResolvedValue(undefined),
    refreshResources: vi.fn().mockResolvedValue([]),
    debounceMs: 1_000,
  } satisfies ResourceRefreshTriggerDeps & { debounceMs: number };
  return { deps, emit: (event: Parameters<EventHandler>[0]) => handler(event) };
}

describe('createResourceRefreshTriggers (PAN-2893)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refreshes membership then resources for the event project after the debounce window', async () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.started', payload: { issueId: 'PAN-42' } });
    expect(deps.refreshMemberships).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.refreshMemberships).toHaveBeenCalledExactlyOnceWith([panProject]);
    expect(deps.refreshResources).toHaveBeenCalledTimes(1);
  });

  it('debounces a convoy burst into one refresh covering every touched project', async () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.created', payload: { issueId: 'PAN-1' } });
    emit({ type: 'agent.created', payload: { issueId: 'PAN-2' } });
    emit({ type: 'agent.started', payload: { issueId: 'MIN-3' } });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.refreshMemberships).toHaveBeenCalledExactlyOnceWith([panProject, minProject]);
    expect(deps.refreshResources).toHaveBeenCalledTimes(1);
  });

  it('falls back to all projects when the event has no resolvable project', async () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.stopped', payload: { issueId: 'UNKNOWN-9' } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.refreshMemberships).toHaveBeenCalledExactlyOnceWith([panProject, minProject]);
  });

  it('ignores non-lifecycle events entirely', async () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.thinking_started', payload: { issueId: 'PAN-1' } });
    emit({ type: 'agent.output_received', payload: { issueId: 'PAN-1' } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.refreshMemberships).not.toHaveBeenCalled();
    expect(deps.refreshResources).not.toHaveBeenCalled();
  });

  it('rate-limits: a burst arriving within the 30s floor of the last flush waits for the floor', async () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers({ ...deps, minIntervalMs: 30_000 });

    emit({ type: 'agent.started', payload: { issueId: 'PAN-1' } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(1);

    // Events 2s after the first flush must NOT trigger a second refresh yet…
    emit({ type: 'agent.stopped', payload: { issueId: 'PAN-2' } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(1);

    // …only once the 30s floor from the last flush has elapsed.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(2);
  });

  it('never queues a second compute behind a running one — re-arms instead', async () => {
    const { deps, emit } = makeDeps();
    let releaseRefresh!: () => void;
    deps.refreshMemberships = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { releaseRefresh = resolve; }));
    createResourceRefreshTriggers({ ...deps, minIntervalMs: 30_000 });

    emit({ type: 'agent.started', payload: { issueId: 'PAN-1' } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(1);

    // While the first refresh is STILL RUNNING, more events + the floor elapsing
    // must not start an overlapping compute.
    emit({ type: 'agent.started', payload: { issueId: 'PAN-2' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(1);

    releaseRefresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.refreshMemberships).toHaveBeenCalledTimes(2);
  });

  it('stops firing after dispose', async () => {
    const { deps, emit } = makeDeps();
    const dispose = createResourceRefreshTriggers(deps);

    emit({ type: 'agent.started', payload: { issueId: 'PAN-42' } });
    dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.refreshMemberships).not.toHaveBeenCalled();
  });
});
