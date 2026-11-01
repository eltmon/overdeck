/**
 * Operator-side machine-link routes (PAN-4645 WI-12).
 *
 * `POST /api/machines/link` takes a `pan pair` link from another machine and
 * creates the link (and, by default, the reverse one). Admin only, never from
 * a channel: no link may create or use another machine's links (FR-4).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { MACHINE_ACCESS_LEVELS } from '../../../lib/access-tokens.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { createMachineLink, MachineLinkError } from '../services/machine-link-service.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

const ERROR_STATUS: Record<MachineLinkError['code'], number> = {
  'bad-pairing-url': 400,
  'unreachable': 502,
  'pairing-refused': 401,
  'unsupported': 409,
  'identity-mismatch': 409,
  'exchange-failed': 502,
};

function parseLinkBody(text: string): { pairingUrl: string; bothWays: boolean; access: 'operator' | 'agent-fenced'; allowLoopback: boolean } | string {
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return 'body is not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'body must be an object';
  const body = value as Record<string, unknown>;
  if (typeof body.pairingUrl !== 'string' || body.pairingUrl === '') return 'pairingUrl must be a non-empty string';
  if (body.bothWays !== undefined && typeof body.bothWays !== 'boolean') return 'bothWays must be a boolean';
  if (body.allowLoopback !== undefined && typeof body.allowLoopback !== 'boolean') return 'allowLoopback must be a boolean';
  if (body.access !== undefined && !(MACHINE_ACCESS_LEVELS as readonly unknown[]).includes(body.access)) return `access must be one of ${MACHINE_ACCESS_LEVELS.join(', ')}`;
  return {
    pairingUrl: body.pairingUrl,
    bothWays: body.bothWays ?? true,
    access: (body.access as 'operator' | 'agent-fenced' | undefined) ?? 'operator',
    allowLoopback: body.allowLoopback ?? false,
  };
}

const linkRoute = HttpRouter.add(
  'POST',
  '/api/machines/link',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot create links here' }, { status: 403 });
    }
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = parseLinkBody(yield* request.text);
    if (typeof body === 'string') return jsonResponse({ error: body }, { status: 400 });

    const outcome = yield* Effect.promise(() => createMachineLink(body).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
    if (!outcome.ok) {
      const error = outcome.error;
      if (error instanceof MachineLinkError) {
        return jsonResponse({ error: error.code, message: error.message, detail: error.detail }, { status: ERROR_STATUS[error.code] });
      }
      return jsonResponse({ error: 'link-failed', message: (error as Error).message }, { status: 500 });
    }
    const { link, view } = outcome.result;
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Linked machine "${link.label}"`,
      details: JSON.stringify({ linkId: link.id, environmentId: link.environmentId, access: link.access, bothWays: body.bothWays, route: view.routes[0]?.url ?? null }),
    });
    return jsonResponse(view);
  }),
);

export const machinesRouteLayer = Layer.mergeAll(linkRoute);
