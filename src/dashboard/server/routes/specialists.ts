import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';
/**
 * Specialists route module — Effect HttpRouter.Layer (PAN-428 B9)
 *
 * Implements all /api/specialists/* endpoints from the Express server:
 *   GET    /api/specialists
 *   POST   /api/specialists/reset-all
 *   POST   /api/specialists/done
 *   POST   /api/specialists/logs/cleanup-all
 *   GET    /api/specialists/queues
 *   GET    /api/specialists/projects
 *   POST   /api/specialists/:name/wake
 *   POST   /api/specialists/:name/reset
 *   POST   /api/specialists/:name/init
 *   POST   /api/specialists/:name/report-status
 *   GET    /api/specialists/:name/cost
 *   GET    /api/specialists/:name/queue
 *   POST   /api/specialists/:name/queue
 *   DELETE /api/specialists/:name/queue/:itemId
 *   PUT    /api/specialists/:name/queue/reorder
 *   POST   /api/specialists/:name/auto-complete
 *   GET    /api/specialists/:project/:issueId/:type/status
 *   POST   /api/specialists/:project/:issueId/:type/kill
 *   GET    /api/specialists/:project/:type/queue
 *   POST   /api/specialists/:project/:type/spawn
 *   GET    /api/specialists/:project/:type/runs
 *   GET    /api/specialists/:project/:type/runs/:runId
 *   GET    /api/specialists/:project/:type/runs/:runId/stream
 *   POST   /api/specialists/:project/:type/runs/:runId/terminate
 *   POST   /api/specialists/:project/:type/grace/pause
 *   POST   /api/specialists/:project/:type/grace/resume
 *   POST   /api/specialists/:project/:type/grace/exit
 *   GET    /api/specialists/:project/:type/grace
 *   GET    /api/specialists/:project/:type/context
 *   POST   /api/specialists/:project/:type/context/regenerate
 *   POST   /api/specialists/:project/:type/complete
 *   GET    /api/specialists/:project/:type/latest-log
 *   POST   /api/specialists/:project/:type/logs/cleanup
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getAgentCommand } from '../../../lib/settings.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import {
  getReviewStatus,
  setReviewStatus as setReviewStatusBase,
  loadReviewStatuses,
  saveReviewStatuses,
  type ReviewStatus,
} from '../../../lib/review-status.js';
import {
  saveAgentRuntimeState,
  messageAgent,
  transitionIssueToInProgress,
} from '../../../lib/agents.js';
import { calculateCost, getPricing, type TokenUsage } from '../../../lib/cost.js';
import { normalizeModelName } from '../../../lib/cost-parsers/jsonl-parser.js';
import { syncBeadStatusToVBrief } from '../../../lib/vbrief/beads.js';
import { readWorkspacePlan } from '../../../lib/vbrief/io.js';
import { getUnblockedItems } from '../../../lib/cloister/task-readiness.js';
import { EventStoreService } from '../services/domain-services.js';
import { extractPrefix } from '../../../lib/issue-id.js';
import { createSessionAsync } from '../../../lib/tmux.js';

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent';
type ProjectSpecialistType = 'review-agent' | 'test-agent' | 'merge-agent';

const VALID_SPECIALIST_NAMES: string[] = [
  'merge-agent',
  'review-agent',
  'test-agent',
  'inspect-agent',
  'uat-agent',
];

function validateSpecialistType(type: string): type is ProjectSpecialistType {
  return type === 'review-agent' || type === 'test-agent' || type === 'merge-agent';
}

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Track in-flight postMergeLifecycle to prevent concurrent execution ───────

const _postMergeInFlight = new Set<string>();

// Track issues where the server is managing the merge lifecycle (polyrepo).
// Exported so the workspaces route can register/unregister server-managed merges.
export const _serverManagedMerges = new Set<string>();

function firePostMergeLifecycle(issueId: string): void {
  if (_postMergeInFlight.has(issueId)) {
    console.log(`[merge] firePostMergeLifecycle: skipping ${issueId} — already in flight`);
    return;
  }

  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPathForIssue(issuePrefix);

  _postMergeInFlight.add(issueId);
  (async () => {
    try {
      const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
      await postMergeLifecycle(issueId, projectPath);
      console.log(`[merge] post-merge lifecycle completed for ${issueId}`);
    } catch (err) {
      console.error(`[merge] post-merge lifecycle failed for ${issueId}:`, err);
    } finally {
      _postMergeInFlight.delete(issueId);
    }
  })();
}

function getProjectPathForIssue(issuePrefix: string): string {
  const issueId = `${issuePrefix}-1`;
  const resolved = resolveProjectFromIssue(issueId);
  if (resolved) return resolved.projectPath;
  return join(homedir(), 'Projects');
}

// ─── Route: GET /api/specialists ─────────────────────────────────────────────

const getSpecialistsRoute = HttpRouter.add(
  'GET',
  '/api/specialists',
  httpHandler(Effect.gen(function* () {
    const {
      getAllSpecialistStatus,
      getAllProjectSpecialistStatuses,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    const legacySpecialists = yield* Effect.promise(() => getAllSpecialistStatus());
    const projectSpecialists = yield* Effect.promise(() => getAllProjectSpecialistStatuses());

    return jsonResponse({
      specialists: legacySpecialists,
      projects: projectSpecialists,
    });
  })),
);

// ─── Route: POST /api/specialists/reset-all ───────────────────────────────────
// NOTE: Must be registered before /:name/reset to avoid "reset-all" matching as :name

const postSpecialistsResetAllRoute = HttpRouter.add(
  'POST',
  '/api/specialists/reset-all',
  httpHandler(Effect.gen(function* () {
    const {
      getAllSpecialists,
      clearSessionId,
      isRunning,
      getTmuxSessionName,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const { clearHook } = yield* Effect.promise(() => import('../../../lib/hooks.js'));

    const specialists = getAllSpecialists();
    const results: { name: string; killed: boolean; sessionCleared: boolean; queueCleared: boolean }[] = [];

    for (const specialist of specialists) {
      const name = specialist.name;
      let killed = false;

      if (isRunning(name)) {
        const tmuxSession = getTmuxSessionName(name);
        const killResult = yield* Effect.promise(() =>
          killSessionAsync(tmuxSession).then(() => true).catch(() => false),
        );
        killed = killResult;
      }

      const sessionCleared = clearSessionId(name);
      clearHook(name);
      results.push({ name, killed, sessionCleared, queueCleared: true });
    }

    // Reset any "reviewing" statuses to "pending"
    let reviewStatusesReset = 0;
    try {
      const statuses = loadReviewStatuses();
      for (const key of Object.keys(statuses)) {
        if (statuses[key].reviewStatus === 'reviewing') {
          statuses[key].reviewStatus = 'pending';
          statuses[key].updatedAt = new Date().toISOString();
          reviewStatusesReset++;
        }
      }
      if (reviewStatusesReset > 0) {
        saveReviewStatuses(statuses);
      }
    } catch (e) {
      console.error('Failed to reset review statuses:', e);
    }

    return jsonResponse({
      success: true,
      message: `Reset ${results.length} specialists, reset ${reviewStatusesReset} review statuses`,
      results,
      reviewStatusesReset,
    });
  })),
);

// ─── Route: POST /api/specialists/done ───────────────────────────────────────
// CRITICAL: This endpoint has idempotency guards — see CLAUDE.md.
// Must be registered before /:name/* routes to prevent "done" matching as :name.

const postSpecialistsDoneRoute = HttpRouter.add(
  'POST',
  '/api/specialists/done',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { specialist, issueId, status, notes } = body as {
      specialist: string;
      issueId: string;
      status: string;
      notes?: string;
    };

    // Validate specialist type
    const validSpecialists = ['review', 'test', 'merge', 'inspect', 'uat'];
    if (!validSpecialists.includes(specialist)) {
      return jsonResponse(
        { error: `Invalid specialist: ${specialist}. Valid: ${validSpecialists.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate status
    if (!status || !['passed', 'failed'].includes(status)) {
      return jsonResponse(
        { error: `Invalid status: ${status}. Must be 'passed' or 'failed'` },
        { status: 400 },
      );
    }

    // Validate issueId
    if (!issueId) {
      return jsonResponse({ error: 'issueId is required' }, { status: 400 });
    }

    const normalizedIssueId = issueId.toUpperCase();
    console.log(`[specialists/done] ${specialist} signaling ${status} for ${normalizedIssueId}`);

    // Resolve any pending specialist completion Promises (PAN-632: event-driven completion).
    // This replaces polling loops in spawnMergeAgentForBranches / syncMainIntoWorkspace.
    if (specialist === 'merge') {
      yield* Effect.promise(async () => {
        const { reportSpecialistCompletion } = await import('../../../lib/cloister/specialist-completion.js');
        const resolved = reportSpecialistCompletion(normalizedIssueId, {
          status: status as 'passed' | 'failed',
          notes,
        });
        if (resolved) {
          console.log(`[specialists/done] Resolved pending completion waiter for ${normalizedIssueId}`);
        }
      });
    }

    // GUARD: If this issue is in a server-managed merge (polyrepo), the server handles
    // the merge lifecycle. Acknowledge the agent's call but do NOT trigger onMergeComplete.
    if (specialist === 'merge' && _serverManagedMerges.has(normalizedIssueId)) {
      console.log(`[specialists/done] ${normalizedIssueId} is server-managed merge — acknowledging without triggering lifecycle`);
      return jsonResponse({
        success: true,
        specialist,
        issueId: normalizedIssueId,
        status,
        notes,
        serverManaged: true,
      });
    }

    // Build the update based on specialist type
    const update: Partial<ReviewStatus> = {};

    switch (specialist) {
      case 'review':
        update.reviewStatus = status === 'passed' ? 'passed' : 'blocked';
        if (notes) update.reviewNotes = notes;
        break;

      case 'test':
        update.testStatus = status;
        if (notes) update.testNotes = notes;
        break;

      case 'merge':
        update.mergeStatus = status === 'passed' ? 'merged' : 'failed';
        break;

      case 'inspect':
        update.inspectStatus = status;
        if (notes) update.inspectNotes = notes;
        break;

      case 'uat':
        update.uatStatus = status;
        if (notes) update.uatNotes = notes;
        if (status === 'passed') {
          update.readyForMerge = true;
        }
        break;
    }

    // Apply the update (triggers side effects like idle state, queue processing)
    const updatedStatus = setReviewStatusBase(normalizedIssueId, update);

    // Set specialist state to idle and clear registry write-scope.
    // CRITICAL: No `await` between the mergeStatus write above and the guard check below.
    yield* Effect.promise(async () => {
      try {
        const { getTmuxSessionName, updateRunMetadata, makeSpecialistRegistryKey } =
          await import('../../../lib/cloister/specialists.js');
        const project = resolveProjectFromIssue(normalizedIssueId);
        const projectKey = project?.projectKey;
        const tmuxSession = projectKey
          ? getTmuxSessionName(`${specialist}-agent` as SpecialistType, projectKey, normalizedIssueId)
          : getTmuxSessionName(`${specialist}-agent` as SpecialistType);
        saveAgentRuntimeState(tmuxSession, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });
        console.log(`[specialists/done] Set ${tmuxSession} to idle`);

        // Clear write-scope lock so the next specialist can claim the workspace
        if (projectKey) {
          const registryKey = makeSpecialistRegistryKey(`${specialist}-agent`, normalizedIssueId);
          updateRunMetadata(projectKey, registryKey, {
            currentRun: null,
            writeScope: null,
            workspace: null,
            currentActivity: null,
          });
          console.log(`[specialists/done] Cleared registry lock for ${registryKey} (${projectKey})`);
        }

        // Update specialist handoff log so success-rate metrics reflect actual outcome
        const { updateSpecialistHandoffStatus } = await import('../../../lib/cloister/specialist-handoff-logger.js');
        const updated = await updateSpecialistHandoffStatus(
          normalizedIssueId,
          `${specialist}-agent`,
          status === 'passed' ? 'completed' : 'failed',
          status === 'passed' ? 'success' : 'failure',
        );
        if (updated) {
          console.log(`[specialists/done] Updated handoff log: ${specialist}-agent ${normalizedIssueId} → ${status}`);
        }
      } catch (err) {
        console.error(`[specialists/done] Error managing specialist state:`, err);
      }
    });

    // When review passes, snapshot the current HEAD commit so we can detect
    // if the agent makes new commits before merge (which invalidates the review).
    if (specialist === 'review' && status === 'passed') {
      yield* Effect.promise(async () => {
        try {
          const project = resolveProjectFromIssue(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              const { getWorkspaceGitInfo } = await import('../../../lib/git-utils.js');
              const { HEAD } = await getWorkspaceGitInfo(workspacePath);
              setReviewStatusBase(normalizedIssueId, { reviewedAtCommit: HEAD });
              console.log(`[specialists/done] Snapshotted reviewedAtCommit=${HEAD.substring(0, 8)} for ${normalizedIssueId}`);
            }
          }
        } catch (err) {
          console.error(`[specialists/done] Failed to snapshot reviewedAtCommit for ${normalizedIssueId}:`, err);
        }
      });
    }

    // When inspect specialist reports success, save checkpoint
    if (specialist === 'inspect' && status === 'passed') {
      yield* Effect.promise(async () => {
        try {
          const { onInspectComplete } = await import('../../../lib/cloister/inspect-agent.js');
          // Extract beadId from notes (format: "Bead <beadId> matches spec...")
          const beadMatch = notes?.match(/[Bb]ead\s+(\S+)/);
          const beadId = beadMatch?.[1] || 'unknown';
          // Resolve project to get workspace path
          const project = resolveProjectFromIssue(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              onInspectComplete(project.projectKey, normalizedIssueId, beadId, 'passed', workspacePath);

              // Sync bead completion to vBRIEF plan
              try {
                const updatedItemId = syncBeadStatusToVBrief(beadId, workspacePath, 'completed');
                if (updatedItemId) {
                  // Check which tasks are now unblocked and wake the work agent
                  try {
                    const unblockedItems = getUnblockedItems(workspacePath, updatedItemId);
                    if (unblockedItems.length > 0) {
                      console.log(
                        `[auto-wake] ${normalizedIssueId}: items unblocked after "${updatedItemId}": ${unblockedItems.join(', ')}`,
                      );
                      const workAgentId = `agent-${normalizedIssueId.toLowerCase()}`;
                      const doc = readWorkspacePlan(workspacePath);
                      const unblockedTitles = unblockedItems
                        .map((id) => {
                          const it = doc?.plan.items.find((i) => i.id === id);
                          return it ? `"${it.title}"` : `"${id}"`;
                        })
                        .join(', ');
                      const wakeMsg = `DAG SCHEDULER: Task${unblockedItems.length > 1 ? 's' : ''} now unblocked after completing "${updatedItemId}": ${unblockedTitles}. Pick up the next available task.`;
                      await messageAgent(workAgentId, wakeMsg).catch((err: unknown) => {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        console.log(
                          `[auto-wake] Could not wake ${workAgentId} (may not be running): ${errMsg}`,
                        );
                      });
                    }
                  } catch (wakeErr: unknown) {
                    const errMsg = wakeErr instanceof Error ? wakeErr.message : String(wakeErr);
                    console.warn(`[auto-wake] Failed to check unblocked items: ${errMsg}`);
                  }
                }
              } catch (syncErr: unknown) {
                const errMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
                console.warn(`[specialists/done] vBRIEF sync failed: ${errMsg}`);
              }
            }
          }
        } catch (err) {
          console.error(`[specialists/done] Error saving inspect checkpoint:`, err);
        }
      });
    }

    // When test specialist reports success, mark as ready for merge.
    // The post-rebase verification in triggerMerge() is the real quality gate —
    // don't block readyForMerge based on a potentially stale verification status.
    if (specialist === 'test' && status === 'passed') {
      try {
        const project = resolveProjectFromIssue(normalizedIssueId);
        if (project) {
          const workspacePath = join(
            project.projectPath,
            'workspaces',
            `feature-${normalizedIssueId.toLowerCase()}`,
          );
          if (existsSync(workspacePath)) {
            setReviewStatusBase(normalizedIssueId, { readyForMerge: true });
            console.log(`[specialists/done] ${normalizedIssueId} marked ready for merge after tests passed`);
          }
        }
      } catch (err) {
        console.error(`[specialists/done] Error marking ready for merge:`, err);
      }
    }

    // When merge specialist reports success, run post-merge lifecycle ONCE.
    // Use firePostMergeLifecycle directly rather than onMergeComplete: onMergeComplete
    // has a guard that checks mergeStatus !== 'merged', but setReviewStatusBase above
    // already set mergeStatus='merged' — that guard would always fire and the lifecycle
    // would never run. firePostMergeLifecycle skips that guard and uses _postMergeInFlight
    // (concurrency) + postMergeLifecycle's _completedPostMerge (defense-in-depth).
    if (specialist === 'merge' && status === 'passed') {
      firePostMergeLifecycle(normalizedIssueId);
    }

    // When any specialist reports failure, transition issue back to In Progress
    // (inspect failures don't change Linear status — they're mid-implementation gates).
    if (status === 'failed' && specialist !== 'inspect') {
      try {
        const project = resolveProjectFromIssue(normalizedIssueId);
        if (project) {
          const workspacePath = join(
            project.projectPath,
            'workspaces',
            `feature-${normalizedIssueId.toLowerCase()}`,
          );
          const wsPath = existsSync(workspacePath) ? workspacePath : undefined;
          transitionIssueToInProgress(normalizedIssueId, wsPath).catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[specialists/done] Could not transition ${normalizedIssueId} back to in_progress: ${errMsg}`,
            );
          });
          console.log(
            `[specialists/done] ${specialist} failed → transitioning ${normalizedIssueId} back to In Progress`,
          );
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[specialists/done] Could not transition issue back to in_progress:`, errMsg);
      }
    }

    // When merge fails, post a comment on the GitHub PR so the failure is visible
    // outside the dashboard, and send feedback to the work agent.
    if (specialist === 'merge' && status === 'failed') {
      yield* Effect.promise(async () => {
        try {
          // Post comment on the PR
          const reviewStatus = loadReviewStatuses()[normalizedIssueId];
          const prUrl = reviewStatus?.prUrl;
          if (prUrl) {
            // Extract owner/repo#number from PR URL
            const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (prMatch) {
              const [, owner, repo, prNumber] = prMatch;
              const commentBody = `## Merge Failed\n\n${notes || 'Merge could not be completed.'}\n\nThe issue has been moved back to In Progress. The work agent needs to resolve conflicts and resubmit.`;
              await execAsync(`gh api repos/${owner}/${repo}/issues/${prNumber}/comments -f body=${JSON.stringify(commentBody)}`, { encoding: 'utf-8' });
              console.log(`[specialists/done] Posted merge failure comment on ${prUrl}`);
            }
          }
        } catch (err: any) {
          console.warn(`[specialists/done] Failed to post merge failure comment: ${err.message}`);
        }
      });

      // If merge failed due to conflicts, send rebase instructions to the work agent.
      if (notes?.toLowerCase().includes('conflict')) {
        yield* Effect.promise(async () => {
          try {
            const workAgentId = `agent-${normalizedIssueId.toLowerCase()}`;
            const { sessionExists } = await import('../../../lib/tmux.js');
            const { messageAgent, spawnAgent, getAgentState } = await import('../../../lib/agents.js');

            if (sessionExists(workAgentId)) {
              // Agent is running — send rebase instructions directly
              const rebaseMsg = `MERGE CONFLICT: The merge-agent could not rebase your branch onto main due to conflicts. Please fix this now:\n\n1. git fetch origin main\n2. git rebase origin/main\n3. Resolve any conflicts (git add <file> && git rebase --continue)\n4. git push --force-with-lease\n5. Resubmit: curl -s -X POST http://localhost:3011/api/review/${normalizedIssueId}/request -H "Content-Type: application/json" -d "{}"\n\nConflict details: ${notes}`;
              await messageAgent(workAgentId, rebaseMsg);
              console.log(`[specialists/done] Sent rebase instructions to ${workAgentId}`);
            } else {
              // Agent is stopped — start fresh (don't resume, sessions may be corrupted: PAN-612)
              console.log(`[specialists/done] Work agent ${workAgentId} not running — will need manual restart or next pan start dispatch`);
            }
          } catch (err: any) {
            console.warn(`[specialists/done] Failed to send rebase feedback to work agent: ${err.message}`);
          }
        });
      }
    }

    // When review fails or is blocked, send feedback to work agent so it can fix the issues
    if (specialist === 'review' && (status === 'failed' || status === 'blocked') && notes) {
      yield* Effect.promise(async () => {
        try {
          const workAgentId = `agent-${normalizedIssueId.toLowerCase()}`;
          const { sessionExists } = await import('../../../lib/tmux.js');
          const { messageAgent } = await import('../../../lib/agents.js');

          if (sessionExists(workAgentId)) {
            const reviewMsg = `REVIEW FEEDBACK: The review specialist found issues that must be fixed:\n\n${notes}\n\nPlease address all issues, push your changes, then re-request review with: pan review request ${normalizedIssueId} -m "Fixed review issues"`;
            await messageAgent(workAgentId, reviewMsg);
            console.log(`[specialists/done] Sent review feedback to ${workAgentId}`);
          }
        } catch (err: any) {
          console.warn(`[specialists/done] Failed to send review feedback: ${err.message}`);
        }
      });
    }

    // Emit domain event for specialist completion/failure
    if (status === 'passed') {
      yield* eventStore.append({
        type: 'specialist.completed',
        timestamp: new Date().toISOString(),
        payload: { name: `${specialist}-agent`, issueId: normalizedIssueId },
      });
    } else {
      yield* eventStore.append({
        type: 'specialist.failed',
        timestamp: new Date().toISOString(),
        payload: { name: `${specialist}-agent`, issueId: normalizedIssueId, error: notes || `${specialist} failed` },
      });
    }

    return jsonResponse({
      success: true,
      specialist,
      issueId: normalizedIssueId,
      status,
      notes,
      currentStatus: updatedStatus,
    });
  })),
);

// ─── Route: POST /api/specialists/logs/cleanup-all ────────────────────────────
// NOTE: Must be registered before /:project/:type routes.

const postSpecialistsLogsCleanupAllRoute = HttpRouter.add(
  'POST',
  '/api/specialists/logs/cleanup-all',
  httpHandler(Effect.gen(function* () {
    const { cleanupAllLogs } = yield* Effect.promise(() => import('../../../lib/cloister/specialist-logs.js'));
    const results = cleanupAllLogs();

    return jsonResponse({
      success: true,
      totalDeleted: results.totalDeleted,
      byProject: results.byProject,
      message: `Cleaned up ${results.totalDeleted} old logs`,
    });
  })),
);

// ─── Route: GET /api/specialists/projects ────────────────────────────────────
// NOTE: Must be registered before /:name routes.

const getSpecialistsProjectsRoute = HttpRouter.add(
  'GET',
  '/api/specialists/projects',
  httpHandler(Effect.gen(function* () {
    const { getAllProjectSpecialistStatuses } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const specialists = yield* Effect.promise(() => getAllProjectSpecialistStatuses());
    return jsonResponse(specialists);
  })),
);

// ─── Route: POST /api/specialists/:name/wake ─────────────────────────────────

const postSpecialistWakeRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/wake',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const { sessionId } = body as { sessionId?: string };
    const eventStore = yield* EventStoreService;

    const {
      getTmuxSessionName,
      getSessionId,
      recordWake,
      isRunning,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    if (yield* Effect.promise(() => isRunning(name as SpecialistType))) {
      return jsonResponse(
        { error: `Specialist ${name} is already running` },
        { status: 400 },
      );
    }

    const existingSessionId = getSessionId(name as SpecialistType);
    const tmuxSession = getTmuxSessionName(name as SpecialistType);

    if (!existingSessionId && !sessionId) {
      return jsonResponse(
        {
          error: 'No session ID found. Specialist must be initialized first or provide sessionId in request.',
        },
        { status: 400 },
      );
    }

    const useSessionId = sessionId || existingSessionId;

    // Get specialist model from work-type router (config.yaml)
    let specModel = 'claude-sonnet-4-6';
    try {
      const { getModelId } = yield* Effect.promise(() => import('../../../lib/work-type-router.js'));
      const workTypeId = `specialist-${name}` as any;
      specModel = getModelId(workTypeId);
    } catch { /* fall back to default */ }
    const specCmd = getAgentCommand(specModel);
    const specCmdWithArgs =
      specCmd.args.length > 0
        ? `${specCmd.command} ${specCmd.args.join(' ')} --dangerously-skip-permissions --permission-mode bypassPermissions`
        : `${specCmd.command} --dangerously-skip-permissions --permission-mode bypassPermissions`;

    const cwd = homedir();
    yield* Effect.promise(() => createSessionAsync(
      tmuxSession,
      cwd,
      `${specCmdWithArgs} --resume ${useSessionId}`,
    ));

    recordWake(name as SpecialistType, useSessionId!);

    yield* eventStore.append({
      type: 'specialist.started',
      timestamp: new Date().toISOString(),
      payload: {
        specialist: {
          name: name as SpecialistType,
          state: 'active',
          isRunning: true,
          lastWake: new Date().toISOString(),
        },
      },
    });

    return jsonResponse({
      success: true,
      message: `Specialist ${name} woken up`,
      tmuxSession,
      sessionId: useSessionId,
    });
  })),
);

