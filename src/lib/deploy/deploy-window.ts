import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect } from 'effect';

import {
  readDevSupervisorMarker,
  type DevSupervisorMarker,
} from '../dev-supervisor.js';
import { getFlywheelActiveRunId } from '../overdeck/control-settings.js';
import { getOverdeckHome } from '../paths.js';
import { loadReviewStatuses, type ReviewStatus } from '../review-status.js';
import { readRestartLockHolder, type RestartLockHolder } from '../restart-lock.js';
import { sessionExists } from '../tmux.js';

interface DeployWindowDependencies {
  readonly loadReviewStatuses: () => Record<string, ReviewStatus>;
  readonly getFlywheelActiveRunId: () => string | null;
  readonly isMergeAgentRunning: () => Promise<boolean>;
  readonly pendingPostMergeExists: () => Promise<boolean>;
  readonly readRestartLockHolder: () => Promise<RestartLockHolder | null>;
  readonly readDevSupervisorMarker: () => DevSupervisorMarker | null;
}

const defaultDependencies: DeployWindowDependencies = {
  loadReviewStatuses,
  getFlywheelActiveRunId,
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

export async function getDeployBlockReason(
  dependencies: Partial<DeployWindowDependencies> = {},
): Promise<string | null> {
  const deps = { ...defaultDependencies, ...dependencies };
  const verifyingIssues = Object.entries(deps.loadReviewStatuses())
    .filter(([, status]) => status.verificationStatus === 'running')
    .map(([issueId]) => issueId)
    .sort();

  if (verifyingIssues.length > 0) {
    return `Deployment deferred because verification is in flight for ${verifyingIssues.join(', ')}.`;
  }

  const activeFlywheelRunId = deps.getFlywheelActiveRunId();
  if (activeFlywheelRunId) {
    return `Deployment deferred because flywheel run ${activeFlywheelRunId} owns deployment.`;
  }

  if (await deps.isMergeAgentRunning()) {
    return 'Deployment deferred because a merge specialist session is active.';
  }

  if (await deps.pendingPostMergeExists()) {
    return 'Deployment deferred because the post-merge lifecycle is pending.';
  }

  const restartLock = await deps.readRestartLockHolder();
  if (restartLock) {
    return `Deployment deferred because a restart is already in progress (pid ${restartLock.pid}, ${restartLock.caller}).`;
  }

  if (deps.readDevSupervisorMarker()) {
    return 'Deployment deferred because a pan dev session owns the dashboard.';
  }

  return null;
}
