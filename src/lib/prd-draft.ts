/**
 * Pre-workspace PRD Management
 *
 * Allows PRDs to be created and managed before a workspace exists.
 * Drafts are now stored in the owning project's `.pan/drafts/` directory.
 */

import { Effect } from 'effect';
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

export function getPRDDraftPath(issueId: string): string {
  return getIssueDraftPath(resolveDraftProjectRoot(issueId), issueId);
}

/**
 * Whether the issue has a draft PRD in its project's `.pan/drafts/`. Rejects
 * (never throws synchronously) when the issue's project cannot be resolved.
 */
export async function hasPRDDraft(issueId: string): Promise<boolean> {
  return Effect.runPromise(hasIssueDraft(resolveDraftProjectRoot(issueId), issueId));
}
