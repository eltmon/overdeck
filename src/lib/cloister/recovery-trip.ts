import type { PanIssueRecoveryTrip } from '../pan-dir/record.js';
import { readIssueRecord } from '../pan-dir/record.js';
import { updateIssueRecordForWorkspace } from '../pan-dir/record-update.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

/**
 * PAN-3092: read an existing trip without taking the per-issue record lock.
 *
 * A caller that surfaces lock contention needs to know whether it has already
 * surfaced this episode, and it cannot learn that from a path that takes the
 * contended lock. Best-effort: an unreadable record returns undefined, which
 * callers must treat as "not yet surfaced" so a first warning is never lost.
 */
export async function findRecoveryTrip(
  issue: string,
  recoveryPath: string,
  obligationGeneration: string,
): Promise<PanIssueRecoveryTrip | undefined> {
  const normalized = issue.toUpperCase();
  try {
    const resolved = resolveProjectFromIssueSync(normalized);
    if (!resolved) return undefined;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return undefined;
    const record = await readIssueRecord(project, normalized);
    return (record?.recoveryTrips ?? []).find(trip =>
      trip.issue === normalized
      && trip.recoveryPath === recoveryPath
      && trip.obligationGeneration === obligationGeneration);
  } catch {
    return undefined;
  }
}

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
