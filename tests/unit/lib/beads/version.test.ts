import { describe, expect, it } from 'vitest';

import {
  MINIMUM_BD_VERSION,
  assertSupportedBdVersion,
  compareBdVersions,
  isSupportedBdVersion,
  parseBdVersion,
} from '../../../../src/lib/beads/version.js';

describe('bd version policy', () => {
  it('defines one minimum-compatible version', () => {
    expect(MINIMUM_BD_VERSION).toBe('1.1.0');
    expect(isSupportedBdVersion('1.1.0')).toBe(true);
    expect(isSupportedBdVersion('1.2.0')).toBe(true);
    expect(isSupportedBdVersion('1.0.4')).toBe(false);
  });

  it('parses CLI output and compares semantic versions', () => {
    expect(parseBdVersion('bd version 1.1.0 (abc)')).toBe('1.1.0');
    expect(compareBdVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('surfaces a standalone below-minimum error', () => {
    expect(() => assertSupportedBdVersion('1.0.4')).toThrow(
      'Installed bd 1.0.4 is below the required minimum 1.1.0; canonical Dolt synchronization and writes are blocked until bd is upgraded.',
    );
  });
});
