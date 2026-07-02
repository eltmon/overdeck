import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentState, getAgentRuntimeState, messageAgent, saveAgentRuntimeState, transitionIssueToInProgress } from '../../../../lib/agents.js';
import { queryBeadById } from '../../../../lib/beads-query.js';
import { getUnblockedItemsSync } from '../../../../lib/cloister/task-readiness.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { getReviewStatusSync, loadReviewStatuses, setReviewStatusSync as setReviewStatusBase, type ReviewStatus } from '../../../../lib/review-status.js';
import { syncBeadStatusToVBrief } from '../../../../lib/vbrief/beads.js';
import { readWorkspacePlanSync } from '../../../../lib/vbrief/io.js';
import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { validateAgentRuntimeEventAuth } from '../agents.js';
import { httpHandler } from '../http-handler.js';
import { killSession } from '../../../../lib/tmux.js';
import {
  _serverManagedMerges,
  execFileAsync,
  firePostMergeLifecycle,
  readJsonBody,
  specialistEventRole,
  validateSpecialistAutoCompleteMetadata,
  type SpecialistAgentName,
  type SpecialistAutoCompleteBody,
} from './shared.js';

// ─── Route: GET /api/specialists ─────────────────────────────────────────────

const getSpecialistsRoute = HttpRouter.add(
  'GET',
  '/api/specialists',
  httpHandler(Effect.gen(function* () {
    const {
      getAllSpecialistStatus,
      getAllProjectSpecialistStatuses,
    } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));

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
      isRunning,
      getTmuxSessionName,
    } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
    const { clearHookSync } = yield* Effect.promise(() => import('../../../../lib/hooks.js'));

    const specialists = getAllSpecialists();
    const results: { name: string; killed: boolean; sessionCleared: boolean; queueCleared: boolean }[] = [];

    for (const specialist of specialists) {
      const name = specialist.name;
      let killed = false;

      if (yield* Effect.promise(() => isRunning(name))) {
        const tmuxSession = getTmuxSessionName(name);
        const killResult = yield* killSession(tmuxSession).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        );
        killed = killResult;
      }

      clearHookSync(name);
      results.push({ name, killed, sessionCleared: false, queueCleared: true });
    }

    // Reset any "reviewing" statuses to "pending" — use per-issue atomic updates
    // to avoid the read-all/write-all race that saveReviewStatuses() would reintroduce.
    let reviewStatusesReset = 0;
    try {
      const statuses = loadReviewStatuses();
      for (const key of Object.keys(statuses)) {
        if (statuses[key].reviewStatus === 'reviewing') {
          setReviewStatusBase(key, { reviewStatus: 'pending' });
          reviewStatusesReset++;
        }
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
    const validSpecialists = ['review', 'test', 'merge', 'inspect', 'uat', 'ship'];
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

    // Resolve any pending specialist completion waiters (PAN-632: event-driven completion).
    // This replaces polling loops in spawnMergeAgentForBranches / syncMainIntoWorkspace.
    if (specialist === 'merge') {
      const { reportSpecialistCompletion } = yield* Effect.promise(() => import('../../../../lib/cloister/specialist-completion.js'));
      const resolved = yield* reportSpecialistCompletion(normalizedIssueId, {
        status: status as 'passed' | 'failed',
        notes,
      });
      if (resolved) {
        console.log(`[specialists/done] Resolved pending completion waiter for ${normalizedIssueId}`);
      }
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
        update.testStatus = status as typeof update.testStatus;
        if (notes) update.testNotes = notes;
        break;

      case 'merge':
        update.mergeStatus = status === 'passed' ? 'merged' : 'failed';
        break;

      case 'inspect':
        update.inspectStatus = status as typeof update.inspectStatus;
        if (notes) update.inspectNotes = notes;
        break;

      case 'uat':
        update.uatStatus = status as typeof update.uatStatus;
        if (notes) update.uatNotes = notes;
        if (status === 'passed') {
          update.readyForMerge = true;
        }
        break;

      case 'ship':
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
          await import('../../../../lib/cloister/specialists.js');
        const project = resolveProjectFromIssueSync(normalizedIssueId);
        const projectKey = project?.projectKey;
        const tmuxSession = projectKey
          ? getTmuxSessionName(`${specialist}-agent` as SpecialistAgentName, projectKey, normalizedIssueId)
          : getTmuxSessionName(`${specialist}-agent` as SpecialistAgentName);
        saveAgentRuntimeState(tmuxSession, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });
        console.log(`[specialists/done] Set ${tmuxSession} to idle`);

        // PAN-846: Kill the specialist tmux session so it doesn't leak RAM.
        // The session has completed its work; next dispatch spawns fresh.
        // PAN-2007: operator-requested temporary keep-alive — record the verdict
        // (already done above via setReviewStatusBase) but leave the session
        // running so the operator can inspect it. Re-enable by flipping the flag.
        const { KEEP_SPECIALIST_SESSIONS_ALIVE } = await import('../../../../lib/cloister/reap-terminal-sessions.js');
        if (KEEP_SPECIALIST_SESSIONS_ALIVE) {
          console.log(`[specialists/done] PAN-2007 keep-alive: verdict recorded, leaving ${tmuxSession} running`);
        } else {
          try {
            await Effect.runPromise(killSession(tmuxSession));
            console.log(`[specialists/done] Killed specialist session ${tmuxSession}`);
          } catch (err) {
            console.log(`[specialists/done] Session ${tmuxSession} already gone or failed to kill: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Clear write-scope lock so the next specialist can claim the workspace
        if (projectKey) {
          const registryKey = makeSpecialistRegistryKey(`${specialist}-agent`, normalizedIssueId);
          updateRunMetadata(projectKey, registryKey, {
            currentRun: null,
            writeScope: undefined,
            workspace: null,
            currentActivity: null,
          });
          console.log(`[specialists/done] Cleared registry lock for ${registryKey} (${projectKey})`);
        }

        // Update specialist handoff log so success-rate metrics reflect actual outcome
        const { updateSpecialistHandoffStatus } = await import('../../../../lib/cloister/specialist-handoff-logger.js');
        const updated = await Effect.runPromise(updateSpecialistHandoffStatus(
          normalizedIssueId,
          `${specialist}-agent`,
          status === 'passed' ? 'completed' : 'failed',
          status === 'passed' ? 'success' : 'failure',
        ));
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
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              const { getWorkspaceGitInfo } = await import('../../../../lib/git-utils.js');
              const { HEAD } = await Effect.runPromise(getWorkspaceGitInfo(workspacePath));
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
          const { onInspectComplete } = await import('../../../../lib/cloister/inspect-agent.js');
          // Extract beadId from notes (format: "Bead <beadId> matches spec...")
          const beadMatch = notes?.match(/[Bb]ead\s+(\S+)/);
          const beadId = beadMatch?.[1] || 'unknown';
          // Resolve project to get workspace path
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              (await Effect.runPromise(onInspectComplete(project.projectKey, normalizedIssueId, beadId, 'passed', workspacePath)));

              // Sync bead completion to vBRIEF plan
              try {
                const beadData = await Effect.runPromise(queryBeadById(workspacePath, beadId));
                const updatedItemId = await Effect.runPromise(syncBeadStatusToVBrief(beadId, workspacePath, 'completed', beadData?.title));
                if (updatedItemId) {
                  // Check which tasks are now unblocked and wake the work agent
                  try {
                    const unblockedItems = getUnblockedItemsSync(workspacePath, updatedItemId);
                    if (unblockedItems.length > 0) {
                      console.log(
                        `[auto-wake] ${normalizedIssueId}: items unblocked after "${updatedItemId}": ${unblockedItems.join(', ')}`,
                      );
                      const workAgentId = `agent-${normalizedIssueId.toLowerCase()}`;
                      const doc = readWorkspacePlanSync(workspacePath);
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

    // When the test specialist reports success, persist testStatus and emit
    // test.passed so reactive Cloister records the shipping lifecycle phase.
    // PAN-1650 derives readyForMerge from review/test gate state server-side;
    // no ship role is spawned.
    if (specialist === 'test' && status === 'passed') {
      yield* Effect.promise(async () => {
        try {
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              setReviewStatusBase(normalizedIssueId, { testStatus: 'passed' });
              const { initEventStore } = await import('../../event-store.js');
              const store = await initEventStore();
              await store.appendAsync({
                type: 'test.passed',
                timestamp: new Date().toISOString(),
                payload: { issueId: normalizedIssueId },
              } as any);
              console.log(`[specialists/done] ${normalizedIssueId} emitted test.passed; shipping lifecycle recorded`);
            }
          }
        } catch (err) {
          console.error(`[specialists/done] Error emitting test.passed for ${normalizedIssueId}:`, err);
        }
      });
    }

    // When merge specialist reports success, run post-merge lifecycle ONCE.
    // Use firePostMergeLifecycle directly rather than onMergeComplete: onMergeComplete
    // has a guard that checks mergeStatus !== 'merged', but setReviewStatusBase above
    // already set mergeStatus='merged' — that guard would always fire and the lifecycle
    // would never run. firePostMergeLifecycle skips that guard and uses the
    // in-flight guard (postMergeGuard, concurrency) + postMergeLifecycle's
    // _completedPostMerge (defense-in-depth).
    if (specialist === 'merge' && status === 'passed') {
      firePostMergeLifecycle(normalizedIssueId);
    }

    // When any specialist reports failure, transition issue back to In Progress
    // (inspect failures don't change Linear status — they're mid-implementation gates).
    if (status === 'failed' && specialist !== 'inspect') {
      try {
        const project = resolveProjectFromIssueSync(normalizedIssueId);
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
              await execFileAsync(
                'gh',
                ['api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--field', `body=${commentBody}`],
                { encoding: 'utf-8' },
              );
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
            const { sessionExists } = await import('../../../../lib/tmux.js');
            const { messageAgent, spawnAgent, getAgentStateSync } = await import('../../../../lib/agents.js');

            if (await Effect.runPromise(sessionExists(workAgentId))) {
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

    if (specialist === 'review' && (status === 'failed' || status === 'blocked')) {
      yield* Effect.promise(async () => {
        try {
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          const workspacePath = project
            ? join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`)
            : undefined;
          const { deliverReviewVerdictFeedback } = await import(
            '../../../../lib/cloister/review-verdict-feedback.js'
          );
          const result = await Effect.runPromise(deliverReviewVerdictFeedback({
            issueId: normalizedIssueId,
            verdict: status === 'failed' ? 'failed' : 'blocked',
            notes,
            workspacePath,
            prUrl: updatedStatus.prUrl,
          }));
          console.log(
            `[specialists/done] Delivered review verdict feedback for ${normalizedIssueId}` +
              ` (feedback=${result.feedbackPath ?? 'none'}, synthesis=${result.synthesisPath ?? 'none'}, prComment=${result.prCommentPosted})`,
          );
        } catch (err: any) {
          console.warn(`[specialists/done] Failed to deliver review verdict feedback: ${err.message}`);
        }
      });
    }

    // Emit domain event for role-backed specialist completion/failure.
    const eventRole = specialistEventRole(specialist);
    if (eventRole) {
      if (status === 'passed') {
        yield* eventStore.append({
          type: 'specialist.completed',
          timestamp: new Date().toISOString(),
          payload: { name: eventRole, issueId: normalizedIssueId },
        });
      } else {
        yield* eventStore.append({
          type: 'specialist.failed',
          timestamp: new Date().toISOString(),
          payload: { name: eventRole, issueId: normalizedIssueId, error: notes || `${specialist} failed` },
        });
      }
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
    const { cleanupAllLogsSync } = yield* Effect.promise(() => import('../../../../lib/cloister/specialist-logs.js'));
    const results = cleanupAllLogsSync();

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
      yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
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
    return jsonResponse(
      { error: `Legacy specialist wake is no longer supported for ${name}; role runs spawn agents directly.` },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:name/reset ─────────────────────────────────

const postSpecialistResetRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    return jsonResponse(
      { error: `Legacy specialist session reset is no longer supported for ${name}; role agents are managed through the normal agent lifecycle.` },
      { status: 410 },
    );
  })),
);

