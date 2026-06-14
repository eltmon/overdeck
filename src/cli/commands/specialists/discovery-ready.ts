/**
 * pan admin specialists discovery-ready <type> <issueId>
 *
 * Signal that the parent review synthesis agent has completed its discovery
 * phase and is ready for the server to fork its session into convoy reviewers.
 *
 * Usage:
 *   pan admin specialists discovery-ready review PAN-1862
 */

import chalk from 'chalk';

export async function discoveryReadyCommand(type: string, issueId: string): Promise<void> {
  if (type !== 'review') {
    console.error(chalk.red(`Invalid type: ${type}`));
    console.error(chalk.dim('Only "review" is supported for discovery-ready'));
    process.exit(1);
  }

  const normalizedIssueId = issueId.toUpperCase();

  const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
  const { join } = await import('node:path');

  const project = resolveProjectFromIssueSync(normalizedIssueId);
  if (!project) {
    console.error(chalk.red(`Could not resolve project for issue ${normalizedIssueId}`));
    process.exit(1);
  }

  const workspace = join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`);

  const { handleDiscoveryReady } = await import('../../../lib/cloister/review-agent.js');
  const result = await handleDiscoveryReady(normalizedIssueId, workspace);

  if (result.noOp) {
    console.log(chalk.yellow(`  ↳ ${result.message}`));
    return;
  }

  if (result.success) {
    console.log(chalk.green(`✓ ${result.message}`));
  } else {
    console.error(chalk.red(`✗ ${result.message}${result.error ? `: ${result.error}` : ''}`));
    process.exit(1);
  }
}
