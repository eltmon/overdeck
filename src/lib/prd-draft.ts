/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * Drafts are now stored in the owning project's `.pan/drafts/` directory.
 */

import { listProjects, resolveProjectFromIssue } from './projects.js';
import {
  deleteIssueDraft,
  getIssueDraftInfo,
  getIssueDraftPath,
  hasIssueDraft,
  listIssueDrafts,
  readIssueDraft,
  writeIssueDraft,
} from './pan-dir/index.js';

function resolveDraftProjectRoot(issueId: string): string {
  const resolved = resolveProjectFromIssue(issueId);
  if (resolved?.projectPath) {
    return resolved.projectPath;
  }

  const projects = listProjects();
  if (projects.length === 1 && projects[0]?.config.path) {
    return projects[0].config.path;
  }

  throw new Error(`Could not resolve project path for ${issueId}. Add the project to projects.yaml first.`);
}

export function getPRDDraftPath(issueId: string): string {
  return getIssueDraftPath(resolveDraftProjectRoot(issueId), issueId);
}

export function hasPRDDraft(issueId: string): boolean {
  return hasIssueDraft(resolveDraftProjectRoot(issueId), issueId);
}

export function readPRDDraft(issueId: string): string | null {
  return readIssueDraft(resolveDraftProjectRoot(issueId), issueId);
}

export function writePRDDraft(issueId: string, content: string): string {
  return writeIssueDraft(resolveDraftProjectRoot(issueId), issueId, content);
}

export function listPRDDrafts(issueIdOrProjectPath?: string): string[] {
  if (issueIdOrProjectPath) {
    const projectPath = issueIdOrProjectPath.includes('/')
      ? issueIdOrProjectPath
      : resolveDraftProjectRoot(issueIdOrProjectPath);
    return listIssueDrafts(projectPath);
  }

  const projects = listProjects();
  if (projects.length === 1 && projects[0]?.config.path) {
    return listIssueDrafts(projects[0].config.path);
  }

  return [];
}

export function deletePRDDraft(issueId: string): boolean {
  return deleteIssueDraft(resolveDraftProjectRoot(issueId), issueId);
}

export function getPRDDraftInfo(issueId: string): {
  exists: boolean;
  path?: string;
  size?: number;
  modified?: Date;
} {
  return getIssueDraftInfo(resolveDraftProjectRoot(issueId), issueId);
}
