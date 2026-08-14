import { describe, expect, it, vi } from 'vitest';
import {
  ensureSwarmForeman,
  type EnsureSwarmForemanDeps,
} from '../../../../src/cli/commands/swarm.js';

function deps(sessions: string[] = []): EnsureSwarmForemanDeps {
  return {
    listSessionNamesSync: vi.fn(() => sessions),
    messageAgent: vi.fn(async () => undefined),
    buildWorkAgentPrompt: vi.fn(async () => 'foreman kickoff'),
    spawnRun: vi.fn(async (_issueId, _role, options) => ({
      id: 'agent-pan-3680',
      issueId: 'PAN-3680',
      workspace: options.workspace!,
      role: 'work',
      foreman: options.foreman,
      model: 'resolved-by-cloister',
      status: 'running',
      startedAt: '2026-08-13T00:00:00Z',
    })),
    resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
  } as unknown as EnsureSwarmForemanDeps;
}

describe('swarm foreman spawn gate', () => {
  it('spawns the bare parent work agent with a durable foreman marker and no model override', async () => {
    const fakeDeps = deps();

    const actions = await ensureSwarmForeman(
      'PAN-3680',
      '/repo/workspaces/feature-pan-3680',
      { startedBy: 'cli:swarm' },
      fakeDeps,
    );

    expect(actions).toEqual(['[swarm] spawned foreman agent-pan-3680 for PAN-3680']);
    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-3680', 'work', {
      workspace: '/repo/workspaces/feature-pan-3680',
      prompt: 'foreman kickoff',
      foreman: true,
      startedBy: 'cli:swarm',
    });
    expect(vi.mocked(fakeDeps.spawnRun).mock.calls[0]?.[2]).not.toHaveProperty('model');
  });

  it('messages a live foreman instead of spawning a duplicate', async () => {
    const fakeDeps = deps(['agent-pan-3680']);

    const actions = await ensureSwarmForeman(
      'pan-3680',
      '/repo/workspaces/feature-pan-3680',
      { startedBy: 'cli:swarm' },
      fakeDeps,
    );

    expect(actions).toEqual(['[swarm] attached to live foreman agent-pan-3680 for PAN-3680']);
    expect(fakeDeps.messageAgent).toHaveBeenCalledWith(
      'agent-pan-3680',
      expect.stringContaining('pan swarm status PAN-3680 --json'),
      'pan-swarm',
    );
    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
  });
});