// ─── Route: POST /api/specialists/:name/reset ─────────────────────────────────

const postSpecialistResetRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const { reinitialize = false } = body as { reinitialize?: boolean };

    const {
      clearSessionId,
      isRunning,
      getTmuxSessionName,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    if (yield* Effect.promise(() => isRunning(name as SpecialistType))) {
      const tmuxSession = getTmuxSessionName(name as SpecialistType);
      return jsonResponse(
        {
          error: `Specialist ${name} is currently running. Stop it first (tmux kill-session -t ${tmuxSession})`,
        },
        { status: 400 },
      );
    }

    const wasDeleted = clearSessionId(name as SpecialistType);

    if (reinitialize) {
      // TODO: Add initialization logic if needed
      // For now, just clearing is sufficient
    }

    return jsonResponse({
      success: true,
      message: `Specialist ${name} reset`,
      sessionCleared: wasDeleted,
    });
  })),
);

// ─── Route: POST /api/specialists/:name/init ──────────────────────────────────

const postSpecialistInitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/init',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;

    const { initializeSpecialist } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const result = yield* Effect.promise(() => initializeSpecialist(name as SpecialistType));

    if (!result.success) {
      return jsonResponse({ error: result.message }, { status: 400 });
    }

    return jsonResponse({
      success: true,
      message: result.message,
      tmuxSession: result.tmuxSession,
      note: 'Session ID will be available after Claude responds. Use "claude config get sessionId" in the tmux session to get it, then update via /reset with reinitialize.',
    });
  })),
);

