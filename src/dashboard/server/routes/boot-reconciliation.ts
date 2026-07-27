import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  extendBootReconciliationGrace,
  isAutoResumableRole,
  isBootReconciliationCandidate,
  listBootReconciliationCandidates,
  MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS,
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
  if (agent.stoppedByUser === true) return 'stopped by operator';
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
    const toRow = (agent: BootReconciliationAgent) => ({
      id: agent.id,
      issueId: agent.issueId,
      role: agent.role,
      model: agent.model,
      whyStopped: bootReconciliationWhyStopped(agent),
      concern: bootReconciliationConcern(agent),
      lastActivity: agent.lastActivity ?? agent.updatedAt ?? null,
      cost: agent.costSoFar ?? null,
      remote: Boolean(agent.hostOverride),
      stoppedByUser: agent.stoppedByUser === true,
      readOnly: bootReconciliationReadOnly(agent),
    });

    // `set` is exactly what a decision acts on. Everything else the operator may
    // want to see at boot — agents paused or troubled from earlier sessions, or
    // running remote — goes in `context`, which no decision touches. Mixing the
    // two made a 2-candidate boot render a 22-row dialog under a "Resume all"
    // button, so the operator read "resumed 1" as a failure (PAN-3052).
    const autoResumableAgents = listAllAgentsSync().filter((agent) => isAutoResumableRole(agent.role));
    const set = autoResumableAgents.filter((agent) => candidateIds.has(agent.id)).map(toRow);
    const context = autoResumableAgents
      .filter((agent) => !candidateIds.has(agent.id) && (
        agent.paused === true
        || agent.troubled === true
        || Boolean(agent.hostOverride)
      ))
      .map(toRow);
    let heldCount = 0;
    if (state.decision === 'hold_all') {
      heldCount = set.length;
    } else if (state.decision === 'per_agent') {
      heldCount = set.filter((agent) => state.perAgent[agent.issueId] !== 'resume').length;
    }

    return jsonResponse({
      ...state,
      maxGraceExtensions: MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS,
      heldCount,
      set,
      context,
    });
  }),
);

/**
 * Push the grace deadline out while the operator is answering a different
 * blocking dialog. Bounded server-side by MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS;
 * the client may call this freely and the cap decides.
 */
const postBootReconciliationExtendRoute = HttpRouter.add(
  'POST',
  '/api/boot-reconciliation/extend',
  httpHandler(Effect.sync(() => jsonResponse({ ok: true, ...extendBootReconciliationGrace() }))),
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
    const result = yield* Effect.promise(() => applyBootReconciliationDecision({ origin: 'operator' }));
    const resumed = result.resumed;
    return jsonResponse({
      ok: true,
      decision: body.decision,
      perAgent,
      resumed,
      outcomes: result.outcomes,
      skipped: result.skipped,
      deferred: result.deferred,
      count: resumed.length,
    });
  })),
);

export const bootReconciliationRouteLayer = Layer.mergeAll(
  getBootReconciliationRoute,
  postBootReconciliationDecisionRoute,
  postBootReconciliationExtendRoute,
);
