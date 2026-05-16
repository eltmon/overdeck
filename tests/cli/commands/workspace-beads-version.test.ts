import { describe, expect, it } from 'vitest';
import { __testInternals } from '../../../src/cli/commands/workspace.js';

const { encodeBeadsVersion, REDIRECT_MANAGED_BEADS_VERSION } = __testInternals;

describe('workspace beads version detection', () => {
  it('encodes beads v1.0.4 above the redirect-managed threshold', () => {
    expect(encodeBeadsVersion('bd 1.0.4')).toBe(10004);
    expect(encodeBeadsVersion('bd 1.0.4')).toBeGreaterThanOrEqual(REDIRECT_MANAGED_BEADS_VERSION);
  });

  it('does not route older beads versions through redirect-managed initialization', () => {
    expect(encodeBeadsVersion('0.47.1')).toBe(4701);
    expect(encodeBeadsVersion('0.47.1')).toBeLessThan(REDIRECT_MANAGED_BEADS_VERSION);
  });
});
