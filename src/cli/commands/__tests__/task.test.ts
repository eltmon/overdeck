import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ItemNotVerifiable: class ItemNotVerifiable extends Error {},
  claimItem: vi.fn(),
  markItemDone: vi.fn(),
  setItemStatus: vi.fn(),
  readContinueState: vi.fn(),
  readPlan: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectKey: 'test', projectPath: '/tmp/test' }),
  getProjectSync: () => ({ name: 'test', path: '/tmp/test' }),
}));
vi.mock('../../../lib/pan-dir/paths.js', () => ({ resolvePlanHome: (p: string) => p }));
vi.mock('../../../lib/xbrief/io.js', () => ({ readWorkspacePlanSync: mocks.readPlan }));
vi.mock('../../../lib/xbrief/continue-state.js', () => ({
  claimItem: mocks.claimItem,
  markItemDone: mocks.markItemDone,
  setItemStatus: mocks.setItemStatus,
  readContinueState: mocks.readContinueState,
  ItemNotVerifiable: mocks.ItemNotVerifiable,
}));
vi.mock('../../../lib/overdeck/plan-artifact-commit.js', () => ({
  commitPlanArtifacts: mocks.commit,
  planArtifactCommitMessage: (id: string) => `chore(workspace): plan artifacts for ${id}`,
}));

import { registerTaskCommands } from '../task.js';

const item = { id: 'PAN-1-a', title: 'A', status: 'pending', subItems: [] };

function program(): Command {
  const command = new Command().exitOverride();
  registerTaskCommands(command);
  return command;
}

describe('pan task CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
    mocks.readPlan.mockReturnValue({ plan: { id: 'PAN-1', items: [item], edges: [] } });
    mocks.readContinueState.mockReturnValue({ items: {} });
    mocks.claimItem.mockReturnValue({ status: 'in_progress', claimedBy: 'agent-pan-1' });
    mocks.markItemDone.mockResolvedValue({ status: 'completed', doneAt: 'now' });
    mocks.commit.mockResolvedValue({ committed: true, sha: 'abc' });
  });

  it('registers exactly the eight task verbs', () => {
    expect(program().commands[0].commands.map((command) => command.name())).toEqual([
      'next', 'show', 'claim', 'done', 'block', 'unblock', 'reopen', 'cancel',
    ]);
  });

  it('claim records the claim in the continue file and commits it', async () => {
    await program().parseAsync(['node', 'pan', 'task', 'claim', 'PAN-1', 'PAN-1-a']);
    expect(mocks.claimItem).toHaveBeenCalledWith('/tmp/test/workspaces/feature-pan-1', 'PAN-1', 'PAN-1-a', expect.any(String));
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/test/workspaces/feature-pan-1' }));
  });

  it('done requires the Item trailer and a pushed branch', async () => {
    await program().parseAsync(['node', 'pan', 'task', 'done', 'PAN-1', 'PAN-1-a']);
    expect(mocks.markItemDone).toHaveBeenCalledWith(
      '/tmp/test/workspaces/feature-pan-1',
      'PAN-1',
      'PAN-1-a',
      { requireTrailer: 'Item: PAN-1-a', requirePushed: true },
    );
    expect(mocks.commit).toHaveBeenCalled();
  });

  it('done refuses in plain English and writes nothing when git cannot corroborate it', async () => {
    mocks.markItemDone.mockRejectedValue(new mocks.ItemNotVerifiable('the branch is 2 commit(s) ahead of its upstream'));
    const errors: string[] = [];
    vi.mocked(console.error).mockImplementation((message: unknown) => { errors.push(String(message)); });

    await program().parseAsync(['node', 'pan', 'task', 'done', 'PAN-1', 'PAN-1-a']);

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('is not done yet');
    expect(errors.join('\n')).toContain('Item: PAN-1-a');
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['block', 'blocked'],
    ['unblock', 'pending'],
    ['reopen', 'pending'],
    ['cancel', 'cancelled'],
  ])('%s writes the item status into the continue file', async (verb, status) => {
    await program().parseAsync(['node', 'pan', 'task', verb, 'PAN-1', 'PAN-1-a']);
    expect(mocks.setItemStatus).toHaveBeenCalledWith(expect.any(String), 'PAN-1', 'PAN-1-a', status);
  });

  it('reads next and show without writing', async () => {
    await program().parseAsync(['node', 'pan', 'task', 'next', 'PAN-1']);
    await program().parseAsync(['node', 'pan', 'task', 'show', 'PAN-1', 'PAN-1-a']);
    expect(mocks.claimItem).not.toHaveBeenCalled();
    expect(mocks.markItemDone).not.toHaveBeenCalled();
    expect(mocks.setItemStatus).not.toHaveBeenCalled();
  });
});
