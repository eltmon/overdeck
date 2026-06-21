import { join } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import type { WorkspacePanPaths } from './types.js'
import {
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
  PAN_SPEC_FILENAME,
  PAN_CONTEXT_FILENAME,
} from './types.js'

function workspacePanPaths(workspacePath: string): WorkspacePanPaths {
  const panDir = join(workspacePath, PAN_DIRNAME)
  return {
    panDir,
    specPath: join(panDir, PAN_SPEC_FILENAME),
    continuePath: join(panDir, PAN_CONTINUE_FILENAME),
    sessionsPath: join(panDir, PAN_SESSIONS_FILENAME),
    feedbackDir: join(panDir, PAN_FEEDBACK_DIRNAME),
    contextPath: join(panDir, PAN_CONTEXT_FILENAME),
  }
}

export function getWorkspacePanPaths(workspacePath: string): WorkspacePanPaths {
  return workspacePanPaths(workspacePath)
}

export function ensureWorkspacePanDir(
  workspacePath: string,
): Effect.Effect<WorkspacePanPaths, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = workspacePanPaths(workspacePath)
    yield* fs.makeDirectory(paths.panDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new FsError({ path: paths.panDir, operation: 'makeDirectory', cause })),
    )
    yield* fs.makeDirectory(paths.feedbackDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new FsError({ path: paths.feedbackDir, operation: 'makeDirectory', cause })),
    )
    return paths
  }).pipe(Effect.provide(NodeFileSystem.layer))
}
