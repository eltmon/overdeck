import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), spawn: vi.fn(), readPlan: vi.fn() }));
vi.mock('../../../lib/projects.js', () => ({ resolveProjectFromIssueSync: mocks.resolve }));
vi.mock('../../../lib/cloister/inspect-agent.js', () => ({ spawnInspectAgent: mocks.spawn }));
vi.mock('../../../lib/cloister/inspect-checkpoints.js', () => ({ getDiffBase: () => Effect.succeed('abc'), getDiffStats: () => Effect.succeed('1 file') }));
vi.mock('../../../lib/vbrief/io.js', () => ({ readWorkspacePlanSync: mocks.readPlan }));

import { inspectCommand, resolveInspectItem } from '../inspect.js';

describe('inspect command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.resolve.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
    mocks.readPlan.mockReturnValue({ plan: { id: 'PAN-1', items: [{ id: 'PAN-1-a', title: 'A', status: 'completed' }], edges: [] } });
    mocks.spawn.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));
  });

  it('spawns inspection with the vBRIEF item id', async () => {
    await inspectCommand('pan-1', { item: 'PAN-1-a', workspace: '/repo/workspaces/feature-pan-1' });
    expect(mocks.spawn).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'PAN-1', itemId: 'PAN-1-a' }), { deep: false });
  });

  it('passes deep inspection through', async () => {
    await inspectCommand('pan-1', { item: 'PAN-1-a', workspace: '/repo/workspaces/feature-pan-1', deep: true });
    expect(mocks.spawn).toHaveBeenCalledWith(expect.anything(), { deep: true });
  });

  it('omits the run id when inspection is routed to the standing supervisor', async () => {
    mocks.spawn.mockReturnValue(Effect.succeed({
      success: true,
      message: 'routed',
      tmuxSession: 'agent-pan-1-review-supervisor',
    }));

    await inspectCommand('pan-1', { item: 'PAN-1-a', workspace: '/repo/workspaces/feature-pan-1' });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Session: agent-pan-1-review-supervisor');
    expect(output).not.toContain('Run ID:');
    expect(output).not.toContain('undefined');
  });

  it('prints the run id for a dedicated inspection session', async () => {
    mocks.spawn.mockReturnValue(Effect.succeed({
      success: true,
      message: 'spawned',
      tmuxSession: 'inspect-pan-1-pan-1-a',
      runId: 'inspect-run-123',
    }));

    await inspectCommand('pan-1', { item: 'PAN-1-a', workspace: '/repo/workspaces/feature-pan-1' });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Session: inspect-pan-1-pan-1-a');
    expect(output).toContain('Run ID:  inspect-run-123');
  });

  it('rejects ids absent from the vBRIEF without a tracker fallback', async () => {
    await expect(resolveInspectItem('legacy-task', '/repo/workspaces/feature-pan-1')).rejects.toThrow('does not exist');
  });
});
