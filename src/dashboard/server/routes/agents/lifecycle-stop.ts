import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  clearAgentPaused,
  clearAgentTroubled,
  getAgentState,
  getSessionId,
  markAgentStoppedState,
  saveAgentRuntimeState,
  saveSessionId,
  setAgentPaused,
  stopAgent,
} from '../../../../lib/agents.js';
import { emitActivityEntry } from '../../../../lib/activity-logger.js';
import { operatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { stopWorkspaceDocker } from '../../../../lib/workspace-manager.js';
import { sessionExists } from '../../../../lib/tmux.js';
import { agentPaneExists, closeAgentPane, closeAgentPaneDetailed } from '../../../../lib/terminal-backends/launch.js';
import {
  describeSweepProblems,
  describeUnpauseRestartProblems,
  haltIssueSpecialistsForPause,
  restartIssueAfterUnpause,
  type ReviewRequestOutcome,
} from '../../../../lib/agents/issue-pause.js';
import { getWorkAgentLifecycleState } from '../../../../lib/work-agent-lifecycle.js';
import { getGuardedReviewRequester } from '../../../../lib/cloister/request-review-pipeline.js';
import { saveAgentStateAndEmitEventProgram } from '../../services/agent-projection.js';
import { EventStoreService } from '../../services/domain-services.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateOrigin } from '../origin-validation.js';
import {
  appendAgentLifecycleLog,
  buildAgentControlEventPayload,
  captureAgentOutputBeforeKill,
  invalidateAgentsCache,
  readJsonBody,
  toAgentStatusPayload,
} from './shared.js';

export function createAgentStopHandler(
  lifecycleEvent: 'agent.delete_requested' | 'agent.stop_requested',
) {
  return httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeStop = getAgentState(id);
    yield* Effect.promise(() => appendAgentLifecycleLog(id, lifecycleEvent));
    yield* stopAgent(id, 'operator');

    // PAN-1316/PAN-1326: tear down the workspace Docker stack on user-initiated stop.
    // Without this, dev-server containers (Vite/Webpack) outlive their owning
    // agent and can degrade the host via inotify-fallback polling storms.
    // Internal stops (restart) take a different path and don't reach here.
    //
    // Resolve the workspace from the issue (not from the agent's own state) so
    // killing a specialist (review/test/ship) — whose state.workspace may not
    // point at the work agent's workspace — still tears down the right stack.
    // Mirrors the postMergeLifecycle pattern in merge-agent.ts.
    if (stateBeforeStop?.issueId) {
      yield* Effect.promise(async () => {
        try {
          const { resolveProjectFromIssueSync } = await import('../../../../lib/projects.js');
          const { findWorkspacePath } = await import('../../../../lib/lifecycle/archive-planning.js');
          const issueLower = stateBeforeStop.issueId!.toLowerCase();
          const project = resolveProjectFromIssueSync(stateBeforeStop.issueId!);
          const projectPath = project?.projectPath ?? process.cwd();
          const workspacePath = findWorkspacePath(projectPath, issueLower);
          if (workspacePath) {
            const dockerResult = await stopWorkspaceDocker(workspacePath, issueLower);
            if (dockerResult.containersFound) {
              console.log(`[agents] ✓ Stopped Docker stack for ${id}: ${dockerResult.steps.join('; ')}`);
            }
          }
        } catch (err) {
          console.warn(`[agents] Docker teardown failed for ${id} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }

    // PAN-1048 review feedback 004 (C1): AgentStoppedEvent requires both
    // agentId AND issueId on the payload (packages/contracts/src/events.ts:36);
    // ws-rpc drops events that fail Schema validation, so emits without issueId
    // never reach subscribers and the dashboard misses the stop transition.
    //
    // PAN-1908: write-through projection — re-upsert the stopped row and append
    // the lifecycle event in one SQLite transaction. stopAgent already saved
    // state, but repeating the upsert here makes the event append atomic.
    const stateAfterStop = getAgentState(id);
    if (stateAfterStop) {
      yield* saveAgentStateAndEmitEventProgram(stateAfterStop, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: stateAfterStop.issueId || stateBeforeStop?.issueId || '' },
      });
    }
    const issueId = stateBeforeStop?.issueId;
    // PAN-1048: derive label from role; legacy state.phase no longer exists.
    const phaseLabel = stateBeforeStop?.role === 'plan' ? 'planning' : 'work';
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: issueId
        ? `User stopped ${issueId} ${phaseLabel} agent`
        : `User stopped agent ${id}`,
      issueId,
    });
    invalidateAgentsCache();
    return jsonResponse({ success: true });
  }));
}

function agentStopRoute(
  method: 'DELETE' | 'POST',
  path: `/${string}`,
  lifecycleEvent: 'agent.delete_requested' | 'agent.stop_requested',
) {
  return HttpRouter.add(method, path, createAgentStopHandler(lifecycleEvent));
}

// ─── Route: DELETE /api/agents/:id ───────────────────────────────────────────

export const deleteAgentRoute = agentStopRoute('DELETE', '/api/agents/:id', 'agent.delete_requested');

// ─── Route: POST /api/agents/:id/stop ────────────────────────────────────────

export const postAgentStopRoute = agentStopRoute('POST', '/api/agents/:id/stop', 'agent.stop_requested');

// ─── Route: POST /api/agents/:id/suspend ─────────────────────────────────────

export const postAgentSuspendRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/suspend',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { sessionId } = body as any;
    const effectiveSessionId = sessionId || getSessionId(id);

    if (!effectiveSessionId) {
      return jsonResponse({ error: 'Session ID required for suspend' }, { status: 400 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.suspend_requested', { sessionId: effectiveSessionId }));
    saveSessionId(id, effectiveSessionId);
    // PAN-1048 review feedback 004 (C1): resolve issueId before kill so we can
    // include it on the agent.stopped payload (the contract requires it).
    const suspendIssueId = (getAgentState(id))?.issueId ?? '';
    // PAN-3947: close through the terminal backend (tmux session or Herdr pane).
    yield* Effect.promise(() => closeAgentPane(id));
    saveAgentRuntimeState(id, {
      state: 'suspended',
      lastActivity: new Date().toISOString(),
      claudeSessionId: effectiveSessionId,
    });
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction. Preserve the existing agent-table status
    // (suspend does not flip it to stopped).
    const stateAfterSuspend = getAgentState(id);
    if (stateAfterSuspend) {
      yield* saveAgentStateAndEmitEventProgram(stateAfterSuspend, {
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId: id, issueId: stateAfterSuspend.issueId || suspendIssueId },
      });
    }

    invalidateAgentsCache();
    return jsonResponse({ success: true });
  })),
);

// ─── Route: POST /api/agents/:id/pause ────────────────────────────────────────

export const postAgentPauseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/pause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const reason = (body as { reason?: unknown }).reason;

    if (reason !== undefined && typeof reason !== 'string') {
      return jsonResponse({ error: 'reason must be a string' }, { status: 400 });
    }

    const stateBeforePause = getAgentState(id);
    if (!stateBeforePause) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const previousStatus = toAgentStatusPayload(stateBeforePause.status);
    // PAN-3947: a live terminal on the host's backend — a tmux session or a
    // Herdr pane. `sessionExists` alone is always false on Herdr, so a paused
    // agent's pane and harness used to stay alive.
    const hasLiveSession = yield* Effect.promise(() => agentPaneExists(id).catch(() => false));
    const stoppedByPause = hasLiveSession || stateBeforePause.status === 'running' || stateBeforePause.status === 'starting';
    let updatedState = yield* setAgentPaused(id, reason, stoppedByPause, true);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    // PAN-3911: a failed close is reported in the response, never as a stop.
    let closeError: string | undefined;
    if (hasLiveSession) {
      yield* Effect.promise(() => captureAgentOutputBeforeKill(id));
      const close = yield* Effect.promise(() => closeAgentPaneDetailed(id));
      if (close.outcome === 'failed') closeError = close.reason;
    }

    if (hasLiveSession || updatedState.status === 'running' || updatedState.status === 'starting') {
      const stoppedState = markAgentStoppedState(updatedState, 'operator');
      updatedState = stoppedState;
      yield* Effect.promise(() => saveAgentRuntimeState(id, {
        state: 'stopped',
        lastActivity: new Date().toISOString(),
      }));
    }

    // PAN-3911: pausing the issue's work agent pauses the issue, so its review
    // and test agents stop too. Never throws.
    const sweep = yield* Effect.promise(() => haltIssueSpecialistsForPause(id, stateBeforePause, 'dashboard'));
    const specialistProblems = sweep ? describeSweepProblems(sweep) : [];
    for (const problem of specialistProblems) console.warn(`[agents] Pause of ${id}: ${problem}`);

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.pause_requested', { reason }));
    yield* eventStore.appendAsync(operatorInterventionEvent({
      issueId: updatedState.issueId || stateBeforePause.issueId || id.replace(/^agent-/, '').toUpperCase(),
      kind: 'pause',
      source: 'dashboard',
    }));
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    // PAN-2633: assert tmux liveness at emission time so the reducer knows whether
    // this stop-shaped transition is idle-alive (preserve pending-input payload).
    const hasLiveTmuxSession = yield* sessionExists(id);
    yield* saveAgentStateAndEmitEventProgram(updatedState, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentControlEventPayload(updatedState, previousStatus, hasLiveTmuxSession),
    });

    invalidateAgentsCache();
    return jsonResponse({
      success: true,
      agent: updatedState,
      ...(closeError ? { closeError } : {}),
      ...(sweep
        ? {
          specialists: {
            stopped: sweep.stopped,
            closedPanes: sweep.closedPanes,
            failed: sweep.failed,
            unknown: sweep.unknown,
          },
        }
        : {}),
      ...(closeError || specialistProblems.length > 0
        ? { warnings: [...(closeError ? [`could not close ${id}: ${closeError}`] : []), ...specialistProblems] }
        : {}),
    });
  })),
);

// ─── Route: POST /api/agents/:id/unpause ──────────────────────────────────────

/**
 * The review-request door, in this process: the same guarded request
 * `POST /api/review/:issueId/request` makes for `pan unpause` (merged check,
 * approved-head check, re-request breaker), never the bare pipeline starter.
 */
async function requestReviewInProcess(issueId: string): Promise<ReviewRequestOutcome> {
  const requestReviewGuarded = getGuardedReviewRequester();
  if (!requestReviewGuarded) return { requested: false, reason: 'the review pipeline is not loaded in this process' };
  const outcome = await requestReviewGuarded(issueId, {
    message: 'review re-requested after pan unpause',
    source: 'pan-unpause',
  });
  switch (outcome.kind) {
    case 'started':
      return { requested: true };
    case 'already-running':
      // A request already in flight will dispatch the review itself.
      return { requested: true, message: 'a review request was already running' };
    case 'already-merged':
      return { requested: false, noReviewNeeded: true, reason: `${issueId} is already merged` };
    case 'already-passed':
      return { requested: false, noReviewNeeded: true, reason: 'the PR is approved at its current head' };
    case 'tests-requeued':
      return { requested: false, noReviewNeeded: true, reason: 'the PR is approved; its tests were re-queued' };
    case 'circuit-breaker':
      return { requested: false, reason: `the re-review limit is reached (${outcome.autoRequeueCount} requests)` };
    case 'dirty-workspace':
      return { requested: false, reason: outcome.error };
    case 'no-workspace':
      return { requested: false, reason: 'the workspace does not exist' };
    case 'no-project':
      return { requested: false, reason: `no project is configured for ${issueId}` };
  }
}

export const postAgentUnpauseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/unpause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeUnpause = getAgentState(id);
    if (!stateBeforeUnpause) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const updatedState = yield* clearAgentPaused(id);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.unpause_requested'));
    if (stateBeforeUnpause.paused === true) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState.issueId || stateBeforeUnpause.issueId || id.replace(/^agent-/, '').toUpperCase(),
        kind: 'unpause',
        source: 'dashboard:agent-unpause',
      }));
    }
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    // PAN-2633: assert tmux liveness at emission time so the reducer knows whether
    // this stop-shaped transition is idle-alive (preserve pending-input payload).
    const hasLiveTmuxSession = yield* sessionExists(id);
    yield* saveAgentStateAndEmitEventProgram(updatedState, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentControlEventPayload(updatedState, toAgentStatusPayload(stateBeforeUnpause.status), hasLiveTmuxSession),
    });

    invalidateAgentsCache();

    // Resume immediately instead of leaving the agent for the deacon's next
    // patrol — clicking unpause means "go now". Fire-and-forget: resume has
    // its own readiness gate; the response returns at once and the tree
    // updates via the projection as the agent comes up. Only fires when the
    // lifecycle says there is actually a session to resume — a plain stopped
    // agent with no session is left for the Start button, same as before.
    // PAN-3911: when the issue pause stopped review or test agents, start them
    // again through the normal doors before the work agent resumes: a fresh
    // review request (new synthesis parent and convoy for the current head),
    // never convoy recovery against the stopped parent.
    const restart = yield* Effect.promise(() => restartIssueAfterUnpause(stateBeforeUnpause, {
      requestReview: requestReviewInProcess,
    }));

    let resumeTriggered = false;
    const lifecycle = yield* Effect.promise(() => getWorkAgentLifecycleState(id));
    // Troubled agents are quarantined from auto-resume (the deacon skips them
    // too) — firing resumeAgent would just hit its gate and make
    // resumeTriggered a lie. untroubled + start is the path for those.
    if (lifecycle.canResumeSession && updatedState.troubled !== true) {
      resumeTriggered = true;
      yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.unpause_immediate_resume_triggered'));
      void import('../../../../lib/agents/resume.js')
        .then(({ resumeAgent }) => resumeAgent(id))
        .then((result) => {
          if (!result.success) console.warn(`[agents] immediate resume after unpause failed for ${id}: ${result.error}`);
        })
        .catch((err) => console.warn(`[agents] immediate resume after unpause errored for ${id}:`, err));
    }

    // PAN-3911: a re-request that did not go out is reported, never a silent success.
    const warnings = restart ? describeUnpauseRestartProblems(restart) : [];
    for (const warning of warnings) console.warn(`[agents] Unpause of ${id}: ${warning}`);
    return jsonResponse({
      success: true,
      agent: updatedState,
      resumeTriggered,
      ...(restart ? { restart } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  })),
);
