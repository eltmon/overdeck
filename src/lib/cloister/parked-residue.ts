import type { ProjectConfig } from '../projects.js';
import type { PanIssueRecord } from '../pan-dir/record.js';
import { listIssueRecords } from '../pan-dir/record-list.js';
import { acknowledgeAllOpenRecoveryTrips } from './recovery-trip.js';
import { clearAgentOperatorGatesForIssueSync } from '../agents/agent-state.js';
import type { StatePlaneReconcileAction } from './state-plane-patrol.js';

/**
 * Record-level terminality: closedOut is the durable close-out marker, and a
 * mergeStatus of 'merged' with no reopenedAt means the issue merged and was
 * never reopened afterward (reopen drops the stale mergeStatus — see
 * clearRecordPipelineClosedOut in record-update.ts). Shared with the parked
 * resolver's record-first terminality check (PAN-3727) so both surfaces agree
 * by construction on what counts as terminal.
 */
export function isRecordPipelineTerminal(record: Pick<PanIssueRecord, 'pipeline'>): boolean {
  if (!record.pipeline) return false;
  return record.pipeline.closedOut === true
    || (record.pipeline.mergeStatus === 'merged' && !record.pipeline.reopenedAt);
}

export interface ParkedResiduePatrolDeps {
  listRecords: (project: ProjectConfig) => Promise<PanIssueRecord[]>;
  ackTrips: (issueId: string) => Promise<number>;
  clearGates: (issueId: string) => string[];
}

function defaultDeps(): ParkedResiduePatrolDeps {
  return {
    listRecords: listIssueRecords,
    ackTrips: acknowledgeAllOpenRecoveryTrips,
    clearGates: clearAgentOperatorGatesForIssueSync,
  };
}

/**
 * Sweep every project's terminal-issue records for parked-population residue
 * left over from before close-out started acknowledging it (PAN-3727): open
 * recovery trips and operator-gate flags (stoppedByUser/paused/troubled) on a
 * terminal issue's stopped agent rows. Runs on the state-plane patrol cadence
 * so the backlog existing before this fix self-heals without a manual sweep,
 * and any future leak path is caught on the next cycle. A door failure for
 * one issue never stops the remaining issues.
 */
export async function reconcileTerminalIssueResidue(
  projects: Array<{ config: ProjectConfig }>,
  deps: ParkedResiduePatrolDeps = defaultDeps(),
): Promise<StatePlaneReconcileAction[]> {
  const actions: StatePlaneReconcileAction[] = [];

  for (const { config } of projects) {
    if (!config.path) continue;
    const records = await deps.listRecords(config);
    const terminalRecords = records.filter((record) => isRecordPipelineTerminal(record));

    for (const record of terminalRecords) {
      const issueId = record.issueId.toUpperCase();
      try {
        const trips = await deps.ackTrips(issueId);
        const gates = deps.clearGates(issueId);
        if (trips > 0 || gates.length > 0) {
          actions.push({
            message: `Cleaned parked residue for ${issueId}: acked ${trips} open trip(s), cleared operator gates on ${gates.length} agent row(s)`,
            level: 'action',
          });
        }
      } catch (error) {
        actions.push({
          message: `Failed to clean parked residue for ${issueId}: ${error instanceof Error ? error.message : String(error)}`,
          level: 'warn',
        });
      }
    }
  }

  return actions;
}
