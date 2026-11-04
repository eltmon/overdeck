/**
 * Reconnects the machine view's `/ws/rpc` stream as soon as the phone's link to the open machine
 * comes back (PAN-5046 FR-8, D-5), instead of waiting out the stream's reconnect backoff (up to
 * 10 s). Held composer messages then send through the usual flush. A stream that is already live is
 * never touched, so a healthy view and the first connection to a machine are left alone.
 */
import type { MachineDialer } from '@overdeck/anywhere-channel/web';

import type { ConnectionPhase } from '../../../../src/dashboard/frontend/src/lib/connectionState';

export interface LinkRecoveryDeps {
  dialer: Pick<MachineDialer, 'onRecovered'>;
  /** The machine the view is open on, if any. */
  currentEnvironmentId: () => string | null;
  phase: () => ConnectionPhase;
  requestReconnect: () => void;
}

/** Returns the uninstaller. */
export function installLinkRecovery({ dialer, currentEnvironmentId, phase, requestReconnect }: LinkRecoveryDeps): () => void {
  return dialer.onRecovered((environmentId) => {
    if (environmentId !== currentEnvironmentId() || phase() === 'live') return;
    requestReconnect();
  });
}
