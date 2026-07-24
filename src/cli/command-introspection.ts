import type { Command } from 'commander';

export interface CommandInfo {
  /** Command path below the program root, e.g. ["admin", "cloister", "status"]. */
  path: string[];
  description: string;
  /** Declared positional arguments. */
  args: { name: string; required: boolean; variadic: boolean }[];
  /** True when the command has visible subcommands. */
  hasSubcommands: boolean;
}

export function collectCommandTree(root: Command): CommandInfo[] {
  const help = root.createHelp();
  const commands: CommandInfo[] = [];

  const visit = (parent: Command, parentPath: string[]): void => {
    for (const command of help.visibleCommands(parent)) {
      if (command.name() === 'help') continue;

      const path = [...parentPath, command.name()];
      const visibleSubcommands = help
        .visibleCommands(command)
        .filter(subcommand => subcommand.name() !== 'help');

      commands.push({
        path,
        description: command.description(),
        args: command.registeredArguments.map(argument => ({
          name: argument.name(),
          required: argument.required,
          variadic: argument.variadic,
        })),
        hasSubcommands: visibleSubcommands.length > 0,
      });

      visit(command, path);
    }
  };

  visit(root, []);
  return commands;
}
