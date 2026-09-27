/**
 * Which review artifact a merge lands (PAN-4263).
 *
 * The merge lands the PR `ensurePRExists` just resolved (open first), never
 * the persisted merge-set `artifact_url`: that URL is written when a PR first
 * opens and nothing refreshes it, so it can name a long-closed PR (PAN-3668
 * stored #3670 while #4251 was the open PR). A stale stored URL is
 * overwritten so later readers see the PR that merged.
 */

import { parseArtifactRef } from '../../../../lib/forge.js';
import type { MergeSet, MergeSetRepoState } from '../../../../lib/merge-set.js';

const sameArtifactUrl = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

export async function freshMergeArtifact(
  issueId: string,
  mergeSet: MergeSet | null | undefined,
  repo: MergeSetRepoState | undefined,
  prUrl: string,
): Promise<{ artifactUrl: string; artifactId: string | undefined }> {
  const number = parseArtifactRef(prUrl)?.number;
  const artifactId = number !== undefined ? String(number) : undefined;
  if (mergeSet && repo?.artifactUrl && !sameArtifactUrl(repo.artifactUrl, prUrl)) {
    console.log(`[merge] replacing stale stored artifact ${repo.artifactUrl} with ${prUrl} for ${issueId}`);
    const { upsertMergeSet, withRepoArtifactUrl } = await import('../../../../lib/merge-set.js');
    upsertMergeSet(withRepoArtifactUrl(mergeSet, repo.repoKey, prUrl, artifactId));
  }
  return { artifactUrl: prUrl, artifactId };
}
