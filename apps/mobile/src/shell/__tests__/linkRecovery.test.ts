import { describe, expect, it, vi } from 'vitest';

import type { ConnectionPhase } from '../../../../../src/dashboard/frontend/src/lib/connectionState';
import { installLinkRecovery } from '../linkRecovery';

function setup(phase: ConnectionPhase) {
  let listener: ((environmentId: string) => void) | null = null;
  const dialer = {
    onRecovered: vi.fn((l: (environmentId: string) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  };
  const requestReconnect = vi.fn();
  const uninstall = installLinkRecovery({ dialer, currentEnvironmentId: () => 'env-current', phase: () => phase, requestReconnect });
  return { recover: (id: string) => listener?.(id), requestReconnect, uninstall };
}

describe('installLinkRecovery (PAN-5046 FR-8)', () => {
  it('requests a reconnect when the current machine recovers and the phase is not live', () => {
    const { recover, requestReconnect } = setup('unreachable');
    recover('env-current');
    expect(requestReconnect).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the phase is live', () => {
    const { recover, requestReconnect } = setup('live');
    recover('env-current');
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  it('does nothing for another machine', () => {
    const { recover, requestReconnect } = setup('delayed');
    recover('env-other');
    expect(requestReconnect).not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    const { recover, requestReconnect, uninstall } = setup('delayed');
    uninstall();
    recover('env-current');
    expect(requestReconnect).not.toHaveBeenCalled();
  });
});
