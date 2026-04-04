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
 *   GET    /api/specialists/:project/:type/status
 *   POST   /api/specialists/:project/:type/kill
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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { loadSettings, getAgentCommand } from '../../../lib/settings.js';
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

  const issuePrefix = issueId.split('-')[0];
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
  Effect.tryPromise({
    try: async () => {
      const {
        getAllSpecialistStatus,
        getAllProjectSpecialistStatuses,
      } = await import('../../../lib/cloister/specialists.js');

      const legacySpecialists = await getAllSpecialistStatus();
      const projectSpecialists = await getAllProjectSpecialistStatuses();

      return HttpServerResponse.json({
        specialists: legacySpecialists,
        projects: projectSpecialists,
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting specialists:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get specialists: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: POST /api/specialists/reset-all ───────────────────────────────────
// NOTE: Must be registered before /:name/reset to avoid "reset-all" matching as :name

const postSpecialistsResetAllRoute = HttpRouter.add(
  'POST',
  '/api/specialists/reset-all',
  Effect.tryPromise({
    try: async () => {
      const {
        getAllSpecialists,
        clearSessionId,
        isRunning,
        getTmuxSessionName,
      } = await import('../../../lib/cloister/specialists.js');
      const { clearHook } = await import('../../../lib/hooks.js');

      const specialists = getAllSpecialists();
      const results: { name: string; killed: boolean; sessionCleared: boolean; queueCleared: boolean }[] = [];

      for (const specialist of specialists) {
        const name = specialist.name;
        let killed = false;

        if (isRunning(name)) {
          const tmuxSession = getTmuxSessionName(name);
          try {
            await execAsync(`tmux kill-session -t "${tmuxSession}"`);
            killed = true;
          } catch {
            // Session might not exist, continue
          }
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

      return HttpServerResponse.json({
        success: true,
        message: `Reset ${results.length} specialists, cleared queues, reset ${reviewStatusesReset} review statuses`,
        results,
        reviewStatusesReset,
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error resetting all specialists:', error);
      return HttpServerResponse.json(
        { error: 'Failed to reset specialists: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: POST /api/specialists/done ───────────────────────────────────────
// CRITICAL: This endpoint has idempotency guards — see CLAUDE.md.
// Must be registered before /:name/* routes to prevent "done" matching as :name.

const postSpecialistsDoneRoute = HttpRouter.add(
  'POST',
  '/api/specialists/done',
  Effect.gen(function* () {
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
      return HttpServerResponse.json(
        { error: `Invalid specialist: ${specialist}. Valid: ${validSpecialists.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate status
    if (!status || !['passed', 'failed'].includes(status)) {
      return HttpServerResponse.json(
        { error: `Invalid status: ${status}. Must be 'passed' or 'failed'` },
        { status: 400 },
      );
    }

    // Validate issueId
    if (!issueId) {
      return HttpServerResponse.json({ error: 'issueId is required' }, { status: 400 });
    }

    const normalizedIssueId = issueId.toUpperCase();
    console.log(`[specialists/done] ${specialist} signaling ${status} for ${normalizedIssueId}`);

    // GUARD: If this issue is in a server-managed merge (polyrepo), the server handles
    // the merge lifecycle. Acknowledge the agent's call but do NOT trigger onMergeComplete.
    if (specialist === 'merge' && _serverManagedMerges.has(normalizedIssueId)) {
      console.log(`[specialists/done] ${normalizedIssueId} is server-managed merge — acknowledging without triggering lifecycle`);
      return HttpServerResponse.json({
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

    // Set specialist state to idle and clear queue.
    // CRITICAL: No `await` between the mergeStatus write above and the guard check below.
    yield* Effect.promise(async () => {
      try {
        const { getTmuxSessionName, checkSpecialistQueue, completeSpecialistTask } =
          await import('../../../lib/cloister/specialists.js');
        const tmuxSession = getTmuxSessionName(`${specialist}-agent` as SpecialistType);
        saveAgentRuntimeState(tmuxSession, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });
        console.log(`[specialists/done] Set ${specialist}-agent to idle`);

        // Clear this issue from the specialist's queue
        const queue = checkSpecialistQueue(`${specialist}-agent` as SpecialistType);
        for (const item of queue.items) {
          if (item.payload?.issueId?.toLowerCase() === normalizedIssueId.toLowerCase()) {
            completeSpecialistTask(`${specialist}-agent` as SpecialistType, item.id);
            console.log(`[specialists/done] Cleared ${normalizedIssueId} from ${specialist}-agent queue`);
          }
        }
      } catch (err) {
        console.error(`[specialists/done] Error managing specialist state:`, err);
      }
    });

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

    // Emit domain event for specialist completion/failure
    if (status === 'passed') {
      Effect.runSync(eventStore.append({
        type: 'specialist.completed',
        timestamp: new Date().toISOString(),
        payload: { name: `${specialist}-agent`, issueId: normalizedIssueId },
      }));
    } else {
      Effect.runSync(eventStore.append({
        type: 'specialist.failed',
        timestamp: new Date().toISOString(),
        payload: { name: `${specialist}-agent`, issueId: normalizedIssueId, error: notes || `${specialist} failed` },
      }));
    }

    return HttpServerResponse.json({
      success: true,
      specialist,
      issueId: normalizedIssueId,
      status,
      notes,
      currentStatus: updatedStatus,
    });
  }),
);

// ─── Route: POST /api/specialists/logs/cleanup-all ────────────────────────────
// NOTE: Must be registered before /:project/:type routes.

const postSpecialistsLogsCleanupAllRoute = HttpRouter.add(
  'POST',
  '/api/specialists/logs/cleanup-all',
  Effect.tryPromise({
    try: async () => {
      const { cleanupAllLogs } = await import('../../../lib/cloister/specialist-logs.js');
      const results = cleanupAllLogs();

      return HttpServerResponse.json({
        success: true,
        totalDeleted: results.totalDeleted,
        byProject: results.byProject,
        message: `Cleaned up ${results.totalDeleted} old logs`,
      });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error cleaning up all logs:', error);
      return HttpServerResponse.json(
        { error: 'Failed to clean up logs: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/specialists/queues ───────────────────────────────────────
// NOTE: Must be registered before /:name/queue to avoid "queues" matching as :name.

const getSpecialistQueuesRoute = HttpRouter.add(
  'GET',
  '/api/specialists/queues',
  Effect.tryPromise({
    try: async () => {
      const { getAllSpecialists, checkSpecialistQueue } =
        await import('../../../lib/cloister/specialists.js');
      const specialists = getAllSpecialists();

      const queues = await Promise.all(
        specialists.map(async (specialist) => {
          const queue = checkSpecialistQueue(specialist.name);
          return {
            specialistName: specialist.name,
            hasWork: queue.hasWork,
            urgentCount: queue.urgentCount,
            totalCount: queue.items.length,
            items: queue.items,
          };
        }),
      );

      return HttpServerResponse.json({ queues });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting specialist queues:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get specialist queues: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/specialists/projects ────────────────────────────────────
// NOTE: Must be registered before /:name routes.

const getSpecialistsProjectsRoute = HttpRouter.add(
  'GET',
  '/api/specialists/projects',
  Effect.tryPromise({
    try: async () => {
      const { getAllProjectSpecialistStatuses } =
        await import('../../../lib/cloister/specialists.js');
      const specialists = await getAllProjectSpecialistStatuses();
      return HttpServerResponse.json(specialists);
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting project specialists:', error);
      return HttpServerResponse.json(
        { error: 'Failed to get project specialists: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: POST /api/specialists/:name/wake ─────────────────────────────────

const postSpecialistWakeRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/wake',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const { sessionId } = body as { sessionId?: string };
    const eventStore = yield* EventStoreService;

    return yield* Effect.tryPromise({
      try: async () => {
        const {
          getTmuxSessionName,
          getSessionId,
          recordWake,
          isRunning,
        } = await import('../../../lib/cloister/specialists.js');

        if (await isRunning(name as SpecialistType)) {
          return HttpServerResponse.json(
            { error: `Specialist ${name} is already running` },
            { status: 400 },
          );
        }

        const existingSessionId = getSessionId(name as SpecialistType);
        const tmuxSession = getTmuxSessionName(name as SpecialistType);

        if (!existingSessionId && !sessionId) {
          return HttpServerResponse.json(
            {
              error: 'No session ID found. Specialist must be initialized first or provide sessionId in request.',
            },
            { status: 400 },
          );
        }

        const useSessionId = sessionId || existingSessionId;

        // Get specialist model from settings
        const specSettings = loadSettings();
        const specModelKey = `${name}_agent` as keyof typeof specSettings.models.specialists;
        const specModel = specSettings.models.specialists[specModelKey] || 'claude-sonnet-4-6';
        const specCmd = getAgentCommand(specModel);
        const specCmdWithArgs =
          specCmd.args.length > 0
            ? `${specCmd.command} ${specCmd.args.join(' ')} --dangerously-skip-permissions`
            : `${specCmd.command} --dangerously-skip-permissions`;

        const cwd = homedir();
        await execAsync(
          `tmux new-session -d -s "${tmuxSession}" -c "${cwd}" "${specCmdWithArgs} --resume ${useSessionId}"`,
          { encoding: 'utf-8' },
        );

        recordWake(name as SpecialistType, useSessionId!);

        Effect.runSync(eventStore.append({
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
        }));

        return HttpServerResponse.json({
          success: true,
          message: `Specialist ${name} woken up`,
          tmuxSession,
          sessionId: useSessionId,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error waking specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to wake specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:name/reset ─────────────────────────────────

const postSpecialistResetRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/reset',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const { reinitialize = false } = body as { reinitialize?: boolean };

    return yield* Effect.tryPromise({
      try: async () => {
        const {
          clearSessionId,
          isRunning,
          getTmuxSessionName,
        } = await import('../../../lib/cloister/specialists.js');

        if (await isRunning(name as SpecialistType)) {
          const tmuxSession = getTmuxSessionName(name as SpecialistType);
          return HttpServerResponse.json(
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

        return HttpServerResponse.json({
          success: true,
          message: `Specialist ${name} reset`,
          sessionCleared: wasDeleted,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error resetting specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to reset specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:name/init ──────────────────────────────────

const postSpecialistInitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/init',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { initializeSpecialist } = await import('../../../lib/cloister/specialists.js');
        const result = await initializeSpecialist(name as SpecialistType);

        if (!result.success) {
          return HttpServerResponse.json({ error: result.message }, { status: 400 });
        }

        return HttpServerResponse.json({
          success: true,
          message: result.message,
          tmuxSession: result.tmuxSession,
          note: 'Session ID will be available after Claude responds. Use "claude config get sessionId" in the tmux session to get it, then update via /reset with reinitialize.',
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error initializing specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to initialize specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:name/report-status ────────────────────────

const postSpecialistReportStatusRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/report-status',
  Effect.gen(function* () {
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
      return HttpServerResponse.json(
        { error: 'issueId and status required' },
        { status: 400 },
      );
    }

    if (!['passed', 'blocked', 'failed', 'in-progress'].includes(status)) {
      return HttpServerResponse.json(
        { error: 'status must be: passed, blocked, failed, or in-progress' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        // Write status to specialist's state directory
        const specialistDir = join(homedir(), '.panopticon', 'specialists', name);
        mkdirSync(specialistDir, { recursive: true });

        const statusFile = join(specialistDir, `${issueId}-status.json`);
        const statusData = {
          issueId,
          specialist: name,
          status,
          notes: notes || '',
          timestamp: new Date().toISOString(),
        };

        writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

        console.log(`[specialists] ${name} reported status for ${issueId}: ${status}`);

        // When specialist reports completion (passed/blocked/failed), set state to idle
        if (['passed', 'blocked', 'failed'].includes(status)) {
          const { getTmuxSessionName } = await import('../../../lib/cloister/specialists.js');
          const tmuxSession = getTmuxSessionName(name as SpecialistType);
          saveAgentRuntimeState(tmuxSession, {
            state: 'idle',
            lastActivity: new Date().toISOString(),
          });
        }

        // Emit domain event based on status
        if (status === 'passed') {
          Effect.runSync(eventStore.append({
            type: 'specialist.completed',
            timestamp: new Date().toISOString(),
            payload: { name: name as SpecialistType, issueId },
          }));
        } else if (status === 'failed' || status === 'blocked') {
          Effect.runSync(eventStore.append({
            type: 'specialist.failed',
            timestamp: new Date().toISOString(),
            payload: { name: name as SpecialistType, issueId, error: notes || `${name} reported ${status}` },
          }));
        }

        return HttpServerResponse.json({ success: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error saving specialist status:', error);
        return HttpServerResponse.json(
          { error: 'Failed to save status: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:name/cost ───────────────────────────────────

const getSpecialistCostRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:name/cost',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { getSessionId } = await import('../../../lib/cloister/specialists.js');
        const sessionId = getSessionId(name as SpecialistType);

        if (!sessionId) {
          return HttpServerResponse.json({ cost: 0, inputTokens: 0, outputTokens: 0 });
        }

        // Find the JSONL session file
        const homeDir = process.env.HOME || homedir();
        const claudeProjectsDir = join(homeDir, '.claude', 'projects');

        const projectDirName = `-${homeDir.replace(/^\//, '').replace(/\//g, '-')}`;
        const projectDir = join(claudeProjectsDir, projectDirName);
        const sessionsIndexPath = join(projectDir, 'sessions-index.json');

        let cost = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
        let detectedModel = '';

        if (existsSync(sessionsIndexPath)) {
          const indexContent = JSON.parse(readFileSync(sessionsIndexPath, 'utf-8'));
          const sessionEntry = indexContent.entries?.find(
            (e: { sessionId: string }) => e.sessionId === sessionId,
          );

          if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
            const jsonlContent = readFileSync(sessionEntry.fullPath, 'utf-8');
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

        return HttpServerResponse.json({
          cost,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          model: detectedModel,
        });
      },
      catch: (error: unknown) => {
        console.error('Error getting specialist cost:', error);
        return HttpServerResponse.json({ cost: 0, inputTokens: 0, outputTokens: 0 });
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:name/queue ──────────────────────────────────

const getSpecialistQueueRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:name/queue',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return HttpServerResponse.json(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { checkSpecialistQueue } = await import('../../../lib/cloister/specialists.js');
        const queue = checkSpecialistQueue(name as SpecialistType);

        return HttpServerResponse.json({
          specialistName: name,
          hasWork: queue.hasWork,
          urgentCount: queue.urgentCount,
          totalCount: queue.items.length,
          items: queue.items,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error getting queue for ${name}:`, error);
        return HttpServerResponse.json(
          { error: `Failed to get queue for ${name}: ${msg}` },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:name/queue ─────────────────────────────────

const postSpecialistQueueRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/queue',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const {
      issueId,
      workspace,
      branch,
      customPrompt,
      priority = 'normal',
    } = body as {
      issueId?: string;
      workspace?: string;
      branch?: string;
      customPrompt?: string;
      priority?: string;
    };

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return HttpServerResponse.json(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    if (!issueId) {
      return HttpServerResponse.json({ error: 'issueId is required' }, { status: 400 });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { spawnEphemeralSpecialist, submitToSpecialistQueue } =
          await import('../../../lib/cloister/specialists.js');

        const resolved = resolveProjectFromIssue(issueId);
        if (!resolved) {
          return HttpServerResponse.json(
            { error: `No project configured for ${issueId}. Add it to projects.yaml.` },
            { status: 400 },
          );
        }

        const result = await spawnEphemeralSpecialist(resolved.projectKey, name as SpecialistType, {
          issueId,
          workspace,
          branch,
          promptOverride: customPrompt,
        });

        if (!result.success && result.error === 'specialist_busy') {
          submitToSpecialistQueue(name as SpecialistType, {
            priority: priority as 'urgent' | 'normal' | 'low',
            source: 'api-queue',
            issueId,
            workspace,
            branch,
          });
          return HttpServerResponse.json({
            success: true,
            queued: true,
            message: `${name} busy, task queued for ${issueId}`,
          });
        }

        return HttpServerResponse.json({
          success: result.success,
          queued: false,
          ...result,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error queuing work to ${name}:`, error);
        return HttpServerResponse.json(
          { error: `Failed to queue work to ${name}: ${msg}` },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: DELETE /api/specialists/:name/queue/:itemId ───────────────────────

const deleteSpecialistQueueItemRoute = HttpRouter.add(
  'DELETE',
  '/api/specialists/:name/queue/:itemId',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const itemId = params['itemId'] as string;

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return HttpServerResponse.json(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { completeSpecialistTask } = await import('../../../lib/cloister/specialists.js');
        const success = completeSpecialistTask(name as SpecialistType, itemId);

        if (!success) {
          return HttpServerResponse.json(
            { error: `Item ${itemId} not found in queue for ${name}` },
            { status: 404 },
          );
        }

        return HttpServerResponse.json({
          success: true,
          message: `Removed item ${itemId} from ${name}'s queue`,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error removing item from ${name}'s queue:`, error);
        return HttpServerResponse.json(
          { error: `Failed to remove item: ${msg}` },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: PUT /api/specialists/:name/queue/reorder ──────────────────────────

const putSpecialistQueueReorderRoute = HttpRouter.add(
  'PUT',
  '/api/specialists/:name/queue/reorder',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const { itemIds } = body as { itemIds?: unknown };

    if (!Array.isArray(itemIds)) {
      return HttpServerResponse.json(
        { error: 'itemIds must be an array' },
        { status: 400 },
      );
    }

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return HttpServerResponse.json(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { reorderHookItems } = await import('../../../lib/hooks.js');
        const success = reorderHookItems(name, itemIds as string[]);

        if (!success) {
          return HttpServerResponse.json(
            { error: 'Failed to reorder queue. Check that all item IDs are valid.' },
            { status: 400 },
          );
        }

        return HttpServerResponse.json({
          success: true,
          message: `Reordered queue for ${name}`,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error reordering queue for ${name}:`, error);
        return HttpServerResponse.json(
          { error: `Failed to reorder queue: ${msg}` },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:name/auto-complete ────────────────────────

const postSpecialistAutoCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/auto-complete',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { issueId, status } = body as { issueId?: string; status?: string };

    if (!issueId || !status) {
      return HttpServerResponse.json(
        { error: 'issueId and status required' },
        { status: 400 },
      );
    }

    console.log(`[specialists] Auto-detected completion for ${name}: ${issueId} -> ${status}`);

    if (!VALID_SPECIALIST_NAMES.includes(name)) {
      return HttpServerResponse.json(
        { error: `Invalid specialist name: ${name}` },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const {
          getTmuxSessionName,
          completeSpecialistTask,
          wakeSpecialistWithTask,
          checkSpecialistQueue,
          submitToSpecialistQueue,
        } = await import('../../../lib/cloister/specialists.js');

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

          // If passed (by either method), queue test-agent
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
                const workState = JSON.parse(readFileSync(workStateFile, 'utf-8'));
                workspace = workState.workspace;
                branch = workState.branch || `feature/${issueId.toLowerCase()}`;
              } catch {}
            }

            submitToSpecialistQueue('test-agent', {
              priority: 'high',
              source: 'review-agent-auto',
              issueId,
              workspace,
              branch,
            });
            console.log(`[specialists] Queued test-agent for ${issueId} after review passed`);
          }
        } else if (name === 'test-agent') {
          const alreadyReported =
            existingStatus?.testNotes && !existingStatus.testNotes.startsWith('Auto-detected:');
          if (alreadyReported) {
            console.log(
              `[specialists] Skipping auto-detect for ${name}/${issueId}: specialist already reported (${existingStatus!.testStatus})`,
            );
          } else {
            setReviewStatusBase(issueId, {
              testStatus: status === 'passed' ? 'passed' : 'failed',
              testNotes: `Auto-detected: ${status}`,
            });
          }
        }

        // Clear the current task from queue (if it matches)
        const queueStatus = checkSpecialistQueue(name as SpecialistType);
        for (const item of queueStatus.items) {
          if (item.payload?.issueId?.toUpperCase() === issueId.toUpperCase()) {
            completeSpecialistTask(name as SpecialistType, item.id);
            console.log(`[specialists] Cleared ${issueId} from ${name} queue`);
            break;
          }
        }

        // Check for next queued task and wake if available
        const specialistQueue = checkSpecialistQueue(name as SpecialistType);
        let nextValidTask = null;
        for (const task of specialistQueue.items) {
          const taskIssueId = task.payload?.issueId;
          if (!taskIssueId) {
            completeSpecialistTask(name as SpecialistType, task.id);
            continue;
          }

          const taskStatus = getReviewStatus(taskIssueId);
          if (name === 'review-agent' && taskStatus?.reviewStatus === 'passed') {
            completeSpecialistTask(name as SpecialistType, task.id);
            console.log(
              `[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already reviewed)`,
            );
            continue;
          }
          if (name === 'test-agent' && taskStatus?.testStatus === 'passed') {
            completeSpecialistTask(name as SpecialistType, task.id);
            console.log(
              `[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already tested)`,
            );
            continue;
          }
          if (taskStatus?.mergeStatus === 'merged') {
            completeSpecialistTask(name as SpecialistType, task.id);
            console.log(
              `[specialists] Skipping stale ${name} queue item: ${taskIssueId} (already merged)`,
            );
            continue;
          }

          nextValidTask = task;
          break;
        }

        if (nextValidTask) {
          console.log(`[specialists] Waking ${name} for next task: ${nextValidTask.payload.issueId}`);
          await wakeSpecialistWithTask(name as SpecialistType, {
            issueId: nextValidTask.payload.issueId!,
            workspace: nextValidTask.payload.context?.workspace,
            branch: nextValidTask.payload.context?.branch,
          });
          completeSpecialistTask(name as SpecialistType, nextValidTask.id);
        }

        Effect.runSync(eventStore.append({
          type: 'specialist.completed',
          timestamp: new Date().toISOString(),
          payload: { name: name as SpecialistType, issueId },
        }));

        return HttpServerResponse.json({
          success: true,
          status,
          issueId,
          nextTaskQueued: !!nextValidTask,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error processing auto-complete for ${name}:`, error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/status ────────────────────────

const getProjectSpecialistStatusRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/status',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { getSpecialistStatus } = await import('../../../lib/cloister/specialists.js');
        const status = await getSpecialistStatus(type, project);
        return HttpServerResponse.json(status);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting per-project specialist status:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get specialist status: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/kill ────────────────────────

const postProjectSpecialistKillRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/kill',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { getTmuxSessionName } = await import('../../../lib/cloister/specialists.js');
        const tmuxSession = getTmuxSessionName(type, project);
        await execAsync(`tmux kill-session -t "${tmuxSession}"`).catch(() => {});
        // Do NOT clearSessionId — the Claude session persists and should be resumed on next dispatch
        saveAgentRuntimeState(tmuxSession, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });
        return HttpServerResponse.json({
          success: true,
          message: `Killed ${type} (${project})`,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error killing per-project specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to kill specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/queue ────────────────────────

const getProjectSpecialistQueueRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/queue',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { checkSpecialistQueue } = await import('../../../lib/cloister/specialists.js');
        const queue = checkSpecialistQueue(type);
        return HttpServerResponse.json(queue);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting per-project specialist queue:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get queue: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/spawn ───────────────────────

const postProjectSpecialistSpawnRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/spawn',
  Effect.gen(function* () {
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
      return HttpServerResponse.json({ error: 'issueId is required' }, { status: 400 });
    }

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { spawnEphemeralSpecialist } = await import('../../../lib/cloister/specialists.js');
        const result = await spawnEphemeralSpecialist(project, type, {
          issueId,
          branch,
          workspace,
          prUrl,
          context,
        });

        if (result.success) {
          return HttpServerResponse.json(result);
        } else {
          return HttpServerResponse.json({ error: result.message }, { status: 500 });
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error spawning specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to spawn specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/runs ──────────────────────────

const getProjectSpecialistRunsRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs',
  Effect.gen(function* () {
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

    return yield* Effect.tryPromise({
      try: async () => {
        const { listRunLogs } = await import('../../../lib/cloister/specialist-logs.js');
        const runs = listRunLogs(project, type, { limit, offset });
        return HttpServerResponse.json(runs);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error listing run logs:', error);
        return HttpServerResponse.json(
          { error: 'Failed to list run logs: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId/stream ────────────
// NOTE: Must be registered before /:project/:type/runs/:runId to avoid route conflict.

const getProjectSpecialistRunStreamRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId/stream',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { getRunLogPath, isRunLogActive } =
          await import('../../../lib/cloister/specialist-logs.js');

        const logPath = getRunLogPath(project, type, runId);

        if (!existsSync(logPath)) {
          return HttpServerResponse.json({ error: 'Run log not found' }, { status: 404 });
        }

        // Build an SSE stream using Effect Stream + Node ReadableStream
        const encoder = new TextEncoder();

        const nodeStream = new ReadableStream({
          async start(controller) {
            // Send initial content
            const content = readFileSync(logPath, 'utf-8');
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
                  const finalContent = readFileSync(logPath, 'utf-8');
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
                const currentContent = readFileSync(logPath, 'utf-8');
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
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error streaming run log:', error);
        return HttpServerResponse.json(
          { error: 'Failed to stream run log: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/runs/:runId ───────────────────

const getProjectSpecialistRunRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/runs/:runId',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const runId = params['runId'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { getRunLog, parseLogMetadata } =
          await import('../../../lib/cloister/specialist-logs.js');
        const content = getRunLog(project, type, runId);

        if (!content) {
          return HttpServerResponse.json({ error: 'Run log not found' }, { status: 404 });
        }

        const metadata = parseLogMetadata(content);
        return HttpServerResponse.json({ runId, content, metadata });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting run log:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get run log: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/runs/:runId/terminate ────────

const postProjectSpecialistRunTerminateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/runs/:runId/terminate',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { terminateSpecialist } = await import('../../../lib/cloister/specialists.js');
        await terminateSpecialist(project, type);
        return HttpServerResponse.json({ success: true, message: 'Specialist terminated' });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error terminating specialist:', error);
        return HttpServerResponse.json(
          { error: 'Failed to terminate specialist: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/grace/pause ──────────────────

const postProjectSpecialistGracePauseRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/pause',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { pauseGracePeriod } = await import('../../../lib/cloister/specialists.js');
        const success = pauseGracePeriod(project, type);

        if (success) {
          return HttpServerResponse.json({ success: true, message: 'Grace period paused' });
        } else {
          return HttpServerResponse.json(
            { error: 'No active grace period to pause' },
            { status: 400 },
          );
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error pausing grace period:', error);
        return HttpServerResponse.json(
          { error: 'Failed to pause grace period: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/grace/resume ─────────────────

const postProjectSpecialistGraceResumeRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/resume',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { resumeGracePeriod } = await import('../../../lib/cloister/specialists.js');
        const success = resumeGracePeriod(project, type);

        if (success) {
          return HttpServerResponse.json({ success: true, message: 'Grace period resumed' });
        } else {
          return HttpServerResponse.json(
            { error: 'No paused grace period to resume' },
            { status: 400 },
          );
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error resuming grace period:', error);
        return HttpServerResponse.json(
          { error: 'Failed to resume grace period: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/grace/exit ───────────────────

const postProjectSpecialistGraceExitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/grace/exit',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { exitGracePeriod } = await import('../../../lib/cloister/specialists.js');
        exitGracePeriod(project, type);
        return HttpServerResponse.json({
          success: true,
          message: 'Specialist terminated immediately',
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error exiting grace period:', error);
        return HttpServerResponse.json(
          { error: 'Failed to exit grace period: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/grace ────────────────────────

const getProjectSpecialistGraceRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/grace',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { getGracePeriodState } = await import('../../../lib/cloister/specialists.js');
        const state = getGracePeriodState(project, type);

        if (state) {
          return HttpServerResponse.json(state);
        } else {
          return HttpServerResponse.json({ error: 'No active grace period' }, { status: 404 });
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting grace period state:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get grace period state: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/context ──────────────────────

const getProjectSpecialistContextRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/context',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { loadContextDigest } =
          await import('../../../lib/cloister/specialist-context.js');
        const digest = loadContextDigest(project, type);

        if (digest) {
          return HttpServerResponse.json({ digest });
        } else {
          return HttpServerResponse.json({ error: 'No context digest found' }, { status: 404 });
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting context digest:', error);
        return HttpServerResponse.json(
          { error: 'Failed to get context digest: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/context/regenerate ───────────

const postProjectSpecialistContextRegenerateRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/context/regenerate',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { regenerateContextDigest } =
          await import('../../../lib/cloister/specialist-context.js');
        const digest = await regenerateContextDigest(project, type);

        if (digest) {
          return HttpServerResponse.json({ digest, message: 'Context digest regenerated' });
        } else {
          return HttpServerResponse.json(
            { error: 'Failed to generate context digest' },
            { status: 500 },
          );
        }
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error regenerating context digest:', error);
        return HttpServerResponse.json(
          { error: 'Failed to regenerate context digest: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/complete ─────────────────────

const postProjectSpecialistCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/complete',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;
    const body = yield* readJsonBody;
    const { status, notes } = body as { status?: string; notes?: string };

    if (!status || !['passed', 'failed', 'blocked'].includes(status)) {
      return HttpServerResponse.json(
        { error: 'Valid status (passed/failed/blocked) is required' },
        { status: 400 },
      );
    }

    if (!validateSpecialistType(type)) {
      return HttpServerResponse.json(
        { error: 'Invalid specialist type. Must be review-agent, test-agent, or merge-agent' },
        { status: 400 },
      );
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { signalSpecialistCompletion } =
          await import('../../../lib/cloister/specialists.js');
        signalSpecialistCompletion(project, type, { status, notes });
        return HttpServerResponse.json({
          success: true,
          message: 'Specialist completion signaled, grace period started',
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error signaling completion:', error);
        return HttpServerResponse.json(
          { error: 'Failed to signal completion: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: GET /api/specialists/:project/:type/latest-log ───────────────────

const getProjectSpecialistLatestLogRoute = HttpRouter.add(
  'GET',
  '/api/specialists/:project/:type/latest-log',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    return yield* Effect.try({
      try: () => {
        const runsDir = join(homedir(), '.panopticon', 'specialists', project, type, 'runs');
        if (!existsSync(runsDir)) {
          return HttpServerResponse.json({ log: null, message: 'No runs found' });
        }

        const files = readdirSync(runsDir)
          .filter((f) => f.endsWith('.log'))
          .sort()
          .reverse();

        if (files.length === 0) {
          return HttpServerResponse.json({ log: null, message: 'No run logs found' });
        }

        const latestLog = readFileSync(join(runsDir, files[0]), 'utf-8');
        return HttpServerResponse.json({
          log: latestLog,
          file: files[0],
          totalRuns: files.length,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/specialists/:project/:type/logs/cleanup ────────────────

const postProjectSpecialistLogsCleanupRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:project/:type/logs/cleanup',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const project = params['project'] as string;
    const type = params['type'] as string;

    return yield* Effect.tryPromise({
      try: async () => {
        const { cleanupOldLogs } = await import('../../../lib/cloister/specialist-logs.js');
        const { getSpecialistRetention } = await import('../../../lib/projects.js');

        const retention = getSpecialistRetention(project);
        const deleted = cleanupOldLogs(project, type, retention);

        return HttpServerResponse.json({
          success: true,
          deleted,
          message: `Cleaned up ${deleted} old logs`,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error cleaning up logs:', error);
        return HttpServerResponse.json(
          { error: 'Failed to clean up logs: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
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
  getSpecialistQueuesRoute,
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
  getSpecialistQueueRoute,
  postSpecialistQueueRoute,
  deleteSpecialistQueueItemRoute,
  putSpecialistQueueReorderRoute,
  postSpecialistAutoCompleteRoute,

  // ── Per-project /api/specialists/:project/:type/* routes ──
  getProjectSpecialistStatusRoute,
  postProjectSpecialistKillRoute,
  getProjectSpecialistQueueRoute,
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
);

export default specialistsRouteLayer;
