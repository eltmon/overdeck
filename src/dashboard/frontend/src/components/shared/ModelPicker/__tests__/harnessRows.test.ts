import { describe, expect, it } from 'vitest';
import { KIMI_NATIVE_EFFORT_LEVELS, pickerEffortLevels } from '../harnessRows';

// PAN-4825: kimi-code/kimi-for-coding is K2.8 Preview (native low/high/max);
// kimi-code/kimi-for-coding-highspeed is K2.7 Code Highspeed (no adjustable effort).
describe('pickerEffortLevels', () => {
  it('offers the native Kimi levels for K2.8 Preview', () => {
    expect(pickerEffortLevels('kimi-code/kimi-for-coding')).toEqual(KIMI_NATIVE_EFFORT_LEVELS);
  });

  it('offers no effort for K2.7 Code Highspeed', () => {
    expect(pickerEffortLevels('kimi-code/kimi-for-coding-highspeed')).toEqual([]);
  });

  it('keeps the native Kimi levels for K3', () => {
    expect(pickerEffortLevels('kimi-code/k3')).toEqual(KIMI_NATIVE_EFFORT_LEVELS);
  });

  it('leaves claude-code models unrestricted', () => {
    expect(pickerEffortLevels('claude-sonnet-5-5')).toBeUndefined();
  });
});
