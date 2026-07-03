import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { clearReviewStatus } from '../../dashboard/server/review-status.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { getGitHubConfig, getRallyConfig } from '../../dashboard/server/services/tracker-config.js';
import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execFileAsync = promisify(execFile);

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

function getIssueDataService() {
  return getSharedIssueService();
}

export async function closeIssuePullRequest(issueId: string, reason = 'Canceled via Overdeck'): Promise<string[]> {
  const githubCheck = isGitHubIssue(issueId);
  if (!githubCheck.isGitHub || !githubCheck.owner || !githubCheck.repo) {
    return ['No GitHub PR to close'];
  }

  const branchName = `feature/${issueId.toLowerCase()}`;
  try {
    const { stdout: prListRaw } = await execFileAsync(
      'gh',
      [
        'pr', 'list',
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--head', branchName,
        '--state', 'open',
        '--json', 'number',
        '--jq', '.[0].number',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const prNumber = prListRaw.trim();
    if (!prNumber) {
      return ['No open PR found for branch'];
    }

    await execFileAsync(
      'gh',
      [
        'pr', 'close', prNumber,
        '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
        '--comment', reason,
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    try {
      const { setReviewStatusSync } = await import('../review-status.js');
      setReviewStatusSync(issueId.toUpperCase(), { prUrl: undefined });
    } catch { /* non-fatal — validator catches this downstream */ }
    return [`Closed PR #${prNumber} on ${githubCheck.owner}/${githubCheck.repo}`];
  } catch (err: any) {
    return [`PR close warning: ${err.message}`];
  }
}

export function buildLifecycleContext(id: string, issueSource: string | undefined) {
  const issuePrefix = extractTeamPrefix(id);
  const projectPath = getProjectPath(undefined, issuePrefix ?? undefined);
  const projectConfig = issuePrefix ? findProjectByTeamSync(issuePrefix) : null;
  const githubCheck = isGitHubIssue(id);

  const ctx: any = {
    issueId: id,
    projectPath,
    projectName: projectConfig?.name || '',
    ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
      ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
      : {}),
  };

  if (issueSource === 'rally') {
    const rallyConfig = getRallyConfig();
    if (rallyConfig) {
      ctx.rally = {
        apiKey: rallyConfig.apiKey,
        server: rallyConfig.server,
        workspace: rallyConfig.workspace,
        project: rallyConfig.project,
      };
    }
  }

  return { ctx, projectConfig, githubCheck };
}

export function isOrphanedIssue(issue: { status?: string; state?: string; rawTrackerState?: string; completedAt?: string | null }): boolean {
  const status = issue.status?.toLowerCase() ?? '';
  const state = issue.state?.toLowerCase() ?? '';
  const rawTrackerState = issue.rawTrackerState?.toLowerCase() ?? '';
  return Boolean(
    issue.completedAt
    || status.includes('closed')
    || status.includes('done')
    || status.includes('completed')
    || state.includes('closed')
    || state.includes('done')
    || state.includes('completed')
    || rawTrackerState.includes('closed')
    || rawTrackerState.includes('done')
    || rawTrackerState.includes('completed'),
  );
}

export function getIssueForCleanup(issueId: string) {
  const issueDataService = getIssueDataService();
  return issueDataService.getIssues({ includeCompleted: true }).find((issue: any) => {
    const identifier = typeof issue?.identifier === 'string' ? issue.identifier : '';
    return identifier.toUpperCase() === issueId.toUpperCase();
  }) as {
    status?: string;
    state?: string;
    rawTrackerState?: string;
    completedAt?: string | null;
  } | undefined;
}

export async function runDestructiveIssueLifecycle(
  id: string,
  mode: 'reset' | 'cancel',
  opts: { deleteWorkspace?: boolean; onProgress?: (data: Record<string, unknown>) => void } = {},
): Promise<{ success: boolean; cleanupLog: string[]; error?: string }> {
  const cleanupLog: string[] = [];
  const issueDataService = getIssueDataService();
  const issueSource = issueDataService.getIssueSource(id);
  const { ctx, projectConfig } = buildLifecycleContext(id, issueSource ?? undefined);
  const deleteWorkspace = opts.deleteWorkspace ?? true;

  cleanupLog.push(...await closeIssuePullRequest(
    id,
    mode === 'cancel' ? 'Canceled via Overdeck' : 'Reset to Todo via Overdeck',
  ));

  const { resetToTodo, cancelIssueWorkflow } = await import('../lifecycle/index.js');
  const workflow = mode === 'cancel' ? cancelIssueWorkflow : resetToTodo;
  const result = await Effect.runPromise(workflow(ctx, {
    deleteWorkspace,
    deleteBranches: deleteWorkspace,
    resetIssue: true,
    workspaceConfig: projectConfig?.workspace,
    projectName: projectConfig?.name || '',
    onProgress: opts.onProgress ? (event) => opts.onProgress?.({ type: 'progress', ...event }) : undefined,
  }));

  cleanupLog.push(...result.steps.flatMap((step: any) => step.details || [step.error].filter(Boolean)));

  // vBRIEF lifecycle transition for cancel (PAN-946): move to cancelled/ on main.
  if (mode === 'cancel') {
    try {
      const { transitionVBriefOnMain } = await import('../vbrief/lifecycle-io.js');
      const tx = await Effect.runPromise(transitionVBriefOnMain(
        ctx.projectPath,
        id,
        'cancelled',
        'cancelled',
        `scope: cancel ${id.toUpperCase()} vBRIEF`,
      ));
      if (tx.moved) cleanupLog.push(`vBRIEF moved ${tx.fromDir} → cancelled`);
      if (tx.committed) cleanupLog.push(`Committed vBRIEF cancellation on main`);
    } catch (err: any) {
      cleanupLog.push(`vBRIEF cancel transition failed (non-fatal): ${err?.message ?? err}`);
    }
  }

  // Kill canonical reviewer/synthesis tmux sessions (PAN-915). They persist
  // across review rounds to preserve context, so reset/cancel/deep-wipe is the
  // right place to tear them down — the issue is going back to Todo or being
  // canceled outright.
  try {
    const { killAllReviewerSessions } = await import('../cloister/review-agent.js');
    const { resolveProjectFromIssueSync } = await import('../projects.js');
    const resolved = resolveProjectFromIssueSync(id);
    const projectKey = resolved?.projectKey;
    if (projectKey) {
      const { killed } = await Effect.runPromise(killAllReviewerSessions(projectKey, id.toUpperCase()));
      if (killed.length > 0) {
        cleanupLog.push(`Killed ${killed.length} reviewer session(s)`);
      }
    }
  } catch (err) {
    cleanupLog.push(`Reviewer session cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    clearReviewStatus(id.toUpperCase());
    cleanupLog.push('Cleared review status');
  } catch { /* non-fatal */ }

  try {
    const { resetPostMergeState } = await import('../cloister/merge-agent.js');
    resetPostMergeState(id);
    resetPostMergeState(id.toUpperCase());
    cleanupLog.push('Cleared merge state');
  } catch { /* non-fatal */ }

  const issueDataServiceAfter = getIssueDataService();
  issueDataServiceAfter.invalidateTracker('github').catch(() => {});
  issueDataServiceAfter.invalidateTracker('linear').catch(() => {});
  issueDataServiceAfter.invalidateTracker('rally').catch(() => {});

  return {
    success: result.success,
    cleanupLog,
    error: result.success ? undefined : result.steps.find((s: any) => !s.success && !s.skipped)?.error,
  };
}
