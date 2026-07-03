import { describe, expect, it } from 'vitest';
import { resolveTieredExecutionEnabled, TieredExecutionConfigError } from '../tier-table.js';

describe('resolveTieredExecutionEnabled', () => {
  it('returns true for an explicit per-issue on even when the global flag is off', () => {
    expect(resolveTieredExecutionEnabled({ enabled: false }, { tiered_execution: 'on' })).toBe(true);
  });

  it('returns false for an explicit per-issue off even when the global flag is on', () => {
    expect(resolveTieredExecutionEnabled({ enabled: true }, { tiered_execution: 'off' })).toBe(false);
  });

  it('inherits the global flag when the per-issue field is unset', () => {
    expect(resolveTieredExecutionEnabled({ enabled: true }, {})).toBe(true);
    expect(resolveTieredExecutionEnabled({ enabled: false }, {})).toBe(false);
    expect(resolveTieredExecutionEnabled({ enabled: true }, undefined)).toBe(true);
    expect(resolveTieredExecutionEnabled({ enabled: false }, undefined)).toBe(false);
  });

  it('throws a named error on an unrecognized override value instead of silently inheriting', () => {
    for (const bad of ['yes', 'true', true, false, 1] as const) {
      expect(() =>
        resolveTieredExecutionEnabled({ enabled: false }, { tiered_execution: bad }),
      ).toThrow(TieredExecutionConfigError);
    }
  });
});
