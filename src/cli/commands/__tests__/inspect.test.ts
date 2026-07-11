import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { mockResolveProjectFromIssue, mockSpawnInspectAgent, mockGetDiffBase, mockGetDiffStats, mockReadWorkspacePlanSync, mockExecFileAsync } = vi.hoisted(() => ({
  mockResolveProjectFromIssue: vi.fn(),
  mockSpawnInspectAgent: vi.fn(),
  mockGetDiffBase: vi.fn(),
  mockGetDiffStats: vi.fn(),
  mockReadWorkspacePlanSync: vi.fn(),
  mockExecFileAsync: vi.fn(),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
}));

vi.mock('../../../lib/cloister/inspect-agent.js', () => ({
  spawnInspectAgent: mockSpawnInspectAgent,
}));

vi.mock('../../../lib/cloister/inspect-checkpoints.js', () => ({
  getDiffBase: mockGetDiffBase,
  getDiffStats: mockGetDiffStats,
}));

vi.mock('../../../lib/vbrief/io.js', () => ({
  readWorkspacePlanSync: mockReadWorkspacePlanSync,
}));

vi.mock('child_process', () => {
  function execFile(): void {
    throw new Error('execFile callback form is not used in inspect command tests');
  }

  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mockExecFileAsync;
  return { execFile };
});

import { inspectCommand, registerInspectCommand, resolveInspectBead } from '../inspect.js';

describe('inspect command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveProjectFromIssue.mockReturnValue({
      projectKey: 'overdeck',
      projectPath: '/repo',
    });
    mockGetDiffBase.mockReturnValue(Effect.succeed('abcdef1234567890'));
    mockGetDiffStats.mockReturnValue(Effect.succeed('1 file changed'));
    mockReadWorkspacePlanSync.mockReturnValue(null);
    mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify({ title: 'bead title' }), stderr: '' });
    mockSpawnInspectAgent.mockReturnValue(Effect.succeed({
      success: true,
      runId: 'run-1',
      tmuxSession: 'inspect-pan-1-bead-1',
      message: 'spawned',
    }));
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

  it('resolves a bd bead id to its vBRIEF item id before spawning', async () => {
    mockReadWorkspacePlanSync.mockReturnValue(planDoc([
      planItem('mnemos-installer', 'mnemos installer'),
    ]));
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'workspace-d6tzf',
        title: 'pan-1: mnemos installer',
        metadata: {},
      }),
      stderr: '',
    });

    await inspectCommand('pan-1', { bead: 'workspace-d6tzf', workspace: '/repo/workspaces/feature-pan-1' });

    expect(mockSpawnInspectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        beadId: 'mnemos-installer',
        trackerBeadId: 'workspace-d6tzf',
      }),
      { deep: false },
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mnemos-installer'));
  });

  it('uses bead metadata vbriefItemId when present', async () => {
    mockReadWorkspacePlanSync.mockReturnValue(planDoc([
      planItem('fix-harness-policy-api-key', 'Fix harness policy API key'),
    ]));
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'workspace-d549r',
        title: 'pan-1: stale title',
        metadata: { vbriefItemId: 'fix-harness-policy-api-key' },
      }),
      stderr: '',
    });

    await expect(resolveInspectBead('workspace-d549r', '/repo/workspaces/feature-pan-1')).resolves.toEqual({
      itemId: 'fix-harness-policy-api-key',
      trackerBeadId: 'workspace-d549r',
    });
  });

  it('registers the --deep flag on the CLI command', () => {
    const program = new Command();
    registerInspectCommand(program);

    const inspect = program.commands.find(command => command.name() === 'inspect');
    expect(inspect?.options.map(option => option.long)).toContain('--deep');
  });
});

function planItem(id: string, title: string) {
  return {
    id,
    title,
    status: 'pending',
  };
}

function planDoc(items: ReturnType<typeof planItem>[]) {
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: '2026-07-09T00:00:00Z',
    },
    plan: {
      id: 'pan-1',
      title: 'Test plan',
      status: 'approved',
      items,
      edges: [],
    },
  };
}
