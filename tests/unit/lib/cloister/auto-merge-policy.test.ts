import { describe, it, expect } from 'vitest';
import { shouldHoldForUat } from '../../../../src/lib/cloister/auto-merge-policy.js';

describe('shouldHoldForUat (PAN-1691/1695 three-tier policy resolution)', () => {
  it('explicit Auto (true) never holds, whatever the project/global default', () => {
    expect(shouldHoldForUat(true, 'hold', true)).toBe(false);
    expect(shouldHoldForUat(true, undefined, true)).toBe(false);
  });

  it('explicit Hold (false) always holds', () => {
    expect(shouldHoldForUat(false, 'auto', false)).toBe(true);
    expect(shouldHoldForUat(false, undefined, false)).toBe(true);
  });

  it('undefined follows the per-project default when set', () => {
    // project 'auto' beats a global require-UAT
    expect(shouldHoldForUat(undefined, 'auto', true)).toBe(false);
    // project 'hold' holds even when global require-UAT is off
    expect(shouldHoldForUat(undefined, 'hold', false)).toBe(true);
  });

  it('undefined with no project default follows the global require-UAT', () => {
    expect(shouldHoldForUat(undefined, undefined, true)).toBe(true);
    expect(shouldHoldForUat(undefined, undefined, false)).toBe(false);
  });
});
