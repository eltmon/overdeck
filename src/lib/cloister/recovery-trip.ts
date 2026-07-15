import type { PanIssueRecoveryTrip } from '../pan-dir/record.js';
import { updateIssueRecordForWorkspace } from '../pan-dir/record-update.js';

export async function recordRecoveryFailure(
  workspacePath: string,
  issue: string,
  recoveryPath: string,
  obligationGeneration: string,
  threshold = 25,
  now = new Date(),
): Promise<{ trip: PanIssueRecoveryTrip; emitNeedsYou: boolean }> {
  const normalized = issue.toUpperCase();
  let outcome!: { trip: PanIssueRecoveryTrip; emitNeedsYou: boolean };
  await updateIssueRecordForWorkspace(workspacePath, normalized, record => {
    const trips = [...(record.recoveryTrips ?? [])];
    const index = trips.findIndex(trip => trip.issue === normalized && trip.recoveryPath === recoveryPath && trip.obligationGeneration === obligationGeneration);
    const prior = index >= 0 ? trips[index] : undefined;
    if (prior?.open) {
      outcome = { trip: prior, emitNeedsYou: false };
      return record;
    }
    const tripCount = (prior?.tripCount ?? 0) + 1;
    const emitNeedsYou = tripCount >= threshold;
    const trip: PanIssueRecoveryTrip = {
      issue: normalized, recoveryPath, obligationGeneration, tripCount,
      open: emitNeedsYou,
      ...(prior?.needsYouEmittedAt ? { needsYouEmittedAt: prior.needsYouEmittedAt } : emitNeedsYou ? { needsYouEmittedAt: now.toISOString() } : {}),
    };
    if (index >= 0) trips[index] = trip; else trips.push(trip);
    outcome = { trip, emitNeedsYou };
    return { ...record, recoveryTrips: trips };
  });
  return outcome;
}

export async function acknowledgeRecoveryTrip(workspacePath: string, issue: string, recoveryPath: string, obligationGeneration: string): Promise<void> {
  const normalized = issue.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalized, record => ({
    ...record,
    recoveryTrips: (record.recoveryTrips ?? []).filter(trip => !(trip.issue === normalized && trip.recoveryPath === recoveryPath && trip.obligationGeneration === obligationGeneration)),
  }));
}
