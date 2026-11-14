/**
 * PAN-4753 WI-5: the workspace and branch a review of an issue reads.
 *
 * Every review site used to assume `workspaces/feature-<id>` on branch
 * `feature/<id>`. A strike (PAN-3973) lives in `workspaces/feature-<id>-strike`
 * on `strike/<id>`, so a strike-only issue could not be reviewed. The feature
 * workspace wins when it exists; otherwise the strike workspace; otherwise
 * there is nothing to review.
 */
import { existsSync } from 'node:fs';

import { resolveProjectFromIssueSync } from '../projects.js';

export interface ReviewTarget {
  kind: 'feature' | 'strike';
  workspacePath: string;
  branch: string;
}

export interface ReviewTargetDeps {
  /** The project checkout that owns the issue; `resolveProjectFromIssueSync` by default. */
  projectPath?: (issueId: string) => string | null | undefined;
  exists?: (path: string) => boolean;
}

/** The review target for `issueId`, or null when neither workspace exists. */
export function resolveReviewTarget(issueId: string, deps: ReviewTargetDeps = {}): ReviewTarget | null {
  const projectPath = (deps.projectPath ?? ((id: string) => resolveProjectFromIssueSync(id)?.projectPath))(issueId);
  if (!projectPath) return null;
  const exists = deps.exists ?? existsSync;
  const lower = issueId.toLowerCase();
  // Same string template as the strike merge door (`strike-merge.ts`), never join().
  const feature = `${projectPath}/workspaces/feature-${lower}`;
  if (exists(feature)) return { kind: 'feature', workspacePath: feature, branch: `feature/${lower}` };
  const strike = `${projectPath}/workspaces/feature-${lower}-strike`;
  if (exists(strike)) return { kind: 'strike', workspacePath: strike, branch: `strike/${lower}` };
  return null;
}
