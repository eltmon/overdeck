import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
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
  getAgentStateSync: vi.fn(() => null),
}));

vi.mock('../../../lib/overdeck/control-settings.js', () => ({
  setCloisterSpawnsPausedSync: vi.fn(),
}));

vi.mock('../../../lib/runtimes/index.js', () => ({
  getRuntimeForAgent: vi.fn(() => ({
    sendMessage: mocks.sendMessage,
  })),
}));

vi.mock('../../../lib/tmux.js', () => ({
  exactPaneTarget: vi.fn((agentId: string) => agentId),
}));

import { pokeAgentWithEscalation } from '../service-crash.js';
import { orchestratedCompactionContinuations } from '../orchestrated-compaction.js';

describe('idle-alive compaction escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orchestratedCompactionContinuations.clear();
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
