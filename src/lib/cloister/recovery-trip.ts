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

/**
 * Acknowledge every open recovery trip on one issue via the record door.
 * Returns the count acked; unresolvable/unreadable issues return 0.
 *
 * Removes every open trip in ONE `updateIssueRecordForWorkspace` mutation
 * (one locked read/write/commit/push cycle) instead of one durable write per
 * trip — N open trips on close-out or the residue patrol previously meant N
 * serial git-backed writes for a single record (review finding, PAN-3727).
 * The write is atomic per issue: if the mutation itself fails (e.g. record
 * lock contention), the whole ack for that issue is warned and skipped
 * rather than partially applied — the caller's per-issue isolation (see
 * closeOut() and reconcileTerminalIssueResidue()) is what keeps one issue's
 * failure from blocking the rest.
 */
export async function acknowledgeAllOpenRecoveryTrips(issueId: string): Promise<number> {
  const normalized = issueId.toUpperCase();
  const resolved = resolveProjectFromIssueSync(normalized);
  if (!resolved) return 0;
  const project = getProjectSync(resolved.projectKey);
  if (!project) return 0;
  const record = await readIssueRecord(project, normalized);
  const openTrips = (record?.recoveryTrips ?? []).filter(trip => trip.open === true);
  if (openTrips.length === 0) return 0;

  const isOpenTrip = (trip: PanIssueRecoveryTrip) => openTrips.some(open =>
    trip.issue === open.issue && trip.recoveryPath === open.recoveryPath && trip.obligationGeneration === open.obligationGeneration);

  let acked = 0;
  try {
    await updateIssueRecordForWorkspace(resolved.projectPath, normalized, current => {
      const before = current.recoveryTrips ?? [];
      const remaining = before.filter(trip => !isOpenTrip(trip));
      acked = before.length - remaining.length;
      return { ...current, recoveryTrips: remaining };
    });
  } catch (error) {
    console.warn(`  ! failed to ack open trips for ${normalized}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  return acked;
}
