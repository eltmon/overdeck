import { join, basename } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

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

