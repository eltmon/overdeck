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
import type { RemoteWorkspaceMetadata } from './interface.js';

// Path for workspace metadata
export const WORKSPACES_DIR = join(homedir(), '.panopticon', 'workspaces');

/**
 * Save workspace metadata to ~/.panopticon/workspaces/{issueId}.yaml
 */
export function saveWorkspaceMetadata(metadata: RemoteWorkspaceMetadata): void {
  if (!existsSync(WORKSPACES_DIR)) {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
  }

  const filename = join(WORKSPACES_DIR, `${metadata.id}.yaml`);
  writeFileSync(filename, stringify(metadata), 'utf-8');
}

/**
 * Load workspace metadata from ~/.panopticon/workspaces/{issueId}.yaml
 */
export function loadWorkspaceMetadata(issueId: string): RemoteWorkspaceMetadata | null {
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
export function listWorkspaceMetadata(): RemoteWorkspaceMetadata[] {
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
export function findRemoteWorkspaceMetadata(issueId: string): RemoteWorkspaceMetadata | null {
  return loadWorkspaceMetadata(issueId);
}

/**
 * Delete workspace metadata
 */
export function deleteWorkspaceMetadata(issueId: string): boolean {
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
