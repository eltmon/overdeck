import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  COMMAND_GROUPS,
  CommandGroupLoader,
  resolveGroupDemand,
  type CommandGroup,
  type CommandGroupKey,
} from '../../../src/cli/command-groups.js';

const argv = (...args: string[]) => ['node', 'pan', ...args];

describe('resolveGroupDemand', () => {
  it('needs no group for --version', () => {
    expect(resolveGroupDemand(argv('--version'))).toBe('none');
    expect(resolveGroupDemand(argv('-V'))).toBe('none');
  });

  it('needs every group for root help, root options and a bare program', () => {
    expect(resolveGroupDemand(argv())).toBe('all');
    expect(resolveGroupDemand(argv('--help'))).toBe('all');
    expect(resolveGroupDemand(argv('-h', 'task'))).toBe('all');
    expect(resolveGroupDemand(argv('help'))).toBe('all');
    expect(resolveGroupDemand(argv('--bogus', 'task'))).toBe('all');
  });

  it('needs every group for `admin commands`, which walks the whole tree', () => {
    expect(resolveGroupDemand(argv('admin', 'commands', '--json'))).toBe('all');
  });

  it('names the invoked top-level command', () => {
    expect(resolveGroupDemand(argv('task', 'done', 'PAN-1', '1'))).toEqual({ name: 'task' });
    expect(resolveGroupDemand(argv('help', 'task'))).toEqual({ name: 'task' });
    expect(resolveGroupDemand(argv('admin', 'specialists', 'done'))).toEqual({ name: 'admin' });
  });
});

describe('COMMAND_GROUPS', () => {
  it('declares exactly the top-level names and aliases each group registers', async () => {
    for (const [key, entry] of Object.entries(COMMAND_GROUPS)) {
      const group = entry as CommandGroup;
      const program = new Command();
      group.register(await group.load(), program);
      const registered = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
      expect({ key, names: [...registered].sort() }).toEqual({ key, names: [...group.names].sort() });
    }
  }, 60_000);
});

describe('CommandGroupLoader', () => {
  const keys = Object.keys(COMMAND_GROUPS) as CommandGroupKey[];
  const topLevelNames = (program: Command) => program.commands.map((command) => command.name());

  it('registers only the group that owns the invoked name', async () => {
    const program = new Command();
    const loader = new CommandGroupLoader(program, { name: 'task' });
    for (const key of keys) await loader.register(key);
    await loader.finish();
    expect(topLevelNames(program)).toEqual(['task']);
  }, 60_000);

  it('registers nothing for --version', async () => {
    const program = new Command();
    const loader = new CommandGroupLoader(program, 'none');
    for (const key of keys) await loader.register(key);
    await loader.finish();
    expect(program.commands).toEqual([]);
  });

  it('registers every group when the invoked name matches no command', async () => {
    const program = new Command();
    const loader = new CommandGroupLoader(program, { name: 'no-such-command' });
    for (const key of keys) await loader.register(key);
    expect(program.commands).toEqual([]);
    await loader.finish();
    expect(topLevelNames(program)).toContain('task');
    expect(topLevelNames(program)).toContain('admin');
  }, 60_000);

  it('keeps registration order when every group is needed', async () => {
    const program = new Command();
    const loader = new CommandGroupLoader(program, 'all');
    for (const key of keys) await loader.register(key);
    const expected: string[] = [];
    for (const entry of Object.values(COMMAND_GROUPS)) {
      const group = entry as CommandGroup;
      const probe = new Command();
      group.register(await group.load(), probe);
      expected.push(...topLevelNames(probe));
    }
    expect(topLevelNames(program)).toEqual(expected);
  }, 60_000);
});
