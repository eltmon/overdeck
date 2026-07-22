import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { messageAgent } from '../../../lib/agents/messaging.js';
import {
  appendLinearMcpAuthCallbackRelayedEvent,
  appendLinearMcpAuthHealthyEvent,
  resolveLinearMcpAuthIntervention,
} from '../../../lib/linear-mcp-auth.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

export const LINEAR_MCP_AUTH_CALLBACK_COPY_PREFIX = 'The operator completed the Linear OAuth authorization in their browser. Finish the flow now: call mcp__linear__complete_authentication with callback_url set to exactly this URL:';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  return text ? JSON.parse(text) as Record<string, unknown> : {};
});

function rejectInvalidOrigin(request: HttpServerRequest.HttpServerRequest): ReturnType<typeof jsonResponse> | null {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return jsonResponse({ error: originCheck.error }, { status: 403 });
  }
  return null;
}

export function isValidLinearMcpCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'http:'
      && localHost
      && !!url.searchParams.get('code')
      && !!url.searchParams.get('state');
  } catch {
    return false;
  }
}

function callbackCopy(callbackUrl: string): string {
  return `${LINEAR_MCP_AUTH_CALLBACK_COPY_PREFIX} ${callbackUrl} — then re-check Linear access and resume your canonical task.`;
}

const getLinearMcpAuthRoute = HttpRouter.add(
  'GET',
  '/api/linear-mcp-auth',
  httpHandler(Effect.gen(function* () {
    const intervention = yield* Effect.promise(() => resolveLinearMcpAuthIntervention());
    return jsonResponse(intervention);
  })),
);

const postLinearMcpAuthCallbackRoute = HttpRouter.add(
  'POST',
  '/api/linear-mcp-auth/callback',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = rejectInvalidOrigin(request);
    if (originError) return originError;

    const body = yield* readJsonBody;
    const callbackUrl = typeof body['callbackUrl'] === 'string' ? body['callbackUrl'] : '';
    if (!isValidLinearMcpCallbackUrl(callbackUrl)) {
      return jsonResponse({ success: false, error: 'callbackUrl must be a localhost OAuth callback URL with code and state parameters' }, { status: 400 });
    }

    const intervention = yield* Effect.promise(() => resolveLinearMcpAuthIntervention());
    if (intervention.authUrlAgentId === null) {
      return jsonResponse({ success: false, error: 'No blocked agent owns the active Linear authorization URL' }, { status: 409 });
    }

    yield* Effect.promise(() => messageAgent(
      intervention.authUrlAgentId!,
      callbackCopy(callbackUrl),
      'linear-mcp-auth-callback',
    ));
    yield* Effect.promise(() => appendLinearMcpAuthCallbackRelayedEvent({
      agentId: intervention.authUrlAgentId!,
      issueId: intervention.blockedAgents.find(agent => agent.agentId === intervention.authUrlAgentId)?.issueId ?? null,
    }));
    return jsonResponse({ success: true, relayedTo: intervention.authUrlAgentId });
  })),
);

const postLinearMcpAuthCompleteRoute = HttpRouter.add(
  'POST',
  '/api/linear-mcp-auth/complete',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = rejectInvalidOrigin(request);
    if (originError) return originError;

    yield* Effect.promise(() => appendLinearMcpAuthHealthyEvent({
      agentId: 'operator',
      issueId: null,
      source: 'operator',
    }));
    return jsonResponse({ success: true });
  })),
);

export const linearMcpAuthRouteLayer = Layer.mergeAll(
  getLinearMcpAuthRoute,
  postLinearMcpAuthCallbackRoute,
  postLinearMcpAuthCompleteRoute,
);
