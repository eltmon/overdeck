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

  describe('record override precedence (PAN-2383)', () => {
    it('record override wins over plan-metadata and the global flag', () => {
      // record 'on' beats plan 'off' and global off
      expect(resolveTieredExecutionEnabled({ enabled: false }, { tiered_execution: 'off' }, 'on')).toBe(true);
      // record 'off' beats plan 'on' and global on
      expect(resolveTieredExecutionEnabled({ enabled: true }, { tiered_execution: 'on' }, 'off')).toBe(false);
    });

    it('record override alone wins over the global flag when no plan-metadata is set', () => {
      expect(resolveTieredExecutionEnabled({ enabled: false }, undefined, 'on')).toBe(true);
      expect(resolveTieredExecutionEnabled({ enabled: true }, undefined, 'off')).toBe(false);
    });

    it('an unset record override preserves the pre-existing plan-metadata > global result byte-for-byte', () => {
      for (const empty of [undefined, null] as const) {
        expect(resolveTieredExecutionEnabled({ enabled: false }, { tiered_execution: 'on' }, empty)).toBe(true);
        expect(resolveTieredExecutionEnabled({ enabled: true }, { tiered_execution: 'off' }, empty)).toBe(false);
        expect(resolveTieredExecutionEnabled({ enabled: true }, {}, empty)).toBe(true);
        expect(resolveTieredExecutionEnabled({ enabled: false }, {}, empty)).toBe(false);
        expect(resolveTieredExecutionEnabled({ enabled: true }, undefined, empty)).toBe(true);
        expect(resolveTieredExecutionEnabled({ enabled: false }, undefined, empty)).toBe(false);
      }
    });

    it('throws a named error on an invalid stored record override instead of silently inheriting', () => {
      for (const bad of ['yes', 'true', true, false, 1] as const) {
        expect(() =>
          resolveTieredExecutionEnabled({ enabled: true }, { tiered_execution: 'on' }, bad),
        ).toThrow(TieredExecutionConfigError);
      }
    });
  });
});
