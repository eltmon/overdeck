/**
 * External Event Stream route — public SSE feed for third-party integrations.
 *
 *   GET /events/stream  — SSE stream of DomainEvents with filtering + resume
 *   GET /events/version — capability discovery: { version, catalog }
 *
 * Contract: docs/EXTERNAL-EVENT-STREAM.md
 *
 * Design:
 *   - One-way SSE (server → client); consumers use the EventSource API.
 *   - Resumable via Last-Event-ID header or ?since= query param.
 *   - Filterable via ?types=, ?sources=, ?issueId= query params.
 *   - Local-only by default (the dashboard binds to 127.0.0.1).
 *   - Optional bearer token auth via PANOPTICON_EVENTS_TOKEN env var.
 *
 * Stability: only the event types in PUBLIC_CATALOG are part of the public
 * contract. All other events stream through but may change shape without notice.
 */

import { Effect, Layer, Option, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getEventStore, type StoredEvent } from '../event-store.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const PUBLIC_CATALOG = [
  'activity.entry',
  'activity.detailed',
  'activity.tts',
  'activity.updated',
  'agent.started',
  'agent.stopped',
  'agent.output_received',
  'workspace.created',
  'workspace.destroyed',
  'issue.status_changed',
  'dashboard.lifecycle_started',
  'dashboard.lifecycle_completed',
  'dashboard.lifecycle_failed',
] as const;

const EVENT_STREAM_VERSION = 1;
const KEEPALIVE_INTERVAL_MS = 15_000;
// Cap replay on a single connection. With 7-day retention the event table can
// easily hold hundreds of thousands of rows, and `store.readFrom(0)` materializes
// all of them into a JS array at once — which blew the heap on the first smoke
// test. Sidecars that reconnect after a short gap will never hit this cap;
// consumers that need bulk historical export should use a dedicated pagination
// API (future work), not live SSE replay.
const MAX_REPLAY_EVENTS = 1000;

interface StreamFilters {
  types: Set<string> | null;
  sources: Set<string> | null;
  issueId: string | null;
}

function parseCsv(value: string | null): Set<string> | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? new Set(parts) : null;
}

function matchesFilter(event: StoredEvent, filters: StreamFilters): boolean {
  if (filters.types && !filters.types.has(event.type)) return false;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (filters.sources) {
    const source = payload['source'];
    if (typeof source !== 'string' || !filters.sources.has(source)) return false;
  }
  if (filters.issueId) {
    if (payload['issueId'] !== filters.issueId) return false;
  }
  return true;
}

function formatFrame(event: StoredEvent): string {
  const data = JSON.stringify({
    type: event.type,
    sequence: event.sequence,
    timestamp: event.timestamp,
    payload: event.payload,
  });
  return `event: ${event.type}\nid: ${event.sequence}\ndata: ${data}\n\n`;
}

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function authorized(request: HttpServerRequest.HttpServerRequest): boolean {
  const expected = process.env['PANOPTICON_EVENTS_TOKEN'];
  if (!expected) return true;
  const header = getHeader(request, 'authorization');
  if (!header) return false;
  const [scheme, token] = header.split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token === expected;
}

// ─── Route: GET /events/stream ────────────────────────────────────────────────

const getEventStreamRoute = HttpRouter.add(
  'GET',
  '/events/stream',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (!authorized(request)) {
        return jsonResponse({ error: 'unauthorized' }, { status: 401 });
      }

      const urlOpt = HttpServerRequest.toURL(request);
      const sp = Option.isSome(urlOpt)
        ? urlOpt.value.searchParams
        : new URLSearchParams();

      const filters: StreamFilters = {
        types: parseCsv(sp.get('types')),
        sources: parseCsv(sp.get('sources')),
        issueId: sp.get('issueId'),
      };

      // Resume semantics: Last-Event-ID header wins over ?since= (standard SSE behavior).
      const lastEventIdHeader = getHeader(request, 'last-event-id');
      const fromLastEventId =
        lastEventIdHeader && lastEventIdHeader.length > 0
          ? parseInt(lastEventIdHeader, 10)
          : NaN;
      const sinceParam = sp.get('since');
      const since = Number.isFinite(fromLastEventId)
        ? fromLastEventId
        : sinceParam
          ? parseInt(sinceParam, 10)
          : NaN;

      const encoder = new TextEncoder();
      const store = getEventStore();

      // Closure-scoped cleanup shared between start() and cancel().
      let cleanup: (() => void) | null = null;

      const nodeStream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const safeEnqueue = (chunk: Uint8Array) => {
            if (closed) return;
            try {
              controller.enqueue(chunk);
            } catch {
              closed = true;
            }
          };

          // Replay missed events before subscribing live — preserves ordering.
          // We MUST cap BEFORE calling readFrom(): the store's readFrom() uses
          // `stmt.all()` which materializes every matching row into memory at
          // once. `since=0` against 7 days of history OOMs the dashboard.
          //
          // We use the latest sequence to compute a safe effective `since` that
          // bounds the result set to ~MAX_REPLAY_EVENTS rows. Sequences are
          // monotonic AUTOINCREMENT, so (latest - since) is an upper bound on
          // the number of rows that would be returned (compaction only makes it
          // smaller, which is still safe).
          if (Number.isFinite(since) && since >= 0) {
            try {
              const latestSeq = store.getLatestSequence();
              let effectiveSince = since;
              const span = latestSeq - since;
              if (span > MAX_REPLAY_EVENTS) {
                const skipped = span - MAX_REPLAY_EVENTS;
                effectiveSince = since + skipped;
                safeEnqueue(
                  encoder.encode(
                    `: replay truncated, skipped ${skipped} events (cap ${MAX_REPLAY_EVENTS})\n\n`,
                  ),
                );
              }
              const missed = store.readFrom(effectiveSince);
              for (const event of missed) {
                if (matchesFilter(event, filters)) {
                  safeEnqueue(encoder.encode(formatFrame(event)));
                }
              }
            } catch (err) {
              console.error('[events/stream] replay failed:', err);
            }
          }

          // Initial keepalive so clients see the stream as open even with no events.
          safeEnqueue(encoder.encode(`: connected\n\n`));

          const unsubscribe = store.subscribe((event) => {
            if (!matchesFilter(event, filters)) return;
            safeEnqueue(encoder.encode(formatFrame(event)));
          });

          const keepalive = setInterval(() => {
            safeEnqueue(encoder.encode(`: keepalive\n\n`));
          }, KEEPALIVE_INTERVAL_MS);

          cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(keepalive);
            unsubscribe();
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
          // Defeat reverse-proxy response buffering (nginx, Cloudflare, etc.)
          'X-Accel-Buffering': 'no',
        },
      });
    }),
  ),
);

// ─── Route: GET /events/version ───────────────────────────────────────────────

const getEventVersionRoute = HttpRouter.add(
  'GET',
  '/events/version',
  jsonResponse({
    version: EVENT_STREAM_VERSION,
    catalog: PUBLIC_CATALOG,
  }),
);

// ─── Layer ────────────────────────────────────────────────────────────────────

export const eventsRouteLayer = Layer.mergeAll(
  getEventStreamRoute,
  getEventVersionRoute,
);

export default eventsRouteLayer;
