/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * PRDs are stored in ~/.panopticon/docs/prds/drafts/ and can be
 * promoted to workspace .planning/PRD.md when implementation begins.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { join, basename } from 'path';
import { PRD_DRAFTS_DIR, PRD_PUBLISHED_DIR } from './paths.js';

/**
 * Get the file path for a pre-workspace PRD draft
 */
export function getPRDDraftPath(issueId: string): string {
  return join(PRD_DRAFTS_DIR, `${issueId.toUpperCase()}.md`);
}

/**
 * Check if a pre-workspace PRD draft exists
 */
export function hasPRDDraft(issueId: string): boolean {
  return existsSync(getPRDDraftPath(issueId));
}

/**
 * Read a pre-workspace PRD draft
 * Returns null if not found
 */
export function readPRDDraft(issueId: string): string | null {
  const path = getPRDDraftPath(issueId);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf-8');
}

/**
 * Create or update a pre-workspace PRD draft
 */
export function writePRDDraft(issueId: string, content: string): string {
  // Ensure drafts directory exists
  if (!existsSync(PRD_DRAFTS_DIR)) {
    mkdirSync(PRD_DRAFTS_DIR, { recursive: true });
  }

  const path = getPRDDraftPath(issueId);
  writeFileSync(path, content, 'utf-8');
  return path;
}

/**
 * List all PRD drafts
 * Returns array of issue IDs (filenames without .md extension)
 */
export function listPRDDrafts(): string[] {
  if (!existsSync(PRD_DRAFTS_DIR)) {
    return [];
  }

  return readdirSync(PRD_DRAFTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => basename(f, '.md'));
}

/**
 * Promote a PRD draft to a workspace
 * Moves the PRD from ~/.panopticon/docs/prds/drafts/ to <workspace>/.planning/PRD.md
 */
export function promotePRDToWorkspace(issueId: string, workspacePath: string): { success: boolean; error?: string } {
  const draftPath = getPRDDraftPath(issueId);

  if (!existsSync(draftPath)) {
    return { success: false, error: `No PRD draft found for ${issueId}` };
  }

  // Create .planning directory in workspace
  const planningDir = join(workspacePath, '.planning');
  if (!existsSync(planningDir)) {
    mkdirSync(planningDir, { recursive: true });
  }

  // Move PRD to workspace
  const targetPath = join(planningDir, 'PRD.md');
  try {
    // Copy content rather than move, so draft persists as backup
    const content = readFileSync(draftPath, 'utf-8');
    writeFileSync(targetPath, content, 'utf-8');

    // Move original to published folder
    if (!existsSync(PRD_PUBLISHED_DIR)) {
      mkdirSync(PRD_PUBLISHED_DIR, { recursive: true });
    }
    const publishedPath = join(PRD_PUBLISHED_DIR, `${issueId.toUpperCase()}.md`);
    renameSync(draftPath, publishedPath);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Delete a PRD draft
 */
export function deletePRDDraft(issueId: string): boolean {
  const path = getPRDDraftPath(issueId);
  if (!existsSync(path)) {
    return false;
  }

  try {
    // Move to a deleted folder for safety
    const deletedDir = join(PRD_DRAFTS_DIR, 'deleted');
    if (!existsSync(deletedDir)) {
      mkdirSync(deletedDir, { recursive: true });
    }
    const deletedPath = join(deletedDir, `${issueId.toUpperCase()}-${Date.now()}.md`);
    renameSync(path, deletedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get metadata about a PRD draft
 */
export function getPRDDraftInfo(issueId: string): {
  exists: boolean;
  path?: string;
  size?: number;
  modified?: Date;
} {
  const path = getPRDDraftPath(issueId);

  if (!existsSync(path)) {
    return { exists: false };
  }

  const stats = statSync(path);
  return {
    exists: true,
    path,
    size: stats.size,
    modified: stats.mtime,
  };
}
