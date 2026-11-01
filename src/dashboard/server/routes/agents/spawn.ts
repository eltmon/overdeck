import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentState, clearAgentPaused, clearAgentTroubled } from '../../../../lib/agents.js';
import { FsError } from '../../../../lib/errors.js';
import { appendOperatorInterventionEvent } from '../../../../lib/operator-interventions.js';
import { httpHandler } from '../http-handler.js';
import { rejectUnsafeDashboardMutationRequest } from '../dashboard-auth.js';
import {
  evaluateAgentStartGate,
  isInternalAgentRequest,
  readJsonBody,
  type AgentStartGateDecision,
} from './shared.js';

export {
  emitDirtyWorkspaceRefusalActivity,
  isOnlyOverdeckRuntimeWorkspaceChanges,
  resolveSpawnGuardrailRefusal,
  spawnAfterClearingStartGates,
  spawnGuardrailResourcesHint,
} from './spawn-issue.js';
import { spawnIssueAgentForRoute } from './spawn-issue.js';

// ─── Start-agent gate resolution (PAN-2499) ───────────────────────────────────

/**
 * Evaluate the persistent start gate for an agent and, if the request is
 * operator-origin and `clearGates` is set, clear the paused/troubled gates
 * through the same write paths used by `pan unpause` and `pan untroubled`.
 *
 * Returns the gate decision when the agent is still blocked, or `null` when
 * the agent may proceed. Emits `operator.intervention` events when a gate is
 * actually cleared.
 */
export function resolveStartAgentGateForRoute(input: {
  agentSessionName: string;
  issueId: string;
  clearGates: boolean;
  originOk: boolean;
}): Effect.Effect<AgentStartGateDecision | null, never> {
  let gate: AgentStartGateDecision | null = null;

  return Effect.gen(function* () {
    const state = yield* Effect.try({
      try: () => getAgentState(input.agentSessionName),
      catch: (cause) => new FsError({ operation: 'read', path: `agents-db:${input.agentSessionName}`, cause }),
    });
    gate = evaluateAgentStartGate(input.agentSessionName, state);
    if (!gate) return null;

    const shouldClear = input.originOk && input.clearGates;
    if (!shouldClear) return gate;
    if (!state) return gate;

    let cleared = false;
    if (state.paused === true) {
      yield* clearAgentPaused(input.agentSessionName);
      yield* Effect.promise(() =>
        appendOperatorInterventionEvent({
          issueId: input.issueId,
          kind: 'unpause',
          source: 'dashboard start-agent',
        }),
      );
      cleared = true;
    }

    if (state.troubled === true || (state.consecutiveFailures ?? 0) > 0) {
      yield* clearAgentTroubled(input.agentSessionName);
      yield* Effect.promise(() =>
        appendOperatorInterventionEvent({
          issueId: input.issueId,
          kind: 'untroubled',
          source: 'dashboard start-agent',
        }),
      );
      cleared = true;
    }

    if (!cleared) return gate;

    gate = evaluateAgentStartGate(input.agentSessionName, yield* Effect.try({
      try: () => getAgentState(input.agentSessionName),
      catch: (cause) => new FsError({ operation: 'read', path: `agents-db:${input.agentSessionName}`, cause }),
    }));
    return gate;
  }).pipe(
    Effect.catch((err) => {
      console.error(`[start-agent] Failed to clear gates for ${input.issueId}: ${err instanceof Error ? err.message : String(err)}`);
      return Effect.succeed(gate);
    }),
  );
}

// ─── Route: POST /api/agents (start agent) ───────────────────────────────────

export const postAgentsRoute = HttpRouter.add(
  'POST',
  '/api/agents',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const internalRequest = yield* Effect.promise(() => isInternalAgentRequest(request));
    return yield* spawnIssueAgentForRoute({ body, internalRequest });
  })),
);
