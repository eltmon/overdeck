import { describe, expect, it } from 'vitest';

import {
  isRoleTerminal,
} from '../../../src/lib/cloister/reap-terminal-sessions.js';

// PAN-3917: phases are derived from the forge (review approval/changes-requested,
// PR merged/mergeable) and the test role's verdict artifact — never a stored
// reviewStatus/testStatus/readyForMerge/mergeStatus field.
describe('reap-terminal-sessions — isRoleTerminal', () => {
  it('treats a settled review (approved or changes-requested) as terminal, an unsettled one as live', () => {
    expect(isRoleTerminal('review', { reviewSettled: true })).toBe(true);
    expect(isRoleTerminal('review', { reviewSettled: false })).toBe(false);
    expect(isRoleTerminal('review', {})).toBe(false);
  });

  it('treats a written test verdict as terminal, no verdict as live', () => {
    expect(isRoleTerminal('test', { testSettled: true })).toBe(true);
    expect(isRoleTerminal('test', { testSettled: false })).toBe(false);
    expect(isRoleTerminal('test', {})).toBe(false);
  });

  it('treats ship as terminal once merge-ready or merged', () => {
    expect(isRoleTerminal('ship', { mergeReady: true })).toBe(true);
    expect(isRoleTerminal('ship', { merged: true })).toBe(true);
    expect(isRoleTerminal('ship', { mergeReady: false, merged: false })).toBe(false);
    expect(isRoleTerminal('ship', {})).toBe(false);
  });
});


