/**
 * PAN-2908 · C-FRESH — the loading boundary, remount-proof.
 *
 * Every region declares its data boundary: data, a skeleton that resolves,
 * or an explicit unavailable state. The expiry lives in a store keyed by
 * label, so a WS tick that remounts the region cannot restart the clock —
 * a spinner older than the timeout is a bug with a name, not furniture.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { create } from 'zustand';

const DEFAULT_TIMEOUT_MS = 8_000;

interface BoundaryTimers {
  expiryByLabel: Record<string, number>;
  arm: (label: string, timeoutMs: number) => void;
  retry: (label: string, timeoutMs: number) => void;
}

const useBoundaryTimers = create<BoundaryTimers>((set, get) => ({
  expiryByLabel: {},
  arm: (label, timeoutMs) => {
    if (get().expiryByLabel[label]) return;
    set((state) => ({ expiryByLabel: { ...state.expiryByLabel, [label]: Date.now() + timeoutMs } }));
  },
  retry: (label, timeoutMs) => {
    set((state) => ({ expiryByLabel: { ...state.expiryByLabel, [label]: Date.now() + timeoutMs } }));
  },
}));

/** Test hook: reset all timers. */
export function resetBoundaryTimers() {
  useBoundaryTimers.setState({ expiryByLabel: {} });
}

export function LoadingBoundary({
  children,
  label,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onRetry,
}: {
  children: ReactNode;
  /** What is being loaded — shown in the unavailable state ("… is taking longer than usual"). */
  label: string;
  timeoutMs?: number;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const arm = useBoundaryTimers((s) => s.arm);
  const retry = useBoundaryTimers((s) => s.retry);
  const expiry = useBoundaryTimers((s) => s.expiryByLabel[label]);

  useEffect(() => {
    arm(label, timeoutMs);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [label, timeoutMs, arm]);

  if (!expiry || now < expiry) return <>{children}</>;

  return (
    <div
      data-component="loading-boundary-unavailable"
      className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
    >
      <span className="flex-1">{label} is taking longer than usual — it may be unavailable right now.</span>
      <button
        type="button"
        onClick={() => {
          retry(label, timeoutMs);
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
