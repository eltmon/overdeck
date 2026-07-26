import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  spawnAgent: vi.fn(),
  saveAgentStateSync: vi.fn(),
  getAgentStateSync: vi.fn(() => null as any),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn((_command, _args, _options, callback) => {
    callback(null, {
      stdout: 'API Error: 400 Your input exceeds the context window of this model.\n❯',
      stderr: '',
    });
  }),
}));

vi.mock('../../../lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(),
  getAgentStateSync: mocks.getAgentStateSync,
  saveAgentStateSync: mocks.saveAgentStateSync,
}));

vi.mock('../../../lib/overdeck/control-settings.js', () => ({
  setCloisterSpawnsPausedSync: vi.fn(),
}));

vi.mock('../../../lib/runtimes/index.js', () => ({
  getRuntimeForAgent: vi.fn(() => ({
    name: 'claude-code',
    sendMessage: mocks.sendMessage,
    spawnAgent: mocks.spawnAgent,
  })),
}));

vi.mock('../../../lib/tmux.js', () => ({
  exactPaneTarget: vi.fn((agentId: string) => agentId),
}));

import { pokeAgentWithEscalation, restartAgent } from '../service-crash.js';
import { orchestratedCompactionContinuations } from '../orchestrated-compaction.js';

describe('idle-alive compaction escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orchestratedCompactionContinuations.clear();
  });

  it('stamps crash respawn provenance in state and runtime environment', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2899',
      issueId: 'PAN-2899',
      workspace: '/repo/workspaces/feature-pan-2899',
      sessionId: 'session-1234',
    });

    await restartAgent({} as any, 'agent-pan-2899');

    expect(mocks.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({ startedBy: 'deacon:crash-respawn' }));
    expect(mocks.spawnAgent).toHaveBeenCalledWith(expect.objectContaining({
      env: { OVERDECK_AGENT_STARTED_BY: 'deacon:crash-respawn' },
    }));
  });

  it('registers a continuation before delivering slash compact', async () => {
    const host = {
      config: {},
      crashTrackers: new Map(),
      deathTimestamps: [],
      spawnsPaused: false,
      pokeProgress: new Map(),
      eventStore: null,
      progressFingerprint: vi.fn().mockResolvedValue('same-fingerprint'),
      pokeAgentWithEscalation: vi.fn(),
      checkForMassDeaths: vi.fn(),
      pauseSpawns: vi.fn(),
      emit: vi.fn(),
    } as any;

    await pokeAgentWithEscalation(host, 'agent-pan-2899');
    await pokeAgentWithEscalation(host, 'agent-pan-2899');
    await pokeAgentWithEscalation(host, 'agent-pan-2899');

    expect(mocks.sendMessage).toHaveBeenLastCalledWith('agent-pan-2899', '/compact');
    expect(orchestratedCompactionContinuations.has('agent-pan-2899')).toBe(true);
  });
});
