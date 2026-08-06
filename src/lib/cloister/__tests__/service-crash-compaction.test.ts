import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  spawnAgent: vi.fn(),
  saveAgentStateSync: vi.fn(),
  getAgentStateSync: vi.fn(() => null as any),
  isRunning: vi.fn(() => true),
  setAgentPausedSync: vi.fn(),
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
    isRunning: mocks.isRunning,
  })),
}));

vi.mock('../../agents/agent-state.js', () => ({
  setAgentPausedSync: mocks.setAgentPausedSync,
}));

vi.mock('../../../lib/tmux.js', () => ({
  exactPaneTarget: vi.fn((agentId: string) => agentId),
}));

import { pokeAgentWithEscalation, restartAgent } from '../service-crash.js';
import { orchestratedCompactionContinuations } from '../orchestrated-compaction.js';

describe('idle-alive compaction escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRunning.mockReturnValue(true);
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

  it('escalates to the reconstruct nudge — never a forced /compact (PAN-3334)', async () => {
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

    const lastMessage = mocks.sendMessage.mock.lastCall?.[1] as string;
    expect(lastMessage).toContain('no observable progress');
    expect(lastMessage).not.toBe('/compact');
    // No orchestrated compact was delivered, so no continuation is registered.
    expect(orchestratedCompactionContinuations.has('agent-pan-2899')).toBe(false);
  });

  it('never pokes or escalates a stopped agent — a boot gate is not an idle-alive stall', async () => {
    mocks.isRunning.mockReturnValue(false);
    const host = {
      config: {},
      crashTrackers: new Map(),
      deathTimestamps: [],
      spawnsPaused: false,
      pokeProgress: new Map([['agent-pan-2899', { fingerprint: 'same', ineffective: 4 }]]),
      eventStore: null,
      progressFingerprint: vi.fn().mockResolvedValue('same'),
      pokeAgentWithEscalation: vi.fn(),
      checkForMassDeaths: vi.fn(),
      pauseSpawns: vi.fn(),
      emit: vi.fn(),
    } as any;

    // Five cycles: enough to trip tier 3 if the escalation counted them.
    for (let i = 0; i < 5; i++) await pokeAgentWithEscalation(host, 'agent-pan-2899');

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.setAgentPausedSync).not.toHaveBeenCalled();
    expect(host.emit).not.toHaveBeenCalled();
    // The stale ineffective streak is cleared, not carried into the next run.
    expect(host.pokeProgress.has('agent-pan-2899')).toBe(false);
  });

  it('does not report a poke that failed to deliver', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('blocked choice menu'));
    const host = {
      config: {},
      crashTrackers: new Map(),
      deathTimestamps: [],
      spawnsPaused: false,
      pokeProgress: new Map(),
      eventStore: null,
      progressFingerprint: vi.fn().mockResolvedValue('fp'),
      pokeAgentWithEscalation: vi.fn(),
      checkForMassDeaths: vi.fn(),
      pauseSpawns: vi.fn(),
      emit: vi.fn(),
    } as any;

    await pokeAgentWithEscalation(host, 'agent-pan-2899');

    expect(mocks.sendMessage).toHaveBeenCalled();
    expect(host.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'poked_agent' }));
  });
});
