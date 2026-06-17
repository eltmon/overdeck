/**
 * Legacy test-only writers for the workspace continue file.
 *
 * PAN-1919 retired production writes to .pan/continue.json; these helpers
 * remain so existing pan-dir tests can still exercise the read-only legacy
 * reader code paths without reintroducing production writers.
 */

import { join } from 'path';
import { randomBytes } from 'crypto';
import { Effect, FileSystem } from 'effect';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import { FsError } from '../../errors.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_FEEDBACK_DIRNAME } from '../types.js';
import type { WorkspaceContinueState, WorkspacePanPaths } from '../types.js';

function uniqueTmpPath(path: string): string {
  return `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
}

function workspacePanPaths(workspacePath: string): WorkspacePanPaths {
  const panDir = join(workspacePath, PAN_DIRNAME);
  return {
    panDir,
    specPath: join(panDir, 'spec.vbrief.json'),
    continuePath: join(panDir, PAN_CONTINUE_FILENAME),
    sessionsPath: join(panDir, 'sessions.json'),
    feedbackDir: join(panDir, PAN_FEEDBACK_DIRNAME),
    contextPath: join(panDir, 'context.json'),
  };
}

function validateWorkspaceContinueState(value: unknown, path: string): asserts value is WorkspaceContinueState {
  if (!value || typeof value !== 'object') {
    throw new Error(`Continue file ${path} is not an object`);
  }
  const v = value as Record<string, unknown>;
  if (v.version !== '1') {
    throw new Error(`Continue file ${path} has unsupported version: ${String(v.version)}`);
  }
  if (typeof v.issueId !== 'string') {
    throw new Error(`Continue file ${path} missing issueId`);
  }
  if (typeof v.created !== 'string' || typeof v.updated !== 'string') {
    throw new Error(`Continue file ${path} missing created/updated timestamps`);
  }
  if (!Array.isArray(v.decisions) || !Array.isArray(v.hazards) || !Array.isArray(v.sessionHistory)) {
    throw new Error(`Continue file ${path} has malformed array fields`);
  }
  if (typeof v.beadsMapping !== 'object' || v.beadsMapping === null) {
    throw new Error(`Continue file ${path} has malformed beadsMapping`);
  }
  if (v.feedback === undefined) {
    (v as Record<string, unknown>).feedback = [];
  } else if (!Array.isArray(v.feedback)) {
    throw new Error(`Continue file ${path} has malformed feedback array`);
  }
}

/** Test-only legacy writer for workspace continue.json. */
export function writeWorkspaceContinue(
  workspacePath: string,
  state: WorkspaceContinueState,
): Effect.Effect<WorkspaceContinueState, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { continuePath, panDir, feedbackDir } = workspacePanPaths(workspacePath);
    yield* fs.makeDirectory(panDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new FsError({ path: panDir, operation: 'makeDirectory', cause })),
    );
    yield* fs.makeDirectory(feedbackDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new FsError({ path: feedbackDir, operation: 'makeDirectory', cause })),
    );
    const now = new Date().toISOString();
    const next: WorkspaceContinueState = {
      ...state,
      version: '1',
      created: state.created || now,
      updated: now,
    };
    const tmp = uniqueTmpPath(continuePath);
    yield* fs.writeFileString(tmp, JSON.stringify(next, null, 2)).pipe(
      Effect.mapError((cause) => new FsError({ path: tmp, operation: 'writeFileString', cause })),
    );
    yield* fs.rename(tmp, continuePath).pipe(
      Effect.mapError((cause) => new FsError({ path: continuePath, operation: 'rename', cause })),
    );
    return next;
  }).pipe(Effect.provide(NodeFileSystem.layer));
}

/** Test-only legacy reader for workspace continue.json. */
export function readWorkspaceContinue(
  workspacePath: string,
): Effect.Effect<WorkspaceContinueState | null, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { continuePath } = workspacePanPaths(workspacePath);
    const exists = yield* fs.exists(continuePath).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return null;
    const raw = yield* fs.readFileString(continuePath, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path: continuePath, operation: 'readFileString', cause })),
    );
    return yield* Effect.try({
      try: () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`Invalid JSON in continue file ${continuePath}: ${(error as Error).message}`);
        }
        validateWorkspaceContinueState(parsed, continuePath);
        return parsed;
      },
      catch: (cause) => new FsError({ path: continuePath, operation: 'parse', cause }),
    });
  }).pipe(Effect.provide(NodeFileSystem.layer));
}
