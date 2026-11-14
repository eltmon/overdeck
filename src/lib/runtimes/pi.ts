/**
 * Pi Coding Agent runtime (PAN-636, restored in PAN-5212).
 *
 * pi is oh-my-pi's upstream and speaks the same `--mode rpc` protocol, so its
 * runtime is the shared pi-family adapter in `ohmypi.ts` constructed for
 * `pi`; the pi-specific launch data (binary `pi`, `--session` resume,
 * `--no-approve`, `~/.pi/agent/models.json`, the `packages/pi-extension`
 * bundle) lives in `pi-family.ts`. The session layout (piSessionsRoot,
 * findPiTranscriptPath) lives in `storage/pi.ts` (PAN-3958 CH-7).
 */

import type {
  SpawnConfig,
} from './types.js'
import { OhmypiRuntimeSync } from './ohmypi.js'

/** The registered pi runtime: the pi-family adapter for the `pi` binary. */
export function createPiRuntimeSync(): OhmypiRuntimeSync {
  return new OhmypiRuntimeSync('pi')
}

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
