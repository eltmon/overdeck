import { describe, expect, it } from 'vitest';
import { HARNESS_ROW_LABELS, KIMI_NATIVE_EFFORT_LEVELS, expandHarnessRows, pickerEffortLevels } from '../harnessRows';

// PAN-4825: kimi-code/kimi-for-coding is K2.8 Preview (native low/high/max);
// kimi-code/kimi-for-coding-highspeed is K2.7 Code Highspeed (no adjustable effort).
describe('pickerEffortLevels', () => {
  it('offers the native Kimi levels for K2.8 Preview', () => {
    expect(pickerEffortLevels('kimi-code/kimi-for-coding')).toEqual(KIMI_NATIVE_EFFORT_LEVELS);
  });

  it('offers the Grok Build levels for grok/* models (PAN-5078)', () => {
    expect(pickerEffortLevels('grok/grok-4.6')).toEqual(['low', 'medium', 'high', 'xhigh']);
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

describe('expandHarnessRows Antigravity rows (PAN-5587)', () => {
  it('passes a Google row that already carries the antigravity harness through unchanged', () => {
    const row = { id: 'gemini-4-argon', label: 'Gemini 4 Argon (1M context) — Antigravity', provider: 'google', harness: 'antigravity' as const };
    expect(expandHarnessRows([row])).toEqual([row]);
  });

  it('labels the Antigravity route', () => {
    expect(HARNESS_ROW_LABELS.antigravity).toBe('Antigravity');
  });
});
