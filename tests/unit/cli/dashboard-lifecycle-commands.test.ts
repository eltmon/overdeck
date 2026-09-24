/**
 * PAN-3912: `pan restart status` used to fall through to a real dashboard
 * restart request, because Commander 12 accepts excess positionals by
 * default. `pan up`, `pan reload` and `pan restart` take no positionals and
 * must reject one before their action (and its side effects) runs.
 *
 * The actions are mocked: these tests exercise only the command parser.
 */

import { Command, CommanderError } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restartCommand: vi.fn(async () => {}),
  restartApproveCommand: vi.fn(async () => {}),
  reloadCommand: vi.fn(async () => {}),
  upAction: vi.fn(async () => {}),
}));

vi.mock('../../../src/cli/commands/restart.js', () => ({
  restartCommand: mocks.restartCommand,
  restartApproveCommand: mocks.restartApproveCommand,
}));
vi.mock('../../../src/cli/commands/reload.js', () => ({ reloadCommand: mocks.reloadCommand }));

const { defineUpCommand, registerReloadAndRestartCommands } = await import(
  '../../../src/cli/commands/dashboard-lifecycle-commands.js'
);

function program(): { root: Command; stderr: string[] } {
  const stderr: string[] = [];
  const root = new Command();
  root.exitOverride();
  root.configureOutput({ writeOut: () => {}, writeErr: (s) => stderr.push(s) });
  defineUpCommand(root).action(mocks.upAction);
  registerReloadAndRestartCommands(root);
  return { root, stderr };
}

async function parse(...args: string[]): Promise<{ error: unknown; stderr: string }> {
  const { root, stderr } = program();
  try {
    await root.parseAsync(['node', 'pan', ...args]);
    return { error: undefined, stderr: stderr.join('') };
  } catch (error) {
    return { error, stderr: stderr.join('') };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dashboard lifecycle verbs reject stray positionals (PAN-3912)', () => {
  it('pan restart status errors without filing a restart and lists the subcommands', async () => {
    const { error, stderr } = await parse('restart', 'status');

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.excessArguments');
    expect((error as CommanderError).exitCode).toBe(1);
    expect(mocks.restartCommand).not.toHaveBeenCalled();
    expect(mocks.restartApproveCommand).not.toHaveBeenCalled();
    expect(stderr).toMatch(/too many arguments for 'restart'/);
    expect(stderr).toMatch(/approve/);
  });

  it('pan restart approve extra errors without approving anything', async () => {
    const { error } = await parse('restart', 'approve', 'extra');

    expect((error as CommanderError).code).toBe('commander.excessArguments');
    expect(mocks.restartApproveCommand).not.toHaveBeenCalled();
  });

  it('pan reload <stray> errors without building or restarting', async () => {
    const { error } = await parse('reload', 'status');

    expect((error as CommanderError).code).toBe('commander.excessArguments');
    expect(mocks.reloadCommand).not.toHaveBeenCalled();
  });

  it('pan up <stray> errors without starting the stack', async () => {
    const { error } = await parse('up', 'status');

    expect((error as CommanderError).code).toBe('commander.excessArguments');
    expect(mocks.upAction).not.toHaveBeenCalled();
  });

  it('still dispatches valid invocations', async () => {
    expect((await parse('restart', '--dashboard')).error).toBeUndefined();
    expect(mocks.restartCommand).toHaveBeenCalledTimes(1);
    expect(mocks.restartCommand.mock.calls[0][0]).toMatchObject({ dashboard: true });

    expect((await parse('restart', 'approve')).error).toBeUndefined();
    expect(mocks.restartApproveCommand).toHaveBeenCalledTimes(1);

    expect((await parse('reload', '--skip-build')).error).toBeUndefined();
    expect(mocks.reloadCommand).toHaveBeenCalledTimes(1);

    expect((await parse('up', '--detach')).error).toBeUndefined();
    expect(mocks.upAction).toHaveBeenCalledTimes(1);
  });
});
