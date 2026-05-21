import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { Command } from 'commander';

const { mockResolveProjectFromIssue, mockSpawnInspectAgent, mockGetDiffBase, mockGetDiffStats } = vi.hoisted(() => ({
  mockResolveProjectFromIssue: vi.fn(),
  mockSpawnInspectAgent: vi.fn(),
  mockGetDiffBase: vi.fn(),
  mockGetDiffStats: vi.fn(),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
}));

vi.mock('../../../lib/cloister/inspect-agent.js', () => ({
  spawnInspectAgent: mockSpawnInspectAgent,
}));

vi.mock('../../../lib/cloister/inspect-checkpoints.js', () => ({
  getDiffBase: mockGetDiffBase,
  getDiffStats: mockGetDiffStats,
}));

import { inspectCommand, registerInspectCommand } from '../inspect.js';

describe('inspect command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveProjectFromIssue.mockReturnValue({
      projectKey: 'panopticon',
      projectPath: '/repo',
    });
    mockGetDiffBase.mockReturnValue(Effect.succeed('abcdef1234567890'));
    mockGetDiffStats.mockReturnValue(Effect.succeed('1 file changed'));
    mockSpawnInspectAgent.mockResolvedValue({
      success: true,
      runId: 'run-1',
      tmuxSession: 'inspect-pan-1-bead-1',
      message: 'spawned',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns the fast inspector by default', async () => {
    await inspectCommand('pan-1', { bead: 'bead-1', workspace: '/repo/workspaces/feature-pan-1' });

    expect(mockSpawnInspectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'PAN-1',
        beadId: 'bead-1',
        workspace: '/repo/workspaces/feature-pan-1',
      }),
      { deep: false },
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fast'));
  });

  it('passes --deep through to the deep inspector', async () => {
    await inspectCommand('pan-1', { bead: 'bead-1', workspace: '/repo/workspaces/feature-pan-1', deep: true });

    expect(mockSpawnInspectAgent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1', beadId: 'bead-1' }),
      { deep: true },
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deep'));
  });

  it('registers the --deep flag on the CLI command', () => {
    const program = new Command();
    registerInspectCommand(program);

    const inspect = program.commands.find(command => command.name() === 'inspect');
    expect(inspect?.options.map(option => option.long)).toContain('--deep');
  });
});
