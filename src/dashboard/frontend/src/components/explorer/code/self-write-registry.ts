// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/editor/external-changes/editor-self-write-registry.ts @ 73771e67d01
/**
 * Self-write registry (PAN-5187, FR-8).
 *
 * When a code pane saves, the watcher reports the write back as a change.
 * The pane records each write's (file key, signature) here, and the
 * external-change controller ignores an event whose disk signature matches
 * a stamp younger than 750 ms, so the pane's own saves never raise the
 * conflict banner.
 *
 * Kept from Orca: the 750 ms TTL, one stamp per file (the newest), and the
 * 256-stamp cap that drops the oldest. Dropped: runtime-environment ids,
 * path normalization (keys are already root id + relative path), the
 * remote TTL and the cleanup timer (stamps are pruned on every record, and
 * the cap bounds the map).
 */

export const SELF_WRITE_TTL_MS = 750;
export const SELF_WRITE_MAX_STAMPS = 256;

interface SelfWriteStamp {
  signature: string;
  expiresAt: number;
}

const stamps = new Map<string, SelfWriteStamp>();

function pruneExpired(now: number): void {
  for (const [key, stamp] of stamps) {
    if (now > stamp.expiresAt) stamps.delete(key);
  }
}

export function recordSelfWrite(key: string, signature: string, now: number = Date.now()): void {
  pruneExpired(now);
  // Re-insert so the Map's order stays oldest first.
  stamps.delete(key);
  stamps.set(key, { signature, expiresAt: now + SELF_WRITE_TTL_MS });
  while (stamps.size > SELF_WRITE_MAX_STAMPS) {
    const oldest = stamps.keys().next().value;
    if (oldest === undefined) break;
    stamps.delete(oldest);
  }
}

/** True when `key` was written by this dashboard with `signature` in the last 750 ms. */
export function isRecentSelfWrite(key: string, signature: string, now: number = Date.now()): boolean {
  const stamp = stamps.get(key);
  if (!stamp) return false;
  if (now > stamp.expiresAt) {
    stamps.delete(key);
    return false;
  }
  return stamp.signature === signature;
}

export function selfWriteStampCount(): number {
  return stamps.size;
}

export function clearSelfWrites(): void {
  stamps.clear();
}
