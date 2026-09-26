/**
 * Host transports (PAN-3668 WI-6, FR-22, D5): the single rule for harnesses that run
 * behind an Overdeck host process with its own control socket.
 *
 * The transport is derived from `HarnessBehavior.deliveryKind`: `acp-host-rpc` → `acp`
 * (harnesses `acp` and `opencode`), `prime-agent-host-rpc` → `prime-agent`. Delivery,
 * messaging and readiness ask this module instead of comparing harness names, so a new
 * host-backed harness is one behavior entry, not a hunt for `=== 'acp'` pairs.
 *
 * File names follow `<transport>-token`, `<transport>-session-id` and
 * `<transport>-launch-error` in the agent directory, plus the socket
 * `$OVERDECK_HOME/sockets/<transport>-<agentId>.sock`. The ACP names are unchanged.
 */
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { getHarnessBehavior } from './behavior.js';
import type { HarnessName } from './types.js';

export type HostTransport = 'acp' | 'prime-agent';

export const HOST_TRANSPORTS: readonly HostTransport[] = ['acp', 'prime-agent'];

/** The host transport for `harness`, or null when it is not host-backed. Unknown strings are null. */
export function hostTransportFor(harness: string | null | undefined): HostTransport | null {
  if (!harness) return null;
  const kind = getHarnessBehavior(harness as HarnessName).deliveryKind;
  if (kind === 'acp-host-rpc') return 'acp';
  if (kind === 'prime-agent-host-rpc') return 'prime-agent';
  return null;
}

export function hostSocketPath(agentId: string, transport: HostTransport, home = getOverdeckHome()): string {
  return join(home, 'sockets', `${transport}-${agentId}.sock`);
}

export const hostTokenFile = (transport: HostTransport): string => `${transport}-token`;
export const hostSessionIdFile = (transport: HostTransport): string => `${transport}-session-id`;
export const hostLaunchErrorFile = (transport: HostTransport): string => `${transport}-launch-error`;

/** Short name used in delivery errors: "ACP delivery failed …", "Prime Agent delivery failed …". */
export const hostDisplayName = (transport: HostTransport): string => (transport === 'acp' ? 'ACP' : 'Prime Agent');

/** Name of the host process in readiness errors: "ACP host …", "Prime Agent host …". */
export const hostLabel = (transport: HostTransport): string => `${hostDisplayName(transport)} host`;
