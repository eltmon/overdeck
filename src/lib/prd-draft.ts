/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * Drafts are now stored in the owning project's `.pan/drafts/` directory.
 */

import { Effect } from 'effect';
import { ConfigError } from './errors.js';
import { listProjectsSync, resolveProjectFromIssueSync } from './projects.js';
import {
  getIssueDraftPath,
  hasIssueDraft,
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

/** Effect variant of {@link hasPRDDraft}. */
export const hasPRDDraft = (issueId: string): Effect.Effect<boolean, ConfigError> =>
  Effect.tryPromise({ try: () => hasPRDDraftPromise(issueId), catch: wrapConfigErr('hasPRDDraft') });
