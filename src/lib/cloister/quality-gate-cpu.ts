/**
 * PAN-5520: CPU settings for quality-gate admission, read from the global
 * config only (D5), so every workspace sharing the machine-wide admission root
 * applies the same rule. PAN-5588: also holds the queue's CPU marker.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isErrnoException, publishExclusive, readJson, unlinkIfExists } from './quality-gate-admission-files.js'

/** PAN-4311 D10: start new gates only while CPU PSI `some avg10` is below this percentage; PSI counts from 50 % utilization (PAN-5589). */
export const DEFAULT_QUALITY_GATE_PSI_START_AVG10 = 25
/**
 * How long the admission queue may stay CPU-blocked before its head starts
 * alone once the slots are empty (PAN-5588: counted per queue episode, not
 * per head).
 */
export const DEFAULT_QUALITY_GATE_CPU_BYPASS_MS = 10 * 60 * 1_000

export const QUALITY_GATE_CPU_START_THRESHOLD = 0.75
// PAN-4311 D10: with CPU PSI available, start heavy runs only once `some avg10` is below the
// configured start threshold. Load per core counts IO wait, so it is the fallback only without PSI.
export const QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD = 1
/**
 * PAN-5589: PSI and load are system-wide, so tasks pinned to a few cores (taskset, a cgroup quota)
 * raise them while other cores sit idle. They count as contention only at or above this utilization.
 */
export const QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR = 0.5

export interface QualityGateCpuSettings {
  /** `resources.quality_gate_psi_start_avg10`. */
  psiStartAvg10: number
  /** `resources.quality_gate_cpu_bypass_minutes`, in milliseconds. */
  bypassMs: number
}

export interface QualityGateCpuReading {
  cpuUtilization: number
  loadPerCore: number
  /** CPU PSI `some avg10`, percent; null when unavailable (PAN-4311). */
  psiSomeAvg10: number | null
}

/** Pressured at 75 % utilization, or from 50 % when PSI some avg10 (load per core without PSI) shows contention (PAN-4311 D10, PAN-5589). */
export function isQualityGateCpuPressured(reading: QualityGateCpuReading, psiStartAvg10: number): boolean {
  if (reading.cpuUtilization >= QUALITY_GATE_CPU_START_THRESHOLD) return true
  if (reading.cpuUtilization < QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR) return false
  return reading.psiSomeAvg10 != null
    ? reading.psiSomeAvg10 >= psiStartAvg10
    : reading.loadPerCore >= QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD
}

/** Never throws: a config read failure falls back to the defaults. */
export async function resolveQualityGateCpuSettings(): Promise<QualityGateCpuSettings> {
  const defaults = { psiStartAvg10: DEFAULT_QUALITY_GATE_PSI_START_AVG10, bypassMs: DEFAULT_QUALITY_GATE_CPU_BYPASS_MS }
  try {
    const { loadGlobalConfigNoMigration } = await import('../config-yaml/load.js')
    const { qualityGatePsiStartAvg10: psi, qualityGateCpuBypassMinutes: minutes } = (await loadGlobalConfigNoMigration()).config.resources
    return {
      psiStartAvg10: typeof psi === 'number' && Number.isFinite(psi) && psi > 0 ? psi : defaults.psiStartAvg10,
      bypassMs: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : defaults.bypassMs,
    }
  } catch {
    return defaults
  }
}

/** PAN-5588: the queue's CPU-pressure episode, `{"since": <epoch ms>}`, in the admission root. */
export const QUEUE_CPU_MARKER_FILE = 'cpu-blocked-since.json'

function validSince(value: unknown): number | null {
  const since = (value as { since?: unknown } | null)?.since
  return typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : null
}

/** When the queue's CPU block began, or null when there is none or the marker is unreadable (FR-8). Never throws. */
export async function readQueueCpuBlockedSince(root: string): Promise<number | null> {
  try {
    return validSince(await readJson(join(root, QUEUE_CPU_MARKER_FILE)))
  } catch {
    return null
  }
}

/**
 * Start the queue's CPU block at `since` unless a valid one is recorded (FR-2).
 * Published create-exclusive, so of two heads racing, the first marker stays.
 * An invalid marker is replaced (FR-8). Never throws (NFR-1).
 */
export async function markQueueCpuBlocked(root: string, since: number): Promise<void> {
  const path = join(root, QUEUE_CPU_MARKER_FILE)
  try {
    let raw: string | null = null
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') return
    }
    if (raw !== null) {
      let parsed: unknown = null
      try { parsed = JSON.parse(raw) } catch { /* invalid: replace it */ }
      if (validSince(parsed) != null) return
      await unlinkIfExists(path)
    }
    await publishExclusive(path, { since })
  } catch {
    // EEXIST (another head won) or any fs error: best effort.
  }
}

/** End the queue's CPU block (FR-4). Never throws. */
export async function clearQueueCpuBlock(root: string): Promise<void> {
  try {
    await unlinkIfExists(join(root, QUEUE_CPU_MARKER_FILE))
  } catch {
    // Best effort.
  }
}
