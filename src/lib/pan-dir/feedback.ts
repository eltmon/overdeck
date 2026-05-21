import { join } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import type { PanFeedbackFile } from './types.js'
import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function readFeedback(
  workspacePath: string,
): Effect.Effect<PanFeedbackFile[], FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { feedbackDir } = getWorkspacePanPaths(workspacePath)
    const exists = yield* fs.exists(feedbackDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return []

    const entries = yield* fs.readDirectory(feedbackDir).pipe(
      Effect.mapError((cause) => new FsError({ path: feedbackDir, operation: 'readDirectory', cause })),
    )

    const files: PanFeedbackFile[] = []
    for (const filename of entries) {
      const path = join(feedbackDir, filename)
      const content = yield* fs.readFileString(path, 'utf-8').pipe(
        Effect.mapError((cause) => new FsError({ path, operation: 'readFileString', cause })),
      )
      files.push({ path, filename, content })
    }
    files.sort((a, b) => a.filename.localeCompare(b.filename))
    return files
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function writeFeedback(
  workspacePath: string,
  filename: string,
  content: string,
): Effect.Effect<string, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { feedbackDir } = yield* ensureWorkspacePanDir(workspacePath)
    yield* fs.makeDirectory(feedbackDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new FsError({ path: feedbackDir, operation: 'makeDirectory', cause })),
    )
    const path = join(feedbackDir, filename)
    yield* fs.writeFileString(path, content).pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'writeFileString', cause })),
    )
    return path
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function clearFeedback(workspacePath: string): Effect.Effect<void, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { feedbackDir } = getWorkspacePanPaths(workspacePath)
    const exists = yield* fs.exists(feedbackDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return
    const entries = yield* fs.readDirectory(feedbackDir).pipe(
      Effect.mapError((cause) => new FsError({ path: feedbackDir, operation: 'readDirectory', cause })),
    )
    for (const filename of entries) {
      const path = join(feedbackDir, filename)
      yield* fs.remove(path, { force: true }).pipe(
        Effect.mapError((cause) => new FsError({ path, operation: 'remove', cause })),
      )
    }
  }).pipe(Effect.provide(NodeFileSystem.layer))
}