// ─── Route: POST /api/specialists/:name/report-status ────────────────────────

const postSpecialistReportStatusRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/report-status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { issueId, status, notes } = body as {
      issueId?: string;
      status?: string;
      notes?: string;
    };

    if (!issueId || !status) {
      return jsonResponse(
        { error: 'issueId and status required' },
        { status: 400 },
      );
    }

    if (!['passed', 'blocked', 'failed', 'in-progress'].includes(status)) {
      return jsonResponse(
        { error: 'status must be: passed, blocked, failed, or in-progress' },
        { status: 400 },
      );
    }

    // Write status to specialist's state directory
    const specialistDir = join(homedir(), '.panopticon', 'specialists', name);
    yield* Effect.promise(() => mkdir(specialistDir, { recursive: true }));

    const statusFile = join(specialistDir, `${issueId}-status.json`);
    const statusData = {
      issueId,
      specialist: name,
      status,
      notes: notes || '',
      timestamp: new Date().toISOString(),
    };

    yield* Effect.promise(() => writeFile(statusFile, JSON.stringify(statusData, null, 2)));

    console.log(`[specialists] ${name} reported status for ${issueId}: ${status}`);

    // When specialist reports completion (passed/blocked/failed), set state to idle
    if (['passed', 'blocked', 'failed'].includes(status)) {
      const { getTmuxSessionName } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
      const tmuxSession = getTmuxSessionName(name as SpecialistType);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });
    }

    // Emit domain event based on status
    if (status === 'passed') {
      yield* eventStore.append({
        type: 'specialist.completed',
        timestamp: new Date().toISOString(),
        payload: { name: name as SpecialistType, issueId },
      });
    } else if (status === 'failed' || status === 'blocked') {
      yield* eventStore.append({
        type: 'specialist.failed',
        timestamp: new Date().toISOString(),
        payload: { name: name as SpecialistType, issueId, error: notes || `${name} reported ${status}` },
      });
    }

    return jsonResponse({ success: true });
  })),
);

