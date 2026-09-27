import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  CommandGroupLoader,
  resolveGroupDemand,
  type CommandGroup,
  type ErasedCommandGroup,
} from '../../../src/cli/command-group-loader.js';
import { COMMAND_GROUPS, type CommandGroupKey } from '../../../src/cli/command-groups.js';
import { ADMIN_COMMAND_GROUPS } from '../../../src/cli/commands/admin/index.js';

const argv = (...args: string[]) => ['node', 'pan', ...args];
const topLevelNames = (command: Command) => command.commands.map((child) => child.name());

async function registerAll(groups: Record<string, ErasedCommandGroup>, parent: Command): Promise<void> {
  for (const entry of Object.values(groups)) {
    const group = entry as CommandGroup;
    await group.register(await group.load(), parent, 'all');
  }
}

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

  it('names the invoked subcommand below a parent path', () => {
    expect(resolveGroupDemand(argv('admin', 'specialists', 'done'), ['admin'])).toEqual({ name: 'specialists' });
    expect(resolveGroupDemand(argv('admin', 'help', 'db'), ['admin'])).toEqual({ name: 'db' });
    expect(resolveGroupDemand(argv('admin'), ['admin'])).toBe('all');
    expect(resolveGroupDemand(argv('admin', '--help'), ['admin'])).toBe('all');
    expect(resolveGroupDemand(argv('help', 'admin', 'db'), ['admin'])).toBe('all');
  });
});

describe.each([
  { label: 'COMMAND_GROUPS', groups: COMMAND_GROUPS as Record<string, ErasedCommandGroup> },
  { label: 'ADMIN_COMMAND_GROUPS', groups: ADMIN_COMMAND_GROUPS as Record<string, ErasedCommandGroup> },
])('$label', ({ groups }) => {
  it('declares exactly the names and aliases each group registers', async () => {
    for (const [key, entry] of Object.entries(groups)) {
      const group = entry as CommandGroup;
      const parent = new Command();
      await group.register(await group.load(), parent, 'all');
      const registered = parent.commands.flatMap((command) => [command.name(), ...command.aliases()]);
      expect({ key, names: [...registered].sort() }).toEqual({ key, names: [...group.names].sort() });
    }
  }, 60_000);
});

describe('CommandGroupLoader', () => {
  const keys = Object.keys(COMMAND_GROUPS) as CommandGroupKey[];

  async function registerWith(demand: ConstructorParameters<typeof CommandGroupLoader>[1]): Promise<{
    program: Command;
    loader: CommandGroupLoader<CommandGroupKey>;
  }> {
    const program = new Command();
    const loader = new CommandGroupLoader(program, demand, COMMAND_GROUPS);
    for (const key of keys) await loader.register(key);
    return { program, loader };
  }

  it('registers only the group that owns the invoked name', async () => {
    const { program, loader } = await registerWith({ name: 'task' });
    await loader.finish();
    expect(topLevelNames(program)).toEqual(['task']);
  }, 60_000);

  it('registers nothing for --version', async () => {
    const { program, loader } = await registerWith('none');
    await loader.finish();
    expect(program.commands).toEqual([]);
  });

  it('registers every group when the invoked name matches no command', async () => {
    const { program, loader } = await registerWith({ name: 'no-such-command' });
    expect(program.commands).toEqual([]);
    await loader.finish();
    expect(topLevelNames(program)).toContain('task');
    expect(topLevelNames(program)).toContain('admin');
  }, 60_000);

  it('keeps registration order when every group is needed', async () => {
    const { program } = await registerWith('all');
    const expected = new Command();
    await registerAll(COMMAND_GROUPS as Record<string, ErasedCommandGroup>, expected);
    expect(topLevelNames(program)).toEqual(topLevelNames(expected));
  }, 60_000);

  it('skips unrelated admin subgroups for `pan admin specialists done`', async () => {
    const { registerAdminCommands } = await import('../../../src/cli/commands/admin/index.js');
    const program = new Command();
    await registerAdminCommands(program, { name: 'specialists' });
    const admin = program.commands.find((command) => command.name() === 'admin');
    expect(admin && topLevelNames(admin)).toContain('specialists');
    expect(admin && topLevelNames(admin)).not.toContain('db');
  }, 60_000);
});
