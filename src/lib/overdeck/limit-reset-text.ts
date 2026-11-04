/**
 * Parses the reset instant out of a Claude Code usage-limit message
 * (PAN-4641 WI-1, FR-2).
 *
 * Claude Code writes `You've hit your session limit · resets 9am
 * (America/New_York)` or `… · resets Oct 1, 3pm (America/New_York)` on the
 * limit error record. The structured `quotaLimits.resetsAt` is the precise
 * source; this text is the fallback when that field is absent. The phrase
 * names a wall-clock time in an IANA zone, so the conversion to UTC goes
 * through that zone's offset at the target instant (DST-aware). Pure, no I/O.
 */

const RESET_PATTERN =
  /resets\s+(?:([A-Z][a-z]{2})\s+(\d{1,2}),\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function resolveZone(candidate: string | undefined): string {
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      // Unknown IANA name: fall back to the process zone.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(epochMs: number, zone: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month') - 1,
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The zone's UTC offset (ms) at `epochMs`: wall time read as UTC minus the instant. */
function zoneOffsetMs(epochMs: number, zone: string): number {
  const wall = wallParts(epochMs, zone);
  return Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second) - epochMs;
}

/** The UTC instant of a wall-clock time in `zone`. `day` may overflow; `Date.UTC` normalizes it. */
function wallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = guess - zoneOffsetMs(guess, zone);
  // Recompute at the candidate instant once so a DST transition between
  // `guess` and the real instant is applied.
  return guess - zoneOffsetMs(first, zone);
}

/** PAN-4641: the reset instant in a Claude Code limit message ("resets 9am (America/New_York)"). */
export function parseLimitResetText(text: string, at: Date): string | null {
  const match = RESET_PATTERN.exec(text);
  if (!match) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] = match;

  const hour = (Number(hourText) % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  const minute = minuteText ? Number(minuteText) : 0;
  const zone = resolveZone(zoneText?.trim());
  const atMs = at.getTime();
  const today = wallParts(atMs, zone);

  if (monthName) {
    const month = MONTHS.indexOf(monthName.toLowerCase());
    if (month < 0) return null;
    const day = Number(dayText);
    let result = wallTimeToUtc(today.year, month, day, hour, minute, zone);
    if (result <= atMs) result = wallTimeToUtc(today.year + 1, month, day, hour, minute, zone);
    return new Date(result).toISOString();
  }

  let result = wallTimeToUtc(today.year, today.month, today.day, hour, minute, zone);
  if (result <= atMs) result = wallTimeToUtc(today.year, today.month, today.day + 1, hour, minute, zone);
  return new Date(result).toISOString();
}