// ─── Route: GET /api/specialists/:name/cost ───────────────────────────────────

const getSpecialistCostRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:name/cost',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;

    const { getSessionId } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const sessionId = getSessionId(name as SpecialistType);

    if (!sessionId) {
      return jsonResponse({ cost: 0, inputTokens: 0, outputTokens: 0 });
    }

    // Find the JSONL session file
    const homeDir = process.env.HOME || homedir();
    const claudeProjectsDir = join(homeDir, '.claude', 'projects');

    const projectDirName = encodeClaudeProjectDir(homeDir);
    const projectDir = join(claudeProjectsDir, projectDirName);
    const sessionsIndexPath = join(projectDir, 'sessions-index.json');

    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = '';

    if (existsSync(sessionsIndexPath)) {
      const indexContent = JSON.parse(yield* Effect.promise(() => readFile(sessionsIndexPath, 'utf-8')));
      const sessionEntry = indexContent.entries?.find(
        (e: { sessionId: string }) => e.sessionId === sessionId,
      );

      if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
        const jsonlContent = yield* Effect.promise(() => readFile(sessionEntry.fullPath, 'utf-8'));
        const lines = jsonlContent.split('\n').filter((l: string) => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const usage = entry.message?.usage || entry.usage;
            const model = entry.message?.model || entry.model;

            if (usage) {
              inputTokens += usage.input_tokens || 0;
              outputTokens += usage.output_tokens || 0;
              cacheReadTokens += usage.cache_read_input_tokens || 0;
              cacheWriteTokens += usage.cache_creation_input_tokens || 0;
            }
            if (model && !detectedModel) {
              detectedModel = model;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      const modelInfo = normalizeModelName(detectedModel || 'claude-sonnet-4');
      const pricing = getPricing(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCost(usage, pricing);
      }
    }

    return jsonResponse({
      cost,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      model: detectedModel,
    });
  })),
);

