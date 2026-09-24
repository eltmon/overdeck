/**
 * Codex transcript storage (PAN-3958 CH-7, D11): the only place that knows where
 * Codex keeps its home and rollouts — `$CODEX_HOME` (default `~/.codex`) and
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`.
 * Overdeck gives every Codex agent and conversation its own CODEX_HOME under the
 * agent directory, so callers pass the home to search.
 *
 * Leaf module: imports only `node:*`, so any layer can import it without
 * creating a cycle. `npm run lint:harness-storage` keeps these paths from being
 * rebuilt anywhere else.
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** The user's own Codex home, `~/.codex`, ignoring `$CODEX_HOME`. */
export function codexDefaultHome(): string {
  return join(homedir(), '.codex')
}

/** A Codex home's rollout directory: `<codexHome>/sessions`. */
export function codexSessionsRoot(codexHomeDir: string): string {
  return join(codexHomeDir, 'sessions')
}

/**
 * An Overdeck agent's persistent Codex home, `<agentDir>/codex-home`. Rollouts
 * live under it even when the agent runs with `codex-home-v2` as CODEX_HOME,
 * whose `sessions/` is a symlink back here.
 */
export function codexAgentHome(agentDir: string): string {
  return join(agentDir, 'codex-home')
}

/** An Overdeck agent's rollout directory: `<agentDir>/codex-home/sessions`. */
export function codexAgentSessionsDir(agentDir: string): string {
  return codexSessionsRoot(codexAgentHome(agentDir))
}

/** Resolve $CODEX_HOME: env var → ~/.codex fallback. */
export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex')
}

/**
 * Extract the thread-id from a rollout filename.
 *
 * Codex names rollouts `rollout-<timestamp>-<threadId>.jsonl`, where threadId
 * is the session UUID (8-4-4-4-12) — e.g.
 * `rollout-2026-06-09T01-47-53-019eaaec-4dfa-7ab1-90ba-9104d16534d1.jsonl`
 * → `019eaaec-4dfa-7ab1-90ba-9104d16534d1`. Extract the trailing UUID;
 * splitting on `-` and taking the last segment truncates the id to its final
 * group, which breaks `codex exec resume <threadId>` and findRolloutPath.
 */
export function extractThreadIdFromRollout(rolloutPath: string): string | null {
  const name = basename(rolloutPath, '.jsonl')
  const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return m ? m[1]! : null
}

/**
 * Read the first line (the session_meta record) of a rollout file without
 * loading the whole multi-megabyte JSONL.
 */
function readRolloutMetaLine(path: string, maxBytes = 131072): string | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
    const text = buf.subarray(0, n).toString('utf-8')
    const nl = text.indexOf('\n')
    return nl === -1 ? text : text.slice(0, nl)
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/**
 * True when a rollout belongs to a Codex-internal subagent thread (e.g. the
 * guardian approval supervisor), per the session_meta `thread_source` field.
 * Subagent rollouts live in the same per-agent CODEX_HOME as the main thread
 * and are written concurrently, so raw mtime cannot tell them apart
 * (PAN-1805). Unknown/unparseable meta is treated as a user thread — older
 * Codex versions predate `thread_source`.
 */
function isSubagentRollout(path: string): boolean {
  const line = readRolloutMetaLine(path)
  if (!line) return false
  try {
    const meta = JSON.parse(line) as { payload?: { thread_source?: unknown } }
    return meta.payload?.thread_source === 'subagent'
  } catch {
    return false
  }
}

/**
 * Return the most-recently-modified *user-thread* rollout JSONL under
 * <codexHomeDir>/sessions, or null. A per-conversation/-agent CODEX_HOME holds
 * only that session's rollouts, so the newest user thread is its current
 * conversation. Subagent (guardian) rollouts are skipped — they interleave
 * writes with the main thread and would otherwise win the mtime race
 * (PAN-1805). Used to resolve the transcript when no thread-id was persisted —
 * the spawn-time capture is a one-shot window, but Codex only writes its
 * rollout on the first turn.
 */
export function findLatestRollout(codexHomeDir: string): string | null {
  const sessionsRoot = join(codexHomeDir, 'sessions')
  const paths: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry)
      let isDir = false
      try { isDir = statSync(full).isDirectory() } catch { continue }
      if (isDir) walk(full)
      else if (entry.startsWith('rollout-') && entry.endsWith('.jsonl')) paths.push(full)
    }
  }
  walk(sessionsRoot)
  const byMtimeDesc = paths
    .map((p) => {
      try { return { p, mtimeMs: statSync(p).mtimeMs } } catch { return null }
    })
    .filter((e): e is { p: string; mtimeMs: number } => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { p } of byMtimeDesc) {
    if (!isSubagentRollout(p)) return p
  }
  // All rollouts are subagent threads — better to show one than nothing.
  return byMtimeDesc[0]?.p ?? null
}

export function codexHomeDir(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

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
