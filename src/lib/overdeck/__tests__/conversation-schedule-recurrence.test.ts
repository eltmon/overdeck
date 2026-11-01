/**
 * PAN-4640: recurrence rules for conversation schedules. DST fixtures come from
 * a probe of croner 10.0.1 on 2026-11-01. Every test passes explicit instants;
 * nothing here depends on the wall clock or timers.
 */
import { describe, expect, it } from 'vitest';
import {
  isValidTimeZone,
  nextRunAfter,
  presetToCron,
  validateRecurrence,
} from '../conversation-schedule-recurrence.js';

const NY = 'America/New_York';

function chain(cron: string, timeZone: string, from: string, count: number): string[] {
  const runs: string[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < count; i++) {
    const next = nextRunAfter(cron, timeZone, cursor);
    if (!next) break;
    runs.push(next.toISOString());
    cursor = next;
  }
  return runs;
}

describe('nextRunAfter', () => {
  it('keeps 21:00 local across the spring-forward change', () => {
    expect(chain('0 21 * * *', NY, '2026-03-07T12:00:00Z', 2)).toEqual([
      '2026-03-08T02:00:00.000Z',
      '2026-03-09T01:00:00.000Z',
    ]);
  });

  it('shifts a nonexistent 02:30 to 03:30 EDT on the spring-forward day', () => {
    expect(chain('30 2 * * *', NY, '2026-03-07T00:00:00Z', 3)).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
    ]);
    expect(nextRunAfter('30 2 * * *', NY, new Date('2026-03-07T07:30:00.000Z'))?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('fires an ambiguous 01:30 once on the fall-back day', () => {
    expect(chain('30 1 * * *', NY, '2026-10-31T00:00:00Z', 3)).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
  });

  it('returns the occurrence strictly after the reference instant', () => {
    expect(nextRunAfter('0 21 * * *', 'UTC', new Date('2026-11-01T21:00:00.000Z'))?.toISOString()).toBe(
      '2026-11-02T21:00:00.000Z',
    );
  });
});

describe('validateRecurrence', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');

  it.each([
    ['61 * * * *', 'UTC', /^Invalid cron expression: /],
    ['0 21 * *', 'UTC', /^Cron expression must have exactly 5 fields \(minute hour day-of-month month day-of-week\)$/],
    ['0 0 21 * * *', 'UTC', /^Cron expression must have exactly 5 fields/],
    ['@daily', 'UTC', /^Cron expression must have exactly 5 fields/],
    ['0 21 * * *', 'Mars/Base', /^Unknown time zone: Mars\/Base$/],
    ['0 9 30 2 *', 'UTC', /^Cron expression never fires$/],
    ['*/5 * * * *', 'UTC', /^Schedules must be at least 15 minutes apart$/],
  ])('rejects %s in %s', (cron, zone, message) => {
    const result = validateRecurrence(cron, zone, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it.each(['*/15 * * * *', '0 * * * *', '0 21 * * *'])('accepts %s', (cron) => {
    expect(validateRecurrence(cron, NY, now)).toEqual({ ok: true });
  });
});

describe('presetToCron', () => {
  it('compiles each preset to a 5-field cron', () => {
    expect(presetToCron({ kind: 'hourly' })).toBe('0 * * * *');
    expect(presetToCron({ kind: 'daily', time: '21:00' })).toBe('0 21 * * *');
    expect(presetToCron({ kind: 'weekdays', time: '09:05' })).toBe('5 9 * * 1-5');
    expect(presetToCron({ kind: 'weekly', day: 'mon', time: '09:00' })).toBe('0 9 * * 1');
    expect(presetToCron({ kind: 'weekly', day: 'SUN', time: '00:00' })).toBe('0 0 * * 0');
  });

  it('throws on an invalid time or day', () => {
    expect(() => presetToCron({ kind: 'daily', time: '24:00' })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', day: 'xyz', time: '09:00' })).toThrow();
    expect(() => presetToCron({ kind: 'weekly', day: 'monday', time: '09:00' })).toThrow();
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});
