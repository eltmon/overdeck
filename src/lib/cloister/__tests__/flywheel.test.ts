import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeRunId: null as string | null,
  paused: false,
  spawnRun: vi.fn(async (issueId: string, role: string, options: { agentId: string; workspace: string }) => ({
    id: options.agentId,
    issueId,
    workspace: options.workspace,
    role,
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: '2026-05-18T12:00:00.000Z',
  })),
  stopAgentAsync: vi.fn(async () => undefined),
}));

vi.mock('../../agents.js', () => ({
  spawnRun: mocks.spawnRun,
  stopAgentAsync: mocks.stopAgentAsync,
}));

vi.mock('../../database/app-settings.js', () => ({
  getFlywheelActiveRunId: () => mocks.activeRunId,
  setFlywheelActiveRunId: (runId: string | null) => {
    mocks.activeRunId = runId;
  },
  setFlywheelGloballyPaused: (paused: boolean) => {
    mocks.paused = paused;
  },
}));

import { FLYWHEEL_ORCHESTRATOR_AGENT_ID, pauseFlywheel, resumeFlywheel, spawnFlywheel } from '../flywheel.js';

const cleanEnv = { PANOPTICON_DISABLE_DEACON: undefined, HOSTNAME: 'host-panopticon' };

describe('flywheel lifecycle', () => {
  beforeEach(() => {
    mocks.activeRunId = null;
    mocks.paused = false;
    mocks.spawnRun.mockClear();
    mocks.stopAgentAsync.mockClear();
  });

  it('spawns the flywheel orchestrator through the role-spawn path', async () => {
    const agent = await spawnFlywheel({ runId: 'RUN-1', workspace: '/repo', env: cleanEnv });

    expect(agent.id).toBe(FLYWHEEL_ORCHESTRATOR_AGENT_ID);
    expect(mocks.activeRunId).toBe('RUN-1');
    expect(mocks.paused).toBe(false);
    expect(mocks.spawnRun).toHaveBeenCalledWith('RUN-1', 'flywheel', expect.objectContaining({
      agentId: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      workspace: '/repo',
      allowHost: true,
      registerConversation: true,
    }));
  });

  it('rejects non-canonical run IDs before spawning', async () => {
    await expect(spawnFlywheel({ runId: '../../RUN-1' as any, workspace: '/repo', env: cleanEnv })).rejects.toThrow();

    expect(mocks.spawnRun).not.toHaveBeenCalled();
    expect(mocks.activeRunId).toBeNull();
  });

  it('refuses a second spawn while a flywheel run is active', async () => {
    await spawnFlywheel({ runId: 'RUN-1', workspace: '/repo', env: cleanEnv });

    await expect(spawnFlywheel({ runId: 'RUN-2', workspace: '/repo', env: cleanEnv }))
      .rejects.toThrow('Flywheel run RUN-1 is already active');

    expect(mocks.spawnRun).toHaveBeenCalledTimes(1);
  });

  it('refuses to spawn inside a workspace devcontainer', async () => {
    await expect(spawnFlywheel({
      runId: 'RUN-1',
      workspace: '/repo',
      env: { PANOPTICON_DISABLE_DEACON: '1', HOSTNAME: 'workspace-pan-1189' },
    })).rejects.toThrow('Refusing to spawn flywheel-orchestrator inside a workspace devcontainer');

    expect(mocks.spawnRun).not.toHaveBeenCalled();
    expect(mocks.activeRunId).toBeNull();
  });

  it('pauses and resumes while preserving the active run id', async () => {
    await spawnFlywheel({ runId: 'RUN-9', workspace: '/repo', env: cleanEnv });

    await pauseFlywheel();

    expect(mocks.paused).toBe(true);
    expect(mocks.activeRunId).toBe('RUN-9');
    expect(mocks.stopAgentAsync).toHaveBeenCalledWith(FLYWHEEL_ORCHESTRATOR_AGENT_ID);

    const resumed = await resumeFlywheel({ workspace: '/repo', env: cleanEnv });

    expect(resumed.activeRunId).toBe('RUN-9');
    expect(mocks.paused).toBe(false);
    expect(mocks.activeRunId).toBe('RUN-9');
    expect(mocks.spawnRun).toHaveBeenCalledTimes(2);
    expect(mocks.spawnRun).toHaveBeenLastCalledWith('RUN-9', 'flywheel', expect.objectContaining({
      agentId: FLYWHEEL_ORCHESTRATOR_AGENT_ID,
      workspace: '/repo',
      registerConversation: true,
    }));
  });
});
