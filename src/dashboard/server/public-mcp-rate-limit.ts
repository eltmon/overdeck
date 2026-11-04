/**
 * PAN-4947 FR-4, D-7, NFR-4: a fixed-window rate limiter for the public MCP
 * surface. A key's window starts at its first request and lasts `windowMs`; a
 * refused hit does not count. At most `maxKeys` keys are tracked: a new key
 * evicts the oldest-inserted one. The clock is injected so tests never sleep.
 */
export const PUBLIC_MCP_WINDOW_MS = 60_000;
export const PUBLIC_MCP_MAX_KEYS = 10_000;

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface FixedWindowLimiter {
  hit(key: string, limit: number): RateDecision;
  size(): number;
}

export function createFixedWindowLimiter(
  opts: { now?: () => number; windowMs?: number; maxKeys?: number } = {},
): FixedWindowLimiter {
  const now = opts.now ?? Date.now;
  const windowMs = opts.windowMs ?? PUBLIC_MCP_WINDOW_MS;
  const maxKeys = opts.maxKeys ?? PUBLIC_MCP_MAX_KEYS;
  const windows = new Map<string, { windowStart: number; count: number }>();

  return {
    hit(key, limit) {
      const at = now();
      const entry = windows.get(key);
      if (!entry || at - entry.windowStart >= windowMs) {
        // Delete first so a restarted window moves to the end of the insertion order.
        windows.delete(key);
        while (windows.size >= maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
        windows.set(key, { windowStart: at, count: 1 });
        return { allowed: true };
      }
      if (entry.count < limit) {
        entry.count += 1;
        return { allowed: true };
      }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - at) / 1000)) };
    },
    size: () => windows.size,
  };
}
