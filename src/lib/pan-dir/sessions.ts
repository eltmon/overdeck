import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import type { PanSessionEntry } from './types.js'
import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function appendSession(
  workspacePath: string,
  entry: PanSessionEntry,
): Effect.Effect<void, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { sessionsPath } = yield* ensureWorkspacePanDir(workspacePath)
    const line = `${JSON.stringify(entry)}\n`

    // Read existing content (or empty) then append + write. Effect FileSystem
    // doesn't expose appendFile directly in this version; this preserves
    // the append semantics atomically.
    const existing = yield* fs.exists(sessionsPath).pipe(Effect.catch(() => Effect.succeed(false)))
    if (existing) {
      const current = yield* fs.readFileString(sessionsPath, 'utf-8').pipe(
        Effect.mapError((cause) => new FsError({ path: sessionsPath, operation: 'readFileString', cause })),
      )
      yield* fs.writeFileString(sessionsPath, current + line).pipe(
        Effect.mapError((cause) => new FsError({ path: sessionsPath, operation: 'writeFileString', cause })),
      )
    } else {
      yield* fs.writeFileString(sessionsPath, line).pipe(
        Effect.mapError((cause) => new FsError({ path: sessionsPath, operation: 'writeFileString', cause })),
      )
    }
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function readSessions(
  workspacePath: string,
): Effect.Effect<PanSessionEntry[], FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { sessionsPath } = getWorkspacePanPaths(workspacePath)
    const exists = yield* fs.exists(sessionsPath).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return []
    const raw = yield* fs.readFileString(sessionsPath, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path: sessionsPath, operation: 'readFileString', cause })),
    )
    return yield* Effect.try({
      try: () =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line, index) => {
            try {
              return JSON.parse(line) as PanSessionEntry
            } catch (error) {
              throw new Error(
                `Invalid JSONL in ${sessionsPath} at line ${index + 1}: ${(error as Error).message}`,
              )
            }
          }),
      catch: (cause) => new FsError({ path: sessionsPath, operation: 'parse', cause }),
    })
  }).pipe(Effect.provide(NodeFileSystem.layer))
}
