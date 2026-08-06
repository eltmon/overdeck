/**
 * pan sync-main <id>
 *
 * Sync the latest main branch into a workspace's feature branch.
 * Uses git merge (not rebase) and delegates conflict resolution to the merge-agent.
 */

import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, sep } from 'node:path';
import { getDashboardApiUrlSync } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrlSync();

interface SyncMainRepoResponse {
  repoKey: string;
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  conflictFiles?: string[];
  reason?: string;
  skipped?: boolean;
}

interface SyncMainResponse {
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  message?: string;
  error?: string;
  repos?: SyncMainRepoResponse[];
}

function printPolyrepoResults(repos: SyncMainRepoResponse[], failed: boolean): void {
  const write = failed ? console.error : console.log;
  for (const repo of repos) {
    const status = repo.skipped
      ? 'skipped (earlier repo failed)'
      : repo.alreadyUpToDate
        ? 'already up to date'
        : repo.success
          ? `${repo.commitCount ?? 0} commit(s)`
          : `failed${repo.reason ? ` — ${repo.reason}` : ''}`;
    write(chalk.dim(`  ${repo.repoKey}: ${status}`));
    if (repo.conflictFiles?.length) {
      write(chalk.yellow('    Conflict files:'));
      repo.conflictFiles.forEach(file => write(chalk.yellow(`      - ${file}`)));
    }
  }
}

/** Return the canonical issue-workspace root containing cwd, when cwd is in one. */
export function workspacePathForSyncMain(issueId: string, cwd = process.cwd()): string | undefined {
  const issueLower = issueId.toLowerCase();
  const parts = resolve(cwd).split(sep);
  const workspaceIndex = Math.max(
    parts.lastIndexOf(`feature-${issueLower}`),
    parts.lastIndexOf(`feature-${issueLower}-strike`),
  );
  if (workspaceIndex < 0) return undefined;
  return parts.slice(0, workspaceIndex + 1).join(sep) || sep;
}

export async function syncMainCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();
  const spinner = ora(`Syncing main into ${issueId}...`).start();

  try {
    const workspacePath = workspacePathForSyncMain(issueId);
    const workspaceQuery = workspacePath
      ? `?workspacePath=${encodeURIComponent(workspacePath)}`
      : '';
    const response = await fetch(`${DASHBOARD_URL}/api/issues/${issueId}/sync-main${workspaceQuery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json() as SyncMainResponse;

    const isPolyrepo = (result.repos?.length ?? 0) > 1;

    if (!response.ok) {
      spinner.fail(chalk.red(`Sync failed: ${result.error || 'Unknown error'}`));
      if (isPolyrepo) {
        printPolyrepoResults(result.repos!, true);
      } else if (result.conflictFiles && result.conflictFiles.length > 0) {
        console.error(chalk.yellow('\nConflict files:'));
        result.conflictFiles.forEach(f => console.error(chalk.yellow(`  - ${f}`)));
      }
      return exitCli(1);
    }

    if (result.alreadyUpToDate) {
      spinner.succeed(chalk.green(`${issueId} is already up to date with main`));
      if (isPolyrepo) printPolyrepoResults(result.repos!, false);
      return;
    }

    spinner.succeed(chalk.green(`✓ ${result.message || 'Sync complete'}`));
    if (isPolyrepo) printPolyrepoResults(result.repos!, false);

    if (result.commitCount !== undefined) {
      console.log(chalk.dim(`  Commits merged: ${result.commitCount}`));
    }

    if (result.changedFiles && result.changedFiles.length > 0) {
      const shown = result.changedFiles.slice(0, 10);
      console.log(chalk.dim(`  Changed files (${result.changedFiles.length}):`));
      shown.forEach(f => console.log(chalk.dim(`    ${f}`)));
      if (result.changedFiles.length > 10) {
        console.log(chalk.dim(`    ... and ${result.changedFiles.length - 10} more`));
      }
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to reach dashboard: ${error.message}`));
    console.error(chalk.dim(`Make sure the dashboard is running: pan up`));
    return exitCli(1);
  }
}
