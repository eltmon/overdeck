/**
 * Rollout-path lookup for Codex threads, split out of codex.ts (PAN-3920) so
 * the miss cache could land without growing that file. codex.ts re-exports
 * `findRolloutPath`, so every caller keeps its import.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Cache resolved rollout paths to avoid repeated synchronous directory walks. */
const rolloutPathCache = new Map<string, string>()
/** A miss is remembered briefly so hot read paths do not re-walk the tree on every call (PAN-3920). */
const ROLLOUT_MISS_TTL_MS = 10_000
const ROLLOUT_MISS_CACHE_MAX = 1024
const rolloutMissCache = new Map<string, number>()

/**
 * Walk $CODEX_HOME/sessions looking for a rollout file whose name ends with
 * `-<threadId>.jsonl`.  The directory tree is YYYY/MM/DD/…, so we walk it
 * recursively.
 *
 * Results are cached by (codexHomeDir, threadId) so the walk runs at most once
 * per unique thread; the hot paths (getHeartbeat tier-2, getTokenUsage,
 * getSessionCost) pay only an existsSync check on subsequent calls.
 */
export function findRolloutPath(codexHomeDir: string, threadId: string): string | null {
  const cacheKey = `${codexHomeDir}:${threadId}`
  const cached = rolloutPathCache.get(cacheKey)
  if (cached) {
    if (existsSync(cached)) return cached
    // File was deleted — evict and re-walk.
    rolloutPathCache.delete(cacheKey)
  }
  const missedAt = rolloutMissCache.get(cacheKey)
  if (missedAt !== undefined && Date.now() - missedAt < ROLLOUT_MISS_TTL_MS) return null
  const sessionsRoot = join(codexHomeDir, 'sessions')
  if (!existsSync(sessionsRoot)) return null
  const result = walkForThread(sessionsRoot, threadId)
  if (result) {
    rolloutPathCache.set(cacheKey, result)
    rolloutMissCache.delete(cacheKey)
  } else {
    if (rolloutMissCache.size >= ROLLOUT_MISS_CACHE_MAX) rolloutMissCache.delete(rolloutMissCache.keys().next().value!)
    rolloutMissCache.set(cacheKey, Date.now())
  }
  return result
}

function walkForThread(dir: string, threadId: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      const hit = walkForThread(full, threadId)
      if (hit) return hit
    } else if (entry.endsWith(`-${threadId}.jsonl`)) {
      return full
    }
  }
  return null
}