// ─── Route: POST /api/specialists/:name/auto-complete ────────────────────────

const postSpecialistAutoCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/auto-complete',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { issueId, status } = body as { issueId?: string; status?: string };

    if (!issueId || !status) {
      return jsonResponse(
        { error: 'issueId and status required' },
        { status: 400 },
      );
    }

    console.log(`[specialists] Auto-detected completion for ${name}: ${issueId} -> ${status}`);

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return jsonResponse(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    const {
      getTmuxSessionName,
      spawnEphemeralSpecialist,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    const tmuxSession = getTmuxSessionName(name as SpecialistType);

    // Set specialist to idle and clear currentIssue
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
      currentIssue: undefined,
    });

    // Update review/test status based on specialist type
    const existingStatus = getReviewStatus(issueId);

    if (name === 'review-agent') {
      const alreadyReported =
        existingStatus?.reviewNotes &&
        !existingStatus.reviewNotes.startsWith('Auto-detected:');
      if (alreadyReported) {
        console.log(
          `[specialists] Skipping auto-detect for ${name}/${issueId}: specialist already reported (${existingStatus!.reviewStatus})`,
        );
      } else {
        setReviewStatusBase(issueId, {
          reviewStatus: status === 'passed' ? 'passed' : 'blocked',
          reviewNotes: `Auto-detected: ${status}`,
        });
      }

      // If passed (by either method), dispatch test-agent immediately
      const effectiveReviewStatus = alreadyReported
        ? existingStatus!.reviewStatus
        : status === 'passed'
        ? 'passed'
        : 'blocked';
      if (effectiveReviewStatus === 'passed') {
        // Get workspace info from work agent state
        const workAgentId = `agent-${issueId.toLowerCase()}`;
        const workStateFile = join(
          homedir(),
          '.panopticon',
          'agents',
          workAgentId,
          'state.json',
        );
        let workspace: string | undefined;
        let branch: string | undefined;

        if (existsSync(workStateFile)) {
          try {
            const workState = JSON.parse(yield* Effect.promise(() => readFile(workStateFile, 'utf-8')));
            workspace = workState.workspace;
            branch = workState.branch || `feature/${issueId.toLowerCase()}`;
          } catch {}
        }

        const resolved = resolveProjectFromIssue(issueId);
        if (resolved) {
          const result = yield* Effect.promise(() => spawnEphemeralSpecialist(resolved.projectKey, 'test-agent', {
            issueId,
            workspace,
            branch,
          }));
          if (result.success) {
            setReviewStatusBase(issueId, { testStatus: 'testing' });
            console.log(`[specialists] Dispatched test-agent for ${issueId} after review passed`);
          } else {
            setReviewStatusBase(issueId, {
              testStatus: 'dispatch_failed',
              testNotes: `Test specialist dispatch failed: ${result.message || result.error}. Deacon will retry.`,
            });
            console.log(`[specialists] Test-agent dispatch failed for ${issueId}: ${result.message || result.error}`);
          }
        } else {
          console.warn(`[specialists] Cannot dispatch test-agent for ${issueId}: no project configured`);
        }
      }
    } else if (name === 'test-agent') {
      const alreadyReported =
        existingStatus?.testNotes && !existingStatus.testNotes.startsWith('Auto-detected:');
      if (alreadyReported) {
        console.log(
          `[specialists] Skipping auto-detect for ${name}/${issueId}: specialist already reported (${existingStatus!.testStatus})`,
        );
      } else {
        const testPassed = status === 'passed';
        setReviewStatusBase(issueId, {
          testStatus: testPassed ? 'passed' : 'failed',
          testNotes: `Auto-detected: ${status}`,
          // Set readyForMerge when test passes. Post-rebase verification in
          // triggerMerge() is the real quality gate, not stale pre-merge verification.
          // Without this, issues that go through per-project specialists never
          // transition to readyForMerge (PAN-615).
          ...(testPassed ? { readyForMerge: true } : {}),
        });
        if (testPassed) {
          console.log(`[specialists] ${issueId} marked ready for merge after auto-detected test pass`);
        }
      }
    }

    yield* eventStore.append({
      type: 'specialist.completed',
      timestamp: new Date().toISOString(),
      payload: { name: name as SpecialistType, issueId },
    });

    return jsonResponse({
      success: true,
      status,
      issueId,
    });
  })),
);

