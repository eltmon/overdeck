import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';
import { Effect, FileSystem } from 'effect';
import type { RemoteWorkspaceMetadata } from './interface.js';
import { FsError } from '../errors.js';

export const WORKSPACES_DIR = join(homedir(), '.panopticon', 'workspaces');

function toFsError(path: string, operation: string) {
  return (cause: unknown): FsError => new FsError({ path, operation, cause });
}

/**
 * Save workspace metadata to ~/.panopticon/workspaces/{id}.yaml
 */
export function saveWorkspaceMetadata(
  metadata: RemoteWorkspaceMetadata,
): Effect.Effect<void, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dirExists = yield* fs.exists(WORKSPACES_DIR).pipe(
      Effect.mapError(toFsError(WORKSPACES_DIR, 'exists')),
    );
    if (!dirExists) {
      yield* fs.makeDirectory(WORKSPACES_DIR, { recursive: true }).pipe(
        Effect.mapError(toFsError(WORKSPACES_DIR, 'mkdir')),
      );
    }
    const filename = join(WORKSPACES_DIR, `${metadata.id}.yaml`);
    yield* fs.writeFileString(filename, stringify(metadata)).pipe(
      Effect.mapError(toFsError(filename, 'write')),
    );
  });
}

/**
 * Load workspace metadata from ~/.panopticon/workspaces/{issueId}.yaml
 */
export function loadWorkspaceMetadata(
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);

    const exists = yield* fs.exists(filename).pipe(
      Effect.mapError(toFsError(filename, 'exists')),
    );
    if (!exists) return null;

    const content = yield* fs.readFileString(filename, 'utf-8').pipe(
      Effect.mapError(toFsError(filename, 'read')),
    );
    return yield* Effect.try({
      try: () => parse(content) as RemoteWorkspaceMetadata,
      catch: (e) => new FsError({ path: filename, operation: 'parse', cause: e }),
    });
  });
}

/**
 * List all workspace metadata files
 */
export function listWorkspaceMetadata(): Effect.Effect<
  RemoteWorkspaceMetadata[],
  FsError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const dirExists = yield* fs.exists(WORKSPACES_DIR).pipe(
      Effect.mapError(toFsError(WORKSPACES_DIR, 'exists')),
    );
    if (!dirExists) return [];

    const files = yield* fs.readDirectory(WORKSPACES_DIR).pipe(
      Effect.mapError(toFsError(WORKSPACES_DIR, 'readdir')),
    );
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));
    const workspaces: RemoteWorkspaceMetadata[] = [];

    for (const file of yamlFiles) {
      const filePath = join(WORKSPACES_DIR, file);
      const content = yield* fs.readFileString(filePath, 'utf-8').pipe(
        Effect.mapError(toFsError(filePath, 'read')),
      );
      const parsed = yield* Effect.try({
        try: () => parse(content) as RemoteWorkspaceMetadata,
        catch: (e) => new FsError({ path: filePath, operation: 'parse', cause: e }),
      });
      workspaces.push(parsed);
    }

    return workspaces;
  });
}

/**
 * Check if a workspace exists (local or remote).
 * Returns metadata if remote workspace exists, null otherwise.
 */
export function findRemoteWorkspaceMetadata(
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null, FsError, FileSystem.FileSystem> {
  return loadWorkspaceMetadata(issueId);
}

/**
 * Delete workspace metadata. Returns true if deleted, false if not found.
 */
export function deleteWorkspaceMetadata(
  issueId: string,
): Effect.Effect<boolean, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);

    const exists = yield* fs.exists(filename).pipe(
      Effect.mapError(toFsError(filename, 'exists')),
    );
    if (!exists) return false;

    yield* fs.remove(filename).pipe(
      Effect.mapError(toFsError(filename, 'unlink')),
    );
    return true;
  });
}
