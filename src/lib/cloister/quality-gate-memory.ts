import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'

import { computeGovernorReserveDefaultsGb } from '../config-yaml/governor-reserves.js'

/**
 * Memory arithmetic for quality-gate admission (PAN-5248).
 *
 * A gate's footprint estimate is the largest of its last recorded peak RSS
 * values (D5), stored one file per footprint key under
 * `<admissionRoot>/footprints/` (D8). The head waiter may start only while
 * MemAvailable minus the live owners' reservations and its own footprint
 * stays at or above the governor's soft reserve (FR-2, NFR-3). An owner's
 * reservation is the part of its footprint it has not allocated yet (D4).
 *
 * Kept free of memory-governor.ts and runaway-process-patrol.ts (NFR-6):
 * the tsc wrapper and the Vitest globalSetup load it.
 */

const GiB = 1024 ** 3

export const DEFAULT_GATE_FOOTPRINT_BYTES = 2.5 * GiB
export const GATE_FOOTPRINT_HISTORY = 5

interface FootprintPeak {
  bytes: number
  at: number
}

interface FootprintFile {
  key: string
  peaks: FootprintPeak[]
}

let tempSequence = 0

export function footprintStoreDir(admissionRoot: string): string {
  return join(admissionRoot, 'footprints')
}

function footprintFileName(key: string): string {
  return `${createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`
}

function isValidPeak(peak: unknown): peak is FootprintPeak {
  const candidate = peak as Partial<FootprintPeak> | null
  return typeof candidate?.bytes === 'number' && Number.isFinite(candidate.bytes) && candidate.bytes > 0
}

/** Stored peaks for `key`, oldest first; an absent, torn or foreign file reads as none. */
async function readPeaks(key: string, admissionRoot: string): Promise<FootprintPeak[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(footprintStoreDir(admissionRoot), footprintFileName(key)), 'utf8'),
    ) as Partial<FootprintFile>
    if (parsed.key !== key || !Array.isArray(parsed.peaks)) return []
    return parsed.peaks.filter(isValidPeak)
  } catch {
    return []
  }
}

/** Largest of the last recorded peaks for `key`, or the default when none exist. */
export async function readGateFootprintEstimate(key: string, admissionRoot: string): Promise<number> {
  const peaks = await readPeaks(key, admissionRoot)
  if (peaks.length === 0) return DEFAULT_GATE_FOOTPRINT_BYTES
  return Math.max(...peaks.map((peak) => peak.bytes))
}

/**
 * Append one peak for `key`, keeping the newest {@link GATE_FOOTPRINT_HISTORY}.
 * Written to a temp file in the same directory, then renamed over the target;
 * two writers racing on one key may lose one peak (accepted, D8).
 */
export async function recordGateFootprintPeak(
  key: string,
  peakBytes: number,
  admissionRoot: string,
  now: () => number = Date.now,
): Promise<void> {
  if (!Number.isFinite(peakBytes) || peakBytes <= 0) return
  const dir = footprintStoreDir(admissionRoot)
  await mkdir(dir, { recursive: true })
  const peaks = [...(await readPeaks(key, admissionRoot)), { bytes: peakBytes, at: now() }]
    .slice(-GATE_FOOTPRINT_HISTORY)
  const name = footprintFileName(key)
  const tempPath = join(dir, `.tmp-${process.pid}-${tempSequence++}-${name}`)
  const body: FootprintFile = { key, peaks }
  try {
    await writeFile(tempPath, JSON.stringify(body))
    await rename(tempPath, join(dir, name))
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

/** `resources.governor_soft_reserve_gb` in bytes (global config only, D9), or the RAM-share default. */
export async function resolveSoftReserveBytes(): Promise<number> {
  try {
    const { loadGlobalConfigNoMigration } = await import('../config-yaml/load.js')
    const gb = (await loadGlobalConfigNoMigration()).config.resources.governorSoftReserveGb
    if (typeof gb === 'number' && Number.isFinite(gb) && gb >= 0) return gb * GiB
  } catch {
    // Fall through to the RAM-share default.
  }
  return computeGovernorReserveDefaultsGb(totalmem() / GiB).soft * GiB
}

export interface MemoryHeadroomInput {
  memAvailableBytes: number
  memTotalBytes: number
  softReserveBytes: number
  estimateBytes: number
  reservationsBytes: number
}

export interface MemoryHeadroomVerdict {
  ok: boolean
  /** The estimate clamped to what the host could ever offer (NFR-3). */
  footprintBytes: number
  /** MemAvailable left after reservations and this gate's footprint. */
  headroomBytes: number
}

/** FR-2: may a gate of `estimateBytes` start without pushing MemAvailable below the soft reserve? */
export function evaluateMemoryHeadroom(input: MemoryHeadroomInput): MemoryHeadroomVerdict {
  const footprintBytes = Math.min(input.estimateBytes, Math.max(0, input.memTotalBytes - input.softReserveBytes))
  const headroomBytes = input.memAvailableBytes - input.reservationsBytes - footprintBytes
  return { ok: headroomBytes >= input.softReserveBytes, footprintBytes, headroomBytes }
}

/**
 * D4: memory a live owner has been promised but has not allocated yet. Growth
 * above its baseline counts as allocated; without a baseline or a tree read,
 * or with `fullReservation`, it reserves its whole footprint. Old-version
 * owners carry no footprint and reserve 0 (NFR-4).
 */
export function ownerReservationBytes(
  owner: { footprintBytes?: number; rssBaselineBytes?: number; fullReservation?: boolean },
  treeRssBytes: number | null,
): number {
  const footprint = owner.footprintBytes ?? 0
  if (owner.fullReservation || owner.rssBaselineBytes === undefined || treeRssBytes === null) return footprint
  return Math.max(0, footprint - Math.max(0, treeRssBytes - owner.rssBaselineBytes))
}
