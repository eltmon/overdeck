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
