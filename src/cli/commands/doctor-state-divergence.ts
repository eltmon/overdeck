import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readPushHealth, RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD } from '../../lib/pan-dir/push-health.js';
import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';
import { resolveStateReadHomeSync, STATE_BRANCH } from '../../lib/state-read-home.js';

const execFileAsync = promisify(execFile);
const STATE_FETCH_TIMEOUT_MS = 10_000;

interface StateDivergenceCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

async function git(gitRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: gitRoot,
    encoding: 'utf8',
    timeout: STATE_FETCH_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function checkStateDivergence(
  projects: Array<{ key: string; config: ProjectConfig }> = listProjectsSync(),
): Promise<StateDivergenceCheck[]> {
  const checks = await Promise.all(projects.map(async ({ key, config }): Promise<StateDivergenceCheck | null> => {
    const stateHome = resolveStateReadHomeSync(config, key);
    if (!stateHome.migrated) return null;

    const name = `State Divergence: ${key} (${config.name})`;
    let stale = false;
    try {
      await git(stateHome.root, ['fetch', 'origin', STATE_BRANCH]);
    } catch {
      stale = true;
    }

    try {
      const counts = await git(stateHome.root, [
        'rev-list',
        '--left-right',
        '--count',
        `${STATE_BRANCH}...origin/${STATE_BRANCH}`,
      ]);
      const [aheadText = '0', behindText = '0'] = counts.split(/\s+/);
      const ahead = Number.parseInt(aheadText, 10);
      const behind = Number.parseInt(behindText, 10);
      const health = readPushHealth(config);
      const streak = health.consecutiveReconcileFailures;
      const status = streak >= RECONCILE_FAILURE_NEEDS_YOU_THRESHOLD
        ? 'error'
        : streak >= 1 || ahead >= 10
          ? 'warn'
          : 'ok';
      const staleSuffix = stale ? ' (stale — fetch failed)' : '';
      const failureSuffix = health.lastFailureReason ? `; last failure: ${health.lastFailureReason}` : '';
      const check: StateDivergenceCheck = {
        name,
        status,
        message: `overdeck-state is ${ahead} ahead / ${behind} behind origin${staleSuffix}; reconcile failure streak: ${streak}${failureSuffix}`,
      };
      if (status !== 'ok') {
        check.fix = `Run "git merge origin/${STATE_BRANCH}" in ${stateHome.root} and resolve the named paths; records/*.json regenerate on their next write.`;
      }
      return check;
    } catch (error) {
      return {
        name,
        status: 'warn',
        message: `Could not read overdeck-state divergence${stale ? ' after the fetch failed' : ''}: ${error instanceof Error ? error.message : String(error)}`,
        fix: `Verify origin/${STATE_BRANCH} exists for ${stateHome.root}, then run pan doctor again.`,
      };
    }
  }));

  return checks.filter((check): check is StateDivergenceCheck => check !== null);
}
