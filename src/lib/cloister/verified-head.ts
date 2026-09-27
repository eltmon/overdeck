/**
 * Resolve the primary repo's sha out of a workspace HEAD anchor (PAN-2948:
 * a polyrepo anchor is a composite `fe@<sha> api@<sha>` string, not a plain
 * sha — slicing it directly yields garbage).
 */
import { parseCompositeSnapshot, type HeadAnchor } from '../git-utils.js';

export function primaryShaFromAnchor(anchor: HeadAnchor | string | undefined, primaryRepoKey: string | undefined): string | undefined {
  if (!anchor) return undefined;
  const composite = parseCompositeSnapshot(anchor);
  if (composite.size === 0) return anchor;
  return (primaryRepoKey && composite.get(primaryRepoKey)) ?? [...composite.values()][0];
}

/** Snapshot the workspace and resolve the primary repo's short (8-char) sha. Never throws. */
export async function readPrimaryHead8(issueId: string, workspacePath: string): Promise<string | undefined> {
  try {
    const { snapshotWorkspaceHeads } = await import('../git-utils.js');
    const { resolveWorkspaceRepoRoots } = await import('../project-repos.js');
    const anchor = await snapshotWorkspaceHeads(issueId, workspacePath);
    const primaryRepoKey = resolveWorkspaceRepoRoots(issueId, workspacePath)[0]?.repoKey;
    return primaryShaFromAnchor(anchor, primaryRepoKey)?.slice(0, 8);
  } catch {
    return undefined;
  }
}
