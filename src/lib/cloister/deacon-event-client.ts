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
}

export interface DeaconEventClient {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  appendAsync(event: Omit<DomainEvent, 'sequence'>): Promise<number>;
  flushNow(): Promise<void>;
  bufferedCount(): number;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_BUFFER_SIZE = 1000;
const DEFAULT_BASE_RETRY_MS = 1000;
const DEFAULT_MAX_RETRY_MS = 30_000;

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

  const queue: Array<Omit<DomainEvent, 'sequence'>> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let retryMs = baseRetryMs;
  let dropped = 0;

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

  return {
    append(event) {
      enqueue(event);
      return 0;
    },
    appendAsync(event) {
      enqueue(event);
      return Promise.resolve(0);
    },
    flushNow,
    bufferedCount: () => queue.length,
  };
}
