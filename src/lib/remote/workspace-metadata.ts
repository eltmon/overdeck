import { Effect, FileSystem } from 'effect';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';
import type { RemoteWorkspaceMetadata } from './interface.js';
import { FsError } from '../errors.js';

export const WORKSPACES_DIR = join(homedir(), '.panopticon', 'workspaces');

export function saveWorkspaceMetadata(
  metadata: RemoteWorkspaceMetadata,
): Effect.Effect<void, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(WORKSPACES_DIR, { recursive: true }).pipe(
      Effect.mapError(cause => new FsError({ path: WORKSPACES_DIR, operation: 'makeDirectory', cause })),
    );

    const filename = join(WORKSPACES_DIR, `${metadata.id}.yaml`);
    yield* fs.writeFileString(filename, stringify(metadata)).pipe(
      Effect.mapError(cause => new FsError({ path: filename, operation: 'write', cause })),
    );
  });
}

export function loadWorkspaceMetadata(
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(filename).pipe(
      Effect.mapError(cause => new FsError({ path: filename, operation: 'exists', cause })),
    );
    if (!exists) return null;

    const content = yield* fs.readFileString(filename).pipe(
      Effect.mapError(cause => new FsError({ path: filename, operation: 'read', cause })),
    );

    return yield* Effect.try({
      try: () => parse(content) as RemoteWorkspaceMetadata,
      catch: cause => new FsError({ path: filename, operation: 'parse', cause }),
    });
  });
}

export function listWorkspaceMetadata(): Effect.Effect<
  RemoteWorkspaceMetadata[],
  FsError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(WORKSPACES_DIR).pipe(
      Effect.mapError(cause => new FsError({ path: WORKSPACES_DIR, operation: 'exists', cause })),
    );
    if (!exists) return [];

    const files = yield* fs.readDirectory(WORKSPACES_DIR).pipe(
      Effect.mapError(cause => new FsError({ path: WORKSPACES_DIR, operation: 'readDirectory', cause })),
    );

    const workspaces: RemoteWorkspaceMetadata[] = [];
    for (const file of files.filter(f => f.endsWith('.yaml'))) {
      const filePath = join(WORKSPACES_DIR, file);
      const content = yield* fs.readFileString(filePath).pipe(
        Effect.mapError(cause => new FsError({ path: filePath, operation: 'read', cause })),
      );
      const parsed = yield* Effect.try({
        try: () => parse(content) as RemoteWorkspaceMetadata,
        catch: cause => new FsError({ path: filePath, operation: 'parse', cause }),
      });
      workspaces.push(parsed);
    }

    return workspaces;
  });
}

export function findRemoteWorkspaceMetadata(
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null, FsError, FileSystem.FileSystem> {
  return loadWorkspaceMetadata(issueId);
}

export function deleteWorkspaceMetadata(
  issueId: string,
): Effect.Effect<boolean, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(filename).pipe(
      Effect.mapError(cause => new FsError({ path: filename, operation: 'exists', cause })),
    );
    if (!exists) return false;

    yield* fs.remove(filename).pipe(
      Effect.mapError(cause => new FsError({ path: filename, operation: 'remove', cause })),
    );
    return true;
  });
}
