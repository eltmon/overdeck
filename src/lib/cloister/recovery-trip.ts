import { readIssueRecordForWorkspaceSync, writeIssueRecordForWorkspaceSync, type PanIssueRecoveryTrip } from '../pan-dir/record.js';
import { createMinimalIssueRecord } from './deacon-swarm-record.js';

export function recordRecoveryFailure(
  workspacePath: string,
  issue: string,
  recoveryPath: string,
  obligationGeneration: string,
  threshold = 25,
  now = new Date(),
): { trip: PanIssueRecoveryTrip; emitNeedsYou: boolean } {
  const normalized = issue.toUpperCase();
  const record = readIssueRecordForWorkspaceSync(workspacePath, normalized) ?? createMinimalIssueRecord(normalized);
  const trips = [...(record.recoveryTrips ?? [])];
  const index = trips.findIndex(trip => trip.issue === normalized && trip.recoveryPath === recoveryPath && trip.obligationGeneration === obligationGeneration);
  const prior = index >= 0 ? trips[index] : undefined;
  if (prior?.open) return { trip: prior, emitNeedsYou: false };
  const tripCount = (prior?.tripCount ?? 0) + 1;
  const emitNeedsYou = tripCount >= threshold && !prior?.open;
  const trip: PanIssueRecoveryTrip = {
    issue: normalized, recoveryPath, obligationGeneration, tripCount,
    open: prior?.open === true || emitNeedsYou,
    ...(prior?.needsYouEmittedAt ? { needsYouEmittedAt: prior.needsYouEmittedAt } : emitNeedsYou ? { needsYouEmittedAt: now.toISOString() } : {}),
  };
  if (index >= 0) trips[index] = trip; else trips.push(trip);
  writeIssueRecordForWorkspaceSync(workspacePath, normalized, { ...record, recoveryTrips: trips });
  return { trip, emitNeedsYou };
}

export function acknowledgeRecoveryTrip(workspacePath: string, issue: string, recoveryPath: string, obligationGeneration: string): void {
  const normalized = issue.toUpperCase();
  const record = readIssueRecordForWorkspaceSync(workspacePath, normalized);
  if (!record) return;
  writeIssueRecordForWorkspaceSync(workspacePath, normalized, {
    ...record,
    recoveryTrips: (record.recoveryTrips ?? []).filter(trip => !(trip.issue === normalized && trip.recoveryPath === recoveryPath && trip.obligationGeneration === obligationGeneration)),
  });
}
