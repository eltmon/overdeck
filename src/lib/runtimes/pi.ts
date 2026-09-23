/**
 * Pi Coding Agent helpers (PAN-636).
 *
 * The Pi runtime adapter classes (PiRuntimeSync, PiRuntime) were never constructed
 * after PAN-1989 and were deleted in PAN-3958 (#4007). What remains is used by the
 * live pi harness paths: the session layout (piSessionsRoot, findPiTranscriptPath),
 * PiSpawnTimeout and the PiSpawnConfig shape.
 */

import { readdir as readdirAsync, stat as statAsync } from 'node:fs/promises'
import { join } from 'node:path'
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

export function piSessionsRoot(agentDir: string): string {
  return join(agentDir, 'sessions')
}

const NON_TRANSCRIPT_JSONL = new Set([
  'acp-session.jsonl',
  'cost-events.jsonl',
  'activity.jsonl',
  'pending-events.jsonl',
])

/** Resolve a Pi/oh-my-pi transcript from the runtime-owned session layout. */
export async function findPiTranscriptPath(
  agentDir: string,
  sessionId?: string,
): Promise<string | null> {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdirAsync(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  await walk(piSessionsRoot(agentDir))
  const rootEntries = await readdirAsync(agentDir, { withFileTypes: true }).catch(() => [])
  for (const entry of rootEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith('.jsonl') && !NON_TRANSCRIPT_JSONL.has(entry.name)) {
      files.push(join(agentDir, entry.name))
    }
  }
  if (sessionId) {
    return files.find((path) => path.endsWith(`_${sessionId}.jsonl`) || path.endsWith(`/${sessionId}.jsonl`)) ?? null
  }
  const withMtime = await Promise.all(files.map(async path => ({
    path,
    mtime: await statAsync(path).then(info => info.mtimeMs, () => -1),
  })))
  return withMtime.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))[0]?.path ?? null
}
