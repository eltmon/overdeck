/**
 * Claude Code hooks ingestion route
 *
 * POST /api/hooks/permission-event
 *   Receives PermissionRequest, PostToolUse, and Stop hook payloads from
 *   Claude Code sessions and emits conversation.permission_changed events
 *   so the dashboard can show a "waiting for permission" indicator in real-time.
 *
 * The hook payload always includes `session_id` (Claude session UUID) and
 * `hook_event_name`. We look up the conversation by claude_session_id and
 * emit an in-memory-only event via emitOnly().
 */

import { basename, dirname } from 'path';
import type { MemoryIdentity } from '@panctl/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getEventStore } from '../event-store.js';
import { getAgentStateAsync } from '../../../lib/agents.js';
import { getConversationByClaudeSessionId } from '../../../lib/database/conversations-db.js';
import { injectPromptTimeMemory } from '../../../lib/memory/injection.js';
import { isSubagentHookPayload } from '../../../lib/memory/subagent-filter.js';

const CLEAR_ON = new Set([
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'PermissionDenied',
])

export function memoryTurnHookResponse(body: unknown): typeof HttpServerResponse.Type | null {
  if (!isSubagentHookPayload(body)) return null;
  return HttpServerResponse.text('', { status: 204 });
}

export async function handleMemoryInjectBody(body: Record<string, unknown>) {
  const prompt = typeof body.prompt === 'string'
    ? body.prompt
    : typeof body.userPrompt === 'string'
      ? body.userPrompt
      : null;
  const sessionId = typeof body.sessionId === 'string'
    ? body.sessionId
    : typeof body.session_id === 'string'
      ? body.session_id
      : null;

  if (!prompt || !sessionId) {
    return { error: 'prompt and sessionId are required', status: 400 } as const;
  }

  const identity = parseMemoryIdentity(body.identity, sessionId)
    ?? await resolveMemoryIdentity(body, sessionId);
  if (!identity) {
    return { error: 'memory identity could not be resolved', status: 202 } as const;
  }

  return await injectPromptTimeMemory({ prompt, identity });
}

const postMemoryInjectRoute = HttpRouter.add(
  'POST',
  '/api/memory/inject',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const result = yield* Effect.promise(() => handleMemoryInjectBody(body));
    if ('error' in result) return jsonResponse({ ok: false, error: result.error }, { status: result.status });
    return jsonResponse({ ok: true, ...result });
  })),
);

const postMemoryTurnRoute = HttpRouter.add(
  'POST',
  '/api/memory/turn',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const subagentResponse = memoryTurnHookResponse(body);
    if (subagentResponse) return subagentResponse;

    return jsonResponse({ ok: true }, { status: 202 });
  })),
);

const postPermissionEventRoute = HttpRouter.add(
  'POST',
  '/api/hooks/permission-event',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    const hookEvent = typeof body.hook_event_name === 'string' ? body.hook_event_name : null;
    const toolName = typeof body.tool_name === 'string' ? body.tool_name : undefined;

    if (!sessionId || !hookEvent) {
      return jsonResponse({ ok: true });
    }

    const conv = getConversationByClaudeSessionId(sessionId);
    if (!conv) {
      return jsonResponse({ ok: true });
    }

    const waiting = hookEvent === 'PermissionRequest';
    const clearing = CLEAR_ON.has(hookEvent);

    if (!waiting && !clearing) {
      return jsonResponse({ ok: true });
    }

    console.log(`[hooks] ${hookEvent} session=${sessionId} conv=${conv.name} waiting=${waiting}${toolName ? ` tool=${toolName}` : ''}`);

    getEventStore().emitOnly({
      type: 'conversation.permission_changed',
      timestamp: new Date().toISOString(),
      payload: { conversationName: conv.name, waiting, toolName },
    });

    return jsonResponse({ ok: true, conversationName: conv.name, waiting });
  })),
);

export const hooksRouteLayer = Layer.mergeAll(
  postMemoryInjectRoute,
  postMemoryTurnRoute,
  postPermissionEventRoute,
);

function parseMemoryIdentity(value: unknown, sessionId: string): MemoryIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = value as Record<string, unknown>;
  const projectId = stringField(identity.projectId);
  const workspaceId = stringField(identity.workspaceId);
  const issueId = stringField(identity.issueId);
  const runId = stringField(identity.runId);
  const agentRole = stringField(identity.agentRole);
  const agentHarness = stringField(identity.agentHarness);
  if (!projectId || !workspaceId || !issueId || !runId || !agentRole || !agentHarness) return null;
  if (!isRole(agentRole)) return null;
  return { projectId, workspaceId, issueId, runId, sessionId, agentRole, agentHarness };
}

async function resolveMemoryIdentity(body: Record<string, unknown>, sessionId: string): Promise<MemoryIdentity | null> {
  const agentId = stringField(body.agentId) ?? stringField(body.agent_id);
  if (!agentId) return null;
  const state = await getAgentStateAsync(agentId);
  if (!state) return null;
  return {
    projectId: inferProjectId(state.workspace),
    workspaceId: basename(state.workspace),
    issueId: state.issueId,
    runId: state.id,
    sessionId,
    agentRole: state.role,
    agentHarness: state.harness ?? 'claude-code',
  };
}

function inferProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return basename(workspacePath);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRole(value: string): value is MemoryIdentity['agentRole'] {
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship';
}
