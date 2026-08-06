import { exitCli } from '../exit.js';
import chalk from 'chalk';

import type { ReviewMode } from '../../lib/config-yaml.js';
import {
  getProjectConfigFromWorkspacePath,
  resolveProjectForIssue,
} from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';

function isReviewMode(value: string): value is ReviewMode {
  return value === 'quick' || value === 'full' || value === 'none';
}

export async function reviewModeCommand(id: string, mode: string): Promise<void> {
  const issueId = id.toUpperCase();
  if (!isReviewMode(mode)) {
    console.error(chalk.red(`Error: review mode must be quick, full, or none, got '${mode}'`));
    console.error(chalk.dim(`Usage: pan review mode ${issueId} <quick|full|none>`));
    return exitCli(1);
  }

  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
  await updateIssueRecord(project, issueId, (record) => { record.reviewMode = mode; });

  console.log(chalk.green(`✓ Set ${issueId} review mode to ${mode}`));
}
