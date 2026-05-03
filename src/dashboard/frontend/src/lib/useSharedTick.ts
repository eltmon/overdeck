import { useState, useEffect } from 'react';

/**
 * Single module-level ticker shared across all subscribers.
 * No matter how many components call useSharedTick(), only ONE setInterval
 * runs — all components update in the same event-loop tick so React can batch
 * the resulting setState calls into a single render pass.
 */
const listeners = new Set<() => void>();
let timerId: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void, intervalMs: number): () => void {
  listeners.add(fn);
  if (!timerId) {
    timerId = setInterval(() => {
      listeners.forEach((l) => l());
    }, intervalMs);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };
}

/**
 * Returns a `now` Date that refreshes every `intervalMs` milliseconds (default 5 s).
 * All callers share a single interval — zero per-component timer overhead.
 */
export function useSharedTick(intervalMs = 5000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => subscribe(() => setNow(new Date()), intervalMs), [intervalMs]);
  return now;
}
