import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http';
import { Duration, Effect, Schedule } from 'effect';

export function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === 'EADDRINUSE') return true;
  return 'cause' in error && isAddressInUseError(error.cause);
}

const BIND_RETRY_DELAY_MS = 250;
const BIND_RETRY_COUNT = 3;

export function retryDashboardBind<A, E, R>(
  bind: Effect.Effect<A, E, R>,
  onRetry?: (attempt: number, delayMs: number) => void,
): Effect.Effect<A, E, R> {
  let failures = 0;
  const observedBind = Effect.tapError(bind, (error) => Effect.sync(() => {
    failures += 1;
    if (failures <= BIND_RETRY_COUNT && isAddressInUseError(error)) {
      onRetry?.(failures, BIND_RETRY_DELAY_MS);
    }
  }));
  return Effect.retry(observedBind, {
    times: BIND_RETRY_COUNT,
    schedule: Schedule.spaced(Duration.millis(BIND_RETRY_DELAY_MS)),
    while: isAddressInUseError,
  });
}

const HOLD_REQUESTS_TIMEOUT_MS = 120_000;

/**
 * Effect's NodeHttpServer listens as soon as its layer is built, but attaches
 * its `request` handler only when HttpRouter.serve runs, after
 * DomainServicesLive has finished building. A request that lands in that gap
 * reaches a server with no `request` listener and is never answered, which
 * pins one of the browser's six per-host connections until the tab closes;
 * six such requests and every reload hangs. Hold those requests and replay
 * them to the first real handler; after the timeout, answer 503 to held and
 * new requests until one attaches.
 * Returns the number of requests currently held.
 */
export function holdRequestsUntilServed(
  server: Server,
  timeoutMs: number = HOLD_REQUESTS_TIMEOUT_MS,
): () => number {
  const held: Array<[IncomingMessage, ServerResponse]> = [];
  let released = false;
  let expired = false;
  const respondStarting = (res: ServerResponse) => {
    if (res.headersSent) return;
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
    res.end('Overdeck dashboard is still starting');
  };
  const hold: RequestListener = (req, res) => {
    if (expired) respondStarting(res);
    else held.push([req, res]);
  };
  const release = (handler: RequestListener) => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    server.off('request', hold);
    server.off('newListener', onNewListener);
    for (const [req, res] of held.splice(0)) handler(req, res);
  };
  const onNewListener = (event: string | symbol, listener: unknown) => {
    if (event !== 'request' || listener === hold) return;
    // newListener fires before the listener is added; replay once it is.
    queueMicrotask(() => release(listener as RequestListener));
  };
  const timer = setTimeout(() => {
    // Keep `hold` installed: until a real handler attaches, every request gets 503.
    expired = true;
    for (const [, res] of held.splice(0)) respondStarting(res);
  }, timeoutMs);
  timer.unref();
  server.on('request', hold);
  server.on('newListener', onNewListener);
  return () => held.length;
}
