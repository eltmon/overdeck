import { timingSafeEqual } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import type { DomainEvent } from '@overdeck/contracts';

import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { EventStoreService } from '../services/domain-services.js';
import { httpHandler } from './http-handler.js';
import { getHeaderFromMap, type HeaderMap } from './origin-validation.js';

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

export function validateInternalEventsHeaders(headers: HeaderMap): { ok: true } | { ok: false; status: number; error: string } {
  const expected = getInternalTokenSync();
  const provided = getHeaderFromMap(headers, INTERNAL_TOKEN_HEADER);
  if (!expected || !constantTimeTokenEqual(provided, expected)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  const origin = getHeaderFromMap(headers, 'origin');
  if (!isLoopbackOrigin(origin)) {
    return { ok: false, status: 403, error: 'non-loopback origin rejected' };
  }
  return { ok: true };
}

export function parseInternalEventsBody(raw: unknown): Array<Omit<DomainEvent, 'sequence'>> {
  const body = raw as { events?: unknown };
  if (!Array.isArray(body.events)) return [];
  return body.events.filter((event): event is Omit<DomainEvent, 'sequence'> => {
    if (!event || typeof event !== 'object') return false;
    const record = event as Record<string, unknown>;
    return typeof record.type === 'string' && typeof record.timestamp === 'string';
  });
}

export function appendInternalEvents(
  events: Array<Omit<DomainEvent, 'sequence'>>,
  append: (event: Omit<DomainEvent, 'sequence'>) => unknown,
): number {
  for (const event of events) append(event);
  return events.length;
}

const internalEventsRoute = HttpRouter.add(
  'POST',
  '/api/internal/events',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = validateInternalEventsHeaders(request.headers as HeaderMap);
    if (!auth.ok) return jsonResponse({ error: auth.error }, { status: auth.status });

    const text = yield* request.text;
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      return jsonResponse({ error: 'invalid json' }, { status: 400 });
    }

    const events = parseInternalEventsBody(parsed);
    const eventStore = yield* EventStoreService;
    for (const event of events) {
      yield* eventStore.append(event);
    }
    return jsonResponse({ appended: events.length });
  })),
);

export const internalEventsRouteLayer = Layer.mergeAll(internalEventsRoute);

export default internalEventsRouteLayer;
