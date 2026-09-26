/**
 * Git history probe for the plan-freshness preflight (PAN-4212).
 *
 * Answers one question per path: when did a commit on the workspace's HEAD
 * history last delete it? Only HEAD is consulted — `--all` would walk the
 * turn-checkpoint refs under refs/pan/turn/*, where any file a session ever
 * drafted appears "tracked". Synchronous caller: `pan start` (CLI only).
 */

import { execFileSync } from 'node:child_process';

/** Returns a probe giving the epoch seconds of the last commit on HEAD that deleted `scope`, or null. */
export function headDeletionEpoch(workspace: string): (scope: string) => number | null {
  return (scope) => {
    try {
      const out = execFileSync(
        'git',
        ['log', '-1', '--no-renames', '--diff-filter=D', '--format=%ct', 'HEAD', '--', scope],
        { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      return out ? Number(out) : null;
    } catch {
      return null;
    }
  };
}
