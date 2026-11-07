import {
  bucketRequestStatus,
  clientRouteOf,
  type ClientRequestFailedProperties,
  type TelemetryClient,
  type TelemetryHttpMethod,
  type TelemetryRequestStatus,
} from '@overdeck/contracts';
import { capture } from './telemetry';

/** PAN-5100 D-9: at most one `client_request_failed` per (route, route_area, status) per page load. */
export const REQUEST_FAILURE_THROTTLE_MS = 60_000;

export interface RequestFailureObserverOptions {
  client: TelemetryClient;
  /** Defaults to `globalThis`. */
  target?: { fetch: typeof fetch; location?: { host: string } };
  /** Defaults to `capture('client_request_failed', properties)`. */
  report?: (properties: ClientRequestFailedProperties) => void;
  /** Defaults to `Date.now`. */
  now?: () => number;
}

const uninstallers = new WeakMap<object, () => void>();

const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function bucketMethod(method: string): TelemetryHttpMethod {
  const upper = method.toUpperCase();
  return (HTTP_METHODS.has(upper) ? upper : 'other') as TelemetryHttpMethod;
}

/** Copied from apps/mobile/src/shell/requestLog.ts: relative and same-host URLs only. */
function pathOf(url: string, host: string | undefined): string | null {
  try {
    const parsed = new URL(url, 'http://overdeck.invalid');
    return parsed.host === 'overdeck.invalid' || parsed.host === host ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/** PAN-5100 D-8: classifies a rejected same-origin fetch. */
export function classifyFetchRejection(error: unknown): 'network' | 'timeout' | 'aborted' {
  if (error instanceof DOMException) {
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.name === 'AbortError') return 'aborted';
  }
  return 'network';
}

/**
 * PAN-5100 WI-5: wraps `target.fetch` once so every failed same-origin
 * `/api/` or `/events/` request reports `client_request_failed` (D-9
 * throttled). Returns the uninstaller; a second call while installed on the
 * same target is a no-op returning the same uninstaller. The wrapper never
 * changes the resolved response or the rejected error.
 */
export function installRequestFailureObserver(options: RequestFailureObserverOptions): () => void {
  const target = options.target ?? (globalThis as unknown as { fetch: typeof fetch; location?: { host: string } });
  const existing = uninstallers.get(target);
  if (existing) return existing;

  const innerFetch = target.fetch;
  const host = target.location?.host;
  const now = options.now ?? Date.now;
  const report = options.report ?? ((properties: ClientRequestFailedProperties) => capture('client_request_failed', properties));
  const lastSentAt = new Map<string, number>();

  function maybeReport(route: { route: string; route_area: string }, method: string, status: TelemetryRequestStatus): void {
    const key = `${route.route} ${route.route_area} ${status}`;
    const timestamp = now();
    const last = lastSentAt.get(key);
    if (last !== undefined && timestamp - last < REQUEST_FAILURE_THROTTLE_MS) return;
    lastSentAt.set(key, timestamp);
    try {
      report({
        client: options.client,
        route: route.route,
        route_area: route.route_area,
        method: bucketMethod(method),
        status,
      } as ClientRequestFailedProperties);
    } catch {
      // Telemetry must never break the request path.
    }
  }

  target.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const path = pathOf(url, host);

    if (path === null || !(path.startsWith('/api/') || path.startsWith('/events/'))) {
      return innerFetch(...args);
    }

    try {
      const response = await innerFetch(...args);
      if (response.status >= 400) {
        maybeReport(clientRouteOf(path), method, bucketRequestStatus(response.status));
      }
      return response;
    } catch (error) {
      maybeReport(clientRouteOf(path), method, classifyFetchRejection(error));
      throw error;
    }
  }) as typeof fetch;

  const uninstall = (): void => {
    target.fetch = innerFetch;
    uninstallers.delete(target);
  };
  uninstallers.set(target, uninstall);
  return uninstall;
}
