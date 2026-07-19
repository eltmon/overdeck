import { describe, expect, it, vi } from 'vitest';

import {
  createResourceRefreshTriggers,
  type ResourceRefreshEvent,
  type ResourceRefreshTriggerDeps,
} from '../../../src/dashboard/server/services/resource-refresh-triggers.js';
import type { ProjectConfig } from '../../../src/lib/projects.js';

const panProject = { name: 'overdeck', path: '/overdeck' } as ProjectConfig;
const minProject = { name: 'myn', path: '/myn' } as ProjectConfig;

function makeDeps() {
  let handler: (event: ResourceRefreshEvent) => void = () => undefined;
  const unsubscribe = vi.fn();
  const deps = {
    subscribe: vi.fn().mockImplementation((fn: (event: ResourceRefreshEvent) => void) => {
      handler = fn;
      return unsubscribe;
    }),
    projectForIssue: vi.fn().mockImplementation((issueId: string) =>
      issueId.startsWith('PAN-') ? panProject : issueId.startsWith('MIN-') ? minProject : null),
    projectForKey: vi.fn().mockImplementation((projectKey: string) =>
      projectKey === 'overdeck' ? panProject : projectKey === 'myn' ? minProject : null),
    issueForAgent: vi.fn().mockImplementation((agentId: string) =>
      agentId === 'agent-pan-42' ? 'PAN-42' : null),
    enqueueProjects: vi.fn(),
    warn: vi.fn(),
  } satisfies ResourceRefreshTriggerDeps;
  return { deps, unsubscribe, emit: (event: ResourceRefreshEvent) => handler(event) };
}

describe('createResourceRefreshTriggers', () => {
  it('routes an issue lifecycle event to its project queue', () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.started', payload: { issueId: 'PAN-42' } });

    expect(deps.enqueueProjects).toHaveBeenCalledExactlyOnceWith([panProject], 'agent.started');
  });

  it('resolves projectKey before issue and agent fallbacks', () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.created', payload: { projectKey: 'myn', issueId: 'PAN-42', agentId: 'agent-pan-42' } });

    expect(deps.enqueueProjects).toHaveBeenCalledExactlyOnceWith([minProject], 'agent.created');
    expect(deps.projectForIssue).not.toHaveBeenCalled();
    expect(deps.issueForAgent).not.toHaveBeenCalled();
  });

  it('uses persisted agent ownership when an event has no issue id', () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.stopped', payload: { agentId: 'agent-pan-42' } });

    expect(deps.issueForAgent).toHaveBeenCalledWith('agent-pan-42');
    expect(deps.enqueueProjects).toHaveBeenCalledExactlyOnceWith([panProject], 'agent.stopped');
  });

  it('skips unresolved events instead of refreshing every project', () => {
    const { deps, emit } = makeDeps();
    createResourceRefreshTriggers(deps);

    emit({ type: 'agent.stopped', payload: { issueId: 'UNKNOWN-9' } });

    expect(deps.enqueueProjects).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('affected project could not be resolved'));
  });

  it('ignores non-lifecycle events and unsubscribes on dispose', () => {
    const { deps, emit, unsubscribe } = makeDeps();
    const dispose = createResourceRefreshTriggers(deps);

    emit({ type: 'agent.output_received', payload: { issueId: 'PAN-42' } });
    expect(deps.enqueueProjects).not.toHaveBeenCalled();

    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
