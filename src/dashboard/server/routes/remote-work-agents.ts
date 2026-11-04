/**
 * Work door for Fly work agents (PAN-4734 WI-8, FR-1, FR-4, D-1).
 *
 * `POST /api/remote/work-agents` `{ issueId, model?, effort?, startedBy?,
 * autoSpawnConsentRequired? }` starts the issue's work agent as a conversation
 * on a new Fly machine linked to this one (`startFlyWorkAgent`). It answers
 * 201 `{ issueId, agentId, environmentId, name, path, machine }`. Provisioning
 * and the project clone take 5–15 minutes, all in this one request; `pan start
 * --remote` waits without a client timeout. It runs here and not in the CLI
 * because provisioning needs the link supervisor and the link pool.
 *
 * Like every operator machines route it refuses requests that arrive through a
 * secure channel, so no linked machine can start Fly VMs on this machine's
 * account. It is not in `route-scopes.ts`, so it needs `admin`.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { FLY_MACHINE_ERROR_STATUS, FlyMachineError } from '../../../lib/anywhere/fly/provision.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { FlyWorkAgentError, type StartFlyWorkAgentInput, startFlyWorkAgent } from '../services/fly-work-agent-service.js';
import { MachineLinkError } from '../services/machine-link-service.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { ERROR_STATUS, handleMachinesUnlink, notifyLinksChanged } from './machines.js';

const ISSUE_ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const STRING_FIELDS = ['model', 'effort', 'startedBy'] as const;

export function parseWorkAgentBody(text: string): StartFlyWorkAgentInput | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  if (typeof body.issueId !== 'string' || !ISSUE_ID_RE.test(body.issueId.trim())) return 'issueId must be an issue id such as PAN-123';
  const input: StartFlyWorkAgentInput = { issueId: body.issueId.trim(), startedBy: 'operator:dashboard' };
  for (const field of STRING_FIELDS) {
    const raw = body[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || raw.trim() === '') return `${field} must be a non-empty string`;
    input[field] = raw.trim();
  }
  if (body.autoSpawnConsentRequired !== undefined) {
    if (typeof body.autoSpawnConsentRequired !== 'boolean') return 'autoSpawnConsentRequired must be a boolean';
    input.autoSpawnConsentRequired = body.autoSpawnConsentRequired;
  }
  return input;
}

function workAgentErrorResponse(error: unknown): HttpServerResponse.HttpServerResponse {
  if (error instanceof FlyWorkAgentError) {
    return jsonResponse({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof FlyMachineError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: FLY_MACHINE_ERROR_STATUS[error.code] });
  }
  if (error instanceof MachineLinkError) {
    return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: ERROR_STATUS[error.code] });
  }
  return jsonResponse({ error: 'fly-work-failed', message: (error as Error).message }, { status: 500 });
}

export const remoteWorkAgentsRouteLayer = HttpRouter.add(
  'POST',
  '/api/remote/work-agents',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot start Fly work agents here' }, { status: 403 });
    }
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const input = parseWorkAgentBody(yield* request.text);
    if (typeof input === 'string') return jsonResponse({ error: input }, { status: 400 });
    const outcome = yield* Effect.promise(() => startFlyWorkAgent(input, {
      notifyLinksChanged,
      unlink: (linkId) => handleMachinesUnlink(linkId),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
    if (!outcome.ok) return workAgentErrorResponse(outcome.error);
    const result = outcome.value;
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Started the ${result.issueId} work agent on Fly machine "${result.machine}" as conversation ${result.name}`,
      details: JSON.stringify(result),
    });
    return jsonResponse(result, { status: 201 });
  }),
);
