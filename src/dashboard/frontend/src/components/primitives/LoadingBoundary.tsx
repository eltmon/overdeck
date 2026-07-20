/**
 * PAN-2908 · C-FRESH — the loading boundary.
 *
 * Every region declares its data boundary: data, a skeleton that resolves,
 * or an explicit unavailable state. A spinner older than the timeout is a
 * bug with a name, not furniture. Wrap bare "Loading…" regions:
 *
 *   <LoadingBoundary label="activity feed" onRetry={() => refetch()}>
 *     <Spinner />
 *   </LoadingBoundary>
 *
 * After `timeoutMs`, children are replaced by an explicit unavailable state
 * with a retry action — never an eternal spinner.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const DEFAULT_TIMEOUT_MS = 8_000;

export function useLoadingTimeout(timeoutMs: number, resetKey?: unknown): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const id = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(id);
  }, [timeoutMs, resetKey]);
  return timedOut;
}

export function LoadingBoundary({
  children,
  label,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onRetry,
  resetKey,
}: {
  children: ReactNode;
  /** What is being loaded — shown in the unavailable state ("… is taking longer than usual"). */
  label: string;
  timeoutMs?: number;
  onRetry?: () => void;
  /** Change to restart the timeout (e.g. pass a retry counter or query key). */
  resetKey?: unknown;
}) {
  const [retries, setRetries] = useState(0);
  const timedOut = useLoadingTimeout(timeoutMs, resetKey ?? retries);

  if (!timedOut) return <>{children}</>;

  return (
    <div
      data-component="loading-boundary-unavailable"
      className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
    >
      <span className="flex-1">{label} is taking longer than usual — it may be unavailable right now.</span>
      <button
        type="button"
        onClick={() => {
          setRetries((n) => n + 1);
          onRetry?.();
        }}
        className="inline-flex items-center gap-1 rounded-sm border border-input px-2 py-0.5 font-medium text-foreground hover:bg-accent"
        data-testid="loading-boundary-retry"
      >
        <RefreshCw className="h-3 w-3" /> Retry
      </button>
    </div>
  );
}
