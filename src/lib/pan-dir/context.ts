import { join } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import { getWorkspacePanPaths, ensureWorkspacePanDir } from './continue.js'

export function readWorkspaceContext(workspacePath: string): Effect.Effect<string | null, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { contextPath } = getWorkspacePanPaths(workspacePath)
    const exists = yield* fs.exists(contextPath).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return null
    return yield* fs.readFileString(contextPath, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path: contextPath, operation: 'readFileString', cause })),
    )
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function writeWorkspaceContext(
  workspacePath: string,
  content: string,
): Effect.Effect<string, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { contextPath } = yield* ensureWorkspacePanDir(workspacePath)
    const tmp = `${contextPath}.tmp`
    yield* fs.writeFileString(tmp, content).pipe(
      Effect.mapError((cause) => new FsError({ path: tmp, operation: 'writeFileString', cause })),
    )
    yield* fs.rename(tmp, contextPath).pipe(
      Effect.mapError((cause) => new FsError({ path: contextPath, operation: 'rename', cause })),
    )
    return contextPath
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

/**
 * The tmp file used for atomic context writes. Exported for use by other modules
 * that need to coordinate temp-file naming.
 */
export function workspaceContextTmpPath(contextPath: string): string {
  return join(contextPath + '.tmp')
}
