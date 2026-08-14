import type { ProjectConfig } from '../projects.js';
import type { PanIssueRecord } from '../pan-dir/record.js';
import { listIssueRecords } from '../pan-dir/record-list.js';
import { acknowledgeAllOpenRecoveryTrips } from './recovery-trip.js';
import { clearAgentOperatorGatesForIssuesSync } from '../agents/agent-state.js';
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
  clearGatesForIssues: (issueIds: ReadonlySet<string>) => Map<string, string[]>;
}

function defaultDeps(): ParkedResiduePatrolDeps {
  return {
    listRecords: listIssueRecords,
    ackTrips: acknowledgeAllOpenRecoveryTrips,
    clearGatesForIssues: clearAgentOperatorGatesForIssuesSync,
  };
}

/**
 * Sweep every project's terminal-issue records for parked-population residue
 * left over from before close-out started acknowledging it (PAN-3727): open
 * recovery trips and operator-gate flags (stoppedByUser/paused/troubled) on a
 * terminal issue's stopped agent rows. Runs on the state-plane patrol cadence
 * so the backlog existing before this fix self-heals without a manual sweep,
 * and any future leak path is caught on the next cycle.
 *
 * Three passes, each isolating its own failure mode (review findings,
 * PAN-3727):
 *   1. Gather every terminal record across every project. A project whose
 *      record listing fails is warned and skipped — it must never abort the
 *      sweep for the remaining projects.
 *   2. Clear operator-gate residue for every terminal issue in ONE batched
 *      agent-table scan (not one scan per issue — cost scales with the agent
 *      table once per patrol run, not with the number of terminal issues).
 *   3. Acknowledge open recovery trips per issue (the record-write door is
 *      inherently per-record). A trip-ack failure for one issue is isolated
 *      to that issue and never suppresses the gate clearing already done in
 *      pass 2 — the two cleanup operations are independent residue.
 */
export async function reconcileTerminalIssueResidue(
  projects: Array<{ config: ProjectConfig }>,
  deps: ParkedResiduePatrolDeps = defaultDeps(),
): Promise<StatePlaneReconcileAction[]> {
  const actions: StatePlaneReconcileAction[] = [];

  const terminalIssueIds: string[] = [];
  for (const { config } of projects) {
    if (!config.path) continue;
    let records: PanIssueRecord[];
    try {
      records = await deps.listRecords(config);
    } catch (error) {
      actions.push({
        message: `Failed to list records for ${config.name ?? config.path}: ${error instanceof Error ? error.message : String(error)}`,
        level: 'warn',
      });
      continue;
    }
    for (const record of records) {
      if (isRecordPipelineTerminal(record)) terminalIssueIds.push(record.issueId.toUpperCase());
    }
  }

  if (terminalIssueIds.length === 0) return actions;

  const gatesByIssue = deps.clearGatesForIssues(new Set(terminalIssueIds));

  for (const issueId of terminalIssueIds) {
    const gates = gatesByIssue.get(issueId) ?? [];
    let trips = 0;
    try {
      trips = await deps.ackTrips(issueId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.push({
        message: `Failed to acknowledge open trips for ${issueId}: ${message}`
          + (gates.length > 0 ? `; cleared operator gates on ${gates.length} agent row(s)` : ''),
        level: 'warn',
      });
      continue;
    }
    if (trips > 0 || gates.length > 0) {
      actions.push({
        message: `Cleaned parked residue for ${issueId}: acked ${trips} open trip(s), cleared operator gates on ${gates.length} agent row(s)`,
        level: 'action',
      });
    }
  }

  return actions;
}
