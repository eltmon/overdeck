import { join, basename } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import { ensurePanDirs } from './specs.js'
import { queueAutoCommit } from './auto-commit.js'

export function getContinuesDir(projectRoot: string): string {
  return join(projectRoot, '.pan', 'continues')
}

export function getContinueFilePath(projectRoot: string, issueId: string): string {
  return join(getContinuesDir(projectRoot), `${issueId.toLowerCase()}.vbrief.json`)
}

export function hasContinueFile(
  projectRoot: string,
  issueId: string,
): Effect.Effect<boolean, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(getContinueFilePath(projectRoot, issueId)).pipe(
      Effect.catch(() => Effect.succeed(false)),
    )
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function readContinueFile(
  projectRoot: string,
  issueId: string,
): Effect.Effect<string | null, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getContinueFilePath(projectRoot, issueId)
    const exists = yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return null
    return yield* fs.readFileString(path, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'readFileString', cause })),
    )
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function writeContinueFile(
  projectRoot: string,
  issueId: string,
  content: string,
): Effect.Effect<string, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* ensurePanDirs(projectRoot)
    const path = getContinueFilePath(projectRoot, issueId)
    yield* fs.writeFileString(path, content).pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'writeFileString', cause })),
    )
    queueAutoCommit({
      projectRoot,
      paths: [path],
      subject: `chore(state): update continue for ${issueId.toUpperCase()}`,
    })
    return path
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function listContinueFiles(
  projectRoot: string,
): Effect.Effect<string[], FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const continuesDir = getContinuesDir(projectRoot)
    const exists = yield* fs.exists(continuesDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return []
    const entries = yield* fs.readDirectory(continuesDir).pipe(
      Effect.mapError((cause) => new FsError({ path: continuesDir, operation: 'readDirectory', cause })),
    )
    return entries
      .filter((filename) => filename.endsWith('.vbrief.json'))
      .map((filename) => basename(filename, '.vbrief.json'))
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function deleteContinueFile(
  projectRoot: string,
  issueId: string,
): Effect.Effect<boolean, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = getContinueFilePath(projectRoot, issueId)
    const exists = yield* fs.exists(path).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return false

    const deletedDir = join(getContinuesDir(projectRoot), 'deleted')
    const result = yield* Effect.gen(function* () {
      yield* fs.makeDirectory(deletedDir, { recursive: true }).pipe(
        Effect.mapError((cause) => new FsError({ path: deletedDir, operation: 'makeDirectory', cause })),
      )
      yield* fs
        .rename(path, join(deletedDir, `${issueId.toLowerCase()}-${Date.now()}.vbrief.json`))
        .pipe(Effect.mapError((cause) => new FsError({ path, operation: 'rename', cause })))
      queueAutoCommit({
        projectRoot,
        paths: [path],
        subject: `chore(state): remove continue for ${issueId.toUpperCase()}`,
      })
      return true
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    return result
  }).pipe(Effect.provide(NodeFileSystem.layer))
}
