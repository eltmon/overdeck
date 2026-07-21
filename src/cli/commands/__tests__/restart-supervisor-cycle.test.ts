import { beforeEach, describe, expect, it, vi } from 'vitest';

const { systemdUserAvailableMock, isSupervisorUnitActiveMock } = vi.hoisted(() => ({
  systemdUserAvailableMock: vi.fn(),
  isSupervisorUnitActiveMock: vi.fn(),
}));

vi.mock('../../../lib/systemd.js', () => ({
  systemdUserAvailable: systemdUserAvailableMock,
  isSupervisorUnitActive: isSupervisorUnitActiveMock,
}));

import { shouldRunManualSupervisorCycle } from '../restart.js';

describe('shouldRunManualSupervisorCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemdUserAvailableMock.mockResolvedValue(false);
    isSupervisorUnitActiveMock.mockResolvedValue(false);
  });

  it('skips the manual cycle when the supervisor unit owns the supervisor', async () => {
    systemdUserAvailableMock.mockResolvedValue(true);
    isSupervisorUnitActiveMock.mockResolvedValue(true);

    await expect(shouldRunManualSupervisorCycle({})).resolves.toBe(false);
  });

  it('preserves the manual cycle when the unit is not active', async () => {
    systemdUserAvailableMock.mockResolvedValue(true);
    isSupervisorUnitActiveMock.mockResolvedValue(false);

    await expect(shouldRunManualSupervisorCycle({})).resolves.toBe(true);
  });

  it('preserves the existing explicit skip environment guard', async () => {
    await expect(shouldRunManualSupervisorCycle({ OVERDECK_SKIP_SUPERVISOR_CYCLE: '1' })).resolves.toBe(false);
    expect(systemdUserAvailableMock).not.toHaveBeenCalled();
  });
});
