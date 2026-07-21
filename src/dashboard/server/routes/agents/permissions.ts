import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  deliverAgentMessage,
  deliverAgentPermissionDecision,
  getAgentRuntimeState,
  getAgentState,
} from '../../../../lib/agents.js';
import { getAgentJsonlPath, scanPendingInputsPromise } from '../../../../lib/agent-enrichment.js';
import { deliverPlanActionToSession } from '../../../../lib/overdeck/conversation-delivery.js';
import { emitActivityEntrySync } from '../../../../lib/activity-logger.js';
import { ReadModelService } from '../../read-model.js';
import { EventStoreService } from '../../services/domain-services.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateOrigin } from '../origin-validation.js';
import {
  buildPermissionActivityDetails,
  buildPermissionWaitingMessage,
  normalizePermissionRequestBody,
  parsePermissionResponseBehavior,
  permissionResolutionVerb,
  processPermissionResponse,
} from '../agent-permissions.js';
import {
  constantTimeTokenEqual,
  getAgentPendingQuestions,
  readJsonBody,
} from './shared.js';

// ─── Route: GET /api/agents/:id/pending-questions ────────────────────────────

export const getAgentPendingQuestionsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/pending-questions',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const questions = yield* getAgentPendingQuestions(id);
    return jsonResponse({ pending: questions.length > 0, questions });
  })),
);

// ─── Route: POST /api/agents/:id/answer-question (PAN-1520) ──────────────────
//
// Operator answer for an AskUserQuestion the agent is blocked on. The Phase 1
// hook (sync-sources/hooks/ask-user-question-hook) denies the upstream tool
// call to prevent silent corruption (upstream returns option #1 under
// --dangerously-skip-permissions), so by the time this endpoint is hit the
// agent has restated the question as plain text and is waiting on a normal
// user message. We compose that user message from the chosen option labels
// and deliver it through the standard message pipeline.
//
// Body: { answers: string[] }  — one chosen-option label per question.

export const postAgentAnswerQuestionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/answer-question',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;

    const answers = body['answers'];
    if (!Array.isArray(answers) || answers.length === 0) {
      return jsonResponse({ error: 'answers array required' }, { status: 400 });
    }
    if (!answers.every((a): a is string => typeof a === 'string' && a.length > 0)) {
      return jsonResponse({ error: 'every answer must be a non-empty string' }, { status: 400 });
    }

    const pendingQuestions = yield* getAgentPendingQuestions(id);
    if (pendingQuestions.length === 0) {
      return jsonResponse({ error: 'No pending questions found for this agent' }, { status: 404 });
    }

    const questionSet = pendingQuestions[0];
    const questions = questionSet.questions;
    const lines: string[] = [];
    for (let i = 0; i < answers.length && i < questions.length; i++) {
      const q = questions[i].question ?? `Question ${i + 1}`;
      lines.push(`Q: ${q}\nA: ${answers[i]}`);
    }
    const message = `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;

    yield* Effect.promise(() => deliverAgentMessage(id, message, 'ask-user-question-answer'));
    return jsonResponse({ success: true, agentId: id, delivered: answers.length });
  })),
);

// ─── Route: POST /api/agents/:id/plan-action (PAN-1520 FR-4) ─────────────────
//
// Agent-scoped mirror of POST /api/conversations/:name/plan-action. The native
// ExitPlanMode approval menu is answered with raw keystrokes (1/2/3/4), not a
// text message, so the conversation delivery door can't serve it — and the
// existing route is conversation-name-scoped. Guarded on the agent actually
// having a pending ExitPlanMode so a stale dashboard click can never inject
// keystrokes into a session that has already moved on.
//
// Body: { action: 'approve-auto' | 'approve-manual' | 'reject-ultraplan' | 'reject-feedback', feedback?: string }

export const postAgentPlanActionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/plan-action',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const action = typeof body['action'] === 'string' ? body['action'] : '';
    const feedback = typeof body['feedback'] === 'string' ? body['feedback'].trim() : '';

    const agentState = yield* getAgentState(id).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    const jsonlPath = yield* getAgentJsonlPath(id).pipe(Effect.catch(() => Effect.succeed(null)));
    const scan = jsonlPath
      ? yield* Effect.promise(() => scanPendingInputsPromise(jsonlPath))
      : null;
    if (!scan?.exitPlanModePending) {
      return jsonResponse({ error: 'No pending plan approval for this agent' }, { status: 409 });
    }

    const error = yield* Effect.promise(() => deliverPlanActionToSession(id, action, feedback));
    if (error) {
      return jsonResponse({ error }, { status: 400 });
    }
    emitActivityEntrySync({
      source: 'dashboard',
      level: 'info',
      issueId: agentState.issueId,
      message: `Operator ${action.startsWith('approve') ? 'approved' : 'requested changes to'} ${id}'s plan from the dashboard`,
    });
    return jsonResponse({ success: true, agentId: id, action });
  })),
);