// ─── Route: GET /api/specialists/:project/:issueId/:type/status ───────────────

const getProjectSpecialistStatusRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:issueId/:type/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const {
      makeSpecialistRegistryKey,
      getRunMetadata,
      getTmuxSessionName,
      isProjectSpecialistActivelyRunning,
    } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const { getAgentRuntimeState } = yield* Effect.promise(() => import('../../../lib/agents.js'));

    const registryKey = makeSpecialistRegistryKey(type, issueId);
    const metadata = getRunMetadata(project, registryKey);
    const tmuxSession = metadata.tmuxSession ?? getTmuxSessionName(type, project, issueId);
    const runtimeState = getAgentRuntimeState(tmuxSession);
    const isRunning = isProjectSpecialistActivelyRunning(runtimeState, metadata.currentRun !== null);

    return jsonResponse({
      name: type,
      state: isRunning ? 'active' : 'sleeping',
      isRunning,
      tmuxSession,
      currentIssue: issueId,
      sessionId: metadata.sessionId,
      contextTokens: undefined,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:issueId/:type/kill ───────────────

const postProjectSpecialistKillRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:issueId/:type/kill',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const issueId = params['issueId'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { getTmuxSessionName, makeSpecialistRegistryKey, getRunMetadata } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    const registryKey = makeSpecialistRegistryKey(type, issueId);
    const tmuxSession = getRunMetadata(project, registryKey).tmuxSession
      ?? getTmuxSessionName(type, project, issueId);

    yield* Effect.promise(() => killSessionAsync(tmuxSession).catch(() => {}));
    // Do NOT clearSessionId — the Claude session persists and should be resumed on next dispatch
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    return jsonResponse({
      success: true,
      message: `Killed ${type} (${project}/${issueId})`,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/spawn ───────────────────────

const postProjectSpecialistSpawnRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/spawn',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const body = yield* readJsonBody;
    const { issueId, branch, workspace, prUrl, context } = body as {
      issueId?: string;
      branch?: string;
      workspace?: string;
      prUrl?: string;
      context?: unknown;
    };

    if (!issueId) {
      return jsonResponse({ error: 'issueId is required' }, { status: 400 });
    }

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { spawnEphemeralSpecialist } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const result = yield* Effect.promise(() => spawnEphemeralSpecialist(project, type, {
      issueId,
      branch,
      workspace,
      prUrl,
      context,
    }));

    if (result.success) {
      return jsonResponse(result);
    } else {
      return jsonResponse({ error: result.message }, { status: 500 });
    }
  })),
);

