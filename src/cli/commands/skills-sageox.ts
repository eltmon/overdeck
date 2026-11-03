/**
 * `pan skills pack sageox link` (PAN-4852 WI-14).
 *
 *   pan skills pack sageox link --project <key> [--team <team>]
 *
 * `skills.ts` registers these on its `sageox` command. Like `skills.ts`, this
 * module imports only Commander types and chalk statically; the SageOx logic
 * loads inside each handler.
 */
import chalk from 'chalk';
import type { Command } from 'commander';

interface SageoxLinkOptions { project: string; team?: string }

export async function skillsPackSageoxLinkCommand(options: SageoxLinkOptions): Promise<void> {
  const { linkSageoxProject, SageoxLinkError } = await import('../../lib/sageox/link.js');
  let result;
  try {
    result = await linkSageoxProject(options.project, { team: options.team });
  } catch (error) {
    if (error instanceof SageoxLinkError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }
  switch (result.status) {
    case 'linked':
      console.log(`linked ${options.project}: ${result.files.length} SageOx files stored in ${result.dir}`);
      if (result.ledger === 'pending') {
        console.log(`the SageOx ledger is not cloned yet; ox clones it in the background. Check with: ${result.bin} status`);
      }
      return;
    case 'already-linked':
      console.log(`already linked: ${result.dir}`);
      return;
    case 'committed':
      console.log(`${options.project}'s default branch already tracks .sageox/; Overdeck uses the committed SageOx link`);
      return;
  }
}

/** Adds `link` to `pan skills pack sageox`. */
export function registerSkillsSageoxCommands(sageox: Command): void {
  sageox.command('link').description("Run ox init in a throwaway worktree and store the project's SageOx link files (changes no checkout)")
    .requiredOption('--project <key>', 'Project key').option('--team <team>', 'SageOx team (name, slug or id) passed to ox init')
    .action(skillsPackSageoxLinkCommand);
}
