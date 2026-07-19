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

  it('stops firing after dispose', async () => {
    const { deps, emit } = makeDeps();
    const dispose = createResourceRefreshTriggers(deps);

    emit({ type: 'agent.started', payload: { issueId: 'PAN-42' } });
    dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.refreshMemberships).not.toHaveBeenCalled();
  });
});
