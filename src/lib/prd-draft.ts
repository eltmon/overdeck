/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * Drafts are now stored in the owning project's `.pan/drafts/` directory.
 */

import { Effect } from 'effect';
import { ConfigError, FsError } from './errors.js';
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// All PRD draft helpers delegate to pan-dir; the only failure mode unique to
// this layer is resolveDraftProjectRoot throwing on missing project config.

const wrapConfigErr = (op: string) => (cause: unknown): ConfigError =>
  new ConfigError({
    message: `prd-draft.${op}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

/** Effect variant of {@link getPRDDraftPath}. */
export const getPRDDraftPathEffect = (issueId: string): Effect.Effect<string, ConfigError> =>
  Effect.try({ try: () => getPRDDraftPath(issueId), catch: wrapConfigErr('getPRDDraftPath') });

/** Effect variant of {@link hasPRDDraft}. */
export const hasPRDDraftEffect = (issueId: string): Effect.Effect<boolean, ConfigError> =>
  Effect.try({ try: () => hasPRDDraft(issueId), catch: wrapConfigErr('hasPRDDraft') });

/** Effect variant of {@link readPRDDraft}. */
export const readPRDDraftEffect = (issueId: string): Effect.Effect<string | null, ConfigError | FsError> =>
  Effect.try({ try: () => readPRDDraft(issueId), catch: wrapConfigErr('readPRDDraft') });

/** Effect variant of {@link writePRDDraft}. */
export const writePRDDraftEffect = (issueId: string, content: string): Effect.Effect<string, ConfigError | FsError> =>
  Effect.try({ try: () => writePRDDraft(issueId, content), catch: wrapConfigErr('writePRDDraft') });

/** Effect variant of {@link listPRDDrafts}. */
export const listPRDDraftsEffect = (issueIdOrProjectPath?: string): Effect.Effect<string[], ConfigError> =>
  Effect.try({ try: () => listPRDDrafts(issueIdOrProjectPath), catch: wrapConfigErr('listPRDDrafts') });

/** Effect variant of {@link deletePRDDraft}. */
export const deletePRDDraftEffect = (issueId: string): Effect.Effect<boolean, ConfigError | FsError> =>
  Effect.try({ try: () => deletePRDDraft(issueId), catch: wrapConfigErr('deletePRDDraft') });

/** Effect variant of {@link getPRDDraftInfo}. */
export const getPRDDraftInfoEffect = (
  issueId: string,
): Effect.Effect<{ exists: boolean; path?: string; size?: number; modified?: Date }, ConfigError> =>
  Effect.try({ try: () => getPRDDraftInfo(issueId), catch: wrapConfigErr('getPRDDraftInfo') });
