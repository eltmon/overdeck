import { Effect } from 'effect';

import type { ProjectConfig } from '../projects.js';
import { reconcileStatePlaneDrift } from '../pan-dir/auto-commit.js';
import type { PanIssueRecord } from '../pan-dir/record.js';
import { listIssueRecords } from '../pan-dir/record-list.js';
import { clearRecordPipelineClosedOut } from '../pan-dir/record-update.js';
import { readLiveTrackerIssueState, type LiveTrackerIssueState } from './issue-closed.js';

export interface StatePlaneReconcileAction {
  message: string;
  level: 'action' | 'warn';
}

export function statePlaneReconcileEveryCycles(patrolIntervalMs: number): number {
  return Math.max(1, Math.ceil((60 * 60 * 1000) / patrolIntervalMs));
}

export interface StatePlanePatrolDeps {
  listRecords: (project: ProjectConfig) => Promise<PanIssueRecord[]>;
  readTrackerState: (issueId: string) => Promise<LiveTrackerIssueState>;
  clearClosedOut: (
    project: ProjectConfig,
    issueId: string,
    reopenedAt: string,
  ) => Promise<boolean>;
  reconcileDrift: (projectPath: string) => Promise<{ committed: boolean; pushed?: boolean }>;
  now: () => string;
}

function defaultDeps(): StatePlanePatrolDeps {
  return {
    listRecords: listIssueRecords,
    readTrackerState: readLiveTrackerIssueState,
    clearClosedOut: (project, issueId, reopenedAt) => clearRecordPipelineClosedOut(
      project,
      issueId,
      { reopenedAt, autoCommit: false },
    ),
    reconcileDrift: (projectPath) => Effect.runPromise(reconcileStatePlaneDrift(projectPath)),
    now: () => new Date().toISOString(),
  };
}

export async function reconcileProjectStatePlanes(
  projects: Array<{ config: ProjectConfig }>,
  deps: StatePlanePatrolDeps = defaultDeps(),
): Promise<StatePlaneReconcileAction[]> {
  const actions: StatePlaneReconcileAction[] = [];
  const trackerStates = new Map<string, Promise<LiveTrackerIssueState>>();

  for (const { config } of projects) {
    if (!config.path) continue;
    const records = await deps.listRecords(config);
    const closedOutRecords = records.filter((record) => record.pipeline.closedOut === true);

    for (const record of closedOutRecords) {
      const issueId = record.issueId.toUpperCase();
      try {
        let trackerState = trackerStates.get(issueId);
        if (!trackerState) {
          trackerState = deps.readTrackerState(issueId);
          trackerStates.set(issueId, trackerState);
        }
        if (await trackerState === 'closed') continue;

        const reopenedAt = deps.now();
        if (await deps.clearClosedOut(config, issueId, reopenedAt)) {
          actions.push({
            message: `Cleared stale closedOut state for reopened ${issueId} at ${reopenedAt}`,
            level: 'action',
          });
        }
      } catch (error) {
        actions.push({
          message: `Preserved closedOut state for ${issueId}: live tracker reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
          level: 'warn',
        });
      }
    }

    const write = await deps.reconcileDrift(config.path);
    if (!write.committed) continue;
    actions.push({
      message: `Reconciled pending spec/record state for ${config.name ?? config.path}`,
      level: write.pushed === false ? 'warn' : 'action',
    });
  }
  return actions;
}
