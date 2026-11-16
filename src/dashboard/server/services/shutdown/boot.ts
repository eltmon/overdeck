/**
 * Shutdown services at dashboard boot (PAN-5342, WI-7 step 1, D-10, D-13).
 *
 * A shutdown record left from the last run (a reboot after the final stage, a
 * `pan up`, or a crash mid-drain) ends through the same `endShutdown(record)`
 * a cancel runs: the record is deleted, so admissions reopen, and the resume
 * offer is seeded. Nothing resumes on its own (FR-10). Then the reboot guard
 * starts (WI-8).
 *
 * A record file that exists but does not parse is deleted too: otherwise every
 * launch door stays shut until someone removes it by hand, and D-1 says the
 * next boot consumes any leftover record.
 *
 * Runs as a top-level await before the server binds, so it never throws.
 */
import {
  deleteShutdownRecord,
  isShutdownDrainingSync,
  readShutdownRecord,
  type ShutdownRecord,
} from '../../../../lib/shutdown/drain-record.js';
import { endShutdown } from './end.js';
import { startRebootGuard } from './reboot-guard.js';

export interface ShutdownBootDeps {
  readonly readRecord: () => Promise<ShutdownRecord | null>;
  readonly recordFileExists: () => boolean;
  readonly deleteRecord: () => Promise<void>;
  readonly endShutdown: (record: ShutdownRecord) => Promise<number>;
  readonly startRebootGuard: () => void;
}

const defaultBootDeps: ShutdownBootDeps = {
  readRecord: readShutdownRecord,
  recordFileExists: isShutdownDrainingSync,
  deleteRecord: deleteShutdownRecord,
  endShutdown: (record) => endShutdown(record),
  startRebootGuard: () => startRebootGuard(),
};

export async function startShutdownServices(overrides: Partial<ShutdownBootDeps> = {}): Promise<void> {
  const deps = { ...defaultBootDeps, ...overrides };
  try {
    const record = await deps.readRecord();
    if (record) {
      const offered = await deps.endShutdown(record);
      console.log(`[shutdown] boot ended a shutdown record from ${record.startedAt}: offering ${offered} sessions`);
    } else if (deps.recordFileExists()) {
      await deps.deleteRecord();
      console.warn('[shutdown] boot deleted an unreadable shutdown record; nothing to offer');
    }
  } catch (err) {
    console.error('[shutdown] boot could not end the shutdown record:', err instanceof Error ? err.message : err);
  }
  try {
    deps.startRebootGuard();
  } catch (err) {
    console.error('[shutdown] reboot guard did not start:', err instanceof Error ? err.message : err);
  }
}
