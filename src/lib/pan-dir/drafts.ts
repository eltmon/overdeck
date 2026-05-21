import { join, basename } from 'path'
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
