/**
 * Pi Coding Agent helpers (PAN-636).
 *
 * The Pi runtime adapter classes (PiRuntimeSync, PiRuntime) were never constructed
 * after PAN-1989 and were deleted in PAN-3958 (#4007). What remains is used by the
 * live pi harness paths: PiSpawnTimeout and the PiSpawnConfig shape. The session
 * layout (piSessionsRoot, findPiTranscriptPath) lives in `storage/pi.ts` (PAN-3958 CH-7).
 */

import type {
  SpawnConfig,
} from './types.js'

const SPAWN_READY_TIMEOUT_MS = 30_000

export class PiSpawnTimeout extends Error {
  readonly code = 'PI_SPAWN_TIMEOUT' as const
  constructor(agentId: string) {
    super(`Pi agent ${agentId} did not write ready.json within ${SPAWN_READY_TIMEOUT_MS}ms`)
    this.name = 'PiSpawnTimeout'
  }
}

export interface PiSpawnConfig extends SpawnConfig {
  /** Absolute path to packages/pi-extension/dist/index.js. */
  piExtensionPath: string
  /** Optional extra args appended to the `pi` command line. */
  extraPiArgs?: string
}
