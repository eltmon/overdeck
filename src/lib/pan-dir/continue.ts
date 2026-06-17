import { join } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import type { WorkspaceContinueState, WorkspacePanPaths } from './types.js'
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

function validateWorkspaceContinueState(value: unknown, path: string): asserts value is WorkspaceContinueState {
  if (!value || typeof value !== 'object') {
    throw new Error(`Continue file ${path} is not an object`)
  }
  const v = value as Record<string, unknown>
  if (v.version !== '1') {
    throw new Error(`Continue file ${path} has unsupported version: ${String(v.version)}`)
  }
  if (typeof v.issueId !== 'string') {
    throw new Error(`Continue file ${path} missing issueId`)
  }
  if (typeof v.created !== 'string' || typeof v.updated !== 'string') {
    throw new Error(`Continue file ${path} missing created/updated timestamps`)
  }
  if (!Array.isArray(v.decisions) || !Array.isArray(v.hazards) || !Array.isArray(v.sessionHistory)) {
    throw new Error(`Continue file ${path} has malformed array fields`)
  }
  if (typeof v.beadsMapping !== 'object' || v.beadsMapping === null) {
    throw new Error(`Continue file ${path} has malformed beadsMapping`)
  }
  if (v.feedback === undefined) {
    ;(v as Record<string, unknown>).feedback = []
  } else if (!Array.isArray(v.feedback)) {
    throw new Error(`Continue file ${path} has malformed feedback array`)
  }
}

export function readWorkspaceContinue(
  workspacePath: string,
): Effect.Effect<WorkspaceContinueState | null, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { continuePath } = workspacePanPaths(workspacePath)
    const exists = yield* fs.exists(continuePath).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return null
    const raw = yield* fs.readFileString(continuePath, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path: continuePath, operation: 'readFileString', cause })),
    )
    return yield* Effect.try({
      try: () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          throw new Error(`Invalid JSON in continue file ${continuePath}: ${(error as Error).message}`)
        }
        validateWorkspaceContinueState(parsed, continuePath)
        return parsed
      },
      catch: (cause) => new FsError({ path: continuePath, operation: 'parse', cause }),
    })
  }).pipe(Effect.provide(NodeFileSystem.layer))
}
