/**
 * Where a merge-train member's xBRIEF spec can live, in lookup order (PAN-4799).
 *
 * A spec is committed on the feature branch and reaches main only when the PR
 * merges, so every batch member's spec is missing from the project root. Look
 * in the batch worktree (every member merged in), then the member's own
 * feature workspace, then the project root (already-merged members).
 */
import type { UatGeneration } from '../../../lib/overdeck/merge-types.js';

export interface MemberSpecRootDeps {
  exists: (path: string) => boolean;
  /** Local feature-workspace path for the issue, or null (none, or remote). */
  featureWorkspacePath: (issueId: string) => string | null;
}

export function memberSpecRoots(
  issueId: string,
  chain: ReadonlyArray<Pick<UatGeneration, 'worktreePath' | 'cleanedAt' | 'members'>>,
  projectRoot: string,
  deps: MemberSpecRootDeps,
): string[] {
  const upper = issueId.toUpperCase();
  const roots: string[] = [];
  const batch = chain.find((gen) =>
    !gen.cleanedAt
    && gen.members.some((m) => m.issueId.toUpperCase() === upper)
    && deps.exists(gen.worktreePath));
  if (batch) roots.push(batch.worktreePath);
  const workspace = deps.featureWorkspacePath(upper);
  if (workspace && deps.exists(workspace)) roots.push(workspace);
  roots.push(projectRoot);
  return [...new Set(roots)];
}
