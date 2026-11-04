/**
 * PAN-4657: schedule preset compiler shared with the dashboard, moved out of
 * `src/lib/overdeck/conversation-schedule-recurrence.ts` (PAN-4640) so the
 * frontend can compile a preset to a cron expression without importing
 * server-side recurrence validation.
 */

export type SchedulePreset =
  | { kind: 'hourly' }
  | { kind: 'daily'; time: string } // 'HH:MM', 24-hour
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; day: string; time: string }; // day: sun|mon|tue|wed|thu|fri|sat

export const SCHEDULE_PRESET_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_NUMBERS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`Invalid time "${time}": expected HH:MM (24-hour)`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function presetToCron(preset: SchedulePreset): string {
  switch (preset.kind) {
    case 'hourly':
      return '0 * * * *';
    case 'daily': {
      const { hour, minute } = parseTime(preset.time);
      return `${minute} ${hour} * * *`;
    }
    case 'weekdays': {
      const { hour, minute } = parseTime(preset.time);
      return `${minute} ${hour} * * 1-5`;
    }
    case 'weekly': {
      const day = DAY_NUMBERS[preset.day.toLowerCase()];
      if (day === undefined) throw new Error(`Invalid day "${preset.day}": expected sun, mon, tue, wed, thu, fri or sat`);
      const { hour, minute } = parseTime(preset.time);
      return `${minute} ${hour} * * ${day}`;
    }
  }
}
