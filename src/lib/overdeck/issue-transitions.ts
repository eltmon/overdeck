import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Stream } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { clearReviewStatus } from '../../dashboard/server/review-status.js';
import { getReviewStatusSync } from '../../dashboard/server/review-status.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { getGitHubConfig, getRallyConfig } from '../../dashboard/server/services/tracker-config.js';
import { saveAgentStateAndEmitEvent, saveAgentStateAndEmitEventProgram } from '../../dashboard/server/services/agent-projection.js';
import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { getAgentState } from '../agents.js';
import { extractPrefixSync } from '../issue-id.js';
import { reopenWorkspaceState } from '../reopen.js';
import { removeCompletionMarker } from './workspace-hygiene.js';

const execAsync = promisify(exec);
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

export function closeIssueTransition(options: {
  issueId: string;
  body: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { issueId, body, eventStore } = options;
    const { reason } = body as any;
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);

    const { close: closeWorkflow } = yield* Effect.promise(() => import('../lifecycle/index.js'));
    const githubCheck = isGitHubIssue(issueId);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(issueId);

    const ctx: any = {
      issueId,
      projectPath,
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

    const result = yield* closeWorkflow(ctx, { reason });

    if (githubCheck.isGitHub) {
      execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 }).catch(() => {});
    }

    // Invalidate tracker caches (fire and forget)
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    if (result.success) {
      yield* eventStore.append({
        type: 'issues.updated',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      });
    }

    return jsonResponse({
      success: result.success,
      message: result.success
        ? `Closed ${issueId}${reason ? ': ' + reason : ''}`
        : `Close failed for ${issueId}`,
      steps: result.steps,
    });
  });
}

export function abortIssueTransition(options: {
  id: string;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, eventStore } = options;

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeAbort = yield* getAgentState(workAgentId);

    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'reset', { deleteWorkspace: true }));

    if (result.success) {
      // PAN-1908: write-through projection for the real work agent.
      if (workAgentStateBeforeAbort) {
        yield* saveAgentStateAndEmitEventProgram(workAgentStateBeforeAbort, {
          type: 'agent.stopped',
          timestamp: new Date().toISOString(),
          payload: { agentId: workAgentId, issueId: workAgentStateBeforeAbort.issueId },
        }).pipe(Effect.catch(() => Effect.void));
      }
      // Planning sessions are not agents in the runtime registry; keep raw emit.
      yield* eventStore.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: planningAgentId },
      } as any).pipe(Effect.catch(() => Effect.void));
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
      });
      yield* eventStore.append({
        type: 'workspace.destroyed',
        timestamp: new Date().toISOString(),
        payload: { issueId: id },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Reset ${id} to Todo` : `Reset completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
  });
}

export function resetIssueTransition(options: {
  id: string;
  body: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, body, eventStore } = options;
    const { deleteWorkspace = true } = body as any || {};

    // PAN-1908: capture agent state before destruction so the stopped event can
    // be projected through the transactional boundary after the reset succeeds.
    const workAgentId = `agent-${id.toLowerCase()}`;
    const planningAgentId = `planning-${id.toLowerCase()}`;
    const workAgentStateBeforeReset = yield* getAgentState(workAgentId);

    const encoder = new TextEncoder();
    const nodeStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        sendEvent({ type: 'started', issueId: id });

        await Effect.runPromise(eventStore.append({
          type: 'workspace.wipe_started',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));

        const result = await runDestructiveIssueLifecycle(id, 'reset', {
          deleteWorkspace,
          onProgress: sendEvent,
        });

        if (result.success) {
          // PAN-1908: write-through projection for the real work agent.
          if (workAgentStateBeforeReset) {
            try {
              saveAgentStateAndEmitEvent(workAgentStateBeforeReset, {
                type: 'agent.stopped',
                timestamp: new Date().toISOString(),
                payload: { agentId: workAgentId, issueId: workAgentStateBeforeReset.issueId },
              });
            } catch { /* non-fatal */ }
          }
          // Planning sessions are not agents in the runtime registry; keep raw emit.
          try {
            await Effect.runPromise(eventStore.append({
              type: 'agent.stopped',
              timestamp: new Date().toISOString(),
              payload: { agentId: planningAgentId },
            } as any));
          } catch { /* non-fatal */ }
          await Effect.runPromise(eventStore.append({
            type: 'issue.statusChanged',
            timestamp: new Date().toISOString(),
            payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
          }));
          await Effect.runPromise(eventStore.append({
            type: 'workspace.destroyed',
            timestamp: new Date().toISOString(),
            payload: { issueId: id },
          }));
          try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
          sendEvent({ type: 'complete', message: `Reset completed for ${id}` });
        } else {
          sendEvent({ type: 'error', error: result.error || 'Reset failed' });
        }
        controller.close();
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });
}

