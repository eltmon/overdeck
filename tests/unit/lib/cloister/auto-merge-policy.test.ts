import { beforeEach, describe, it, expect, vi } from 'vitest';

const policyMocks = vi.hoisted(() => ({
  projects: new Map<string, { merge_train?: 'enabled' | 'disabled' }>(),
  isMergeTrainEnabled: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn((key: string) => policyMocks.projects.get(key) ?? null),
}));

vi.mock('../../../../src/lib/database/app-settings.js', () => ({
  isMergeTrainEnabled: policyMocks.isMergeTrainEnabled,
}));

import { isMergeTrainEnabledForProject, shouldHoldForUat } from '../../../../src/lib/cloister/auto-merge-policy.js';

beforeEach(() => {
  policyMocks.projects.clear();
  policyMocks.isMergeTrainEnabled.mockReset();
  policyMocks.isMergeTrainEnabled.mockReturnValue(false);
});

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

describe('isMergeTrainEnabledForProject (PAN-1696 per-project override)', () => {
  it('lets project disabled override global ON', () => {
    policyMocks.projects.set('pan', { merge_train: 'disabled' });
    policyMocks.isMergeTrainEnabled.mockReturnValue(true);

    expect(isMergeTrainEnabledForProject('pan')).toBe(false);
    expect(policyMocks.isMergeTrainEnabled).not.toHaveBeenCalled();
  });

  it('lets project enabled override global OFF', () => {
    policyMocks.projects.set('pan', { merge_train: 'enabled' });
    policyMocks.isMergeTrainEnabled.mockReturnValue(false);

    expect(isMergeTrainEnabledForProject('pan')).toBe(true);
    expect(policyMocks.isMergeTrainEnabled).not.toHaveBeenCalled();
  });

  it('falls back to the global flag when the project override is absent', () => {
    policyMocks.projects.set('pan', {});
    policyMocks.isMergeTrainEnabled.mockReturnValue(true);

    expect(isMergeTrainEnabledForProject('pan')).toBe(true);
    expect(policyMocks.isMergeTrainEnabled).toHaveBeenCalledTimes(1);
  });
});
