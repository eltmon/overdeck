/**
 * The one end path of a shutdown (PAN-5342, D-9, D-10).
 *
 * Cancel (in the dashboard that runs the drain) and dashboard boot (after a
 * reboot, a `pan up`, or a crash mid-drain) both call `endShutdown(record)`: it
 * deletes the record, which reopens every admission door, then seeds the
 * PAN-5091 resume offer with every agent the drain stopped plus the
 * conversations that were mid-turn when the drain started (D-9). Idle
 * conversations are not offered; they resume when the operator opens them.
 */
import {
  deleteShutdownRecord,
  type ShutdownRecord,
  type ShutdownStoppedSession,
} from '../../../../lib/shutdown/drain-record.js';

export interface EndShutdownDeps {
  readonly deleteRecord: () => Promise<void>;
  readonly seedShutdownOffer: (sessions: readonly ShutdownStoppedSession[]) => void | Promise<void>;
}

/** Lazy: the recovery service is a heavy graph, and the drain must not import it at load. */
export async function seedShutdownOfferLazily(sessions: readonly ShutdownStoppedSession[]): Promise<void> {
  const { seedShutdownOffer } = await import('../backend-restart-recovery.js');
  seedShutdownOffer(sessions);
}

const defaultEndDeps: EndShutdownDeps = {
  deleteRecord: deleteShutdownRecord,
  seedShutdownOffer: seedShutdownOfferLazily,
};

/** The sessions the resume offer lists for this record (D-9). */
export function resumeOfferSessions(record: ShutdownRecord): ShutdownStoppedSession[] {
  return (record.stopped ?? []).filter((s) => s.kind === 'agent' || s.wasWorking);
}

export async function endShutdown(record: ShutdownRecord, overrides: Partial<EndShutdownDeps> = {}): Promise<number> {
  const deps = { ...defaultEndDeps, ...overrides };
  await deps.deleteRecord();
  const offered = resumeOfferSessions(record);
  try {
    await deps.seedShutdownOffer(offered);
  } catch (err) {
    console.warn('[shutdown] could not seed the resume offer:', err instanceof Error ? err.message : err);
  }
  return offered.length;
}
