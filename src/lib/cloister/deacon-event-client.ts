import type { DomainEvent } from '@overdeck/contracts';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../internal-token.js';

export interface DeaconEventClientOptions {
  dashboardUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
  batchSize?: number;
  debounceMs?: number;
  maxBufferSize?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  /**
   * PAN-3092: deadline for the settled `appendOnce` round trip. Must stay well
   * below the Deacon patrol interval (60s), because the patrol awaits it inline.
   */
  appendOnceTimeoutMs?: number;
}

export interface DeaconEventClient {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  appendAsync(event: Omit<DomainEvent, 'sequence'>): Promise<number>;
  /**
   * PAN-3092: append at most once for `idempotencyKey`, awaiting the server's
   * settled transaction outcome rather than a local enqueue.
   */
  appendOnce(
    event: Omit<DomainEvent, 'sequence'>,
    idempotencyKey: string,
  ): Promise<'appended' | 'duplicate' | 'failed'>;
  subscribe(fn: (event: { sequence: number; type: string; timestamp: string; payload: unknown }) => void): () => void;
  flushNow(): Promise<void>;
  bufferedCount(): number;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_BUFFER_SIZE = 1000;
const DEFAULT_BASE_RETRY_MS = 1000;
const DEFAULT_MAX_RETRY_MS = 30_000;
// Comfortably generous for a loopback POST, and far below the 60s patrol
// interval so a hung dashboard cannot stall a patrol cycle.
const DEFAULT_APPEND_ONCE_TIMEOUT_MS = 10_000;

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

export function createDeaconEventClient(options: DeaconEventClientOptions = {}): DeaconEventClient {
  const dashboardUrl = options.dashboardUrl ?? internalDashboardOrigin();
  const fetchImpl = options.fetchImpl ?? fetch;
  const warn = options.warn ?? ((message) => console.warn(message));
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  const baseRetryMs = options.baseRetryMs ?? DEFAULT_BASE_RETRY_MS;
  const maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const appendOnceTimeoutMs = options.appendOnceTimeoutMs ?? DEFAULT_APPEND_ONCE_TIMEOUT_MS;

  const queue: Array<Omit<DomainEvent, 'sequence'>> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let retryMs = baseRetryMs;
  let dropped = 0;

  type StoredEventLike = { sequence: number; type: string; timestamp: string; payload: unknown };

  const schedule = (delayMs: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flushNow();
    }, delayMs);
  };

  const enqueue = (event: Omit<DomainEvent, 'sequence'>): void => {
    while (queue.length >= maxBufferSize) {
      queue.shift();
      dropped++;
    }
    if (dropped > 0) {
      warn(`[deacon-event-client] buffer overflow: dropped ${dropped} oldest event${dropped === 1 ? '' : 's'}`);
      dropped = 0;
    }
    queue.push(event);
    if (queue.length >= batchSize) schedule(0);
    else if (!timer) schedule(debounceMs);
  };

  async function flushNow(): Promise<void> {
    if (inFlight || queue.length === 0) return;
    inFlight = true;
    const batch = queue.slice(0, batchSize);
    try {
      const token = options.token ?? ensureInternalTokenSync();
      const response = await fetchImpl(new URL('/api/internal/events', dashboardUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: dashboardUrl,
          [INTERNAL_TOKEN_HEADER]: token,
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      queue.splice(0, batch.length);
      retryMs = baseRetryMs;
      if (queue.length > 0) schedule(queue.length >= batchSize ? 0 : debounceMs);
    } catch (error) {
      warn(`[deacon-event-client] failed to flush events: ${error instanceof Error ? error.message : String(error)}; retrying in ${retryMs}ms`);
      schedule(retryMs);
      retryMs = Math.min(retryMs * 2, maxRetryMs);
    } finally {
      inFlight = false;
    }
  }

  async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
    const token = options.token ?? ensureInternalTokenSync();
    const response = await fetchImpl(url, {
      signal,
      headers: {
        [INTERNAL_TOKEN_HEADER]: token,
        origin: dashboardUrl,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  async function fetchLatestSequence(signal?: AbortSignal): Promise<number> {
    const body = await fetchJson<{ latestSequence?: unknown }>(new URL('/api/internal/events/latest', dashboardUrl), signal);
    return typeof body.latestSequence === 'number' && Number.isFinite(body.latestSequence) && body.latestSequence >= 0
      ? body.latestSequence
      : 0;
  }

  function parseStreamFrame(frame: string): StoredEventLike | null {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      dataLines.push(line.slice(5).replace(/^\s/, ''));
    }
    if (dataLines.length === 0) return null;
    try {
      const parsed = JSON.parse(dataLines.join('\n')) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.sequence !== 'number' ||
        typeof record.type !== 'string' ||
        typeof record.timestamp !== 'string'
      ) {
        return null;
      }
      return {
        sequence: record.sequence,
        type: record.type,
        timestamp: record.timestamp,
        payload: record.payload,
      };
    } catch {
      return null;
    }
  }

  return {
    append(event) {
      enqueue(event);
      return 0;
    },
    appendAsync(event) {
      enqueue(event);
      return Promise.resolve(0);
    },
    async appendOnce(event, idempotencyKey) {
      // PAN-3092: deliberately NOT queued. `append`/`appendAsync` resolve on
      // local enqueue, before any HTTP request or SQLite commit, so a caller
      // there cannot know whether its event landed — and a queued event can
      // still fail delivery, be dropped on buffer overflow, or die with this
      // child process. An at-most-once operator warning needs the settled
      // server outcome, so this awaits the round trip and reports failure.
      //
      // The deadline is not optional. The Deacon patrol awaits this inline
      // while iterating issues, so an accepted-but-never-completed connection
      // would stall every later issue and every later patrol phase — and the
      // patrol heartbeat ticker keeps refreshing until its `finally`, so the
      // supervisor would see the wedged Deacon as healthy. Exactly the
      // overloaded/restarting dashboard this feature exists to report is the
      // state most likely to hang the request. One controller covers both the
      // response headers and the body read: aborting after headers also aborts
      // the body stream. Giving up after a successful commit is safe — retrying
      // the same idempotency key returns `duplicate`, never a second event.
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), appendOnceTimeoutMs);
      try {
        const token = options.token ?? ensureInternalTokenSync();
        const response = await fetchImpl(new URL('/api/internal/events/append-once', dashboardUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: dashboardUrl,
            [INTERNAL_TOKEN_HEADER]: token,
          },
          body: JSON.stringify({ event, idempotencyKey }),
          signal: controller.signal,
        });
        if (!response.ok) return 'failed';
        const body = await response.json() as { outcome?: unknown };
        return body.outcome === 'appended' || body.outcome === 'duplicate' ? body.outcome : 'failed';
      } catch {
        return 'failed';
      } finally {
        clearTimeout(deadline);
      }
    },
    subscribe(fn) {
      let active = true;
      let cursor = -1;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let connectInFlight = false;
      let reconnectMs = baseRetryMs;
      let abortController: AbortController | null = null;

      const clearPollTimer = (): void => {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
      };

      const schedulePoll = (delayMs: number): void => {
        if (!active) return;
        clearPollTimer();
        pollTimer = setTimeout(() => {
          pollTimer = null;
          void connect();
        }, delayMs);
      };

      const connect = async (): Promise<void> => {
        if (!active || connectInFlight) return;
        connectInFlight = true;
        abortController?.abort();
        abortController = new AbortController();
        try {
          if (cursor < 0) {
            cursor = await fetchLatestSequence(abortController.signal);
          }

          const url = new URL('/api/internal/events/stream', dashboardUrl);
          url.searchParams.set('since', String(cursor));
          const response = await fetchImpl(url, {
            signal: abortController.signal,
            headers: {
              [INTERNAL_TOKEN_HEADER]: options.token ?? ensureInternalTokenSync(),
              origin: dashboardUrl,
            },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          if (!response.body) throw new Error('missing response body');

          reconnectMs = baseRetryMs;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let frameEnd = buffer.indexOf('\n\n');
            while (frameEnd >= 0) {
              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + 2);
              const event = parseStreamFrame(frame);
              if (event) {
                fn(event);
                if (event.sequence > cursor) cursor = event.sequence;
              }
              frameEnd = buffer.indexOf('\n\n');
            }
          }

          if (!active) return;
          schedulePoll(debounceMs);
        } catch (error) {
          if (!active) return;
          warn(`[deacon-event-client] failed to subscribe to events: ${error instanceof Error ? error.message : String(error)}; retrying in ${reconnectMs}ms`);
          schedulePoll(reconnectMs);
          reconnectMs = Math.min(reconnectMs * 2, maxRetryMs);
        } finally {
          connectInFlight = false;
        }
      };

      void connect();

      return () => {
        active = false;
        clearPollTimer();
        abortController?.abort();
        abortController = null;
      };
    },
    flushNow,
    bufferedCount: () => queue.length,
  };
}
