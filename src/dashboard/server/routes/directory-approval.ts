/**
 * The operator's directory actions (PRD PAN-2356 WI-14): join, accept or reject a join, open,
 * approve or reject an incoming approval, and remove a machine from the directory.
 *
 * Admin only and never from a channel, like the machine-link routes: no linked machine may link
 * or forget machines here.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentApprovalService, DirectoryApprovalError, type DirectoryApprovalService } from '../services/directory-approval.js';
import { currentDirectoryClient } from '../services/directory-client.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const STATUS: Record<DirectoryApprovalError['code'], number> = {
  offline: 503,
  unknown: 404,
  expired: 410,
  'not-open': 409,
  'fingerprint-mismatch': 409,
  busy: 409,
};

function errorResponse(error: unknown) {
  if (error instanceof DirectoryApprovalError) return jsonResponse({ error: error.code, message: error.message }, { status: STATUS[error.code] });
  return jsonResponse({ error: 'unreachable', message: (error as Error).message }, { status: 502 });
}

function parseBody(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text || '{}') as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Common guard: an operator mutation, not through a channel, with a running service. */
const guarded = (handler: (service: DirectoryApprovalService, request: HttpServerRequest.HttpServerRequest) => Effect.Effect<ReturnType<typeof jsonResponse>, never, HttpRouter.RouteContext>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot manage the directory here' }, { status: 403 });
    }
    const refused = rejectUnsafeDashboardMutationRequest(request);
    if (refused) return refused;
    const service = currentApprovalService();
    if (!service) return jsonResponse({ error: 'offline', message: 'The directory is not running on this dashboard' }, { status: 503 });
    return yield* handler(service, request);
  });

const joinRoute = HttpRouter.add(
  'POST',
  '/api/directory/join',
  guarded((service, request) =>
    Effect.gen(function* () {
      const body = parseBody(yield* Effect.orDie(request.text));
      const to = body?.to;
      if (body === null || (to !== undefined && to !== null && (typeof to !== 'string' || !UUID_RE.test(to)))) {
        return jsonResponse({ error: 'body must be { to?: environmentId }' }, { status: 400 });
      }
      try {
        return jsonResponse({ requestId: service.join((to as string | undefined) ?? null) });
      } catch (error) {
        return errorResponse(error);
      }
    })),
);

function requestIdParam() {
  return Effect.map(HttpRouter.params, (params) => params['requestId'] ?? '');
}

const joinAcceptRoute = HttpRouter.add(
  'POST',
  '/api/directory/joins/:requestId/accept',
  guarded((service) =>
    Effect.gen(function* () {
      const requestId = yield* requestIdParam();
      try {
        service.accept(requestId);
        return jsonResponse({ ok: true });
      } catch (error) {
        return errorResponse(error);
      }
    })),
);

const joinRejectRoute = HttpRouter.add(
  'POST',
  '/api/directory/joins/:requestId/reject',
  guarded((service) =>
    Effect.gen(function* () {
      const requestId = yield* requestIdParam();
      try {
        service.rejectJoin(requestId);
        return jsonResponse({ ok: true });
      } catch (error) {
        return errorResponse(error);
      }
    })),
);

const approvalOpenRoute = HttpRouter.add(
  'POST',
  '/api/directory/approvals/:requestId/open',
  guarded((service) =>
    Effect.gen(function* () {
      const requestId = yield* requestIdParam();
      const outcome = yield* Effect.promise(() => service.open(requestId).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ));
      return outcome.ok ? jsonResponse(outcome.value) : errorResponse(outcome.error);
    })),
);

const approvalApproveRoute = HttpRouter.add(
  'POST',
  '/api/directory/approvals/:requestId/approve',
  guarded((service) =>
    Effect.gen(function* () {
      const requestId = yield* requestIdParam();
      try {
        // The exchange waits for the other operator; it runs on, and GET /api/directory shows the outcome.
        void service.approve(requestId);
        return jsonResponse({ approving: true }, { status: 202 });
      } catch (error) {
        return errorResponse(error);
      }
    })),
);

const approvalRejectRoute = HttpRouter.add(
  'POST',
  '/api/directory/approvals/:requestId/reject',
  guarded((service) =>
    Effect.gen(function* () {
      const requestId = yield* requestIdParam();
      try {
        service.rejectApproval(requestId);
        return jsonResponse({ ok: true });
      } catch (error) {
        return errorResponse(error);
      }
    })),
);

const forgetRoute = HttpRouter.add(
  'POST',
  '/api/directory/forget',
  guarded((_service, request) =>
    Effect.gen(function* () {
      const body = parseBody(yield* Effect.orDie(request.text));
      // `environmentId` from the panel; `machine` (a label or an environment id) from `pan machines forget`.
      const target = body?.environmentId ?? body?.machine;
      if (typeof target !== 'string' || target.trim() === '') {
        return jsonResponse({ error: 'body must be { environmentId } or { machine }' }, { status: 400 });
      }
      const client = currentDirectoryClient();
      if (!client?.isOnline()) return jsonResponse({ error: 'offline', message: 'Not connected to the overdeck.ai directory' }, { status: 503 });
      const machines = client.status().machines;
      const machine = UUID_RE.test(target)
        ? machines.find((m) => m.environmentId === target)
        : machines.find((m) => m.label === target.trim());
      if (!machine) return jsonResponse({ error: 'unknown', message: `The directory does not list a machine "${target}"` }, { status: 404 });
      if (!client.send({ type: 'forget', environmentId: machine.environmentId })) {
        return jsonResponse({ error: 'offline', message: 'Not connected to the overdeck.ai directory' }, { status: 503 });
      }
      return jsonResponse({ ok: true, environmentId: machine.environmentId, label: machine.label });
    })),
);

export const directoryApprovalRouteLayer = Layer.mergeAll(
  joinRoute,
  joinAcceptRoute,
  joinRejectRoute,
  approvalOpenRoute,
  approvalApproveRoute,
  approvalRejectRoute,
  forgetRoute,
);