// ─── Route: GET /api/specialists/:project/:type/runs ──────────────────────────

const getProjectSpecialistRunsRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);

    let limit: number | undefined;
    let offset = 0;

    if (Option.isSome(urlOpt)) {
      const sp = urlOpt.value.searchParams;
      const limitParam = sp.get('limit');
      const offsetParam = sp.get('offset');
      if (limitParam) limit = parseInt(limitParam, 10);
      if (offsetParam) offset = parseInt(offsetParam, 10);
    }

    const { listRunLogs } = yield* Effect.promise(() => import('../../../lib/cloister/specialist-logs.js'));
    const runs = listRunLogs(project, type, { limit, offset });
    return jsonResponse(runs);
  })),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId/stream ────────────
// NOTE: Must be registered before /:project/:type/runs/:runId to avoid route conflict.

const getProjectSpecialistRunStreamRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId/stream',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    const { getRunLogPath, isRunLogActive } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialist-logs.js'));

        const logPath = getRunLogPath(project, type, runId);

        if (!existsSync(logPath)) {
          return jsonResponse({ error: 'Run log not found' }, { status: 404 });
        }

        // Build an SSE stream using Effect Stream + Node ReadableStream
        const encoder = new TextEncoder();

        const nodeStream = new ReadableStream({
          async start(controller) {
            // Send initial content
            const content = await readFile(logPath, 'utf-8').catch(() => '');
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'content', data: content })}\n\n`,
              ),
            );
            let lastSize = content.length;

            // Poll for updates
            const poll = async () => {
              if (!isRunLogActive(project, type, runId)) {
                // Log completed — send final update and close
                try {
                  const finalContent = await readFile(logPath, 'utf-8');
                  if (finalContent.length > lastSize) {
                    const newContent = finalContent.substring(lastSize);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`,
                      ),
                    );
                  }
                } catch {}
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`),
                );
                controller.close();
                return;
              }

              try {
                const currentContent = await readFile(logPath, 'utf-8');
                if (currentContent.length > lastSize) {
                  const newContent = currentContent.substring(lastSize);
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'append', data: newContent })}\n\n`,
                    ),
                  );
                  lastSize = currentContent.length;
                }
              } catch {}

              await new Promise((r) => setTimeout(r, 1000));
              await poll();
            };

            await new Promise((r) => setTimeout(r, 1000));
            await poll();
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
  })),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId ───────────────────

const getProjectSpecialistRunRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    const { getRunLog, parseLogMetadata } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialist-logs.js'));
    const content = getRunLog(project, type, runId);

    if (!content) {
      return jsonResponse({ error: 'Run log not found' }, { status: 404 });
    }

    const metadata = parseLogMetadata(content);
    return jsonResponse({ runId, content, metadata });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/runs/:runId/terminate ────────

const postProjectSpecialistRunTerminateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/runs/:runId/terminate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { terminateSpecialist } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    yield* Effect.promise(() => terminateSpecialist(project, type));
    return jsonResponse({ success: true, message: 'Specialist terminated' });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/pause ──────────────────

const postProjectSpecialistGracePauseRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/pause',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { pauseGracePeriod } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const success = pauseGracePeriod(project, type);

    if (success) {
      return jsonResponse({ success: true, message: 'Grace period paused' });
    } else {
      return jsonResponse(
        { error: 'No active grace period to pause' },
        { status: 400 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/resume ─────────────────

const postProjectSpecialistGraceResumeRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/resume',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { resumeGracePeriod } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const success = resumeGracePeriod(project, type);

    if (success) {
      return jsonResponse({ success: true, message: 'Grace period resumed' });
    } else {
      return jsonResponse(
        { error: 'No paused grace period to resume' },
        { status: 400 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/grace/exit ───────────────────

const postProjectSpecialistGraceExitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/exit',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { exitGracePeriod } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    exitGracePeriod(project, type);
    return jsonResponse({
      success: true,
      message: 'Specialist terminated immediately',
    });
  })),
);

// ─── Route: GET /api/specialists/:project/:type/grace ────────────────────────

const getProjectSpecialistGraceRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/grace',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { getGracePeriodState } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const state = getGracePeriodState(project, type);

    if (state) {
      return jsonResponse(state);
    } else {
      return jsonResponse({ error: 'No active grace period' }, { status: 404 });
    }
  })),
);

// ─── Route: GET /api/specialists/:project/:type/context ──────────────────────

const getProjectSpecialistContextRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/context',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { loadContextDigest } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialist-context.js'));
    const digest = loadContextDigest(project, type);

    if (digest) {
      return jsonResponse({ digest });
    } else {
      return jsonResponse({ error: 'No context digest found' }, { status: 404 });
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/context/regenerate ───────────

const postProjectSpecialistContextRegenerateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/context/regenerate',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { regenerateContextDigest } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialist-context.js'));
    const digest = yield* Effect.promise(() => regenerateContextDigest(project, type));

    if (digest) {
      return jsonResponse({ digest, message: 'Context digest regenerated' });
    } else {
      return jsonResponse(
        { error: 'Failed to generate context digest' },
        { status: 500 },
      );
    }
  })),
);

// ─── Route: POST /api/specialists/:project/:type/complete ─────────────────────

const postProjectSpecialistCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/complete',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const body = yield* readJsonBody;
    const { status, notes, issueId } = body as { status?: string; notes?: string; issueId?: string };

    if (!status || !['passed', 'failed', 'blocked'].includes(status)) {
      return jsonResponse(
        { error: 'Valid status (passed/failed/blocked) is required' },
        { status: 400 },
      );
    }

    if (!validateSpecialistType(type)) {
      return jsonResponse(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    const { signalSpecialistCompletion } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    signalSpecialistCompletion(project, type, { status, notes }, issueId);
    return jsonResponse({
      success: true,
      message: 'Specialist completion signaled, grace period started',
    });
  })),
);

// ─── Route: GET /api/specialists/:project/:type/latest-log ───────────────────

const getProjectSpecialistLatestLogRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/latest-log',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const runsDir = join(homedir(), '.panopticon', 'specialists', project, type, 'runs');
    if (!existsSync(runsDir)) {
      return jsonResponse({ log: null, message: 'No runs found' });
    }

    const files = (yield* Effect.promise(() => readdir(runsDir)))
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return jsonResponse({ log: null, message: 'No run logs found' });
    }

    const latestLog = yield* Effect.promise(() => readFile(join(runsDir, files[0]), 'utf-8'));
    return jsonResponse({
      log: latestLog,
      file: files[0],
      totalRuns: files.length,
    });
  })),
);

// ─── Route: POST /api/specialists/:project/:type/logs/cleanup ────────────────

const postProjectSpecialistLogsCleanupRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/logs/cleanup',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    const { cleanupOldLogs } = yield* Effect.promise(() => import('../../../lib/cloister/specialist-logs.js'));
    const { getSpecialistRetention } = yield* Effect.promise(() => import('../../../lib/projects.js'));

    const retention = getSpecialistRetention(project);
    const deleted = cleanupOldLogs(project, type, retention);

    return jsonResponse({
      success: true,
      deleted,
      message: `Cleaned up ${deleted} old logs`,
    });
  })),
);

// ─── Route: POST /api/specialists/projects/:project/:name/reset-session ───────
// Bumps the session generation so the next dispatch starts a fresh Claude session.
// Old JSONL files are preserved.

const postProjectSpecialistResetSessionRoute = HttpRouter.add(
  'POST',
  '/api/specialists/projects/:project/:name/reset-session',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const projectKey = params['project'] ?? '';
    const name = params['name'] ?? '';

    const { bumpSessionGeneration } = yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));
    const specialistType = name as any;
    const newGen = bumpSessionGeneration(specialistType, projectKey);

    // Also kill the tmux session so it doesn't linger with old context.
    // NOTE: try/catch does NOT work with yield* in Effect.gen — use .catch() in the Promise chain.
    const tmuxSession = `specialist-${projectKey}-${name}`;
    yield* Effect.promise(() =>
      killSessionAsync(tmuxSession)
        .catch(() => { /* no session to kill */ })
    );

    console.log(`[specialist] Reset session for ${projectKey}/${name} → generation ${newGen}`);
    return jsonResponse({ success: true, specialist: name, project: projectKey, generation: newGen });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────
//
// ORDERING RULES (important for Effect HttpRouter):
//  1. Static routes before parameterized routes (/api/specialists/reset-all before /:name/reset)
//  2. More specific parameterized paths before less specific (/runs/:runId/stream before /runs/:runId)
//  3. All /api/specialists/done, /queues, /projects, /reset-all, /logs/cleanup-all
//     MUST precede /:name/* routes to avoid param capture.

export const specialistsRouteLayer = Layer.mergeAll(
  // ── Static-segment routes (must come first) ──
  getSpecialistsRoute,
  getSpecialistsProjectsRoute,
  postSpecialistsResetAllRoute,
  postSpecialistsDoneRoute,
  postSpecialistsLogsCleanupAllRoute,

  // ── Legacy /api/specialists/:name/* routes ──
  postSpecialistWakeRoute,
  postSpecialistResetRoute,
  postSpecialistInitRoute,
  postSpecialistReportStatusRoute,
  getSpecialistCostRoute,
  postSpecialistAutoCompleteRoute,

  // ── Per-project /api/specialists/:project/:type/* routes ──
  getProjectSpecialistStatusRoute,
  postProjectSpecialistKillRoute,
  postProjectSpecialistSpawnRoute,
  getProjectSpecialistRunsRoute,
  getProjectSpecialistRunStreamRoute,       // /runs/:runId/stream — before /runs/:runId
  getProjectSpecialistRunRoute,             // /runs/:runId
  postProjectSpecialistRunTerminateRoute,   // /runs/:runId/terminate
  postProjectSpecialistGracePauseRoute,     // /grace/pause
  postProjectSpecialistGraceResumeRoute,    // /grace/resume
  postProjectSpecialistGraceExitRoute,      // /grace/exit
  getProjectSpecialistGraceRoute,           // /grace
  getProjectSpecialistContextRoute,         // /context
  postProjectSpecialistContextRegenerateRoute, // /context/regenerate
  postProjectSpecialistCompleteRoute,       // /complete
  getProjectSpecialistLatestLogRoute,       // /latest-log
  postProjectSpecialistLogsCleanupRoute,    // /logs/cleanup
  postProjectSpecialistResetSessionRoute,  // /reset-session
);

export default specialistsRouteLayer;
