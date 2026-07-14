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

  it('rejects ids absent from the vBRIEF without a tracker fallback', async () => {
    await expect(resolveInspectItem('legacy-task', '/repo/workspaces/feature-pan-1')).rejects.toThrow('does not exist');
  });
});
