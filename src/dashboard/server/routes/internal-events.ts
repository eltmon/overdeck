import { timingSafeEqual } from 'node:crypto';
import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import type { DomainEvent } from '@overdeck/contracts';

import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { formatFrame } from './events.js';
import { getEventStore, type StoredEvent } from '../event-store.js';
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

export function parseInternalEventsSince(raw: string | null): number | null {
  if (raw === null || raw.trim().length === 0) return null;
  const since = Number.parseInt(raw, 10);
  return Number.isFinite(since) && since >= 0 ? since : null;
}

const MAX_REPLAY_EVENTS = 1000;

export function computeInternalReplaySince(since: number, latestSequence: number): { since: number; skipped: number } {
  const span = latestSequence - since;
  if (span > MAX_REPLAY_EVENTS) {
    const skipped = span - MAX_REPLAY_EVENTS;
    return { since: since + skipped, skipped };
  }
  return { since, skipped: 0 };
}

export function mergeInternalEventReplay(
  replayed: StoredEvent[],
  buffered: StoredEvent[],
  since: number,
): StoredEvent[] {
  const merged: StoredEvent[] = [];
  let maxSequence = since;

  for (const event of replayed) {
    merged.push(event);
    if (event.sequence > maxSequence) maxSequence = event.sequence;
  }

  const live = [...buffered].sort((a, b) => a.sequence - b.sequence);
  for (const event of live) {
    if (event.sequence <= maxSequence) continue;
    merged.push(event);
    maxSequence = event.sequence;
  }

  return merged;
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

/**
 * PAN-3092: at-most-once append for the Deacon child.
 *
 * The batching `/api/internal/events` path resolves before any HTTP request or
 * SQLite commit, so a caller there cannot know whether its event landed. This
 * route commits (or detects the duplicate) inside one transaction and answers
 * with the settled outcome, which is what an at-most-once operator warning
 * needs — the child awaits this rather than treating a local enqueue as
 * durability.
 */
const internalEventsAppendOnceRoute = HttpRouter.add(
  'POST',
  '/api/internal/events/append-once',
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

    const body = parsed as { event?: unknown; idempotencyKey?: unknown };
    const events = parseInternalEventsBody({ events: [body.event] });
    const event = events[0];
    if (!event || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
      return jsonResponse({ error: 'event and idempotencyKey are required' }, { status: 400 });
    }

    try {
      const result = getEventStore().appendOnce(event, body.idempotencyKey);
      return jsonResponse(result);
    } catch (err) {
      // The transaction did not commit — say so, so the caller retries instead
      // of recording a warning it never delivered.
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'append failed' },
        { status: 500 },
      );
    }
  })),
);

const internalEventsLatestRoute = HttpRouter.add(
  'GET',
  '/api/internal/events/latest',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = validateInternalEventsHeaders(request.headers as HeaderMap);
    if (!auth.ok) return jsonResponse({ error: auth.error }, { status: auth.status });

    const latestSequence = getEventStore().getLatestSequence();
    return jsonResponse({ latestSequence });
  })),
);

const internalEventsStreamRoute = HttpRouter.add(
  'GET',
  '/api/internal/events/stream',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = validateInternalEventsHeaders(request.headers as HeaderMap);
    if (!auth.ok) return jsonResponse({ error: auth.error }, { status: auth.status });

    const urlOpt = HttpServerRequest.toURL(request);
    const url = Option.isSome(urlOpt) ? urlOpt.value : new URL(request.url, 'http://localhost');
    const since = parseInternalEventsSince(url.searchParams.get('since')) ?? 0;
    const eventStore = getEventStore();

    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const nodeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let replaying = true;
        const buffered: StoredEvent[] = [];
        const safeEnqueue = (chunk: Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        };

        const unsubscribeFn = eventStore.subscribe((event) => {
          if (replaying) {
            buffered.push(event);
            return;
          }
          safeEnqueue(encoder.encode(formatFrame(event)));
        });

        const latestSequence = eventStore.getLatestSequence();
        const replayWindow = computeInternalReplaySince(since, latestSequence);
        const missed = eventStore.readFrom(replayWindow.since);

        const merged = mergeInternalEventReplay(missed, buffered, replayWindow.since);
        replaying = false;
        buffered.length = 0;

        safeEnqueue(encoder.encode(`: connected\n\n`));
        if (replayWindow.skipped > 0) {
          safeEnqueue(
            encoder.encode(`: replay truncated, skipped ${replayWindow.skipped} events (cap ${MAX_REPLAY_EVENTS})\n\n`),
          );
        }
        for (const event of merged) {
          safeEnqueue(encoder.encode(formatFrame(event)));
        }

        cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribeFn();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
      },
      cancel() {
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
      },
    });

    const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
      evaluate: () => nodeStream,
      onError: (err) => err,
    });

    return HttpServerResponse.stream(effectStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  })),
);

export const internalEventsRouteLayer = Layer.mergeAll(internalEventsRoute, internalEventsAppendOnceRoute, internalEventsLatestRoute, internalEventsStreamRoute);

export default internalEventsRouteLayer;
