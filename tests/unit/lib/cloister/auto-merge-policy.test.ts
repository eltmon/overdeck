import { describe, it, expect } from 'vitest';
import { projectHoldsForUat, shouldHoldForUat } from '../../../../src/lib/cloister/auto-merge-policy.js';

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

describe('projectHoldsForUat (PAN-3965: batch a single ready feature only when held)', () => {
  it('follows the project default, then the global flag', () => {
    expect(projectHoldsForUat({ auto_merge_default: 'hold' }, false)).toBe(true);
    expect(projectHoldsForUat({ auto_merge_default: 'auto' }, true)).toBe(false);
    expect(projectHoldsForUat({}, true)).toBe(true);
    expect(projectHoldsForUat({}, false)).toBe(false);
    expect(projectHoldsForUat({ auto_merge_default: 'bogus' }, false)).toBe(false);
    expect(projectHoldsForUat(null, true)).toBe(true);
  });
});
