import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentState, getAgentRuntimeState, messageAgent, transitionIssueToInProgress } from '../../../../lib/agents.js';
import { commentOnArtifact, parseArtifactRef } from '../../../../lib/forge.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { jsonResponse } from '../../http-helpers.js';
import { getDerivedIssueState } from '../../services/derived-issue-state.js';
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

    // PAN-3917: there are no review-status rows to reset. A review in flight is
    // a live reviewer pane plus the PR's own review state; killing the pane
    // above is the whole reset.
    return jsonResponse({
      success: true,
      message: `Reset ${results.length} specialists`,
      results,
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
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { specialist, issueId, status, notes, itemId, runId } = body as {
      specialist: string;
      issueId: string;
      status: string;
      notes?: string;
      itemId?: string;
      runId?: string;
    };

    // Validate specialist type
    // PAN-3917 FR-14: the per-item inspection gate and `pan inspect` are gone.
    const validSpecialists = ['review', 'test', 'merge', 'uat', 'ship'];
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

    // PAN-3917 FR-7: a review verdict is a PR review, not a status row. The
    // work agent and the dashboard both read the PR, so posting the verdict
    // there is the whole write. Nothing else is recorded.
    const derived = yield* Effect.promise(() => getDerivedIssueState(normalizedIssueId));
    const prUrl = derived.pr?.url;

    if (specialist === 'review') {
      if (!prUrl) {
        return jsonResponse(
          { error: `No pull request for ${normalizedIssueId} — a review verdict needs one` },
          { status: 422 },
        );
      }
      const artifactRef = parseArtifactRef(prUrl);
      if (!artifactRef) {
        return jsonResponse({ error: `Pull request URL for ${normalizedIssueId} is not a recognized forge artifact` }, { status: 422 });
      }
      const heading = status === 'passed' ? 'Review passed' : 'Changes requested';
      yield* commentOnArtifact(artifactRef.forge, {
        ...artifactRef,
        body: `## ${heading}\n\n${notes ?? (status === 'passed' ? 'No blocking findings.' : 'See the review artifacts for details.')}`,
      }).pipe(Effect.catch((error) => Effect.sync(() => {
        console.warn(`[specialists/done] Could not post the review verdict to ${prUrl}: ${String(error)}`);
      })));
    }

    // Clear the registry write-scope so the next specialist can claim the
    // workspace. The pane's own state is the backend's (PAN-3917 FR-12), so
    // nothing writes an 'idle' runtime row here any more.
    yield* Effect.promise(async () => {
      try {
        const { getTmuxSessionName, updateRunMetadata, makeSpecialistRegistryKey } =
          await import('../../../../lib/cloister/specialists.js');
        const project = resolveProjectFromIssueSync(normalizedIssueId);
        const projectKey = project?.projectKey;
        const tmuxSession = projectKey
          ? getTmuxSessionName(`${specialist}-agent` as SpecialistAgentName, projectKey, normalizedIssueId)
          : getTmuxSessionName(`${specialist}-agent` as SpecialistAgentName);
        // PAN-2579 (warm-by-default lifecycle): the verdict is recorded; the session
        // stays ALIVE so the next review/test cycle resumes it with context intact.
        // Warm-idle sessions no longer count against the advancing ceiling
        // (countRunningAgents excludes them) and the memory governor sheds them
        // first under HARD pressure — eviction is the governor's job, never a
        // side effect of recording a verdict. (Supersedes the PAN-846 kill and
        // the PAN-2007 keep-alive flag.)
        console.log(`[specialists/done] Warm lifecycle: verdict recorded, leaving ${tmuxSession} running (PAN-2579)`);

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

    // PAN-3917 FR-7: there is no reviewedAtCommit anchor and no verdict row. A
    // review verdict is the PR's own review state, and drift past it is the PR
    // being re-requested — both read from the forge, never stamped here.

    // When the test specialist reports success, emit test.passed so reactive
    // Cloister records the shipping lifecycle phase. Merge readiness itself is
    // derived from the PR (approvals, checks, mergeability) — no status is
    // written here.
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
    // firePostMergeLifecycle's in-flight guard (postMergeGuard, concurrency) is
    // what makes it at-most-once per merge.
    if (specialist === 'merge' && status === 'passed') {
      firePostMergeLifecycle(normalizedIssueId);
    }

    // When any specialist reports failure, transition the issue back to In Progress.
    if (status === 'failed') {
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
      // Only deliver feedback if this is a coordinator verdict (not handled by CLI/fallback)
      // The verdict write door has already validated the evidence head
      yield* Effect.promise(async () => {
        try {
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          const workspacePath = project
            ? join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`)
            : undefined;
          const { deliverReviewVerdictFeedback } = await import(
            '../../../../lib/cloister/review-verdict-feedback.js'
          );
          const result = await deliverReviewVerdictFeedback({
            issueId: normalizedIssueId,
            verdict: status === 'failed' ? 'failed' : 'blocked',
            notes,
            workspacePath,
            ...(prUrl ? { prUrl } : {}),
            ...(runId ? { runId } : {}),
          });
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
      // `currentStatus` used to be the whole review-status row. The issue's
      // position is derived now (PAN-3917 FR-6).
      state: (yield* Effect.promise(() => getDerivedIssueState(normalizedIssueId))).state,
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

    console.log(`[specialists] Auto-detected completion for ${name}: ${issueId} -> ${status}`);

    // PAN-3917: auto-detected completion emits the domain event and nothing
    // else. The verdict itself lives on the PR (FR-7), the pane's state is the
    // backend's (FR-12), and merge readiness is derived from the forge (FR-9) —
    // there is no review/test status row left to write here.
    if (name === 'test-agent' && status === 'passed') {
      yield* eventStore.append({
        type: 'test.passed',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      });
      console.log(`[specialists] ${issueId} emitted test.passed after auto-detected test pass`);
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
