/**
 * The workspace head digest a review run id embeds (`agent-<issue>-review-<head8>`).
 * A leaf module so review-convoy.ts can check a saved run's currency without
 * importing review-agent.ts, which imports review-convoy.ts (PAN-5519).
 */
import { exec } from 'child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function deriveReviewRunHead8(issueId: string, workspace: string): Promise<string> {
  try {
    const { resolvePrimaryWorkspaceRepoDir, resolveWorkspaceRepoRoots } = await import('../project-repos.js');
    const roots = resolveWorkspaceRepoRoots(issueId, workspace);
    if (roots.some(root => root.isPolyrepo)) {
      const { snapshotWorkspaceHeads } = await import('../git-utils.js');
      const anchor = await snapshotWorkspaceHeads(issueId, workspace);
      return anchor
        ? createHash('sha1').update(anchor).digest('hex').substring(0, 8)
        : 'unknown';
    }

    // PAN-3037: the primary code repo is resolved through the shared helper —
    // the polyrepo wrapper's HEAD never moves, so a wrapper-derived runId would
    // mismatch every live run and kill a healthy convoy on each dispatch.
    const probeDir = resolvePrimaryWorkspaceRepoDir(issueId, workspace);
    const { stdout } = await execAsync(['git', 'rev-parse', '--short=8', 'HEAD'].join(' '), {
      cwd: probeDir,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
