import { Command } from 'commander';
import { assembleLiveBriefingMarkdown } from '../../lib/briefing-assembler.js';

export interface BriefingCommandOptions {
  cwd?: string;
}

export function createBriefingCommand(): Command {
  return new Command('briefing')
    .description('Print the live Panopticon session briefing markdown')
    .option('--cwd <path>', 'Resolve workspace context from this directory')
    .action(briefingCommandAction);
}

export async function briefingCommandAction(options: BriefingCommandOptions = {}): Promise<void> {
  console.log(await assembleLiveBriefingMarkdown({ cwd: options.cwd }));
}
