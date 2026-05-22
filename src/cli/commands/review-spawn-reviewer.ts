import { Effect } from 'effect';
import chalk from 'chalk';
import { join } from 'path';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { PAN_DIRNAME } from '../../lib/pan-dir/types.js';
import { REVIEW_SUB_ROLES, reviewerOutputPath, type ReviewSubRole } from '../../lib/cloister/review-monitor.js';
import { spawnReviewSubRoleForIssue } from '../../lib/cloister/review-agent.js';

export interface ReviewSpawnReviewerOptions {
  subRole?: string;
  runId?: string;
  workspace?: string;
  output?: string;
  context?: string;
  model?: string;
}

function parseSubRole(value: string | undefined): ReviewSubRole | null {
  if (!value) return null;
  return (REVIEW_SUB_ROLES as readonly string[]).includes(value) ? value as ReviewSubRole : null;
}

export async function reviewSpawnReviewerCommand(
  id: string,
  opts: ReviewSpawnReviewerOptions = {},
): Promise<void> {
  const issueId = id.toUpperCase();
  const subRole = parseSubRole(opts.subRole);
  if (!subRole) {
    console.error(chalk.red(`Error: --sub-role must be one of ${REVIEW_SUB_ROLES.join(', ')}`));
    process.exit(1);
  }
  if (!opts.runId) {
    console.error(chalk.red('Error: --run-id is required'));
    process.exit(1);
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved && !opts.workspace) {
    console.error(chalk.red(`Error: cannot resolve project workspace for ${issueId}`));
    process.exit(1);
  }

  const workspace = opts.workspace ?? join(resolved!.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const outputPath = opts.output ?? reviewerOutputPath(workspace, opts.runId, subRole);
  const contextManifestPath = opts.context ?? join(workspace, PAN_DIRNAME, 'review', opts.runId, 'context.json');

  const result = await Effect.runPromise(spawnReviewSubRoleForIssue({
    issueId,
    workspace,
    subRole,
    runId: opts.runId,
    outputPath,
    contextManifestPath,
    model: opts.model,
  }));

  if (!result.success) {
    console.error(chalk.red(`Error: ${result.error ?? result.message}`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ ${result.message}`));
}
