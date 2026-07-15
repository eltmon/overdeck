import { execFile } from 'node:child_process';
import type { WorkflowRun } from './stale-check-classifier.js';

const RUN_FIELDS = 'databaseId,workflowName,createdAt,conclusion,status,attempt,headSha';

function execGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf-8', timeout: 30000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout as string);
    });
  });
}

function warn(action: string, error: unknown): void {
  console.warn(`[stale-check-github] Failed to ${action}:`, error instanceof Error ? error.message : String(error));
}

export async function listRecentMainRuns(repo: string): Promise<WorkflowRun[]> {
  try {
    return JSON.parse(await execGh([
      'run', 'list', '--repo', repo, '--branch', 'main', '--limit', '50', '--json', RUN_FIELDS,
    ])) as WorkflowRun[];
  } catch (error) {
    warn(`list recent main runs for ${repo}`, error);
    return [];
  }
}

export async function listPrHeadFailingRuns(
  repo: string,
  headRef: string,
  headSha: string,
): Promise<WorkflowRun[]> {
  try {
    const runs = JSON.parse(await execGh([
      'run', 'list', '--repo', repo, '--branch', headRef, '--status', 'failure', '--json', RUN_FIELDS,
    ])) as WorkflowRun[];
    return runs.filter((run) => run.headSha === headSha);
  } catch (error) {
    warn(`list failing runs for ${headRef}`, error);
    return [];
  }
}

export async function getPrHead(
  repo: string,
  prNumber: number,
): Promise<{ headRefName: string; headRefOid: string } | null> {
  try {
    return JSON.parse(await execGh([
      'pr', 'view', String(prNumber), '--repo', repo, '--json', 'headRefName,headRefOid',
    ])) as { headRefName: string; headRefOid: string };
  } catch (error) {
    warn(`resolve PR #${prNumber} head`, error);
    return null;
  }
}

export async function rerunFailedRun(repo: string, runId: number): Promise<boolean> {
  try {
    await execGh(['run', 'rerun', String(runId), '--failed', '--repo', repo]);
    return true;
  } catch (error) {
    warn(`rerun failed jobs for run ${runId}`, error);
    return false;
  }
}
