import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn(async (..._args: unknown[]) => undefined);
  return {
    loginCommand: fn(),
    statusCommand: fn(),
    logoutCommand: fn(),
  };
});
vi.mock('../../../../src/cli/commands/account/login.js', () => ({ loginCommand: mocks.loginCommand }));
vi.mock('../../../../src/cli/commands/account/status.js', () => ({ statusCommand: mocks.statusCommand }));
vi.mock('../../../../src/cli/commands/account/logout.js', () => ({ logoutCommand: mocks.logoutCommand }));

import { registerAccountCommands } from '../../../../src/cli/commands/account/index.js';

function program(): Command {
  const root = new Command();
  root.exitOverride();
  registerAccountCommands(root);
  return root;
}

function leafPaths(command: Command, path: string[] = []): { path: string[]; command: Command }[] {
  const here = [...path, command.name()];
  if (command.commands.length === 0) return [{ path: here, command }];
  return command.commands.flatMap((sub) => leafPaths(sub, here));
}

const accountLeaves = leafPaths(program().commands.find((c) => c.name() === 'account')!);

describe('pan account Commander wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the verbs this test mocks', () => {
    expect(accountLeaves.length).toBe(Object.keys(mocks).length);
  });

  it.each(accountLeaves.map((leaf) => [leaf.path.join(' '), leaf] as const))(
    '%s never passes Commander\'s Command to its implementation',
    async (_name, leaf) => {
      await program().parseAsync(['node', 'pan', ...leaf.path]);

      const called = Object.values(mocks).filter((mock) => mock.mock.calls.length > 0);
      expect(called).toHaveLength(1);
      const args = called[0]!.mock.calls[0]!;
      expect(args.some((arg) => arg instanceof Command)).toBe(false);
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe('object');
    },
  );

  it('routes "account login --base-url <url>" to loginCommand with { baseUrl } (ac1)', async () => {
    await program().parseAsync(['node', 'pan', 'account', 'login', '--base-url', 'http://127.0.0.1:8787']);
    expect(mocks.loginCommand.mock.calls[0]).toEqual([{ baseUrl: 'http://127.0.0.1:8787' }]);
  });

  it('routes "account status --json" to statusCommand with { json: true } (ac1)', async () => {
    await program().parseAsync(['node', 'pan', 'account', 'status', '--json']);
    expect(mocks.statusCommand.mock.calls[0]).toEqual([{ json: true }]);
  });
});
