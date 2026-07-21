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
import { emitActivityEntrySync } from '../../../../lib/activity-logger.js';
import { operatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { stopWorkspaceDocker } from '../../../../lib/workspace-manager.js';
import { killSession, sessionExists } from '../../../../lib/tmux.js';
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

    const stateBeforeStop = yield* getAgentState(id);
    yield* Effect.promise(() => appendAgentLifecycleLog(id, lifecycleEvent));
    yield* stopAgent(id);

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
            const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, issueLower));
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
    const stateAfterStop = yield* getAgentState(id);
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
    emitActivityEntrySync({
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
    const suspendIssueId = (yield* getAgentState(id))?.issueId ?? '';
    yield* killSession(id).pipe(Effect.catch(() => Effect.void));
    saveAgentRuntimeState(id, {
      state: 'suspended',
      lastActivity: new Date().toISOString(),
      claudeSessionId: effectiveSessionId,
    });
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction. Preserve the existing agent-table status
    // (suspend does not flip it to stopped).
    const stateAfterSuspend = yield* getAgentState(id);
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

    const stateBeforePause = yield* getAgentState(id);
    if (!stateBeforePause) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const previousStatus = toAgentStatusPayload(stateBeforePause.status);
    const hasLiveSession = yield* sessionExists(id);
    const stoppedByPause = hasLiveSession || stateBeforePause.status === 'running' || stateBeforePause.status === 'starting';
    let updatedState = yield* setAgentPaused(id, reason, stoppedByPause);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    if (hasLiveSession) {
      yield* Effect.promise(() => captureAgentOutputBeforeKill(id));
      yield* killSession(id);
    }

    if (hasLiveSession || updatedState.status === 'running' || updatedState.status === 'starting') {
      const stoppedState = markAgentStoppedState(updatedState);
      updatedState = stoppedState;
      yield* Effect.promise(() => saveAgentRuntimeState(id, {
        state: 'stopped',
        lastActivity: new Date().toISOString(),
      }));
    }

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
    return jsonResponse({ success: true, agent: updatedState });
  })),
);

// ─── Route: POST /api/agents/:id/unpause ──────────────────────────────────────

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

    const stateBeforeUnpause = yield* getAgentState(id);
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
    return jsonResponse({ success: true, agent: updatedState });
  })),
);

// ─── Route: POST /api/agents/:id/untroubled ───────────────────────────────────

export const postAgentUntroubledRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/untroubled',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    const stateBeforeClear = yield* getAgentState(id);
    if (!stateBeforeClear) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    const updatedState = yield* clearAgentTroubled(id);
    if (!updatedState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => appendAgentLifecycleLog(id, 'agent.untroubled_requested'));
    if (stateBeforeClear.troubled === true || (stateBeforeClear.consecutiveFailures ?? 0) > 0) {
      yield* eventStore.appendAsync(operatorInterventionEvent({
        issueId: updatedState.issueId || stateBeforeClear.issueId || id.replace(/^agent-/, '').toUpperCase(),
        kind: 'untroubled',
        source: 'dashboard:agent-untroubled',
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
      payload: buildAgentControlEventPayload(updatedState, toAgentStatusPayload(stateBeforeClear.status), hasLiveTmuxSession),
    });

    invalidateAgentsCache();
    return jsonResponse({ success: true, agent: updatedState });
  })),
);
