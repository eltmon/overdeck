import chalk from 'chalk';

import type { ReviewMode } from '../../lib/config-yaml.js';
import {
  ensureIssueRecordSync,
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  resolveProjectForIssue,
  writeIssueRecordSync,
} from '../../lib/pan-dir/record.js';

function isReviewMode(value: string): value is ReviewMode {
  return value === 'quick' || value === 'full';
}

export function reviewModeCommand(id: string, mode: string): void {
  const issueId = id.toUpperCase();
  if (!isReviewMode(mode)) {
    console.error(chalk.red(`Error: review mode must be quick or full, got '${mode}'`));
    console.error(chalk.dim(`Usage: pan review mode ${issueId} <quick|full>`));
    process.exit(1);
  }

  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
  const record = readIssueRecordSync(project, issueId) ?? ensureIssueRecordSync(project, issueId);
  record.reviewMode = mode;
  const recordPath = writeIssueRecordSync(project, issueId, record);

  console.log(chalk.green(`✓ Set ${issueId} review mode to ${mode}`));
  console.log(chalk.dim(`  ${recordPath}`));
}
