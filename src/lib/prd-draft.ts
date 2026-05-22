/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * Drafts are now stored in the owning project's `.pan/drafts/` directory.
 */

import { Effect } from 'effect';
import { ConfigError, FsError } from './errors.js';
import { listProjectsSync, resolveProjectFromIssueSync } from './projects.js';
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
  const resolved = resolveProjectFromIssueSync(issueId);
  if (resolved?.projectPath) {
    return resolved.projectPath;
  }

  const projects = listProjectsSync();
  if (projects.length === 1 && projects[0]?.config.path) {
    return projects[0].config.path;
  }

  throw new Error(`Could not resolve project path for ${issueId}. Add the project to projects.yaml first.`);
}

export function getPRDDraftPathSync(issueId: string): string {
  return getIssueDraftPath(resolveDraftProjectRoot(issueId), issueId);
}function hasPRDDraftPromise(issueId: string): Promise<boolean> {
  return Effect.runPromise(hasIssueDraft(resolveDraftProjectRoot(issueId), issueId));
}function readPRDDraftPromise(issueId: string): Promise<string | null> {
  return Effect.runPromise(readIssueDraft(resolveDraftProjectRoot(issueId), issueId));
}function writePRDDraftPromise(issueId: string, content: string): Promise<string> {
  return Effect.runPromise(writeIssueDraft(resolveDraftProjectRoot(issueId), issueId, content));
}function listPRDDraftsPromise(issueIdOrProjectPath?: string): Promise<string[]> {
  if (issueIdOrProjectPath) {
    const projectPath = issueIdOrProjectPath.includes('/')
      ? issueIdOrProjectPath
      : resolveDraftProjectRoot(issueIdOrProjectPath);
    return Effect.runPromise(listIssueDrafts(projectPath));
  }

  const projects = listProjectsSync();
  if (projects.length === 1 && projects[0]?.config.path) {
    return Effect.runPromise(listIssueDrafts(projects[0].config.path));
  }

  return Promise.resolve([]);
}function deletePRDDraftPromise(issueId: string): Promise<boolean> {
  return Effect.runPromise(deleteIssueDraft(resolveDraftProjectRoot(issueId), issueId));
}function getPRDDraftInfoPromise(issueId: string): Promise<{
  exists: boolean;
  path?: string;
  size?: number;
  modified?: Date;
}> {
  return Effect.runPromise(getIssueDraftInfo(resolveDraftProjectRoot(issueId), issueId));
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

/** Effect variant of {@link getPRDDraftPathSync}. */
export const getPRDDraftPath = (issueId: string): Effect.Effect<string, ConfigError> =>
  Effect.try({ try: () => getPRDDraftPathSync(issueId), catch: wrapConfigErr('getPRDDraftPath') });

/** Effect variant of {@link hasPRDDraft}. */
export const hasPRDDraft = (issueId: string): Effect.Effect<boolean, ConfigError> =>
  Effect.tryPromise({ try: () => hasPRDDraftPromise(issueId), catch: wrapConfigErr('hasPRDDraft') });

/** Effect variant of {@link readPRDDraft}. */
export const readPRDDraft = (issueId: string): Effect.Effect<string | null, ConfigError | FsError> =>
  Effect.tryPromise({ try: () => readPRDDraftPromise(issueId), catch: wrapConfigErr('readPRDDraft') });

/** Effect variant of {@link writePRDDraft}. */
export const writePRDDraft = (issueId: string, content: string): Effect.Effect<string, ConfigError | FsError> =>
  Effect.tryPromise({ try: () => writePRDDraftPromise(issueId, content), catch: wrapConfigErr('writePRDDraft') });

/** Effect variant of {@link listPRDDrafts}. */
export const listPRDDrafts = (issueIdOrProjectPath?: string): Effect.Effect<string[], ConfigError> =>
  Effect.tryPromise({ try: () => listPRDDraftsPromise(issueIdOrProjectPath), catch: wrapConfigErr('listPRDDrafts') });

/** Effect variant of {@link deletePRDDraft}. */
export const deletePRDDraft = (issueId: string): Effect.Effect<boolean, ConfigError | FsError> =>
  Effect.tryPromise({ try: () => deletePRDDraftPromise(issueId), catch: wrapConfigErr('deletePRDDraft') });

/** Effect variant of {@link getPRDDraftInfo}. */
export const getPRDDraftInfo = (
  issueId: string,
): Effect.Effect<{ exists: boolean; path?: string; size?: number; modified?: Date }, ConfigError> =>
  Effect.tryPromise({ try: () => getPRDDraftInfoPromise(issueId), catch: wrapConfigErr('getPRDDraftInfo') });
