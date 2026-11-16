/**
 * `pan semgrep ci-setup <project> [--sarif-upload] [--dry-run]` (PAN-4592):
 * open a pull request that adds a Semgrep GitHub Actions workflow to a
 * project. The work is in src/lib/semgrep/ci-setup.ts; the generated commit
 * and push skip repository hooks (`--no-verify`). See
 * configuration/semgrep.mdx, "CI workflow".
 */
import type { Command } from 'commander';

export function registerSemgrepCommands(program: Command): void {
  const semgrep = program.command('semgrep').description('Semgrep support (opt-in SAST)');
  semgrep
    .command('ci-setup <project>')
    .description('Open a pull request that adds a Semgrep GitHub Actions workflow to a project (its commit skips repository hooks)')
    .option('--sarif-upload', 'Also scan base-branch pushes and upload results to GitHub code scanning')
    .option('--dry-run', 'Print the workflow and the target, and change nothing')
    .action(async (project: string, options: { sarifUpload?: boolean; dryRun?: boolean }) => {
      const { runSemgrepCiSetup } = await import('../../lib/semgrep/ci-setup.js');
      const result = await runSemgrepCiSetup({
        projectKey: project,
        sarifUpload: options.sarifUpload === true,
        dryRun: options.dryRun === true,
      });
      if (!result.ok) {
        console.error(result.message);
        const { exitCli } = await import('../exit.js');
        await exitCli(1);
        return;
      }
      if (result.prUrl) console.log(`Pull request: ${result.prUrl}`);
    });
}
