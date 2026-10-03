/**
 * POST /api/agents/:id/effort — live effort change for a running claude-code
 * agent (PAN-4255). Delivers `/effort <level>` through `applyClaudeLiveEffort`
 * and, only after the transcript confirms it, writes `effort` and
 * `effortSource: 'explicit'` to the agent state so `resolveRelaunchEffort`
 * pins the level on resume, recovery, rotation and respawn.
 */
import { isEffortLevel, type EffortLevel, type EffortSource } from '@overdeck/contracts';
import { getLatestSessionId } from './activity.js';
import { saveAgentStateSync } from './agent-state.js';
import { getAgentState } from './agent-state-read.js';
import { applyClaudeLiveEffort, LIVE_EFFORT_FAILURE_STATUS } from './effort-live.js';
import { normalizeAgentId } from './identity.js';
import { isAlive } from './liveness.js';
import { resolveAgentDeliveryMethod } from './messaging.js';
import { resolveEffort } from './resolve-effort.js';

export interface AgentLiveEffortDeps {
  getAgentState?: typeof getAgentState;
  isAlive?: typeof isAlive;
  applyLiveEffort?: typeof applyClaudeLiveEffort;
  saveAgentState?: typeof saveAgentStateSync;
  getLatestSessionId?: typeof getLatestSessionId;
}

export type AgentLiveEffortResponse =
  | { status: 200; body: { ok: true; effort: EffortLevel; source: EffortSource; warning?: string } }
  | { status: number; body: { error: string; code?: string } };

export async function handleAgentLiveEffort(
  rawId: string,
  body: Record<string, unknown>,
  deps: AgentLiveEffortDeps = {},
): Promise<AgentLiveEffortResponse> {
  const readState = deps.getAgentState ?? getAgentState;
  const id = normalizeAgentId(rawId);
  const state = readState(id);
  if (!state) return { status: 404, body: { error: 'Agent not found' } };
  if ((state.harness ?? 'claude-code') !== 'claude-code') {
    return { status: 400, body: { error: 'Live effort change is supported for claude-code agents only' } };
  }
  const level = body['level'];
  if (!isEffortLevel(level)) return { status: 400, body: { error: 'Invalid effort level' } };

  const verdict = await (deps.isAlive ?? isAlive)(id);
  if (!verdict.alive) return { status: 422, body: { error: 'Agent session is not running' } };

  const sessionId = (deps.getLatestSessionId ?? getLatestSessionId)(id, { getAgentState: () => state });
  if (!state.workspace || !sessionId) return { status: 422, body: { error: 'The agent has no transcript yet' } };

  const resolved = resolveEffort({ explicit: level, model: state.model, harness: 'claude-code' });
  // Same rule as messageAgent: a supervisor-backed agent owns a verified PTY socket.
  const deliveryMethod = state.deliveryMethod === 'supervisor' || state.supervisorEnabled === true
    ? 'supervisor'
    : resolveAgentDeliveryMethod(state);
  const result = await (deps.applyLiveEffort ?? applyClaudeLiveEffort)({
    paneId: id,
    workspace: state.workspace,
    sessionId,
    deliveryMethod,
    caller: 'agent-effort',
  }, resolved.effort);
  if (!result.ok) {
    return { status: LIVE_EFFORT_FAILURE_STATUS[result.code], body: { error: result.error, code: result.code } };
  }

  const fresh = readState(id) ?? state;
  (deps.saveAgentState ?? saveAgentStateSync)({ ...fresh, effort: result.effort, effortSource: 'explicit' });
  return {
    status: 200,
    body: {
      ok: true,
      effort: result.effort,
      source: 'explicit',
      ...(resolved.warning ? { warning: resolved.warning } : {}),
    },
  };
}
