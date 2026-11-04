/**
 * PAN-4640: recurrence rules for conversation schedules. A schedule stores a
 * 5-field cron and an IANA time zone; presets are sugar compiled here. croner
 * is used only to parse and compute the next occurrence — always paused, so it
 * never arms a timer.
 */
import { Cron } from 'croner';

export { presetToCron, type SchedulePreset } from '@overdeck/contracts';

export const MIN_SCHEDULE_SPACING_MS = 15 * 60_000;
const SPACING_SAMPLE = 24;

export type RecurrenceCheck = { ok: true } | { ok: false; error: string };

/** The time zone of the process creating the schedule (D10). */
export function defaultScheduleTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function validateRecurrence(cron: string, timeZone: string, now: Date): RecurrenceCheck {
  if (cron.trim().split(/\s+/).length !== 5) {
    return { ok: false, error: 'Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week)' };
  }
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone: ${timeZone}` };
  let job: Cron;
  try {
    job = new Cron(cron, { timezone: timeZone, paused: true });
  } catch (err) {
    return { ok: false, error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}` };
  }
  const runs = job.nextRuns(SPACING_SAMPLE, now);
  if (runs.length === 0) return { ok: false, error: 'Cron expression never fires' };
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].getTime() - runs[i - 1].getTime() < MIN_SCHEDULE_SPACING_MS) {
      return { ok: false, error: 'Schedules must be at least 15 minutes apart' };
    }
  }
  return { ok: true };
}

/** The first occurrence strictly after `after`, or null when the pattern never fires again. */
export function nextRunAfter(cron: string, timeZone: string, after: Date): Date | null {
  return new Cron(cron, { timezone: timeZone, paused: true }).nextRun(after);
}