// ─── Route: POST /api/specialists/:name/init ──────────────────────────────────

const postSpecialistInitRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/init',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    return jsonResponse(
      { error: `Legacy specialist initialization is no longer supported for ${name}; role flows spawn agents on demand.` },
      { status: 410 },
    );
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
    const specialistDir = join(homedir(), '.overdeck', 'specialists', name);
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
      const { getTmuxSessionName } = yield* Effect.promise(() => import('../../../../lib/cloister/specialists.js'));
      const tmuxSession = getTmuxSessionName(name as SpecialistAgentName);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });
    }

    // Emit domain event based on status
    const eventRole = specialistEventRole(name);
    if (eventRole && status === 'passed') {
      yield* eventStore.append({
        type: 'specialist.completed',
        timestamp: new Date().toISOString(),
        payload: { name: eventRole, issueId },
      });
    } else if (eventRole && (status === 'failed' || status === 'blocked')) {
      yield* eventStore.append({
        type: 'specialist.failed',
        timestamp: new Date().toISOString(),
        payload: { name: eventRole, issueId, error: notes || `${name} reported ${status}` },
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
    return jsonResponse({ cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: '' });
  })),
);

// ─── Route: POST /api/specialists/:name/auto-complete ────────────────────────

const postSpecialistAutoCompleteRoute = HttpRouter.add(
  'POST',
  '/api/specialists/:name/auto-complete',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const name = params['name'] as string;
    const body = (yield* readJsonBody) as SpecialistAutoCompleteBody;
    const eventStore = yield* EventStoreService;
    const { issueId: requestIssueId, status: requestStatus, agentId } = body;

    const agentState = agentId ? yield* getAgentState(agentId) : null;
    const runtimeState = agentId ? yield* getAgentRuntimeState(agentId) : null;
    const metadata = validateSpecialistAutoCompleteMetadata(name, body, agentState, runtimeState);
    if (!metadata.ok) {
      return jsonResponse({ error: metadata.error }, { status: metadata.status });
    }

    const issueId = requestIssueId!;
    const status = requestStatus!;
    const completingAgentId = agentId!;

    console.log(`[specialists] Auto-detected completion for ${name}: ${issueId} -> ${status}`);

    yield* Effect.promise(() => saveAgentRuntimeState(completingAgentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
      currentIssue: undefined,
    }));

    // Update review/test status based on specialist type
    const existingStatus = getReviewStatusSync(issueId);

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

      if ((alreadyReported ? existingStatus!.reviewStatus : status === 'passed' ? 'passed' : 'blocked') === 'passed') {
        console.log(`[specialists] ${issueId} review approved; reactive Cloister will dispatch the test role`);
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
        });
        if (testPassed) {
          // Emit test.passed so reactive Cloister records the shipping
          // lifecycle phase; readyForMerge is derived server-side.
          yield* eventStore.append({
            type: 'test.passed',
            timestamp: new Date().toISOString(),
            payload: { issueId },
          });
          console.log(`[specialists] ${issueId} emitted test.passed after auto-detected test pass`);
        }
      }
    }

    const eventRole = specialistEventRole(name);
    if (eventRole) {
      yield* eventStore.append({
        type: 'specialist.completed',
        timestamp: new Date().toISOString(),
        payload: { name: eventRole, issueId },
      });
    }

    return jsonResponse({
      success: true,
      status,
      issueId,
    });
  })),
);

export const specialistsLegacyRouteLayer = Layer.mergeAll(
  getSpecialistsRoute,
  getSpecialistsProjectsRoute,
  postSpecialistsResetAllRoute,
  postSpecialistsDoneRoute,
  postSpecialistsLogsCleanupAllRoute,
  postSpecialistWakeRoute,
  postSpecialistResetRoute,
  postSpecialistInitRoute,
  postSpecialistReportStatusRoute,
  getSpecialistCostRoute,
  postSpecialistAutoCompleteRoute,
);
