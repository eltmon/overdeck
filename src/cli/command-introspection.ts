import type { Command } from 'commander';

export interface CommandInfo {
  /** Command path below the program root, e.g. ["admin", "cloister", "status"]. */
  path: string[];
  aliases: string[];
  description: string;
  /** Declared positional arguments. */
  args: { name: string; required: boolean; variadic: boolean }[];
  /** Declared visible options. */
  options: { flags: string; description: string; required: boolean; valueHint: string | null }[];
  /** True when the command has visible subcommands. */
  hasSubcommands: boolean;
}

function optionValueHint(flags: string): string | null {
  const match = flags.match(/<([^>]+)>|\[([^\]]+)\]/);
  return match?.[1] ?? match?.[2] ?? null;
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
        aliases: command.aliases(),
        description: command.description(),
        args: command.registeredArguments.map(argument => ({
          name: argument.name(),
          required: argument.required,
          variadic: argument.variadic,
        })),
        options: command.options
          .filter(option => !option.hidden)
          .map(option => ({
            flags: option.flags,
            description: option.description,
            required: option.required,
            valueHint: optionValueHint(option.flags),
          })),
        hasSubcommands: visibleSubcommands.length > 0,
      });

      visit(command, path);
    }
  };

  visit(root, []);
  return commands;
}
