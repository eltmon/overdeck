import { describe, expect, it, vi } from 'vitest';

import type { ProjectConfig, ResolvedProject } from '../../projects.js';
import {
  clearStaleClosedOutBeforeSpawn,
  type AgentSpawnReopenGuardDeps,
} from '../reopen-guard.js';

const project: ProjectConfig = { name: 'Test project', path: '/project' };
const resolved: ResolvedProject = {
  projectKey: 'test',
  projectName: 'Test project',
  projectPath: '/project',
  linearTeam: 'PAN',
};

function deps(overrides: Partial<AgentSpawnReopenGuardDeps> = {}): AgentSpawnReopenGuardDeps {
  return {
    resolveProject: vi.fn(() => resolved),
    getProject: vi.fn(() => project),
    hasClosedOutRecord: vi.fn(() => true),
    clearClosedOut: vi.fn(async () => true),
    log: vi.fn(),
    ...overrides,
  };
}

describe('PAN-3513 pre-spawn reopen guard', () => {
  it('clears stale terminal state before launch', async () => {
    const injected = deps();

    await expect(clearStaleClosedOutBeforeSpawn('pan-3513', injected)).resolves.toBe(true);

    expect(injected.clearClosedOut).toHaveBeenCalledWith(project, 'PAN-3513');
    expect(injected.log).toHaveBeenCalledWith(
      '[spawn] Cleared stale closedOut state for PAN-3513 before agent launch',
    );
  });

  it('does not write when the record is not closed out', async () => {
    const injected = deps({ hasClosedOutRecord: vi.fn(() => false) });

    await expect(clearStaleClosedOutBeforeSpawn('PAN-3513', injected)).resolves.toBe(false);

    expect(injected.clearClosedOut).not.toHaveBeenCalled();
  });
});
