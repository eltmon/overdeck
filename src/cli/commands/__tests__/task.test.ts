import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  readRecord: vi.fn(),
  readPlan: vi.fn(),
}));

vi.mock('../../../lib/pan-dir/task-door.js', () => ({ applyTaskStatusChange: mocks.apply }));
vi.mock('../../../lib/pan-dir/record.js', () => ({ readIssueRecordSync: mocks.readRecord }));
vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectKey: 'test', projectPath: '/tmp/test' }),
  getProjectSync: () => ({ name: 'test', path: '/tmp/test' }),
}));
vi.mock('../../../lib/xbrief/io.js', () => ({ readWorkspacePlanSync: mocks.readPlan }));

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
    mocks.readPlan.mockReturnValue({ plan: { id: 'PAN-1', items: [item], edges: [] } });
    mocks.readRecord.mockReturnValue({ tasks: { sequence: 0, claims: {} } });
    mocks.apply.mockImplementation(async (_project, issueId, operation) => ({ issueId, itemId: operation.itemId, status: 'running', sequence: 1 }));
  });

  it('registers exactly the eight task verbs', () => {
    expect(program().commands[0].commands.map((command) => command.name())).toEqual([
      'next', 'show', 'claim', 'done', 'block', 'unblock', 'reopen', 'cancel',
    ]);
  });

  it.each([
    ['claim', []],
    ['done', []],
    ['block', ['--reason', 'waiting']],
    ['unblock', []],
    ['reopen', ['--reason', 'falsely completed']],
    ['cancel', ['--reason', 'removed']],
  ])('routes %s through the task write door', async (verb, flags) => {
    await program().parseAsync(['node', 'pan', 'task', verb, 'PAN-1', 'PAN-1-a', ...flags]);
    expect(mocks.apply).toHaveBeenCalledWith(expect.anything(), 'PAN-1', expect.objectContaining({ type: verb, itemId: 'PAN-1-a' }));
  });

  it('passes CAS and force options to the write door', async () => {
    await program().parseAsync(['node', 'pan', 'task', 'done', 'PAN-1', 'PAN-1-a', '--expected-sequence', '3', '--force', '--reason', 'recovery']);
    expect(mocks.apply).toHaveBeenCalledWith(expect.anything(), 'PAN-1', expect.objectContaining({ expectedSequence: 3, force: true, reason: 'recovery' }));
  });

  it('reads next and show without calling the write door', async () => {
    await program().parseAsync(['node', 'pan', 'task', 'next', 'PAN-1', '--json']);
    await program().parseAsync(['node', 'pan', 'task', 'show', 'PAN-1', 'PAN-1-a', '--json']);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(2);
  });
});
