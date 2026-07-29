import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect } from 'effect';

import {
  readDevSupervisorMarker,
  type DevSupervisorMarker,
} from '../dev-supervisor.js';
import { getOverdeckHome } from '../paths.js';
import { readRestartLockHolder, type RestartLockHolder } from '../restart-lock.js';
import { sessionExists } from '../tmux.js';

/**
 * PAN-3244: the window guards only operations a dashboard restart would
 * genuinely corrupt (merge in progress, pending post-merge handoff, a restart
 * already running, a pan dev session owning the dashboard). Verification is
 * deliberately NOT a gate: supervised verification workers are detached
 * processes that survive restarts and write their results durably
 * (verification-worker-supervisor.ts, PAN-2669). An active flywheel run is
 * also NOT a gate: runs are near-continuous, so deferring to the flywheel
 * held queued deploys — and everything queued behind them — indefinitely.
 * Concurrent-deploy safety comes from the restart lock, not run ownership.
 */
export interface DeployWindowDependencies {
  readonly isMergeAgentRunning: () => Promise<boolean>;
  readonly pendingPostMergeExists: () => Promise<boolean>;
  readonly readRestartLockHolder: () => Promise<RestartLockHolder | null>;
  readonly readDevSupervisorMarker: () => DevSupervisorMarker | null;
}

const defaultDependencies: DeployWindowDependencies = {
  isMergeAgentRunning: () => Effect.runPromise(sessionExists('specialist-merge-agent')),
  pendingPostMergeExists: async () => {
    try {
      await access(join(getOverdeckHome(), 'pending-post-merge.json'));
      return true;
    } catch {
      return false;
    }
  },
  readRestartLockHolder: () => Effect.runPromise(readRestartLockHolder()),
  readDevSupervisorMarker,
};

export interface DeployWindowAssessment {
  readonly reason: string | null;
}

export async function getDeployWindowAssessment(
  dependencies: Partial<DeployWindowDependencies> = {},
): Promise<DeployWindowAssessment> {
  const deps = { ...defaultDependencies, ...dependencies };

  if (await deps.isMergeAgentRunning()) {
    return { reason: 'Deployment deferred because a merge specialist session is active.' };
  }

  if (await deps.pendingPostMergeExists()) {
    return { reason: 'Deployment deferred because the post-merge lifecycle is pending.' };
  }

  const restartLock = await deps.readRestartLockHolder();
  if (restartLock) {
    return {
      reason: `Deployment deferred because a restart is already in progress (pid ${restartLock.pid}, ${restartLock.caller}).`,
    };
  }

  if (deps.readDevSupervisorMarker()) {
    return { reason: 'Deployment deferred because a pan dev session owns the dashboard.' };
  }

  return { reason: null };
}

export async function getDeployBlockReason(
  dependencies: Partial<DeployWindowDependencies> = {},
): Promise<string | null> {
  return (await getDeployWindowAssessment(dependencies)).reason;
}
