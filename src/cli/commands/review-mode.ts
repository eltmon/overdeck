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
  return value === 'quick' || value === 'full' || value === 'none';
}

export function reviewModeCommand(id: string, mode: string): void {
  const issueId = id.toUpperCase();
  if (!isReviewMode(mode)) {
    console.error(chalk.red(`Error: review mode must be quick, full, or none, got '${mode}'`));
    console.error(chalk.dim(`Usage: pan review mode ${issueId} <quick|full|none>`));
    process.exit(1);
  }

  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
  const record = readIssueRecordSync(project, issueId) ?? ensureIssueRecordSync(project, issueId);
  record.reviewMode = mode;
  const recordPath = writeIssueRecordSync(project, issueId, record);

  console.log(chalk.green(`✓ Set ${issueId} review mode to ${mode}`));
  console.log(chalk.dim(`  ${recordPath}`));
}

const RE_REVIEW_SCOPES = ['all', 'changed', 'blockers'] as const;
type ReReviewScopeValue = (typeof RE_REVIEW_SCOPES)[number];

function isReReviewScope(value: string): value is ReReviewScopeValue {
  return (RE_REVIEW_SCOPES as readonly string[]).includes(value);
}

/** PAN-1874: per-issue re-review scope override (which convoy reviewers re-run). */
export function reviewScopeCommand(id: string, scope: string): void {
  const issueId = id.toUpperCase();
  if (!isReReviewScope(scope)) {
    console.error(chalk.red(`Error: re-review scope must be all, changed, or blockers, got '${scope}'`));
    console.error(chalk.dim(`Usage: pan review scope ${issueId} <all|changed|blockers>`));
    process.exit(1);
  }

  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
  const record = readIssueRecordSync(project, issueId) ?? ensureIssueRecordSync(project, issueId);
  record.reReviewScope = scope;
  const recordPath = writeIssueRecordSync(project, issueId, record);

  console.log(chalk.green(`✓ Set ${issueId} re-review scope to ${scope}`));
  console.log(chalk.dim(`  ${recordPath}`));
}
