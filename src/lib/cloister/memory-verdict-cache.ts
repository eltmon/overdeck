/**
 * PAN-2500: the cached MemoryVerdict, split out from memory-governor.ts into
 * its own zero-dependency module so concurrency.ts could read it synchronously
 * (its readers there were removed in PAN-3958 CH-8) without importing
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

export type GovernorTriggerKind = 'soft-dip' | 'hard' | 'swap-psi' | 'psi-unavailable' | 'mac-pressure-critical' | 'cpu';

export interface GovernorTrigger {
  kind: GovernorTriggerKind;
  /** 0 for a `cpu` trigger (PAN-4311 D5). */
  readingBytes: number;
  thresholdBytes: number;
  at: number;
  /** PAN-4311: set on a `cpu` trigger — which CPU signal crossed which threshold. */
  cpuSignal?: 'psi-some-avg60' | 'load-per-core';
  cpuReading?: number;
  cpuThreshold?: number;
}

export interface MemoryVerdict {
  band: MemoryPressureBand;
  availableBytes: number;
  thresholds: MemoryPressureThresholds;
  swapTotalBytes?: number;
  swapFreeBytes?: number;
  psiSomeAvg10?: number | null;
  psiFullAvg10?: number | null;
  loadPerCore?: number | null;
  /** PAN-4311: CPU PSI `some` averages, percent; null when unavailable. */
  psiCpuSomeAvg10?: number | null;
  psiCpuSomeAvg60?: number | null;
  trigger?: GovernorTrigger | null;
  /** PAN-4267: macOS's own kernel pressure level, null on Linux. */
  macPressureLevel?: 'normal' | 'warn' | 'critical' | null;
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
