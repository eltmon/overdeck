/**
 * Workspace Metadata Management
 *
 * Shared module for loading, saving, and listing workspace metadata.
 * Used by both workspace.ts and work/issue.ts for remote workspace support.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';
import { Effect } from 'effect';
import { FsError } from '../errors.js';
import type { RemoteWorkspaceMetadata } from './interface.js';

// Path for workspace metadata
export const WORKSPACES_DIR = join(homedir(), '.panopticon', 'workspaces');

/**
 * Save workspace metadata to ~/.panopticon/workspaces/{issueId}.yaml
 */
export function saveWorkspaceMetadataSync(metadata: RemoteWorkspaceMetadata): void {
  if (!existsSync(WORKSPACES_DIR)) {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
  }

  const filename = join(WORKSPACES_DIR, `${metadata.id}.yaml`);
  writeFileSync(filename, stringify(metadata), 'utf-8');
}

/**
 * Load workspace metadata from ~/.panopticon/workspaces/{issueId}.yaml
 */
export function loadWorkspaceMetadataSync(issueId: string): RemoteWorkspaceMetadata | null {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);

  if (!existsSync(filename)) {
    return null;
  }

  try {
    const content = readFileSync(filename, 'utf-8');
    return parse(content) as RemoteWorkspaceMetadata;
  } catch {
    return null;
  }
}

/**
 * List all workspace metadata files
 */
export function listWorkspaceMetadataSync(): RemoteWorkspaceMetadata[] {
  if (!existsSync(WORKSPACES_DIR)) {
    return [];
  }

  const files = readdirSync(WORKSPACES_DIR).filter(f => f.endsWith('.yaml'));
  const workspaces: RemoteWorkspaceMetadata[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(WORKSPACES_DIR, file), 'utf-8');
      workspaces.push(parse(content) as RemoteWorkspaceMetadata);
    } catch {
      // Skip invalid files
    }
  }

  return workspaces;
}

/**
 * Check if a workspace exists (local or remote)
 * Returns metadata if remote workspace exists, null otherwise
 */
export function findRemoteWorkspaceMetadataSync(issueId: string): RemoteWorkspaceMetadata | null {
  return loadWorkspaceMetadataSync(issueId);
}

/**
 * Delete workspace metadata
 */
export function deleteWorkspaceMetadataSync(issueId: string): boolean {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const filename = join(WORKSPACES_DIR, `${normalizedId}.yaml`);

  if (!existsSync(filename)) {
    return false;
  }

  try {
    const { unlinkSync } = require('fs');
    unlinkSync(filename);
    return true;
  } catch {
    return false;
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Additive Effect-typed wrappers over the metadata sync helpers above. The
// originals stay because they are called from many places (workspace.ts,
// work/issue.ts); the Effect variants surface FS failures as `FsError` so
// callers in Effect graphs can compose this with the broader migration.

const toMetadataFsError = (op: string, path: string, cause: unknown): FsError =>
  new FsError({ path, operation: op, cause });

/** Save workspace metadata (Effect variant). */
export const saveWorkspaceMetadata = (
  metadata: RemoteWorkspaceMetadata,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => saveWorkspaceMetadataSync(metadata),
    catch: (cause) =>
      toMetadataFsError(
        'saveWorkspaceMetadata',
        join(WORKSPACES_DIR, `${metadata.id}.yaml`),
        cause,
      ),
  });

/** Load workspace metadata (Effect variant — pure, never fails). */
export const loadWorkspaceMetadata = (
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null> =>
  Effect.sync(() => loadWorkspaceMetadataSync(issueId));

/** List all workspace metadata files (Effect variant — pure, never fails). */
export const listWorkspaceMetadata = (): Effect.Effect<
  RemoteWorkspaceMetadata[]
> => Effect.sync(() => listWorkspaceMetadataSync());

/** Find a remote workspace by id (Effect variant — pure, never fails). */
export const findRemoteWorkspaceMetadata = (
  issueId: string,
): Effect.Effect<RemoteWorkspaceMetadata | null> =>
  Effect.sync(() => findRemoteWorkspaceMetadataSync(issueId));

/** Delete workspace metadata (Effect variant — returns whether a file was removed). */
export const deleteWorkspaceMetadata = (
  issueId: string,
): Effect.Effect<boolean> =>
  Effect.sync(() => deleteWorkspaceMetadataSync(issueId));
