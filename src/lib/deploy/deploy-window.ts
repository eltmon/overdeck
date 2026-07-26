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

export interface DeployWindowDependencies {
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

export function listVerifyingIssues(
  loadStatuses: () => Record<string, ReviewStatus> = loadReviewStatuses,
): string[] {
  return Object.entries(loadStatuses())
    .filter(([, status]) => status.verificationStatus === 'running' && status.mergeStatus !== 'merged')
    .map(([issueId]) => issueId)
    .sort();
}

export interface DeployWindowAssessment {
  readonly reason: string | null;
  readonly verifyingIssues: string[];
}

export async function getDeployWindowAssessment(
  dependencies: Partial<DeployWindowDependencies> = {},
): Promise<DeployWindowAssessment> {
  const deps = { ...defaultDependencies, ...dependencies };
  const verifyingIssues = listVerifyingIssues(deps.loadReviewStatuses);

  if (verifyingIssues.length > 0) {
    return {
      reason: `Deployment deferred because verification is in flight for ${verifyingIssues.join(', ')}.`,
      verifyingIssues,
    };
  }

  const activeFlywheelRunId = deps.getFlywheelActiveRunId();
  if (activeFlywheelRunId) {
    return { reason: `Deployment deferred because flywheel run ${activeFlywheelRunId} owns deployment.`, verifyingIssues };
  }

  if (await deps.isMergeAgentRunning()) {
    return { reason: 'Deployment deferred because a merge specialist session is active.', verifyingIssues };
  }

  if (await deps.pendingPostMergeExists()) {
    return { reason: 'Deployment deferred because the post-merge lifecycle is pending.', verifyingIssues };
  }

  const restartLock = await deps.readRestartLockHolder();
  if (restartLock) {
    return {
      reason: `Deployment deferred because a restart is already in progress (pid ${restartLock.pid}, ${restartLock.caller}).`,
      verifyingIssues,
    };
  }

  if (deps.readDevSupervisorMarker()) {
    return { reason: 'Deployment deferred because a pan dev session owns the dashboard.', verifyingIssues };
  }

  return { reason: null, verifyingIssues };
}

export async function getDeployBlockReason(
  dependencies: Partial<DeployWindowDependencies> = {},
): Promise<string | null> {
  return (await getDeployWindowAssessment(dependencies)).reason;
}