export const postInternalAgentPermissionRequestRoute = HttpRouter.add(
  'POST',
  '/api/internal/agents/:id/permissions/request',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ ok: false, error: 'missing agent id' }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalTokenSync } = yield* Effect.promise(() =>
      import('../../../../lib/internal-token.js'),
    );
    const expected = getInternalTokenSync();
    if (!expected) {
      return jsonResponse({ ok: false, error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!constantTimeTokenEqual(provided, expected)) {
      return jsonResponse({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const body = (yield* readJsonBody) as Record<string, unknown>;
    const normalized = normalizePermissionRequestBody(body);
    if (!normalized.ok) {
      return jsonResponse({ ok: false, error: normalized.error }, { status: 400 });
    }
    const { requestId, toolName, description, inputPreview } = normalized.value;

    const readModel = yield* ReadModelService;
    const existing = yield* readModel.getChannelPermissionRequest(requestId);
    if (existing) {
      if (existing.agentId !== id) {
        return jsonResponse({ ok: false, error: `request ${requestId} already belongs to ${existing.agentId}` }, { status: 409 });
      }
      return jsonResponse({ ok: true, duplicate: true });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ ok: false, error: `agent ${id} not found` }, { status: 404 });
    }
    const runtimeState = yield* getAgentRuntimeState(id);
    const issueId = runtimeState?.currentIssue ?? agentState.issueId;

    const eventStore = yield* EventStoreService;
    const timestamp = new Date().toISOString();
    yield* eventStore.append({
      type: 'agent.permission_requested',
      timestamp,
      payload: {
        requestId,
        agentId: id,
        issueId,
        toolName,
        description,
        inputPreview,
        createdAt: timestamp,
      },
    } as never);
    yield* eventStore.append({
      type: 'agent.waiting_started',
      timestamp,
      payload: {
        agentId: id,
        reason: 'tool_permission',
        message: buildPermissionWaitingMessage(toolName, description),
      },
    } as never);

    emitActivityEntrySync({
      source: 'dashboard',
      level: 'warn',
      message: `Permission requested for ${toolName}`,
      details: buildPermissionActivityDetails(description, inputPreview),
      issueId,
    });

    return jsonResponse({ ok: true });
  })),
);

export const postAgentPermissionResponseRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/permissions/:requestId/respond',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const requestId = params['requestId'] ?? '';
    if (!id.trim() || !requestId.trim()) {
      return jsonResponse({ ok: false, error: 'missing agent id or request id' }, { status: 400 });
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ ok: false, error: originCheck.error }, { status: 403 });
    }

    const body = (yield* readJsonBody) as Record<string, unknown>;
    const behaviorResult = parsePermissionResponseBehavior(body);
    if (!behaviorResult.ok) {
      return jsonResponse({ ok: false, error: behaviorResult.error }, { status: 400 });
    }
    const behavior = behaviorResult.value;

    const readModel = yield* ReadModelService;
    const eventStore = yield* EventStoreService;
    const result = yield* Effect.promise(() => processPermissionResponse(
      {
        getPendingRequest: (permissionRequestId) =>
          Effect.runPromise(readModel.getChannelPermissionRequest(permissionRequestId)),
        getResolvedDecision: (permissionRequestId) =>
          Effect.runPromise(readModel.getResolvedChannelPermissionDecision(permissionRequestId)),
        appendResolutionEvents: async (pendingRequest, decisionBehavior) => {
          const timestamp = new Date().toISOString();
          await Effect.runPromise(eventStore.append({
            type: 'agent.permission_resolved',
            timestamp,
            payload: {
              requestId: pendingRequest.requestId,
              agentId: pendingRequest.agentId,
              issueId: pendingRequest.issueId,
              behavior: decisionBehavior,
            },
          } as never));
          await Effect.runPromise(eventStore.append({
            type: 'agent.waiting_cleared',
            timestamp,
            payload: {
              agentId: pendingRequest.agentId,
              clearedBy: 'tool_resumed',
            },
          } as never));
        },
        deliverDecision: (agentId, permissionRequestId, decisionBehavior) =>
          deliverAgentPermissionDecision(agentId, permissionRequestId, decisionBehavior),
        emitResolvedActivity: (pendingRequest, decisionBehavior) => {
          emitActivityEntrySync({
            source: 'dashboard',
            level: decisionBehavior === 'allow' ? 'success' : 'warn',
            message: `Permission ${permissionResolutionVerb(decisionBehavior)} for ${pendingRequest.toolName}`,
            details: buildPermissionActivityDetails(
              pendingRequest.description,
              pendingRequest.inputPreview,
            ),
            issueId: pendingRequest.issueId,
          });
        },
      },
      {
        agentId: id,
        requestId,
        behavior,
      },
    ));

    return jsonResponse(result.body, { status: result.status });
  })),
);
