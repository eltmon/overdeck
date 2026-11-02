import { describe, expect, it } from 'vitest';

import { presetToCron } from '../conversation-schedule-presets';

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
