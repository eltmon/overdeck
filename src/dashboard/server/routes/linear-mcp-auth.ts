import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { messageAgent } from '../../../lib/agents/messaging.js';
import {
  appendLinearMcpAuthCallbackRelayedEvent,
  appendLinearMcpAuthHealthyEvent,
  resolveLinearMcpAuthIntervention,
  type LinearMcpAuthIntervention,
} from '../../../lib/linear-mcp-auth.js';
import { connectLinearMcpAuth } from '../../../lib/linear-mcp-auth-connect.js';
import { requestLinearMcpAuthVerify } from '../../../lib/linear-mcp-auth-verify.js';
import { getSharedIssueService } from '../services/issue-service-singleton.js';
import { getConversationByName, getConversationByTmuxSession } from '../../../lib/overdeck/conversations.js';
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

/**
 * Attach each blocked agent's canonical tracker URL (Linear web URL, GitHub
 * html_url) from the issues read door so the banner can link every blocked
 * agent's issue — including Linear-tracked ones the frontend cannot derive a
 * URL for. Best-effort: an unresolvable issue falls back to null and the
 * banner renders its own fallback.
 */
function withIssueUrls(intervention: LinearMcpAuthIntervention): LinearMcpAuthIntervention {
  let urlByIdentifier: Map<string, string>;
  try {
    urlByIdentifier = new Map();
    const issues = getSharedIssueService().getIssues({ includeCompleted: true }) as Array<{ identifier?: unknown; url?: unknown }>;
    for (const issue of issues) {
      if (typeof issue.identifier === 'string' && typeof issue.url === 'string' && issue.url !== '') {
        urlByIdentifier.set(issue.identifier.toLowerCase(), issue.url);
      }
    }
  } catch {
    return intervention;
  }
  return {
    ...intervention,
    blockedAgents: intervention.blockedAgents.map(agent => ({
      ...agent,
      issueUrl: agent.issueId ? urlByIdentifier.get(agent.issueId.toLowerCase()) ?? null : null,
    })),
  };
}

/**
 * Attach each blocked conversation's canonical dashboard URL — /conv/<rowid>,
 * the DB row id, which is how conversations are displayed everywhere else in
 * the dashboard — and its title, so the banner can label the row. The blocked agent id is the conversation's tmux session
 * (`conv-<name>`), so it resolves by tmux session first, then by the bare
 * DB name so an archived conversation still links (PAN-4464). Best-effort: an unresolvable conversation falls back to null and the banner
 * renders the id as plain text.
 */
function withConversationUrls(intervention: LinearMcpAuthIntervention): LinearMcpAuthIntervention {
  return {
    ...intervention,
    blockedAgents: intervention.blockedAgents.map(agent => {
      if (!agent.agentId.startsWith('conv-')) {
        return { ...agent, conversationUrl: null, conversationTitle: null };
      }
      try {
        const conversation = getConversationByTmuxSession(agent.agentId)
          ?? getConversationByName(agent.agentId.slice('conv-'.length));
        return {
          ...agent,
          conversationUrl: conversation === null ? null : `/conv/${conversation.id}`,
          conversationTitle: conversation?.title ?? null,
        };
      } catch {
        return { ...agent, conversationUrl: null, conversationTitle: null };
      }
    }),
  };
}

const getLinearMcpAuthRoute = HttpRouter.add(
  'GET',
  '/api/linear-mcp-auth',
  httpHandler(Effect.gen(function* () {
    const intervention = yield* Effect.promise(() => resolveLinearMcpAuthIntervention());
    return jsonResponse(withConversationUrls(withIssueUrls(intervention)));
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

/** Connect Linear (PAN-4464): open the usable link, or ask a blocked agent
 * for a fresh one. Returns at once; the banner polls GET for the new link. */
const postLinearMcpAuthConnectRoute = HttpRouter.add(
  'POST',
  '/api/linear-mcp-auth/connect',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = rejectInvalidOrigin(request);
    if (originError) return originError;

    const result = yield* Effect.promise(() => connectLinearMcpAuth());
    switch (result.kind) {
      case 'open':
        return jsonResponse({ action: 'open', authUrl: result.authUrl, authUrlAgentId: result.authUrlAgentId });
      case 'refreshing':
        return jsonResponse(
          { action: 'refreshing', requestedFrom: result.requestedFrom, previousAuthUrl: result.previousAuthUrl },
          { status: 202 },
        );
      case 'nothing-pending':
        return jsonResponse({ success: false, error: 'No Linear authorization is pending' }, { status: 409 });
      case 'unreachable':
        return jsonResponse({ success: false, error: result.error }, { status: 409 });
    }
  })),
);

/** Verify request (PAN-4464): ask the URL owner to re-check Linear access
 * after a same-machine approval, so its hook closes the lifecycle. */
const postLinearMcpAuthVerifyRoute = HttpRouter.add(
  'POST',
  '/api/linear-mcp-auth/verify',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = rejectInvalidOrigin(request);
    if (originError) return originError;

    const result = yield* Effect.promise(() => requestLinearMcpAuthVerify());
    switch (result.kind) {
      case 'already-connected':
        return jsonResponse({ alreadyConnected: true });
      case 'requested':
        return jsonResponse({ requestedFrom: result.requestedFrom }, { status: 202 });
      case 'no-owner':
        return jsonResponse({ success: false, error: 'No blocked agent owns the active Linear authorization URL' }, { status: 409 });
      case 'unreachable':
        return jsonResponse({ success: false, error: result.error }, { status: 409 });
    }
  })),
);

export const linearMcpAuthRouteLayer = Layer.mergeAll(
  getLinearMcpAuthRoute,
  postLinearMcpAuthCallbackRoute,
  postLinearMcpAuthCompleteRoute,
  postLinearMcpAuthConnectRoute,
  postLinearMcpAuthVerifyRoute,
);
