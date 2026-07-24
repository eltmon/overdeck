import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { collectCommandTree } from '../../command-introspection.js';

function buildProgram(): Command {
  const program = new Command();
  program.name('pan');

  program.command('alpha').description('First visible command');

  const admin = program.command('admin').description('Administrative commands');
  const cloister = admin.command('cloister').description('Manage the lifecycle watchdog');
  cloister.command('status').description('Show watchdog status');
  cloister.command('secret', { hidden: true }).description('Hidden implementation detail');

  program.command('kill <id>').description('Stop an agent');
  return program;
}

describe('collectCommandTree', () => {
  it('returns visible command paths depth-first in registration order', () => {
    const tree = collectCommandTree(buildProgram());

    expect(tree.map(command => command.path)).toEqual([
      ['alpha'],
      ['admin'],
      ['admin', 'cloister'],
      ['admin', 'cloister', 'status'],
      ['kill'],
    ]);
    expect(tree.map(command => command.path)).not.toContainEqual(['admin', 'cloister', 'secret']);
    expect(tree.map(command => command.path)).not.toContainEqual(['help']);
    expect(tree.find(command => command.path.join(' ') === 'admin')?.hasSubcommands).toBe(true);
    expect(tree.find(command => command.path.join(' ') === 'alpha')?.hasSubcommands).toBe(false);
  });

  it('returns positional argument metadata', () => {
    const kill = collectCommandTree(buildProgram())
      .find(command => command.path.join(' ') === 'kill');

    expect(kill?.args).toEqual([
      { name: 'id', required: true, variadic: false },
    ]);
  });
});
