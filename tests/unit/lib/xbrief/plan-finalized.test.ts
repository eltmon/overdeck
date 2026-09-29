import { describe, expect, it } from 'vitest';
import {
  PLAN_FINALIZED_TRAILER,
  formatPlanFinalizedTrailer,
  isLegacyFinalizeSubject,
  planFinalizedHash,
} from '../../../../src/lib/xbrief/plan-finalized.js';

describe('plan-finalized trailer helper (PAN-1728)', () => {
  it('hashes bytes with SHA-256 hex', () => {
    expect(planFinalizedHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(planFinalizedHash(Buffer.from('abc'))).toBe(planFinalizedHash('abc'));
  });

  it('formats the trailer line', () => {
    expect(PLAN_FINALIZED_TRAILER).toBe('Plan-Finalized');
    expect(formatPlanFinalizedTrailer('deadbeef')).toBe('Plan-Finalized: deadbeef');
  });

  it('matches the legacy finalize subject case-insensitively for the exact issue', () => {
    expect(isLegacyFinalizeSubject('chore(plan): complete planning for pan-1', 'PAN-1')).toBe(true);
    expect(isLegacyFinalizeSubject('  chore(plan): complete planning for PAN-1\n', 'pan-1')).toBe(true);
    expect(isLegacyFinalizeSubject('chore(plan): complete planning for pan-1', 'PAN-12')).toBe(false);
    expect(isLegacyFinalizeSubject('chore(plan): complete planning for PAN-12', 'PAN-1')).toBe(false);
  });
});
