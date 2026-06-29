import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  isBootReconciliationCandidate,
  listBootReconciliationCandidates,
} from '../../../lib/cloister/boot-reconciliation.js';
import { applyBootReconciliationDecision } from '../../../lib/cloister/deacon.js';
import { sessionExists } from '../../../lib/tmux.js';
import { listAllAgentsSync } from '../../../lib/overdeck/agents.js';
import {
  getBootReconciliationState,
  setBootReconciliationDecision,
  type BootReconciliationDecision,
  type BootReconciliationPerAgentMap,
} from '../../../lib/overdeck/control-settings.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {} as unknown;
  }
});

type BootReconciliationAgent = ReturnType<typeof listAllAgentsSync>[number];

function bootReconciliationWhyStopped(agent: BootReconciliationAgent): string {
  if (agent.paused === true) return agent.pausedReason ? `paused: ${agent.pausedReason}` : 'paused';
  if (agent.troubled === true) return 'troubled';
  if (agent.stoppedByUser === true && !isBootReconciliationCandidate(agent)) {
    return 'stopped by operator';
  }
  if (agent.status === 'stopped' && agent.sessionId && !sessionExists(agent.sessionId)) {
    return 'orphaned: tmux session missing';
  }
  if (agent.status === 'stopped') return 'stopped cleanly';
  if (agent.hostOverride) return 'running remote';
  return agent.status;
}

function bootReconciliationConcern(agent: BootReconciliationAgent): string {
  if (agent.paused === true || agent.troubled === true) return 'paused_troubled';
  if (agent.hostOverride && agent.status !== 'stopped') return 'running_remote';
  if (agent.status === 'stopped' && agent.sessionId && !sessionExists(agent.sessionId)) return 'orphaned';
  return 'stopped_cleanly';
}

function bootReconciliationReadOnly(agent: BootReconciliationAgent): boolean {
  return agent.paused === true
    || agent.troubled === true
    || !isBootReconciliationCandidate(agent);
}

const getBootReconciliationRoute = HttpRouter.add(
  'GET',
  '/api/boot-reconciliation',
  Effect.sync(() => {
    const state = getBootReconciliationState();
    const candidateIds = new Set(listBootReconciliationCandidates().map((agent) => agent.id));
    const agents = listAllAgentsSync()
      .filter((agent) => agent.role === 'work' && (
        candidateIds.has(agent.id)
        || agent.paused === true
        || agent.troubled === true
        || agent.status === 'stopped'
        || Boolean(agent.hostOverride)
      ))
      .map((agent) => ({
        id: agent.id,
        issueId: agent.issueId,
        role: agent.role,
        model: agent.model,
        whyStopped: bootReconciliationWhyStopped(agent),
        concern: bootReconciliationConcern(agent),
        lastActivity: agent.lastActivity ?? agent.updatedAt ?? null,
        cost: agent.costSoFar ?? null,
        remote: Boolean(agent.hostOverride),
        readOnly: bootReconciliationReadOnly(agent),
      }));

    return jsonResponse({
      ...state,
      set: agents,
    });
  }),
);

function isBootReconciliationDecision(value: unknown): value is BootReconciliationDecision {
  return value === 'resume_all' || value === 'hold_all' || value === 'per_agent';
}

function parsePerAgentMap(value: unknown): BootReconciliationPerAgentMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: BootReconciliationPerAgentMap = {};
  for (const [issueId, action] of Object.entries(value)) {
    if (action === 'resume' || action === 'hold') parsed[issueId] = action;
  }
  return parsed;
}

const postBootReconciliationDecisionRoute = HttpRouter.add(
  'POST',
  '/api/boot-reconciliation/decision',
  httpHandler(Effect.gen(function* () {
    const body = (yield* readJsonBody) as { decision?: unknown; perAgent?: unknown };
    if (!isBootReconciliationDecision(body.decision)) {
      return jsonResponse(
        { ok: false, error: 'Body must include decision resume_all, hold_all, or per_agent' },
        { status: 400 },
      );
    }

    const perAgent = body.decision === 'per_agent'
      ? parsePerAgentMap(body.perAgent)
      : {};
    setBootReconciliationDecision(body.decision, perAgent);
    const resumed = yield* Effect.promise(() => applyBootReconciliationDecision());
    return jsonResponse({ ok: true, decision: body.decision, perAgent, resumed, count: resumed.length });
  })),
);

export const bootReconciliationRouteLayer = Layer.mergeAll(
  getBootReconciliationRoute,
  postBootReconciliationDecisionRoute,
);