export function cancelIssueTransition(options: {
  id: string;
  body: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, body, eventStore } = options;
    const { wipeWorkspace = true } = body as any;
    const result = yield* Effect.promise(() => runDestructiveIssueLifecycle(id, 'cancel', { deleteWorkspace: wipeWorkspace }));

    if (result.success) {
      yield* eventStore.append({
        type: 'issue.statusChanged',
        timestamp: new Date().toISOString(),
        payload: { issueId: id, status: 'Canceled', canonicalStatus: 'canceled' },
      });
      try { getIssueDataService().patchIssue(id, { status: 'Canceled', canonicalStatus: 'canceled' }); } catch { /* non-fatal */ }
    }

    const responseBody = {
      success: result.success,
      message: result.success ? `Canceled ${id}` : `Cancel completed with errors for ${id}`,
      cleanupLog: result.cleanupLog,
      error: result.error,
    };
    return result.success
      ? jsonResponse(responseBody)
      : jsonResponse(responseBody, { status: 500 });
  });
}

export function reopenIssueTransition(options: {
  id: string;
  body: any;
  lifecycle: any;
  linear: any;
  eventStore: any;
}) {
  return Effect.gen(function* () {
    const { id, body, lifecycle, linear, eventStore } = options;
    const { reason: _reason } = body as any || {};
    void _reason;
    const githubCheck = isGitHubIssue(id);

    const issueDataService = getIssueDataService();
    const issueSource = issueDataService.getIssueSource(id);

    const reviewStatus = getReviewStatusSync(id.toUpperCase());
    const cachedIssue = issueDataService.getIssues()
      .find((issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === id.toUpperCase());
    const reopenToVerifying = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
    const targetState = reopenToVerifying ? 'verifying_on_main' : 'in_progress';
    const targetCanonicalStatus = targetState;

    let newState = reopenToVerifying ? 'Verifying on Main' : 'In Progress';
    let issueIdentifier = id;

    yield* lifecycle.transitionTo(id, targetState).pipe(Effect.catch(() => Effect.void));

    if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
      if (!reopenToVerifying) newState = 'Open';

    } else if (githubCheck.isGitHub) {
      if (!reopenToVerifying) {
        yield* lifecycle.removeLabel(id, 'done').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'needs-close-out').pipe(Effect.catch(() => Effect.void));
        yield* lifecycle.removeLabel(id, 'merged').pipe(Effect.catch(() => Effect.void));
      }

      // Reopen closed (not merged) PR for the feature branch if one exists
      yield* Effect.promise(async () => {
        try {
          const branchName = `feature/${id.toLowerCase()}`;
          const { stdout } = await execAsync(
            `gh pr list --head ${branchName} --state closed --json number,mergedAt --limit 1`,
            { encoding: 'utf-8', timeout: 15000 }
          );
          const prs = JSON.parse(stdout.trim() || '[]');
          if (prs.length > 0 && !prs[0].mergedAt) {
            await execAsync(`gh pr reopen ${prs[0].number}`, { encoding: 'utf-8', timeout: 15000 });
            console.log(`[reopen] Reopened PR #${prs[0].number} for ${id}`);
          }
        } catch (err: any) {
          console.warn(`[reopen] Could not reopen PR for ${id}: ${err.message}`);
        }
      });

      issueDataService.invalidateTracker('github').catch(() => {});
      if (!reopenToVerifying) newState = 'In Progress';

    } else {
      const updatedIssue = yield* linear.getIssue(id).pipe(Effect.catch(() => Effect.succeed(null)));
      issueIdentifier = updatedIssue?.identifier ?? id;
      if (!reopenToVerifying) newState = updatedIssue?.state.name ?? 'In Progress';
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    // Reset specialist pipeline state, post-merge state, and agent markers (all non-fatal)
    yield* Effect.promise(async () => {
      // Reset specialist pipeline state, remove from queues, and update continue file
      // via reopenWorkspaceState (shared logic with `pan reopen` CLI command)
      try {
        const teamPrefix = extractTeamPrefix(id);
        const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
        const projectPath = projectConfig?.path || '';
        const workspacePath = projectPath
          ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
          : '';
        if (workspacePath) {
          await Effect.runPromise(reopenWorkspaceState(id.toUpperCase(), workspacePath, { reason: (body as any)?.reason }));
        } else {
          // Fallback: no workspace path, just clear review status
          clearReviewStatus(id.toUpperCase());
        }
      } catch { /* non-fatal */ }

      // Reset post-merge state
      try {
        const { resetPostMergeState } = await import('../cloister/merge-agent.js');
        resetPostMergeState(id);
        resetPostMergeState(id.toUpperCase());
      } catch { /* non-fatal */ }

      // Clear agent completion markers so Deacon doesn't re-dispatch to specialists
      try {
        const agentDir = join(homedir(), '.overdeck', 'agents', `agent-${id.toLowerCase()}`);
        for (const marker of ['completed', 'completed.processed']) {
          const markerPath = join(agentDir, marker);
          await removeCompletionMarker(markerPath);
          if (!existsSync(markerPath)) console.log(`[reopen] Cleared ${marker} marker for ${id}`);
        }
      } catch { /* non-fatal */ }
    });

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: issueIdentifier, status: newState, canonicalStatus: targetCanonicalStatus },
    });
    // Emit pipeline reset so frontend read model clears the stale readyForMerge badge
    yield* eventStore.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        issueId: issueIdentifier,
        status: {
          issueId: issueIdentifier,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
        },
      },
    });
    try { getIssueDataService().patchIssue(issueIdentifier, { status: newState, canonicalStatus: targetCanonicalStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} reopened and moved to ${newState}`,
      issueId: issueIdentifier,
      newState,
      resetSummary: null,
      agentRunning: false,
      nextStep: `Start an agent: pan start ${id}`,
    });
  });
}

export function moveIssueStatus(options: {
  id: string;
  body: any;
  eventStore: any;
  lifecycle: any;
}) {
  return Effect.gen(function* () {
    const { id, body, eventStore, lifecycle } = options;
    const { targetStatus, syncToTracker = false } = body as any || {};

    const validStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
    if (!targetStatus || !validStatuses.includes(targetStatus)) {
      return jsonResponse(
        { error: `Invalid targetStatus. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const { updateShadowState } = yield* Effect.promise(() => import('../shadow-state.js'));

    const canonicalToIssueState: Record<string, 'open' | 'in_progress' | 'closed'> = {
      backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_progress', done: 'closed',
    };
    const issueState = canonicalToIssueState[targetStatus];

    const shadowResult = yield* updateShadowState(id, issueState, 'dashboard-drag-drop', targetStatus);

    const issueDataService = getIssueDataService();
    // Refresh the in-memory shadow-state cache so subsequent getIssues() calls
    // see this drag-drop change without hitting the disk.
    yield* Effect.promise(() => issueDataService.refreshShadowStatesCache());
    const issueSource = issueDataService.getIssueSource(id);
    const githubCheck = isGitHubIssue(id);

    if (syncToTracker) {
      // Map canonical status to IssueState for the lifecycle service
      const canonicalToLifecycleState: Record<string, 'open' | 'in_progress' | 'in_review' | 'closed'> = {
        backlog: 'open', todo: 'open', in_progress: 'in_progress', in_review: 'in_review', done: 'closed',
      };
      const lifecycleState = canonicalToLifecycleState[targetStatus];

      if (lifecycleState) {
        yield* lifecycle.transitionTo(id, lifecycleState).pipe(
          Effect.catch((err) =>
            Effect.sync(() => console.error(`Tracker sync failed for ${id}:`, String(err))),
          ),
        );
      }
    }

    // Invalidate tracker caches
    if (githubCheck.isGitHub) {
      issueDataService.invalidateTracker('github').catch(() => {});
    } else if (issueSource === 'rally') {
      issueDataService.invalidateTracker('rally').catch(() => {});
    } else {
      issueDataService.invalidateTracker('linear').catch(() => {});
    }

    const canonicalToDisplay: Record<string, string> = {
      backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
      in_review: 'In Review', done: 'Done',
    };

    const displayStatus = canonicalToDisplay[targetStatus] || targetStatus;
    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: displayStatus, canonicalStatus: targetStatus },
    });

    try { issueDataService.patchIssue(id, { status: displayStatus, canonicalStatus: targetStatus }); } catch { /* non-fatal */ }

    return jsonResponse({
      success: true,
      message: `Issue ${id} moved to ${targetStatus}`,
      issueId: id,
      newStatus: targetStatus,
      syncToTracker,
      shadowState: shadowResult,
    });
  });
}
