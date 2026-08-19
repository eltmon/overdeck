/**
 * PAN-2500: the cached MemoryVerdict, split out from memory-governor.ts into
 * its own zero-dependency module. concurrency.ts (canDispatchAdvancing /
 * tryReserveAdvancingSlot) needs to read this synchronously without importing
 * memory-governor.ts directly — memory-governor.ts pulls in
 * dashboard/server/routes/resources/stacks.ts, which transitively reaches
 * concurrency.ts itself (stacks.ts -> review-status.ts -> agents.ts ->
 * agents/spawn.ts -> concurrency.ts), so a direct concurrency.ts ->
 * memory-governor.ts import closes a real cycle (caught by
 * scripts/lint-circular-deps.sh). This module has no imports of its own, so
 * it cannot be part of any cycle.
 */

export type MemoryPressureBand = 'ok' | 'soft' | 'hard';

export interface MemoryPressureThresholds {
  warningBytes: number;
  criticalBytes: number;
}

export type GovernorTriggerKind = 'soft-dip' | 'hard' | 'swap-psi' | 'psi-unavailable';

export interface GovernorTrigger {
  kind: GovernorTriggerKind;
  readingBytes: number;
  thresholdBytes: number;
  at: number;
}

export interface MemoryVerdict {
  band: MemoryPressureBand;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
  swapTotalBytes?: number;
  swapFreeBytes?: number;
  psiSomeAvg10?: number | null;
  psiFullAvg10?: number | null;
  trigger?: GovernorTrigger | null;
}

let cachedVerdict: MemoryVerdict | null = null;

/**
 * The verdict from the most recent assessMemoryPressure() call, or null before
 * any patrol has run one. Synchronous — no I/O.
 */
export function getCachedMemoryVerdict(): MemoryVerdict | null {
  return cachedVerdict;
}

export function setCachedMemoryVerdict(verdict: MemoryVerdict | null): void {
  cachedVerdict = verdict;
}

/** Test-only. */
export function setCachedMemoryVerdictForTests(verdict: MemoryVerdict | null): void {
  cachedVerdict = verdict;
}
