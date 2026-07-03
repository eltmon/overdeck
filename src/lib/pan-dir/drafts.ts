import { join, basename } from 'path'
import { existsSync, readFileSync } from 'node:fs'
import { Effect, FileSystem, Option } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'
import { queueAutoCommit } from './auto-commit.js'

import { getProjectPanPaths, ensurePanDirs } from './specs.js'

export function getDraftsDir(projectRoot: string): string {
  return getProjectPanPaths(projectRoot).draftsDir
}

export function getDraftPath(projectRoot: string, filename: string): string {
  return join(getDraftsDir(projectRoot), filename)
}

export function getIssueDraftPath(projectRoot: string, issueId: string): string {
  return getDraftPath(projectRoot, `${issueId.toUpperCase()}.md`)
}

export function hasIssueDraft(
  projectRoot: string,
  issueId: string,
): Effect.Effect<boolean, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getIssueDraftPath(projectRoot, issueId)
    return yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function readIssueDraft(
  projectRoot: string,
  issueId: string,
): Effect.Effect<string | null, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getIssueDraftPath(projectRoot, issueId)
    const exists = yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return null
    return yield* fs.readFileString(path, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'readFileString', cause })),
    )
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function writeIssueDraft(
  projectRoot: string,
  issueId: string,
  content: string,
): Effect.Effect<string, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* ensurePanDirs(projectRoot)
    const path = getIssueDraftPath(projectRoot, issueId)
    yield* fs.writeFileString(path, content).pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'writeFileString', cause })),
    )
    queueAutoCommit({
      projectRoot,
      paths: [path],
      subject: `chore(state): update PRD draft for ${issueId.toUpperCase()}`,
    })
    return path
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function listIssueDrafts(
  projectRoot: string,
): Effect.Effect<string[], FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draftsDir = getDraftsDir(projectRoot)
    const exists = yield* fs.exists(draftsDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return []
    const entries = yield* fs.readDirectory(draftsDir).pipe(
      Effect.mapError((cause) => new FsError({ path: draftsDir, operation: 'readDirectory', cause })),
    )
    return entries
      .filter((filename) => filename.endsWith('.md'))
      .map((filename) => basename(filename, '.md'))
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function deleteIssueDraft(
  projectRoot: string,
  issueId: string,
): Effect.Effect<boolean, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getIssueDraftPath(projectRoot, issueId)
    const exists = yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return false

    const deletedDir = join(getDraftsDir(projectRoot), 'deleted')
    const result = yield* Effect.gen(function* () {
      yield* fs.makeDirectory(deletedDir, { recursive: true }).pipe(
        Effect.mapError((cause) => new FsError({ path: deletedDir, operation: 'makeDirectory', cause })),
      )
      yield* fs
        .rename(path, join(deletedDir, `${issueId.toUpperCase()}-${Date.now()}.md`))
        .pipe(Effect.mapError((cause) => new FsError({ path, operation: 'rename', cause })))
      return true
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    return result
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export interface IssueDraftInfo {
  exists: boolean
  path?: string
  size?: number
  modified?: Date
}

export function getIssueDraftInfo(
  projectRoot: string,
  issueId: string,
): Effect.Effect<IssueDraftInfo, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getIssueDraftPath(projectRoot, issueId)
    const exists = yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return { exists: false }

    const stats = yield* fs.stat(path).pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'stat', cause })),
    )
    const mtime = Option.getOrUndefined(stats.mtime)
    return {
      exists: true,
      path,
      size: Number(stats.size),
      modified: mtime,
    }
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

/**
 * Minimum line count for a PRD draft to satisfy the PRD-first gate (PAN-2234).
 * A found-but-thinner draft fails the gate with reason 'too-short'.
 */
export const MIN_PRD_LINES = 20

export interface PrdGateResult {
  ok: boolean
  path?: string
  lineCount?: number
  reason?: 'missing' | 'too-short'
  searched?: string[]
}

/**
 * Sync PRD-first gate predicate (PAN-2234). The surrounding module uses the
 * Effect FileSystem for read/write/list paths; this predicate is deliberately a
 * plain sync node:fs read so the CLI caller (`pan plan finalize`) and the
 * complete-planning route can call it inline in a sync flow. No child-process
 * sync (no execSync) — fs-sync only, per the repo's server-code rule.
 *
 * Search order (first existing file wins): projectRoot uppercase → projectRoot
 * lowercase → workspacePath uppercase → workspacePath lowercase. A null/empty
 * root skips its candidates. Non-trivial means at least MIN_PRD_LINES lines.
 */
export function checkPrdGateSync(args: {
  projectRoot?: string | null
  workspacePath?: string | null
  issueId: string
}): PrdGateResult {
  const { projectRoot, workspacePath, issueId } = args
  const upperFile = `${issueId.toUpperCase()}.md`
  const lowerFile = `${issueId.toLowerCase()}.md`
  const searched: string[] = []
  const candidates: string[] = []
  if (projectRoot) {
    candidates.push(join(getDraftsDir(projectRoot), upperFile))
    candidates.push(getDraftPath(projectRoot, lowerFile))
  }
  if (workspacePath) {
    const wsDrafts = join(workspacePath, '.pan', 'drafts')
    candidates.push(join(wsDrafts, upperFile))
    candidates.push(join(wsDrafts, lowerFile))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      let content = ''
      try {
        content = readFileSync(candidate, 'utf-8')
      } catch {
        // Treat an unreadable file as missing; surface the path so the caller
        // can diagnose, but fall through to the searched list.
        searched.push(candidate)
        continue
      }
      const lineCount = content.split('\n').length
      if (lineCount >= MIN_PRD_LINES) {
        return { ok: true, path: candidate, lineCount }
      }
      return { ok: false, reason: 'too-short', path: candidate, lineCount }
    }
    searched.push(candidate)
  }
  return { ok: false, reason: 'missing', searched }
}
